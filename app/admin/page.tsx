'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';

export default function AdminOverview() {
  const [stats, setStats] = useState({
    totalOrganizations: 0,
    pendingApplications: 0,
    activeProducts: 0,
    totalUsers: 0,
  });

  const [recentApplications, setRecentApplications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // For tenant (ORG_ADMIN) scoped views: correct welcome text + card labels + scoped counts
  const [tenantOrgId, setTenantOrgId] = useState<string | null>(null);
  const [currentRole, setCurrentRole] = useState<string>('');
  const [currentOrgName, setCurrentOrgName] = useState<string>('');

  useEffect(() => {
    loadDashboardData();
  }, []);

  async function loadDashboardData() {
    try {
      // Determine scope for tenant ORG_ADMIN (L1) vs super. Use profile (source of truth).
      let scopeOrgId: string | null = null;
      let role = '';
      let orgName = '';
      try {
        const { data: { user: au } } = await supabase.auth.getUser();
        if (au) {
          let { data: prof } = await supabase.from('profiles').select('role, organization_id').eq('id', au.id).maybeSingle();
          if (prof?.role && (prof.role === 'ADMIN' || prof.role === 'ORG_ADMIN' || prof.role === 'SUPER_ADMIN') && prof.organization_id) {
            scopeOrgId = prof.organization_id;
            role = prof.role;
          }
          if (scopeOrgId) {
            const { data: orgRow } = await supabase
              .from('organizations')
              .select('name')
              .eq('id', scopeOrgId)
              .maybeSingle();
            orgName = orgRow?.name || '';
          }
        }
      } catch {}

      setCurrentRole(role);
      setCurrentOrgName(orgName);
      setTenantOrgId(scopeOrgId);

      let totalOrganizations: number;
      let totalUsers: number;

      if (scopeOrgId && role === 'ORG_ADMIN') {
        // Tenant view: only their sponsored children (matches the "Organizations" list for ORG_ADMIN)
        const { count: childOrgs } = await supabase
          .from('organizations')
          .select('*', { count: 'exact' })
          .eq('parent_organization_id', scopeOrgId)
          .eq('approved', true);
        totalOrganizations = childOrgs || 0;

        // Users belonging to this org (the L1's own team; subpage + detail preview use the same)
        const { count: orgUsers } = await supabase
          .from('profiles')
          .select('*', { count: 'exact' })
          .eq('organization_id', scopeOrgId);
        totalUsers = orgUsers || 0;
      } else {
        // Super / global view
        const { count: co } = await supabase
          .from('organizations')
          .select('*', { count: 'exact' })
          .neq('name', 'Loan-App Platform');
        totalOrganizations = co || 0;

        const { count: cu } = await supabase
          .from('profiles')
          .select('*', { count: 'exact' });
        totalUsers = cu || 0;
      }

      // Active Products: already was scoped for ORG_ADMIN to their org
      let prodQuery = supabase.from('loan_products').select('*', { count: 'exact' }).eq('active', true);
      if (scopeOrgId) {
        prodQuery = prodQuery.eq('organization_id', scopeOrgId);
      }
      const { count: activeProducts } = await prodQuery;

      // Pending Applications + Recent: use SAFE client-side filtering for ORG_ADMIN (L1 tenant) to avoid
      // PostgREST 400s on .or() queries (the exact failing URLs seen in console: status=eq.pending&or=(parent_organization_id.eq.org_...)).
      // Matches the pattern in /api/pending-organizations/route.ts (full fetch then filter on parent or documents._intended...).
      let pendingApplications = 0;
      let recent: any[] = [];

      const basePendingQuery = supabase
        .from('pending_organizations')
        .select('id, status, parent_organization_id, documents, created_at, company_name, contact_name, email')
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      const { data: allPending } = await basePendingQuery;

      let scopedPending = allPending || [];
      if (scopeOrgId && role === 'ORG_ADMIN') {
        scopedPending = scopedPending.filter((r: any) => {
          const docs = (r.documents || {}) as any;
          const intended = docs?._intended_parent_organization_id || r.parent_organization_id || null;
          return intended === scopeOrgId;
        });
        console.log('[AdminOverview] scoped pending for ORG_ADMIN', scopeOrgId, 'kept:', scopedPending.length, 'of', (allPending || []).length);
      }

      pendingApplications = scopedPending.length;
      recent = scopedPending.slice(0, 5);

      setStats({
        totalOrganizations,
        pendingApplications: pendingApplications || 0,
        activeProducts: activeProducts || 0,
        totalUsers,
      });

      setRecentApplications(recent || []);
    } catch (error) {
      console.error('Dashboard data error:', error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return <div className="p-10 text-center text-xl">Loading dashboard...</div>;
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-10">
        <h1 className="text-4xl font-bold">Admin Overview</h1>
        <p className="text-gray-500">
          Welcome back{currentOrgName ? `, ${currentOrgName}` : ''}
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
        <div className="bg-white rounded-3xl p-8 border shadow-sm">
          <p className="text-gray-500 text-sm">{tenantOrgId ? 'Child Organizations' : 'Total Organizations'}</p>
          <p className="text-5xl font-bold mt-4">{stats.totalOrganizations}</p>
        </div>

        <div className="bg-white rounded-3xl p-8 border shadow-sm relative overflow-hidden">
          <p className="text-gray-500 text-sm">Pending Applications</p>
          <p className="text-5xl font-bold mt-4 text-amber-600">{stats.pendingApplications}</p>
          {stats.pendingApplications > 0 && (
            <Link 
              href="/admin/applications" 
              className="absolute bottom-6 right-6 text-amber-600 hover:underline text-sm font-medium"
            >
              Review Now →
            </Link>
          )}
        </div>

        <div className="bg-white rounded-3xl p-8 border shadow-sm">
          <p className="text-gray-500 text-sm">Active Products</p>
          <p className="text-5xl font-bold mt-4">{stats.activeProducts}</p>
        </div>

        <div className="bg-white rounded-3xl p-8 border shadow-sm">
          <p className="text-gray-500 text-sm">Total Users</p>
          <p className="text-5xl font-bold mt-4">{stats.totalUsers}</p>
        </div>
      </div>

      {/* Recent Applications */}
      <div className="bg-white rounded-3xl border p-8">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-semibold">Recent Applications</h2>
          <Link href="/admin/applications" className="text-blue-600 hover:underline font-medium">
            View All Applications →
          </Link>
        </div>

        {recentApplications.length === 0 ? (
          <p className="text-gray-500 py-12 text-center">No recent applications.</p>
        ) : (
          <div className="divide-y">
            {recentApplications.map((app) => (
              <div key={app.id} className="py-6 flex justify-between items-center">
                <div>
                  <h4 className="font-semibold">{app.company_name}</h4>
                  <p className="text-sm text-gray-600">{app.contact_name} • {app.email}</p>
                </div>
                <div className="text-right">
                  <span className="text-xs bg-yellow-100 text-yellow-700 px-3 py-1 rounded-full">
                    Pending
                  </span>
                  <p className="text-xs text-gray-400 mt-2">
                    {new Date(app.created_at).toLocaleDateString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
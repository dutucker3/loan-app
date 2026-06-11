'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';

type TimeRange = 'weekly' | 'monthly' | 'quarterly' | 'ytd' | '1year';

export default function AdminReportingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState('');
  const [currentOrgId, setCurrentOrgId] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>('monthly');
  const [loans, setLoans] = useState<any[]>([]);
  const [orgsMap, setOrgsMap] = useState<Record<string, any>>({});
  const [usersMap, setUsersMap] = useState<Record<string, any>>({});

  useEffect(() => {
    async function load() {
      setLoading(true);
      const { data: { user: sbUser } } = await supabase.auth.getUser();
      if (!sbUser) {
        router.push('/sign-in');
        return;
      }

      const { data: prof } = await supabase.from('profiles').select('role, organization_id').eq('id', sbUser.id).maybeSingle();
      const role = prof?.role || '';
      setUserRole(role);
      setCurrentOrgId(prof?.organization_id || null);

      const isPrivileged = ['SUPER_ADMIN', 'ADMIN', 'TECH_SUPPORT', 'ORG_ADMIN'].includes(role);

      if (!isPrivileged) {
        alert('Access denied to reporting.');
        router.push('/dashboard');
        return;
      }

      // Load loans - for ORG_ADMIN / tenant admin scope to their org + children if possible; for global full
      let query = supabase.from('loans').select('*').order('created_at', { ascending: false });

      if (role === 'ORG_ADMIN' && prof?.organization_id) {
        // Scope to own org + direct child orgs for tenant admin view
        const { data: childOrgs } = await supabase
          .from('organizations')
          .select('id')
          .eq('parent_organization_id', prof.organization_id);
        const childIds = (childOrgs || []).map((o: any) => o.id);
        const scopeIds = [prof.organization_id, ...childIds];
        query = query.in('organization_id', scopeIds);
      }
      // For SUPER/ADMIN/TECH full access (no filter)

      const { data: loansData } = await query;
      setLoans(loansData || []);

      // Load orgs and users for labels
      const orgIds = Array.from(new Set((loansData || []).map((l: any) => l.organization_id).filter(Boolean)));
      const userIds = Array.from(new Set((loansData || []).map((l: any) => l.originator_id).filter(Boolean)));
      if (orgIds.length > 0) {
        const { data: orgRows } = await supabase.from('organizations').select('id, name, parent_organization_id').in('id', orgIds);
        const m: Record<string, any> = {};
        (orgRows || []).forEach((o: any) => m[o.id] = o);
        setOrgsMap(m);
      }
      if (userIds.length > 0) {
        // legacy 'users' removed - use profiles
        const { data: userRows } = await supabase.from('profiles').select('id, full_name, email, role').in('id', userIds);
        const m: Record<string, any> = {};
        (userRows || []).forEach((u: any) => m[u.id] = u);
        setUsersMap(m);
      }

      setLoading(false);
    }
    load();
  }, [router]);

  // Filter loans by time range
  const filteredLoans = useMemo(() => {
    if (!loans.length) return [];
    const now = new Date();
    let start: Date;

    switch (timeRange) {
      case 'weekly':
        start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'monthly':
        start = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
        break;
      case 'quarterly':
        start = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
        break;
      case 'ytd':
        start = new Date(now.getFullYear(), 0, 1);
        break;
      case '1year':
        start = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
        break;
      default:
        start = new Date(0);
    }

    return loans.filter((l: any) => new Date(l.created_at) >= start);
  }, [loans, timeRange]);

  // 1. Loans by stage
  const stages = ['Processing', 'Underwriting', 'Clear to Close', 'Closed and Funded', 'On Hold', 'Rejected'];
  const stageCounts = stages.map(stage => ({
    stage,
    count: filteredLoans.filter((l: any) => (l.loan_status || 'Processing') === stage).length
  }));

  // 2. Volume by Senior AE / Originator (use originator as proxy for AE)
  const aeGroups: Record<string, number> = {};
  filteredLoans.forEach((l: any) => {
    const key = usersMap[l.originator_id]?.full_name || usersMap[l.originator_id]?.email || l.originator_id || 'Unknown AE';
    aeGroups[key] = (aeGroups[key] || 0) + 1;
  });
  const aeVolume = Object.entries(aeGroups).sort((a, b) => b[1] - a[1]).slice(0, 8); // top 8

  // 3. Volume by child tenant / org
  const orgGroups: Record<string, number> = {};
  filteredLoans.forEach((l: any) => {
    const orgName = orgsMap[l.organization_id]?.name || l.organization_id || 'Unknown Org';
    orgGroups[orgName] = (orgGroups[orgName] || 0) + 1;
  });
  const orgVolume = Object.entries(orgGroups).sort((a, b) => b[1] - a[1]);

  const maxCount = Math.max(1, ...stageCounts.map(s => s.count), ...aeVolume.map(([, c]) => c), ...orgVolume.map(([, c]) => c));

  function SimpleBar({ label, value, max }: { label: string; value: number; max: number }) {
    const pct = Math.round((value / max) * 100);
    return (
      <div className="mb-2">
        <div className="flex justify-between text-xs mb-0.5">
          <span className="truncate max-w-[70%]">{label}</span>
          <span className="font-medium">{value}</span>
        </div>
        <div className="h-5 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-5 bg-blue-600 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  }

  if (loading) return <div className="p-10">Loading reporting data...</div>;

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">Reporting Dashboard</h1>
          <p className="text-gray-500">Loan statistics for {userRole === 'ORG_ADMIN' ? 'your organization & children' : 'platform / tenant'}</p>
        </div>

        <select
          value={timeRange}
          onChange={(e) => setTimeRange(e.target.value as TimeRange)}
          className="px-4 py-2 border rounded-2xl bg-white"
        >
          <option value="weekly">Weekly (last 7 days)</option>
          <option value="monthly">Monthly (last 30 days)</option>
          <option value="quarterly">Quarterly (last 90 days)</option>
          <option value="ytd">Year to Date</option>
          <option value="1year">1 Year</option>
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Loans by Stage */}
        <div className="bg-white border rounded-3xl p-6">
          <h2 className="font-semibold text-lg mb-4">Loans by Stage ({filteredLoans.length} total in period)</h2>
          {stageCounts.map(s => (
            <SimpleBar key={s.stage} label={s.stage} value={s.count} max={maxCount} />
          ))}
          <div className="text-xs text-gray-500 mt-3">Stages reflect current loan_status.</div>
        </div>

        {/* By Senior AE / AE */}
        <div className="bg-white border rounded-3xl p-6">
          <h2 className="font-semibold text-lg mb-4">Volume by AE / Senior AE</h2>
          {aeVolume.length === 0 && <div className="text-gray-500">No data</div>}
          {aeVolume.map(([label, count]) => (
            <SimpleBar key={label} label={label} value={count} max={maxCount} />
          ))}
        </div>

        {/* By Child Tenant / Org */}
        <div className="bg-white border rounded-3xl p-6">
          <h2 className="font-semibold text-lg mb-4">Volume by Child Tenant / Organization</h2>
          {orgVolume.length === 0 && <div className="text-gray-500">No data</div>}
          {orgVolume.map(([label, count]) => (
            <SimpleBar key={label} label={label} value={count} max={maxCount} />
          ))}
        </div>
      </div>

      <div className="mt-8 text-sm text-gray-500">
        Data is filtered to the selected time range based on loan created_at. For root admins this shows across tenants; for tenant admins (ORG_ADMIN) it is scoped to your org and direct children.
      </div>
    </div>
  );
}

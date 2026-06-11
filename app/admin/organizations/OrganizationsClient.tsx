'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

type Organization = {
  id: string;
  name: string;
  slug?: string;
  logo_url?: string;
  primary_color?: string;
  domain?: string;
  from_email?: string;
  support_email?: string;
  reply_to_email?: string;
  custom_domain_verified?: boolean;
  raw_attrs?: Record<string, unknown> | null;
  created_at: string;
  approved?: boolean;
  referred_by?: string | null;
};

interface OrganizationsClientProps {
  // Server-resolved tenant org from domain (for instant correct heading / "is this a tenant view" without client flash)
  initialTenantOrg?: any | null;
}

export default function OrganizationsClient({ initialTenantOrg }: OrganizationsClientProps) {
  const router = useRouter();
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loanCounts, setLoanCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [currentUserRole, setCurrentUserRole] = useState('');
  const [currentUserOrgId, setCurrentUserOrgId] = useState<string | null>(null);

  // Derive an immediate "tenant context" hint from the server-provided org so the heading is correct on first paint.
  // The real filter still uses the authenticated user's profile orgId (client enrichment).
  const serverTenantIsL1 = initialTenantOrg && !initialTenantOrg.is_root && initialTenantOrg.domain;

  async function fetchOrganizations(role: string, orgId: string | null) {
    let q = supabase
      .from('organizations')
      .select('*')
      .eq('approved', true)  // ONLY approved organizations as specified
      .order('created_at', { ascending: false });

    // For L1 tenant ORG_ADMIN, scope to *their children* only (L2s). Supers see all (L1s + L2s).
    if (role === 'ORG_ADMIN' && orgId) {
      q = q.eq('parent_organization_id', orgId);
    }

    const { data, error } = await q;

    if (error) console.error("Fetch error:", error);
    // Hide root "Loan-App Platform" (Level 0) from normal lists per spec (except root home / super views)
    const fetched = (data || []).filter((o: any) => o.name !== 'Loan-App Platform');
    setOrgs(fetched);
    setLoading(false);

    // Query loan counts (from loans table per task guidance; could use loan_applications)
    const counts: Record<string, number> = {};
    await Promise.all(fetched.map(async (org) => {
      const { count } = await supabase
        .from('loans')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', org.id);
      counts[org.id] = count || 0;
    }));
    setLoanCounts(counts);
  }

  useEffect(() => {
    async function loadCurrentUser() {
      try {
        const { data: { user: au } } = await supabase.auth.getUser();
        if (au?.id) {
          let { data: prof } = await supabase.from('profiles').select('role, organization_id').eq('id', au.id).maybeSingle();
          let role = prof?.role || '';
          let orgId = prof?.organization_id || null;
          if (!orgId) {
            // Fallback to legacy users table if org_id only lives there (ensures tenant scoping works)
            const { data: urow } = await supabase.from('users').select('role, organization_id').eq('id', au.id).maybeSingle();
            if (urow) {
              role = urow.role || role;
              orgId = urow.organization_id || orgId;
            }
          }
          setCurrentUserRole(role);
          setCurrentUserOrgId(orgId);

          // Kick off the scoped fetch now that we have user context
          await fetchOrganizations(role, orgId);
        } else {
          setLoading(false);
        }
      } catch {
        setLoading(false);
      }
    }
    loadCurrentUser();
  }, []);

  function getMainContact(org: Organization): string {
    const ra = (org.raw_attrs || {}) as Record<string, unknown>;
    const cName = ra.contact_name as string | undefined;
    const cEmail = ra.contact_email as string | undefined;
    const rFrom = ra.from_email as string | undefined;
    return cName || cEmail || org.from_email || rFrom || '—';
  }

  function getWhiteLabelCount(org: Organization): number {
    const ra = org.raw_attrs as Record<string, unknown> | null | undefined;
    return (org.domain || (ra && ra.domain)) ? 1 : 0;
  }

  // Use server tenant context for the heading immediately (before or while client user role loads)
  const showAsTenantChildren = (currentUserRole === 'ORG_ADMIN' && currentUserOrgId) ||
    (!currentUserRole && serverTenantIsL1);

  if (loading && orgs.length === 0) {
    return <div className="p-10 text-center">Loading organizations...</div>;
  }

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-2">
        {showAsTenantChildren ? 'Child / Sponsored Organizations' : 'Approved Organizations'}
      </h1>
      <p className="text-gray-500 mb-8">
        {showAsTenantChildren
          ? 'These are the L2 organizations you sponsor (children of your L1). Click a row to manage their details, white-label settings, and users.'
          : 'Only organizations with approved=true from the organizations table. Click a row to manage details, white-label settings, and users.'}
      </p>

      {orgs.length === 0 ? (
        <div className="bg-white rounded-3xl border p-12 text-center text-gray-500">
          No approved organizations yet. Approve applications from the Applications page.
        </div>
      ) : (
        <div className="bg-white rounded-3xl border overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 text-left text-sm font-semibold text-gray-600">
                <th className="p-6">Company Name</th>
                <th className="p-6">Main Contact</th>
                <th className="p-6">Number of Loans</th>
                <th className="p-6">Number of WhiteLabel Orgs</th>
                <th className="p-6">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {orgs.map((org) => {
                const loanCount = loanCounts[org.id] || 0;
                const wlCount = getWhiteLabelCount(org);
                const contact = getMainContact(org);
                return (
                  <tr
                    key={org.id}
                    onClick={() => router.push(`/admin/organizations/${org.id}`)}
                    className="hover:bg-blue-50 cursor-pointer transition"
                  >
                    <td className="p-6">
                      <div className="flex items-center gap-3">
                        {org.logo_url && (
                          <img src={org.logo_url} alt="logo" className="h-8 w-8 object-contain rounded" />
                        )}
                        <div>
                          <div className="font-semibold text-lg">{org.name}</div>
                          <div className="text-xs text-gray-400">{org.slug || org.id}</div>
                          {org.referred_by && <div className="text-[10px] text-purple-600 mt-0.5">referred_by: {org.referred_by}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="p-6 text-sm text-gray-700">{contact}</td>
                    <td className="p-6">
                      <span className="inline-block px-3 py-1 bg-gray-100 rounded-full text-sm font-medium">
                        {loanCount}
                      </span>
                    </td>
                    <td className="p-6">
                      <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${wlCount > 0 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {wlCount}
                      </span>
                      {org.domain && <span className="ml-2 text-xs text-gray-500">({org.domain})</span>}
                    </td>
                    <td className="p-6 text-sm text-gray-500">
                      {new Date(org.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-6 text-xs text-gray-500">
        Rows are clickable and open the organization detail page at <code>/admin/organizations/[id]</code> for white-label management (domain + from_email in raw_attrs + DNS verify) and user management (links to existing /users subpage).
      </div>

      {initialTenantOrg && (
        <div className="mt-4 text-[10px] text-gray-400">
          Tenant context resolved server-side from domain: {initialTenantOrg.name} ({initialTenantOrg.id})
        </div>
      )}
    </div>
  );
}

'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { hasPermission } from '@/lib/permissions';

type AuditLog = {
  id: number;
  user_id: string | null;
  organization_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  details: any;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
};

export default function AdminAuditPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [sbUser, setSbUser] = useState<any>(null);
  const [currentUserRole, setCurrentUserRole] = useState<string>('');
  const [currentUserOrgId, setCurrentUserOrgId] = useState<string | null>(null);

  // Filters
  const [actionFilter, setActionFilter] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [resourceTypeFilter, setResourceTypeFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [orgFilter, setOrgFilter] = useState(''); // manual for supers

  const commonActions = [
    'user_deleted',
    'user_created',
    'user_added_to_org',
    'user_removed_from_org',
    'loan_deleted',
    'loan_status_changed',
    'loan_processor_assigned',
    'ae_referral_assigned',
    'document_uploaded',
    'document_deleted',
    'document_approved',
    'condition_added',
    'condition_deleted',
    'product_updated',
    'product_base_rates_rebased',
    'product_saved',
    'organization_updated',
    'organization_approved',
    'organization_deleted',
    'page_visit',
  ];

  useEffect(() => {
    async function loadUserContext() {
      const { data: { user: u } } = await supabase.auth.getUser();
      setSbUser(u);
      if (u?.id) {
        let role = '';
        let orgId: string | null = null;
        try {
          let { data: prof } = await supabase.from('profiles').select('role, organization_id').eq('id', u.id).maybeSingle();
          if (prof) {
            role = prof.role || '';
            orgId = prof.organization_id || null;
          } // legacy 'users' table calls removed - profiles only
        } catch {}
        setCurrentUserRole(role);
        setCurrentUserOrgId(orgId);
      }
    }
    loadUserContext();
  }, []);

  async function fetchLogs() {
    setLoading(true);
    try {
      let query = supabase
        .from('audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);

      // Org scoping for non-super (including ORG_ADMIN / tenant ADMIN)
      const isSuper = hasPermission({ id: sbUser?.id || '', role: currentUserRole, organization_id: currentUserOrgId }, 'SUPER_ADMIN');
      const effectiveOrg = orgFilter || currentUserOrgId;
      if (!isSuper && effectiveOrg) {
        query = query.eq('organization_id', effectiveOrg);
      } else if (orgFilter) {
        query = query.eq('organization_id', orgFilter);
      }

      const { data, error } = await query;
      if (error) throw error;

      let filtered = (data || []) as AuditLog[];

      // Client-side filters (action, user, resource, dates)
      if (actionFilter) {
        filtered = filtered.filter(l => l.action.toLowerCase().includes(actionFilter.toLowerCase()));
      }
      if (userFilter) {
        const uf = userFilter.toLowerCase();
        filtered = filtered.filter(l =>
          (l.user_id || '').toLowerCase().includes(uf) ||
          JSON.stringify(l.details || {}).toLowerCase().includes(uf)
        );
      }
      if (resourceTypeFilter) {
        filtered = filtered.filter(l => l.resource_type.toLowerCase().includes(resourceTypeFilter.toLowerCase()));
      }
      if (dateFrom) {
        filtered = filtered.filter(l => l.created_at >= dateFrom);
      }
      if (dateTo) {
        filtered = filtered.filter(l => l.created_at <= dateTo + 'T23:59:59.999Z');
      }

      setLogs(filtered);
    } catch (e: any) {
      console.error('Failed to load audit logs:', e);
      alert('Failed to load audit logs: ' + (e.message || e));
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (sbUser !== undefined) { // after user context
      fetchLogs();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionFilter, userFilter, resourceTypeFilter, dateFrom, dateTo, orgFilter, currentUserOrgId, currentUserRole, sbUser]);

  const isSuper = hasPermission(
    { id: sbUser?.id || '', role: currentUserRole as any, organization_id: currentUserOrgId },
    'SUPER_ADMIN'
  );
  const canSeeAll = isSuper || !currentUserOrgId;

  const clearFilters = () => {
    setActionFilter('');
    setUserFilter('');
    setResourceTypeFilter('');
    setDateFrom('');
    setDateTo('');
    setOrgFilter('');
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-4xl font-bold">Audit Logs</h1>
          <p className="text-gray-500 mt-1">
            Security and operations audit trail. All deletions, key mutations (approvals, status, margin/base, invites, AE/processor assignments, uploads), and critical page visits.
          </p>
          {!canSeeAll && currentUserOrgId && (
            <p className="text-xs text-amber-600 mt-1">ORG-scoped view (your organization only). SUPER_ADMIN sees across all.</p>
          )}
        </div>
        <button onClick={fetchLogs} className="px-6 py-3 border rounded-2xl hover:bg-gray-100">Refresh</button>
      </div>

      {/* Filters */}
      <div className="bg-white border rounded-3xl p-6 mb-8 grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <div>
          <label className="block text-xs font-medium mb-1 text-gray-500">Action contains</label>
          <input
            type="text"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            placeholder="e.g. deleted, approved, uploaded"
            className="w-full px-3 py-2 border rounded-2xl text-sm"
            list="common-actions"
          />
          <datalist id="common-actions">
            {commonActions.map(a => <option key={a} value={a} />)}
          </datalist>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1 text-gray-500">User / details contains</label>
          <input
            type="text"
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
            placeholder="user id or email snippet"
            className="w-full px-3 py-2 border rounded-2xl text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1 text-gray-500">Resource type</label>
          <input
            type="text"
            value={resourceTypeFilter}
            onChange={(e) => setResourceTypeFilter(e.target.value)}
            placeholder="user, loan, document, product..."
            className="w-full px-3 py-2 border rounded-2xl text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1 text-gray-500">Date from</label>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-full px-3 py-2 border rounded-2xl text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1 text-gray-500">Date to</label>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-full px-3 py-2 border rounded-2xl text-sm" />
        </div>
        {canSeeAll && (
          <div>
            <label className="block text-xs font-medium mb-1 text-gray-500">Org ID (optional)</label>
            <input
              type="text"
              value={orgFilter}
              onChange={(e) => setOrgFilter(e.target.value)}
              placeholder="org_... (blank = all)"
              className="w-full px-3 py-2 border rounded-2xl text-sm"
            />
          </div>
        )}
        <div className="flex items-end">
          <button onClick={clearFilters} className="px-4 py-2 text-sm border rounded-2xl hover:bg-gray-50 w-full">Clear Filters</button>
        </div>
      </div>

      {loading ? (
        <div className="p-12 text-center">Loading audit logs...</div>
      ) : logs.length === 0 ? (
        <div className="bg-white rounded-3xl border p-12 text-center text-gray-500">No audit entries match the current filters.</div>
      ) : (
        <div className="bg-white rounded-3xl border overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="p-4 font-semibold">Time</th>
                <th className="p-4 font-semibold">Action</th>
                <th className="p-4 font-semibold">Resource</th>
                <th className="p-4 font-semibold">User</th>
                <th className="p-4 font-semibold">Org</th>
                <th className="p-4 font-semibold">Details</th>
                <th className="p-4 font-semibold">IP</th>
                <th className="p-4 font-semibold">UA (truncated)</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-gray-50 align-top">
                  <td className="p-4 text-xs text-gray-500 whitespace-nowrap">
                    {new Date(log.created_at).toLocaleString()}
                  </td>
                  <td className="p-4">
                    <span className="font-mono text-xs px-2 py-0.5 bg-gray-100 rounded">{log.action}</span>
                  </td>
                  <td className="p-4">
                    <div className="font-medium">{log.resource_type}</div>
                    <div className="text-[10px] text-gray-500 font-mono">{log.resource_id || '—'}</div>
                  </td>
                  <td className="p-4 font-mono text-xs break-all">{log.user_id || '—'}</td>
                  <td className="p-4 font-mono text-xs break-all">{log.organization_id || '—'}</td>
                  <td className="p-4">
                    <pre className="text-[10px] bg-gray-50 p-2 rounded max-w-[320px] overflow-auto whitespace-pre-wrap">
                      {JSON.stringify(log.details || {}, null, 2)}
                    </pre>
                  </td>
                  <td className="p-4 text-xs font-mono text-gray-600">{log.ip_address || '—'}</td>
                  <td className="p-4 text-[10px] text-gray-500 max-w-[180px] truncate" title={log.user_agent || ''}>
                    {log.user_agent ? log.user_agent.substring(0, 60) + (log.user_agent.length > 60 ? '…' : '') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs text-gray-500">
        Showing up to 200 most recent (client filtered). Use SUPER_ADMIN or org-scoped ADMIN/ORG_ADMIN for full visibility. Inserts use service role; RLS can be added separately for direct SELECT.
      </p>
    </div>
  );
}

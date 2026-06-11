'use client';

// Admin - Sales / Loan Applications Review (Supabase Auth aligned)

import { useState, useEffect, useCallback, useRef } from 'react';
import { ensureDocumentColumns, ensureSuperAdminProfile, ensureStorageBuckets } from '../actions/run-migrations';
// getSignedDocumentUrl import removed to avoid UnrecognizedActionError in dev (use stored signed URLs directly from DB)
import { supabase } from '@/lib/supabase';

type PendingOrg = {
  id: string;
  company_name: string;
  contact_name?: string;
  email: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  website?: string;
  loan_volume_estimate?: string;
  notes?: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  reviewed_at?: string;
  owners?: any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  managers?: string[];
  additional_users?: any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  products_offered?: string[];
  documents?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  agreement_accepted?: boolean;
  submitter?: { id: string; full_name?: string; email?: string } | null;
  reviewer?: { id: string; full_name?: string; email?: string } | null;
  referred_by?: string | null;
  referredBy?: { id: string; full_name?: string; email?: string } | null;
};

export default function AdminApplicationsPage() {
  const [applications, setApplications] = useState<PendingOrg[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [selectedApp, setSelectedApp] = useState<PendingOrg | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);

  // Approver (Lender side) signature capture for when approving (drawn on this page, embedded in final PDFs on approve)
  const [approverSignatureData, setApproverSignatureData] = useState<string | null>(null);
  const approverCanvasRef = useRef<HTMLCanvasElement>(null);
  const [isApproverDrawing, setIsApproverDrawing] = useState(false);

  const startApproverDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = approverCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsApproverDrawing(true);
  };
  const drawApprover = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isApproverDrawing) return;
    const canvas = approverCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.stroke();
  };
  const endApproverDrawing = () => {
    setIsApproverDrawing(false);
    const canvas = approverCanvasRef.current;
    if (canvas) setApproverSignatureData(canvas.toDataURL('image/png'));
  };
  const clearApproverSignature = () => {
    const canvas = approverCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    setApproverSignatureData(null);
  };

  // No Clerk: the /api/pending-organizations uses Supabase server client from auth cookies (set at sign-in).
  // Service role paths inside API handle admin checks via profiles.role.
  const fetchApplications = useCallback(async () => {
    console.log('[AdminApplications] fetchApplications START - looking for company/pending info');
    try {
      // Use the admin API which bypasses RLS and enriches with submitter + handles docs
      // Attach Supabase session token so createServerClient can auth the user
      const { data: { session } } = await supabase.auth.getSession();
      console.log('[AdminApplications] fetchApplications has session token?', !!session?.access_token);
      const headers: HeadersInit = session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {};
      const res = await fetch('/api/pending-organizations', { headers });
      console.log('[AdminApplications] fetchApplications response status:', res.status, 'ok:', res.ok);
      if (!res.ok) {
        // Always log status + text for debugging (the previous complex json/text try could result in minimal {} in some cases)
        let errBody = '';
        try {
          errBody = await res.text();
        } catch {}
        const errObj = {
          status: res.status,
          statusText: res.statusText,
          body: (errBody || '').slice(0, 800),
        };
        console.error('Failed to load from API:', errObj);
        setApplications([]);
        return;
      }
      const json = await res.json();
      console.log('[AdminApplications] fetchApplications SUCCESS, rows:', (json.data || []).length);
      setApplications(json.data || []);
    } catch (e) {
      console.error('Error fetching applications via API:', e);
      setApplications([]);
    } finally {
      setLoading(false);
      console.log('[AdminApplications] fetchApplications END - loading company/pending info complete (or errored)');
    }
  }, []);

  useEffect(() => {
    fetchApplications();
  }, [fetchApplications]);

  // Always declare ALL hooks (useState/useRef/useCallback/useEffect) at the top, before any early returns,
  // conditionals, or role-based logic. This prevents "Rendered more hooks than during the previous render"
  // and "change in the order of Hooks" (the previous cleanup effect was after `if (loading) return`).
  // Optional: also clear approver sig when the component unmounts (defensive; closeDetail + post-approve also clear).
  useEffect(() => {
    return () => {
      setApproverSignatureData(null);
    };
  }, []);

  const handleApprove = async (id: string) => {
    if (!confirm('Approve this application and create the organization (profile link + welcome email)?')) return;

    setProcessingId(id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      };
      const res = await fetch('/api/pending-organizations', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ id, status: 'approved', approver_signature: approverSignatureData || null }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || 'Failed to approve');
      }
      const result = await res.json().catch(() => ({}));
      alert('✅ Organization approved and created!' + (result.orgId ? ` (Org: ${result.orgId})` : ''));
      setApproverSignatureData(null);
      if (approverCanvasRef.current) {
        const ctx = approverCanvasRef.current.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, approverCanvasRef.current.width, approverCanvasRef.current.height);
      }
      setSelectedApp(null);
      fetchApplications();
    } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      alert('Error approving: ' + err.message);
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (id: string) => {
    if (!confirm('Reject this application?')) return;

    setProcessingId(id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      };
      const res = await fetch('/api/pending-organizations', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ id, status: 'rejected' }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || 'Failed to reject');
      }
      alert('Application rejected.');
      setSelectedApp(null);
      fetchApplications();
    } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      alert('Error rejecting: ' + err.message);
    } finally {
      setProcessingId(null);
    }
  };

  if (loading) {
    return <div className="p-10 text-center text-xl">Loading applications...</div>;
  }

  // helpers defined after hooks, before render (no more post-conditional hooks)
  const openDetail = (app: PendingOrg) => setSelectedApp(app);
  const closeDetail = () => {
    setSelectedApp(null);
    // Clear approver signature state/canvas when closing so it doesn't carry over to next detail
    setApproverSignatureData(null);
    if (approverCanvasRef.current) {
      const ctx = approverCanvasRef.current.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, approverCanvasRef.current.width, approverCanvasRef.current.height);
    }
  };

  // filtered list
  const filteredApplications = applications.filter((app) => {
    const term = searchTerm.toLowerCase().trim();
    const matchesSearch =
      !term ||
      (app.company_name || '').toLowerCase().includes(term) ||
      (app.contact_name || '').toLowerCase().includes(term) ||
      (app.email || '').toLowerCase().includes(term) ||
      (app.website || '').toLowerCase().includes(term) ||
      (app.submitter?.full_name || '').toLowerCase().includes(term) ||
      (app.submitter?.email || '').toLowerCase().includes(term);
    const matchesStatus = statusFilter === 'all' || app.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const pendingCount = applications.filter((a) => a.status === 'pending').length;

  return (
    <div className="max-w-7xl mx-auto p-8">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-4xl font-bold">Organization Applications</h1>
        <button
          onClick={fetchApplications}
          className="px-4 py-2 text-sm border rounded-xl hover:bg-gray-50 flex items-center gap-2"
          disabled={loading}
        >
          ↻ Refresh
        </button>
      </div>
      <p className="text-gray-600 mb-4">
        Review <strong>all answers</strong> to the organization application form questions (see app/apply/organization/page.tsx).
        All fields from the form + DB (including submitter/reviewer + computed email domain) are shown in detail view using expandable sections in modal. Now includes history of all statuses.
        {pendingCount > 0 && <span className="ml-2 text-amber-600 font-medium">({pendingCount} pending)</span>}
      </p>

      <div className="mb-4">
        <button
          onClick={async () => {
            const res = await ensureDocumentColumns();
            if (res.success) {
              alert(res.message || 'Columns ensured.');
            } else {
              alert((res.error || 'Failed') + (res.sql ? '\n\nSQL:\n' + res.sql : ''));
            }
          }}
          className="px-4 py-2 text-sm bg-emerald-100 border border-emerald-300 rounded-xl hover:bg-emerald-200"
        >
          Ensure DB columns (docs/agreement + support_tickets) — run SQL if needed
        </button>
        <span className="ml-2 text-xs text-gray-500">Ensures pending_organizations doc columns + support_tickets table (with organization_id). Shows full SQL on failure for copy-paste to Supabase SQL Editor.</span>
      </div>

      <div className="mb-4">
        <button
          onClick={async () => {
            const res = await ensureSuperAdminProfile();
            if (res.success) {
              alert(res.message || 'Profile ensured.');
              // Refresh role etc by reloading the page or re-fetching apps (the 401/403 should be gone)
              window.location.reload();
            } else {
              const msg = (res.error || 'Failed') + (res.sql ? '\n\n--- COPY THIS SQL ---\n' + res.sql + '\n\nRun in Supabase SQL Editor, then "Reload Schema Cache" (in the sidebar) and hard refresh this page.' : '');
              alert(msg);
              // Also copy to clipboard for convenience
              if (res.sql) navigator.clipboard?.writeText(res.sql).catch(() => {});
            }
          }}
          className="px-4 py-2 text-sm bg-amber-100 border border-amber-300 rounded-xl hover:bg-amber-200"
        >
          Ensure SUPER_ADMIN profile for PLATFORM super (dustin@247sparkplug.com - do not use for tenant users)
        </button>
        <span className="ml-2 text-xs text-gray-500">Upserts the profiles row with role SUPER_ADMIN (and email/name). If RPC unavailable, shows full SQL + auto-copies it. Run, reload schema cache, refresh.</span>
      </div>

      <div className="mb-4">
        <button
          onClick={async () => {
            // Fix for info@plumbingkings.net (LOAN_PROCESSOR for L1 org) so it appears in users lists (dashboard + admin/organizations/.../users)
            // This sets organization_id on its profiles row (legacy users removed).
            const { ensureUserInOrg } = await import('@/app/actions/organization-actions');
            await ensureUserInOrg(
              '781b283a-a011-4835-8ba7-683b772e64f9',
              'org_cc8a9caa48d1',
              'LOAN_PROCESSOR',
              'John Smith',
              'info@plumbingkings.net'
            );
            alert('Ensured info@plumbingkings.net has organization_id=org_cc8a9caa48d1 in profiles. Reload users pages.');
          }}
          className="px-4 py-2 text-sm bg-emerald-100 border border-emerald-300 rounded-xl hover:bg-emerald-200"
        >
          Ensure info@plumbingkings.net linked to org org_cc8a9caa48d1 (for users tab)
        </button>
        <span className="ml-2 text-xs text-gray-500">One-time data fix for the 2nd L1 user so it loads in tenant dashboard users + admin org users page.</span>
      </div>

      <div className="mb-4">
        <button
          onClick={async () => {
            const res = await ensureStorageBuckets();
            if (res.success) {
              const summary = (res.results || []).map((r: any) => `${r.id}: ${r.status}${r.error ? ' (' + r.error + ')' : ''}`).join(' | ');
              alert('Storage buckets ensured: ' + summary);
            } else {
              alert('Failed to ensure buckets: ' + (res.error || 'unknown error'));
            }
          }}
          className="px-4 py-2 text-sm bg-purple-100 border border-purple-300 rounded-xl hover:bg-purple-200"
        >
          Ensure Storage Buckets (organization-documents + support-screenshots)
        </button>
        <span className="ml-2 text-xs text-gray-500">Creates the buckets via service role if they don't exist (fixes "Bucket not found" on document URLs and uploads). Also creates support-screenshots. Run this + the policy SQL if needed.</span>
      </div>

      {/* Search + Status Filters (polish) */}
      <div className="mb-6 flex flex-col md:flex-row gap-3 items-start md:items-center">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search company, contact, email, website, submitter..."
          className="flex-1 px-4 py-2.5 border rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
        />
        <div className="flex gap-2 flex-wrap">
          {(['all', 'pending', 'approved', 'rejected'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`px-4 py-2 rounded-2xl text-sm font-medium border transition ${
                statusFilter === f
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white hover:bg-gray-50 border-gray-200'
              }`}
            >
              {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* List of cards (compact summary + actions; detail via modal) */}
      <div className="bg-white rounded-3xl border shadow-sm overflow-hidden">
        {filteredApplications.length === 0 ? (
          <p className="p-20 text-center text-gray-500">
            {applications.length === 0 ? 'No applications yet.' : 'No matches for current search/filter.'}
          </p>
        ) : (
          filteredApplications.map((app) => {
            const isProcessing = processingId === app.id;
            const addr = [app.address, app.city, app.state, app.zip].filter(Boolean).join(', ');
            return (
              <div key={app.id} className="p-6 border-b last:border-b-0 hover:bg-gray-50/50 transition flex flex-col md:flex-row md:items-start gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <h3 className="text-xl font-semibold truncate">{app.company_name}</h3>
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold tracking-wide ${
                      app.status === 'approved' ? 'bg-green-100 text-green-800' :
                      app.status === 'rejected' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'
                    }`}>
                      {app.status.toUpperCase()}
                    </span>
                  </div>
                  <div className="text-gray-600 mt-0.5">
                    {app.contact_name} • {app.email}
                    {app.email && <span className="ml-1 text-gray-400">@{app.email.split('@')[1]}</span>}
                    {app.phone && <span className="ml-2 text-gray-500">📞 {app.phone}</span>}
                  </div>
                  {app.website && (
                    <a href={app.website.startsWith('http') ? app.website : `https://${app.website}`} target="_blank" rel="noopener" className="text-sm text-blue-600 hover:underline">
                      🌐 {app.website}
                    </a>
                  )}
                  {addr && <div className="text-sm text-gray-500 mt-0.5">{addr}</div>}
                  {app.loan_volume_estimate && <div className="text-sm mt-0.5">📊 Est. Volume: {app.loan_volume_estimate}</div>}
                  {/* Quick indicators from full form data for review at list level */}
                  <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                    {app.owners && app.owners.length > 0 && <span className="px-1.5 py-0.5 bg-blue-50 border border-blue-100 rounded">👥 {app.owners.length} owner(s)</span>}
                    {app.additional_users && app.additional_users.length > 0 && <span className="px-1.5 py-0.5 bg-purple-50 border border-purple-100 rounded">👤+ {app.additional_users.length} team</span>}
                    {app.products_offered && app.products_offered.length > 0 && <span className="px-1.5 py-0.5 bg-emerald-50 border border-emerald-100 rounded">📦 {app.products_offered.length} products</span>}
                    {app.agreement_accepted && <span className="px-1.5 py-0.5 bg-green-50 border border-green-100 rounded">✓ agrmt</span>}
                    {app.documents && Object.keys(app.documents).length > 0 && <span className="px-1.5 py-0.5 bg-amber-50 border border-amber-100 rounded">📎 {Object.keys(app.documents).length} doc(s)</span>}
                  </div>
                  {app.submitter && (
                    <div className="text-xs text-blue-600 mt-1">Submitted by: {app.submitter.full_name || app.submitter.email}</div>
                  )}
                  {(app.referredBy || app.referred_by) && (
                    <div className="text-xs text-purple-600 mt-1">Referred by: {app.referredBy ? (app.referredBy.full_name || app.referredBy.email) : app.referred_by}</div>
                  )}
                  <div className="text-[11px] text-gray-400 mt-1">
                    {new Date(app.created_at).toLocaleDateString()} {new Date(app.created_at).toLocaleTimeString()}
                  </div>
                </div>

                <div className="flex flex-col md:items-end gap-2 md:min-w-[220px]">
                  <div className="flex gap-2 flex-wrap md:justify-end">
                    <button
                      onClick={() => openDetail(app)}
                      className="px-4 py-2 text-sm border rounded-xl hover:bg-white"
                      disabled={isProcessing}
                    >
                      View Full Details
                    </button>
                    {app.status === 'pending' && (
                      <>
                        <button
                          onClick={() => handleApprove(app.id)}
                          disabled={isProcessing}
                          className="px-5 py-2 bg-green-600 text-white rounded-xl hover:bg-green-700 text-sm font-medium disabled:opacity-50"
                        >
                          {isProcessing ? '...' : 'Approve'}
                        </button>
                        <button
                          onClick={() => handleReject(app.id)}
                          disabled={isProcessing}
                          className="px-5 py-2 bg-red-600 text-white rounded-xl hover:bg-red-700 text-sm font-medium disabled:opacity-50"
                        >
                          {isProcessing ? '...' : 'Reject'}
                        </button>
                      </>
                    )}
                  </div>
                  {app.reviewer && (
                    <div className="text-[10px] text-gray-500 text-right">Reviewed by: {app.reviewer.full_name || app.reviewer.email}</div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <p className="mt-4 text-xs text-gray-500">
        Showing {filteredApplications.length} of {applications.length}. View Full Details opens a modal with <strong>expandable &lt;details&gt; sections</strong> for every answer to the questions in app/apply/organization/page.tsx (company/contact/address/owners/managers/additionalUsers/products/agreement/documents/notes + email domain + all metadata + raw). Approve/reject use the /api/pending-organizations (Supabase session via cookies + profiles.role check) + lib/create-organization.ts (creates org + links users + auto-creates additional team users from form data + sends welcome email via Resend).
      </p>

      {/* FULL DETAIL MODAL — clean, reviewable view of ALL answers from the apply/organization form + DB fields + actions from detail */}
      {selectedApp && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={closeDetail}>
          <div className="bg-white rounded-3xl shadow-2xl max-w-4xl w-full max-h-[92vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between z-10 rounded-t-3xl">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-2xl font-bold">{selectedApp.company_name}</h2>
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold tracking-wide ${
                    selectedApp.status === 'approved' ? 'bg-green-100 text-green-800' :
                    selectedApp.status === 'rejected' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'
                  }`}>
                    {selectedApp.status.toUpperCase()}
                  </span>
                </div>
                <p className="text-sm text-gray-500">ID: {selectedApp.id}</p>
              </div>
              <button onClick={closeDetail} className="text-3xl leading-none px-3 py-0 text-gray-400 hover:text-gray-600">×</button>
            </div>

            <div className="p-6 space-y-4 text-sm">
              {/* Use native expandable <details> for reviewable full details / all Q&A from apply/organization form */}
              <details open className="border rounded-2xl overflow-hidden">
                <summary className="px-4 py-3 bg-gray-50 font-semibold cursor-pointer select-none">Q: Company Name &amp; Contact (from form top section)</summary>
                <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 bg-white">
                  <div><strong>Company Name:</strong> {selectedApp.company_name}</div>
                  <div><strong>Contact Name:</strong> {selectedApp.contact_name || '—'}</div>
                  <div><strong>Email:</strong> {selectedApp.email}</div>
                  <div><strong>Email Domain:</strong> {selectedApp.email ? selectedApp.email.split('@')[1] || '—' : '—'}</div>
                  <div><strong>Phone:</strong> {selectedApp.phone || '—'}</div>
                  <div><strong>Website:</strong> {selectedApp.website ? <a href={selectedApp.website.startsWith('http') ? selectedApp.website : `https://${selectedApp.website}`} target="_blank" className="underline text-blue-600" rel="noreferrer">{selectedApp.website}</a> : '—'}</div>
                  <div><strong>Est. Loan Volume:</strong> {selectedApp.loan_volume_estimate || '—'}</div>
                </div>
              </details>

              <details open className="border rounded-2xl overflow-hidden">
                <summary className="px-4 py-3 bg-gray-50 font-semibold cursor-pointer select-none">Q: Business Address (address, city, state, zip from form)</summary>
                <div className="p-4 bg-white">
                  <div className="bg-gray-50 rounded-2xl p-3">{[selectedApp.address, selectedApp.city, selectedApp.state, selectedApp.zip].filter(Boolean).join(', ') || '—'}</div>
                  <div className="text-[10px] text-gray-500 mt-1">Full structured address as submitted in application.</div>
                </div>
              </details>

              <details open className="border rounded-2xl overflow-hidden">
                <summary className="px-4 py-3 bg-gray-50 font-semibold cursor-pointer select-none">Q: Company Owners (25%+ ownership — array from form)</summary>
                <div className="p-4 bg-white">
                  {selectedApp.owners && selectedApp.owners.length > 0 ? (
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    <ul className="divide-y border rounded-2xl">{selectedApp.owners.map((o: any, i: number) => <li key={i} className="px-3 py-1 flex justify-between"><span>{o?.name || '—'}</span><span>{o?.percentage || ''}%</span></li>)}</ul>
                  ) : <span className="text-gray-500">— (none listed)</span>}
                </div>
              </details>

              <details open className="border rounded-2xl overflow-hidden">
                <summary className="px-4 py-3 bg-gray-50 font-semibold cursor-pointer select-none">Q: Company Managers / Authorized Signers (optional array)</summary>
                <div className="p-4 bg-white">
                  {selectedApp.managers && selectedApp.managers.filter(Boolean).length ? <span>{selectedApp.managers.filter(Boolean).join(', ')}</span> : <span className="text-gray-500">—</span>}
                </div>
              </details>

              <details open className="border rounded-2xl overflow-hidden">
                <summary className="px-4 py-3 bg-gray-50 font-semibold cursor-pointer select-none">Q: Additional Team Members (additionalUsers array — will be / were auto-created on approve)</summary>
                <div className="p-4 bg-white">
                  {selectedApp.additional_users && selectedApp.additional_users.length > 0 ? (
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    <ul className="list-disc ml-5">{selectedApp.additional_users.map((u: any, i: number) => <li key={i}>{u?.name || '—'} {u?.email && `(${u.email})`}{u?.role && ` — role: ${u.role}`}</li>)}</ul>
                  ) : <span className="text-gray-500">—</span>}
                </div>
              </details>

              <details open className="border rounded-2xl overflow-hidden">
                <summary className="px-4 py-3 bg-gray-50 font-semibold cursor-pointer select-none">Q: Products Offered (checkbox selections from form: Bridge/RTL/DSCR/Business/Retail)</summary>
                <div className="p-4 bg-white">
                  {(() => {
                    const offered = (selectedApp.products_offered || []) as string[];
                    const all = ['Bridge Loans', 'RTL Loans', 'DSCR Loans', 'Business Purpose', 'Retail Loans'];
                    return (
                      <div className="flex flex-wrap gap-2">
                        {all.map(p => (
                          <span key={p} className={`px-2 py-0.5 rounded text-xs border ${offered.includes(p) ? 'bg-green-100 border-green-300' : 'bg-gray-100 border-gray-200 text-gray-500'}`}>
                            {offered.includes(p) ? '✓ ' : ''}{p}
                          </span>
                        ))}
                      </div>
                    );
                  })()}
                  {!selectedApp.products_offered?.length && <span className="text-xs text-gray-500 block mt-1">(none selected)</span>}
                </div>
              </details>

              <details open className="border rounded-2xl overflow-hidden">
                <summary className="px-4 py-3 bg-gray-50 font-semibold cursor-pointer select-none">Q: White Label Agreement (generated PDF + accepted checkbox)</summary>
                <div className="p-4 bg-white">
                  <div className={selectedApp.agreement_accepted ? 'text-green-700' : 'text-red-600'}>
                    {selectedApp.agreement_accepted ? '✓ Agreement accepted by applicant' : '✗ Not accepted'}
                  </div>
                </div>
              </details>

              <details open className="border rounded-2xl overflow-hidden">
                <summary className="px-4 py-3 bg-gray-50 font-semibold cursor-pointer select-none">Documents (all uploads + agreement PDF from form; links if http)</summary>
                <div className="p-4 bg-white break-all text-sm">
                  {selectedApp.documents && Object.keys(selectedApp.documents).length > 0 ? (
                    <ul className="ml-4 list-disc space-y-0.5">
                      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                      {Object.entries(selectedApp.documents).map(([key, val]: [string, any]) => {
                        const arr = Array.isArray(val) ? val : (val ? [val] : []);
                        return arr.map((u: string, j: number) => (
                          <li key={key + j}>
                            {typeof u === 'string' && u.startsWith('http') ? (
                              <a
                                href="#"
                                onClick={(e) => {
                                  e.preventDefault();
                                  // Use stored URL directly (they are pre-signed from apply time with long expiry; avoids server action hash mismatch errors in dev)
                                  window.open(u, '_blank', 'noopener');
                                }}
                                className="text-blue-600 underline"
                                rel="noreferrer"
                              >
                                {key.replace(/_/g, ' ')} ↗
                              </a>
                            ) : `${key}: ${u}`}
                          </li>
                        ));
                      })}
                    </ul>
                  ) : '— (no documents uploaded with application)'}
                  <div className="text-[10px] text-gray-500 mt-2">Keys like operating_agreement_url, agreement_pdf_url, ein_letter_url etc. from storage uploads in /apply/organization.</div>
                </div>
              </details>

              <details className="border rounded-2xl overflow-hidden">
                <summary className="px-4 py-3 bg-gray-50 font-semibold cursor-pointer select-none">Additional Notes (free text from form)</summary>
                <div className="p-4 bg-white">
                  {selectedApp.notes ? <div className="p-2 bg-gray-50 border rounded whitespace-pre-wrap">{selectedApp.notes}</div> : <span className="text-gray-500">—</span>}
                </div>
              </details>

              <details className="border rounded-2xl overflow-hidden">
                <summary className="px-4 py-3 bg-gray-50 font-semibold cursor-pointer select-none">Timestamps + Submitter / Reviewer (DB + enrichment from API)</summary>
                <div className="p-4 bg-white text-xs">
                  Created: {new Date(selectedApp.created_at).toLocaleString()}
                  {selectedApp.reviewed_at ? ` • Reviewed: ${new Date(selectedApp.reviewed_at).toLocaleString()}` : ''}
                  {selectedApp.submitter ? ` • Submitter: ${selectedApp.submitter.full_name || selectedApp.submitter.email}` : ''}
                  {selectedApp.reviewer ? ` • Reviewer: ${selectedApp.reviewer.full_name || selectedApp.reviewer.email}` : ''}
                </div>
              </details>

              <details className="border rounded-2xl overflow-hidden">
                <summary className="px-4 py-3 bg-gray-50 font-semibold cursor-pointer select-none">Referral (referred_by for AE hierarchy / dashboards)</summary>
                <div className="p-4 bg-white text-xs">
                  Referred by (raw ID): {selectedApp.referred_by || '—'}
                  {selectedApp.referredBy ? ` • ${selectedApp.referredBy.full_name || selectedApp.referredBy.email} (id: ${selectedApp.referredBy.id})` : ''}
                </div>
              </details>

              {/* For full debug/review of raw answers */}
              <details className="border rounded-2xl overflow-hidden">
                <summary className="px-4 py-3 bg-gray-50 font-semibold cursor-pointer select-none text-xs">Raw application data (JSON for complete review)</summary>
                <pre className="p-4 bg-gray-900 text-green-200 text-[10px] overflow-auto max-h-48 rounded-b-2xl">{JSON.stringify(selectedApp, null, 2)}</pre>
              </details>

              {/* Approver (Lender-side) signature for the Licensing Agreement — shown only for pending apps */}
              {selectedApp.status === 'pending' && (
                <div className="border-2 border-blue-200 rounded-2xl p-4 bg-blue-50">
                  <div className="font-semibold text-blue-900 mb-1">Sign as Lender / Approver (Licensing Agreement)</div>
                  <p className="text-xs text-blue-700 mb-2">Draw your signature below. This will be embedded (along with the applicant's signature) in the signed Lender Licensing Agreement PDF generated on approval. The PDF will be stored on the new organization and emailed to the applicant.</p>

                  <canvas
                    ref={approverCanvasRef}
                    width={420}
                    height={120}
                    className="border border-blue-400 bg-white cursor-crosshair rounded-xl touch-none mx-auto block"
                    onMouseDown={startApproverDrawing}
                    onMouseMove={drawApprover}
                    onMouseUp={endApproverDrawing}
                    onMouseLeave={endApproverDrawing}
                  />

                  <div className="mt-2 flex items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={clearApproverSignature}
                      className="text-sm px-3 py-1 border border-blue-300 rounded-lg hover:bg-white"
                    >
                      Clear signature
                    </button>
                    {approverSignatureData ? (
                      <span className="text-xs text-green-700 font-medium">✓ Approver signature captured — ready to approve</span>
                    ) : (
                      <span className="text-xs text-blue-600">Draw above to sign the agreement as the platform/Lender</span>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="sticky bottom-0 bg-white border-t px-6 py-4 flex justify-between rounded-b-3xl">
              <button onClick={closeDetail} className="px-4 py-2 border rounded-xl">Close</button>
              {selectedApp.status === 'pending' && (
                <div className="flex gap-2">
                  <button 
                    onClick={() => handleApprove(selectedApp.id)} 
                    disabled={processingId===selectedApp.id} 
                    className="px-4 py-2 bg-green-600 text-white rounded-xl disabled:opacity-50"
                  >
                    {processingId===selectedApp.id ? 'Approving...' : 'Approve & Sign Agreement'}
                  </button>
                  <button 
                    onClick={() => handleReject(selectedApp.id)} 
                    disabled={processingId===selectedApp.id} 
                    className="px-4 py-2 bg-red-600 text-white rounded-xl disabled:opacity-50"
                  >
                    {processingId===selectedApp.id ? '...' : 'Reject'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

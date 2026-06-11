'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { fetchTreasuryRate, setOrgBenchmark, getOrganizationUsers } from '@/app/actions/organization-actions';
import { ensureMainContactForOrganization } from '@/lib/create-organization';
import { logAudit } from '@/lib/audit';

type Org = {
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
  updated_at?: string;
  approved?: boolean;
  approved_at?: string;
  approved_by?: string;
  wholesale_markup?: number;
  retail_markup?: number;
  active?: boolean;
  pass_credit_report_costs_to_borrower?: boolean;
  credit_report_cost_amount?: number | string;
};

type OrgUser = {
  id: string;
  email?: string;
  full_name?: string;
  role?: string;
  created_at?: string;
};

interface OrgDetailClientProps {
  orgId: string;
  // Server-preloaded org (from async page using headers + supabaseAdmin). When present we seed state instantly
  // so there is no "Loading organization..." flash and no chance of pulling a parent/root org first.
  initialOrg?: Org | null;
  // Optional server-resolved tenant context org (from domain headers lookup) for any chrome / "belongs to" indicators.
  tenantContextOrg?: any | null;
}

export default function OrgDetailClient({ orgId, initialOrg, tenantContextOrg }: OrgDetailClientProps) {
  const router = useRouter();

  const [org, setOrg] = useState<Org | null>(initialOrg || null);
  const [users, setUsers] = useState<OrgUser[]>([]);
  const [loading, setLoading] = useState(!initialOrg);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Local editable state (domain top-level; from_email managed inside raw_attrs)
  const [editDomain, setEditDomain] = useState(initialOrg?.domain || '');
  const [editFromEmail, setEditFromEmail] = useState(
    (initialOrg?.raw_attrs as any)?.from_email || initialOrg?.from_email || ''
  );
  const [editPrimaryColor, setEditPrimaryColor] = useState(initialOrg?.primary_color || '#3b82f6');
  const [editLogo, setEditLogo] = useState<string | undefined>(initialOrg?.logo_url);
  const [editPassCreditCosts, setEditPassCreditCosts] = useState(!!initialOrg?.pass_credit_report_costs_to_borrower);
  const [editCreditReportCost, setEditCreditReportCost] = useState(
    initialOrg?.credit_report_cost_amount != null ? String(initialOrg.credit_report_cost_amount) : ''
  );
  const [editBenchmark, setEditBenchmark] = useState(initialOrg?.benchmark_treasury || '');

  useEffect(() => {
    if (orgId) {
      // Always fetch org + users on orgId. When server provided initialOrg we still need this
      // to populate the users list (getOrganizationUsers). The org data will be refreshed
      // but the initial server seed gives instant form fields / header on first paint.
      fetchOrgAndUsers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  async function fetchOrgAndUsers() {
    setLoading(true);
    try {
      const { data: orgData, error: orgErr } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', orgId)
        .single();

      if (orgErr) {
        console.error('Org fetch error:', orgErr);
        alert('Failed to load organization');
        setOrg(null);
      } else {
        setOrg(orgData as Org);
        // init edit fields
        setEditDomain(orgData?.domain || '');
        const ra = (orgData?.raw_attrs || {}) as Record<string, unknown>;
        setEditFromEmail((ra.from_email as string) || orgData?.from_email || '');
        setEditPrimaryColor(orgData?.primary_color || '#3b82f6');
        setEditLogo(orgData?.logo_url);
        setEditPassCreditCosts(!!orgData?.pass_credit_report_costs_to_borrower);
        setEditCreditReportCost(orgData?.credit_report_cost_amount != null ? String(orgData.credit_report_cost_amount) : '');
        setEditBenchmark(orgData?.benchmark_treasury || '');
      }

      // Users for this org — use admin action (bypass RLS) so L1 ORG_ADMIN sees all team members in their org (including ones set via ensure/add).
      // Direct client query was sometimes limited; the /users subpage already used this.
      try {
        const res = await getOrganizationUsers(orgId);
        setUsers(res.users || []);
      } catch (e) {
        console.warn('getOrganizationUsers failed in org detail, falling back', e);
        const { data: usersData } = await supabase
          .from('profiles')
          .select('id, email, full_name, role, created_at')
          .eq('organization_id', orgId)
          .order('created_at', { ascending: false });
        setUsers((usersData || []).map((p: any) => ({
          id: p.id,
          email: p.email,
          full_name: p.full_name,
          role: p.role,
          created_at: p.created_at,
        })));
      }
    } finally {
      setLoading(false);
    }
  }

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !org) return;

    setUploading(true);
    const fileName = `${org.id}-logo-${Date.now()}.${file.name.split('.').pop()}`;

    try {
      const { error: uploadError } = await supabase.storage
        .from('logos')
        .upload(fileName, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('logos').getPublicUrl(fileName);
      setEditLogo(urlData.publicUrl);
      alert('Logo uploaded. Click Save White Label Settings to persist.');
    } catch (err: unknown) {
      const msg = (err as Error)?.message || String(err);
      alert('Upload failed: ' + msg);
    } finally {
      setUploading(false);
    }
  };

  const saveWhiteLabel = async () => {
    if (!org) return;
    setSaving(true);

    try {
      // Build updated raw_attrs, putting from_email inside it (as specified)
      const currentRaw = org.raw_attrs || {};
      const newRaw = {
        ...currentRaw,
        from_email: editFromEmail || undefined,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updatePayload: any = {
        domain: editDomain || null,
        primary_color: editPrimaryColor,
        logo_url: editLogo || org.logo_url,
        // from_email top level for broad compat (create flow + selects also sync'd)
        from_email: editFromEmail || null,
        raw_attrs: newRaw,
        updated_at: new Date().toISOString(),
        pass_credit_report_costs_to_borrower: editPassCreditCosts,
        credit_report_cost_amount: editCreditReportCost ? parseFloat(editCreditReportCost) : null,
        benchmark_treasury: editBenchmark || null,
      };

      const { error } = await supabase
        .from('organizations')
        .update(updatePayload)
        .eq('id', org.id);

      if (error) {
        console.error('Save white label error:', error);
        alert('Save failed: ' + error.message);
      } else {
        alert('✅ Settings saved (white label + credit report cost pass-through).');
        await fetchOrgAndUsers();
      }
    } finally {
      setSaving(false);
    }
  };

  // DNS verify using public DNS-over-HTTPS (dns.google) — no server needed, client fetch ok.
  // Existing logic: none present in codebase, so implemented per common white-label domain verification pattern.
  // Instructs admin to create TXT record; on verify success, sets custom_domain_verified=true.
  const handleDnsVerify = async () => {
    if (!org || !editDomain) {
      alert('Please set and save a domain first.');
      return;
    }
    setVerifying(true);

    const domain = editDomain.trim();
    const verifyName = `_lending-verify.${domain}`;
    // Use org id as the verification token value (simple, no extra storage needed; can be enhanced with raw_attrs.dns_token)
    const expectedValue = org.id;

    try {
      const url = `https://dns.google/resolve?name=${encodeURIComponent(verifyName)}&type=TXT`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('DNS lookup service unavailable');
      const json = await res.json();

      const answers: Array<{ data?: string | string[] }> = (json.Answer || []) as Array<{ data?: string | string[] }>;
      let matched = false;
      for (const ans of answers) {
        if (!ans.data) continue;
        // TXT data often quoted
        const txt = String(ans.data).replace(/^"|"$/g, '');
        if (txt.includes(expectedValue)) {
          matched = true;
          break;
        }
      }

      if (matched) {
        // Persist verified status (top level + raw for completeness)
        const currentRaw = org.raw_attrs || {};
        const { error: upErr } = await supabase
          .from('organizations')
          .update({
            custom_domain_verified: true,
            raw_attrs: { ...currentRaw, dns_verified: true, dns_verified_at: new Date().toISOString() },
            updated_at: new Date().toISOString(),
          })
          .eq('id', org.id);

        if (upErr) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          alert('DNS record matched but failed to save verified status: ' + (upErr as any).message);
        } else {
          alert('✅ DNS verified successfully! Status updated.');
          await fetchOrgAndUsers();
        }
      } else {
        const instructions = `Add a DNS TXT record:\n\nName/Host: ${verifyName}\nValue: ${expectedValue}\n\n( TTL 300 or default. Propagation can take minutes to hours. )`;
        alert('Verification record NOT found yet.\n\n' + instructions);
      }
    } catch (e: unknown) {
      const msg = (e as Error)?.message || String(e);
      alert('Verify failed: ' + msg + '\n\nCheck your domain is public and try again. You can manually set verified in DB if needed.');
    } finally {
      setVerifying(false);
    }
  };

  const deleteOrganization = async () => {
    if (!confirm('Permanently DELETE this organization and all related data (products, loans references may break)? This is audited.')) return;
    try {
      await logAudit({
        userId: null,
        organizationId: orgId,
        action: 'organization_deleted',
        resourceType: 'organization',
        resourceId: orgId,
        details: { name: org?.name, via: 'admin_org_detail' },
      });
      const { error } = await supabase.from('organizations').delete().eq('id', orgId);
      if (error) throw error;
      alert('Organization deleted (audited).');
      router.push('/admin/organizations');
    } catch (e: any) {
      alert('Delete failed: ' + (e.message || e) + ' (FK constraints may apply; delete children first if needed)');
    }
  };

  if (loading && !org) {
    return <div className="p-10 text-center">Loading organization...</div>;
  }
  if (!org) {
    return (
      <div className="p-10">
        <button onClick={() => router.push('/admin/organizations')} className="mb-4 px-4 py-2 border rounded-2xl">← Back</button>
        <p>Organization not found.</p>
      </div>
    );
  }

  const verified = !!org.custom_domain_verified || !!(org.raw_attrs && (org.raw_attrs as any).dns_verified);
  const currentFromInRaw = String(((org.raw_attrs as any)?.from_email) || org.from_email || '—');

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex justify-between items-start mb-8">
        <div>
          <button
            onClick={() => router.push('/admin/organizations')}
            className="text-sm px-4 py-2 border rounded-2xl hover:bg-gray-50 mb-2"
          >
            ← Back to Organizations
          </button>
          <h1 className="text-3xl font-bold">{org.name}</h1>
          <p className="text-gray-500">Organization ID: {org.id} {org.slug && `• slug: ${org.slug}`}</p>
        </div>
        <div className="flex gap-3">
          <Link
            href={`/admin/organizations/${orgId}/users`}
            className="px-6 py-3 bg-indigo-600 text-white rounded-2xl hover:bg-indigo-700 inline-flex items-center justify-center"
          >
            Manage Users (full subpage)
          </Link>
          <button
            onClick={() => router.push('/admin/applications')}
            className="px-5 py-3 border rounded-2xl"
          >
            View Applications
          </button>
          <button
            onClick={deleteOrganization}
            className="px-5 py-3 border border-red-300 text-red-600 rounded-2xl hover:bg-red-50"
            title="Delete org (SUPER_ADMIN recommended; audited)"
          >
            Delete Org
          </button>
        </div>
      </div>

      {/* Full Org Details */}
      <div className="bg-white rounded-3xl border p-8 mb-8">
        <h2 className="text-xl font-semibold mb-4">Full Organization Details</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 text-sm">
          <div><span className="font-medium text-gray-500">ID:</span> {org.id}</div>
          <div><span className="font-medium text-gray-500">Name:</span> {org.name}</div>
          <div><span className="font-medium text-gray-500">Slug:</span> {org.slug || '—'}</div>
          <div><span className="font-medium text-gray-500">Parent Org (hierarchy):</span> { (org as any).parent_organization_id || '— (root or L1 under platform root)' }</div>
          <div><span className="font-medium text-gray-500">Approved:</span> {org.approved ? '✅ true' : 'false'} {org.approved_at && `(at ${new Date(org.approved_at).toLocaleString()})`}</div>
          <div><span className="font-medium text-gray-500">Approved By:</span> {org.approved_by || '—'}</div>
          <div><span className="font-medium text-gray-500">Active:</span> {org.active !== false ? 'true' : 'false'}</div>
          <div><span className="font-medium text-gray-500">Created:</span> {new Date(org.created_at).toLocaleString()}</div>
          <div><span className="font-medium text-gray-500">Domain (top-level):</span> {org.domain || '—'}</div>
          <div><span className="font-medium text-gray-500">From Email (top-level):</span> {org.from_email || '—'}</div>
          <div><span className="font-medium text-gray-500">From Email (in raw_attrs):</span> {currentFromInRaw}</div>
          <div><span className="font-medium text-gray-500">Custom Domain Verified:</span> {verified ? '✅ Verified' : 'Not verified'}</div>
          <div><span className="font-medium text-gray-500">Wholesale Markup:</span> {org.wholesale_markup ?? '—'}</div>
          <div><span className="font-medium text-gray-500">Retail Markup:</span> {org.retail_markup ?? '—'}</div>
          <div><span className="font-medium text-gray-500">Pass Credit Costs to Borrower:</span> {org.pass_credit_report_costs_to_borrower ? 'Yes' : 'No'}</div>
          <div><span className="font-medium text-gray-500">Credit Report Cost Amount:</span> {org.credit_report_cost_amount != null ? `$${Number(org.credit_report_cost_amount).toFixed(2)}` : '—'}</div>
        </div>

        <div className="mt-6">
          <div className="font-medium text-gray-500 mb-1">raw_attrs (JSON):</div>
          <pre className="bg-gray-50 p-4 rounded-2xl text-xs overflow-auto max-h-48 border">
            {JSON.stringify(org.raw_attrs || {}, null, 2)}
          </pre>
        </div>

        <div className="mt-4 text-xs text-gray-400">All other fields from organizations table (synced + full details shown).</div>

        {/* Repair for "user created before org" or wrong role (BROKER_AE instead of ADMIN) on main contact */}
        <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-2xl">
          <div className="text-sm font-medium mb-1">Main Contact / Submitter Repair</div>
          <p className="text-xs text-amber-700 mb-2">
            If the original applicant/contact (e.g. the one who filled the apply form, or pre-created via users before this org was approved) is not associated with the org, or has role BROKER_AE instead of organization ADMIN, click to fix. This uses email from raw_attrs / from_email, locates the auth user, ensures profile row + sets role=ADMIN + organization_id (idempotent).
          </p>
          <button
            onClick={async () => {
              if (!confirm('Ensure the main contact for this org is linked with ADMIN role? (safe to re-run)')) return;
              try {
                const res = await ensureMainContactForOrganization(org.id);
                alert((res as any)?.message || 'Main contact ensured as ADMIN.');
                // refresh data
                await fetchOrgAndUsers();
              } catch (e: any) {
                alert('Fix failed: ' + (e?.message || e));
              }
            }}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm rounded-2xl"
          >
            🔧 Ensure Main Contact Linked + Role=ADMIN
          </button>
          <p className="text-[10px] text-amber-600 mt-1">After fix, go to "Manage Users (full subpage)" to confirm, and have the user re-login if role was cached.</p>
        </div>
      </div>

      {/* White Label Settings (domain top-level + from_email inside raw_attrs + DNS verify) */}
      <div className="bg-white rounded-3xl border p-8 mb-8">
        <h2 className="text-xl font-semibold mb-2">White Label Settings</h2>
        <p className="text-sm text-gray-500 mb-6">Edit domain (stored top-level), from_email (stored inside raw_attrs per spec), logo/color for branding. Use DNS verify for custom domain status.</p>

        <div className="space-y-6">
          {/* Logo */}
          <div>
            <label className="block text-sm font-medium mb-2">Logo</label>
            <div className="flex items-center gap-4">
              {editLogo && <img src={editLogo} alt="logo preview" className="h-12 w-12 object-contain border rounded" />}
              <div>
                <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" id="detail-logo" />
                <label htmlFor="detail-logo" className="cursor-pointer px-4 py-2 border rounded-2xl text-sm hover:bg-gray-50">
                  {uploading ? 'Uploading...' : 'Upload Logo'}
                </label>
              </div>
            </div>
          </div>

          {/* Primary Color */}
          <div>
            <label className="block text-sm font-medium mb-2">Primary Color</label>
            <input
              type="color"
              value={editPrimaryColor}
              onChange={(e) => setEditPrimaryColor(e.target.value)}
              className="w-20 h-10 border p-1 rounded"
            />
          </div>

          {/* Domain (top level) */}
          <div>
            <label className="block text-sm font-medium mb-2">Custom Domain (top-level in DB)</label>
            <input
              type="text"
              value={editDomain}
              onChange={(e) => setEditDomain(e.target.value)}
              placeholder="loans.yourcompany.com"
              className="w-full px-5 py-3 border rounded-2xl"
            />
            <p className="text-xs text-gray-500 mt-1">Used by tenant-context for hostname matching and emails.</p>
          </div>

          {/* From Email in raw_attrs */}
          <div>
            <label className="block text-sm font-medium mb-2">From Email (stored in raw_attrs.from_email)</label>
            <input
              type="email"
              value={editFromEmail}
              onChange={(e) => setEditFromEmail(e.target.value)}
              placeholder="noreply@yourcompany.com"
              className="w-full px-5 py-3 border rounded-2xl"
            />
            <p className="text-xs text-gray-500 mt-1">Saved under raw_attrs (also mirrored to top-level from_email for compatibility with email senders / dashboard).</p>
          </div>

          {/* Credit Report Cost Pass-Through */}
          <div className="pt-4 border-t">
            <label className="block text-sm font-medium mb-2">Pass Credit Report Costs to Borrower</label>
            <div className="flex items-center gap-4 mb-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="passCredit"
                  checked={editPassCreditCosts}
                  onChange={() => setEditPassCreditCosts(true)}
                />
                <span>Yes</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="passCredit"
                  checked={!editPassCreditCosts}
                  onChange={() => setEditPassCreditCosts(false)}
                />
                <span>No</span>
              </label>
            </div>
            {editPassCreditCosts && (
              <div>
                <label className="block text-sm font-medium mb-1">Amount to Charge Borrower for Credit Report ($)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={editCreditReportCost}
                  onChange={(e) => setEditCreditReportCost(e.target.value)}
                  placeholder="25.00"
                  className="w-full px-5 py-3 border rounded-2xl"
                />
                <p className="text-xs text-gray-500 mt-1">If enabled, this amount will be passed on to the borrower when ordering credit reports for loans under this organization.</p>
              </div>
            )}
          </div>

          {/* Treasury Benchmark for Base Rates (FRED) */}
          <div className="pt-4 border-t">
            <label className="block text-sm font-medium mb-2">Benchmark Treasury Yield for Base Rate Updates</label>
            <select
              value={editBenchmark}
              onChange={(e) => setEditBenchmark(e.target.value)}
              className="w-full px-5 py-3 border rounded-2xl mb-2"
            >
              <option value="">None (no auto rebase)</option>
              <option value="DGS2">2-Year Treasury (DGS2)</option>
              <option value="DGS5">5-Year Treasury (DGS5)</option>
              <option value="DGS10">10-Year Treasury (DGS10)</option>
              <option value="DGS30">30-Year Treasury (DGS30)</option>
            </select>
            <p className="text-xs text-gray-500">Choose the treasury yield as benchmark. Base rates (interest rate levels) will be shifted by the change in this yield when using "Update Base Rates". Use global update in products to apply to all products.</p>
            <button
              type="button"
              onClick={async () => {
                if (!editBenchmark) return alert('Select a benchmark first');
                const res = await fetchTreasuryRate(editBenchmark);
                if (res.error) alert('Fetch failed: ' + res.error);
                else alert(`Current ${editBenchmark}: ${res.rate}% as of ${res.date}`);
              }}
              className="mt-2 px-4 py-2 bg-blue-600 text-white rounded-2xl text-sm hover:bg-blue-700"
            >
              Fetch Current Rate (test)
            </button>
          </div>
        </div>

        <div className="flex gap-3 mt-8">
          <button
            onClick={saveWhiteLabel}
            disabled={saving}
            className="flex-1 py-3 bg-green-600 text-white rounded-2xl font-semibold hover:bg-green-700 disabled:opacity-60"
          >
            {saving ? 'Saving...' : 'Save Organization Settings'}
          </button>
          <button
            onClick={() => { /* reset to current */ fetchOrgAndUsers(); }}
            className="flex-1 py-3 bg-gray-200 rounded-2xl font-semibold hover:bg-gray-300"
          >
            Reset
          </button>
        </div>

        {/* DNS Verify Section */}
        <div className="mt-10 pt-6 border-t">
          <h3 className="font-semibold mb-2">DNS Verification Status</h3>
          <div className={`inline px-3 py-1 rounded-full text-sm mb-3 ${verified ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
            {verified ? 'VERIFIED' : 'NOT VERIFIED'}
          </div>

          <p className="text-sm text-gray-600 mb-3">
            To prove ownership of the custom domain, add a DNS TXT record. This uses public DNS lookup (no backend required).
          </p>

          {editDomain && (
            <div className="bg-gray-50 p-4 rounded-2xl text-sm mb-4 font-mono">
              Name: <span className="font-bold">_lending-verify.{editDomain}</span><br />
              Value / TXT: <span className="font-bold">{org.id}</span>
            </div>
          )}

          <button
            onClick={handleDnsVerify}
            disabled={verifying || !editDomain}
            className="px-6 py-3 bg-blue-600 text-white rounded-2xl font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {verifying ? 'Checking DNS...' : 'Verify DNS Now'}
          </button>
          <p className="text-xs text-gray-500 mt-2">After adding the record, wait for propagation (use dig or dnschecker.org) then click verify. On success it will set custom_domain_verified=true and update raw_attrs.</p>
        </div>
      </div>

      {/* Users Section — link to existing subpage + integrated view */}
      <div className="bg-white rounded-3xl border p-8">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h2 className="text-xl font-semibold">Organization Users ({users.length})</h2>
            <p className="text-sm text-gray-500">Users linked via organization_id in profiles (canonical table).</p>
          </div>
          <Link
            href={`/admin/organizations/${orgId}/users`}
            className="px-5 py-2 bg-indigo-600 text-white text-sm rounded-2xl hover:bg-indigo-700 inline-flex items-center justify-center"
          >
            Open Full Users Management →
          </Link>
        </div>

        {users.length === 0 ? (
          <p className="text-gray-500 py-4">No users found for this organization yet. Use the full subpage to add (or approve flow creates some automatically).</p>
        ) : (
          <div className="divide-y border rounded-2xl overflow-hidden">
            {users.slice(0, 5).map((u) => (
              <div key={u.id} className="p-4 flex justify-between text-sm">
                <div>
                  <div className="font-medium">{u.full_name || u.email}</div>
                  <div className="text-gray-500">{u.email}</div>
                </div>
                <div className="text-right">
                  <div className="text-gray-500">{u.role?.replace(/_/g, ' ') || '—'}</div>
                  <div className="text-[10px] text-gray-400">{u.created_at ? new Date(u.created_at).toLocaleDateString() : ''}</div>
                </div>
              </div>
            ))}
            {users.length > 5 && <div className="p-3 text-center text-xs text-gray-400">+{users.length - 5} more — see full page</div>}
          </div>
        )}

        <div className="mt-4">
          <Link href={`/admin/organizations/${orgId}/users`} className="text-blue-600 text-sm underline">Go to dedicated /users subpage for add/remove</Link>
        </div>
      </div>

      <div className="mt-8 text-center">
        <button onClick={() => router.push('/admin/organizations')} className="text-sm text-gray-500 hover:text-gray-700">← Return to all approved organizations</button>
      </div>
    </div>
  );
}

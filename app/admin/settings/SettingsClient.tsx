'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { fetchTreasuryRate, setOrgBenchmark, uploadOrganizationLogo } from '@/app/actions/organization-actions';
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
  benchmark_treasury?: string;
  appraisal_fee_preset?: number;
};

interface SettingsClientProps {
  initialOrg: Org | null;
}

export default function SettingsClient({ initialOrg }: SettingsClientProps) {
  const router = useRouter();
  const [org, setOrg] = useState<Org | null>(initialOrg);
  const [loading, setLoading] = useState(!initialOrg);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Editable fields (initialized from server-provided org when available)
  const [editDomain, setEditDomain] = useState(initialOrg?.domain || '');
  const [editFromEmail, setEditFromEmail] = useState(
    (initialOrg?.raw_attrs as any)?.from_email || initialOrg?.from_email || ''
  );
  const [editPrimaryColor, setEditPrimaryColor] = useState(initialOrg?.primary_color || '#3b82f6');
  const [editLogo, setEditLogo] = useState<string | undefined>(initialOrg?.logo_url);
  const [editPassCreditCosts, setEditPassCreditCosts] = useState(
    !!initialOrg?.pass_credit_report_costs_to_borrower
  );
  const [editCreditReportCost, setEditCreditReportCost] = useState(
    initialOrg?.credit_report_cost_amount != null ? String(initialOrg.credit_report_cost_amount) : ''
  );
  const [editBenchmark, setEditBenchmark] = useState(initialOrg?.benchmark_treasury || '');
  const [editAppraisalFee, setEditAppraisalFee] = useState(
    initialOrg?.appraisal_fee_preset != null ? String(initialOrg.appraisal_fee_preset) : ''
  );

  const [currentUserOrgId, setCurrentUserOrgId] = useState<string | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState<string>('');

  // Client-side enrichment (user's actual profile org + re-fetch for freshness)
  // The critical "current company info" was already resolved on the server via domain.
  useEffect(() => {
    async function enrichWithUserContext() {
      try {
        const { data: { user: au } } = await supabase.auth.getUser();
        if (!au?.id) {
          router.push('/sign-in');
          return;
        }

        let orgId: string | null = null;
        let role = '';
        let { data: prof } = await supabase
          .from('profiles')
          .select('role, organization_id')
          .eq('id', au.id)
          .maybeSingle();

        if (prof) {
          role = prof.role || '';
          orgId = prof.organization_id || null;
        }
        if (!orgId) {
          const { data: urow } = await supabase
            .from('users')
            .select('role, organization_id')
            .eq('id', au.id)
            .maybeSingle();
          if (urow) {
            role = urow.role || role;
            orgId = urow.organization_id || orgId;
          }
        }

        setCurrentUserRole(role);
        setCurrentUserOrgId(orgId);

        // If the server gave us an org via domain, keep it for display.
        // If the user's profile org is different (or server had no match), fetch the user's org.
        if (orgId && (!org || org.id !== orgId)) {
          await fetchOrg(orgId);
        }
      } catch (e) {
        console.warn('Failed to enrich settings with user context', e);
      } finally {
        setLoading(false);
      }
    }

    if (initialOrg) {
      // We already have the server-resolved org (correct company info at HTML time)
      enrichWithUserContext();
    } else {
      // No server org (rare) — do full client load
      loadCurrentUserAndOrg();
    }
  }, [initialOrg]);

  async function loadCurrentUserAndOrg() {
    setLoading(true);
    try {
      const { data: { user: au } } = await supabase.auth.getUser();
      if (!au?.id) {
        router.push('/sign-in');
        return;
      }

      let orgId: string | null = null;
      let role = '';
      let { data: prof } = await supabase
        .from('profiles')
        .select('role, organization_id')
        .eq('id', au.id)
        .maybeSingle();
      if (prof) {
        role = prof.role || '';
        orgId = prof.organization_id || null;
      }
      if (!orgId) {
        const { data: urow } = await supabase
          .from('users')
          .select('role, organization_id')
          .eq('id', au.id)
          .maybeSingle();
        if (urow) {
          role = urow.role || role;
          orgId = urow.organization_id || orgId;
        }
      }

      setCurrentUserRole(role);
      setCurrentUserOrgId(orgId);

      const targetOrgId = orgId;
      if (targetOrgId) {
        await fetchOrg(targetOrgId);
      } else {
        // fallback to root
        const { data: root } = await supabase
          .from('organizations')
          .select('*')
          .eq('name', 'Loan-App Platform')
          .maybeSingle();
        if (root) await fetchOrg(root.id);
      }
    } catch (e) {
      console.error('Failed to load settings', e);
    } finally {
      setLoading(false);
    }
  }

  async function fetchOrg(orgId: string) {
    try {
      const { data: orgData, error: orgErr } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', orgId)
        .single();

      if (orgErr) {
        console.error('Org fetch error:', orgErr);
        return;
      }

      setOrg(orgData as Org);

      // sync edit fields
      setEditDomain(orgData?.domain || '');
      const ra = (orgData?.raw_attrs || {}) as Record<string, unknown>;
      setEditFromEmail((ra.from_email as string) || orgData?.from_email || '');
      setEditPrimaryColor(orgData?.primary_color || '#3b82f6');
      setEditLogo(orgData?.logo_url);
      setEditPassCreditCosts(!!orgData?.pass_credit_report_costs_to_borrower);
      setEditCreditReportCost(orgData?.credit_report_cost_amount != null ? String(orgData.credit_report_cost_amount) : '');
      setEditBenchmark(orgData?.benchmark_treasury || '');
      setEditAppraisalFee(orgData?.appraisal_fee_preset != null ? String(orgData.appraisal_fee_preset) : '');
    } catch (e) {
      console.error('fetchOrg error', e);
    }
  }

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !org) return;

    setUploading(true);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('orgId', org.id);

      const res = await uploadOrganizationLogo(formData);
      setEditLogo(res.publicUrl);
      alert('Logo uploaded. Click Save to persist.');
    } catch (err: unknown) {
      const msg = (err as Error)?.message || String(err);
      console.error('Logo upload error:', err);
      alert('Upload failed: ' + msg);
    } finally {
      setUploading(false);
    }
  };

  const saveWhiteLabel = async () => {
    if (!org) return;
    setSaving(true);

    try {
      const currentRaw = org.raw_attrs || {};
      const update: any = {
        domain: editDomain || null,
        from_email: editFromEmail || null,
        primary_color: editPrimaryColor || '#3b82f6',
        logo_url: editLogo || null,
        pass_credit_report_costs_to_borrower: editPassCreditCosts,
        credit_report_cost_amount: editCreditReportCost ? parseFloat(editCreditReportCost) : null,
        benchmark_treasury: editBenchmark || null,
        appraisal_fee_preset: editAppraisalFee ? parseFloat(editAppraisalFee) : 900,
        raw_attrs: {
          ...currentRaw,
          from_email: editFromEmail || currentRaw.from_email,
        },
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from('organizations')
        .update(update)
        .eq('id', org.id);

      if (error) throw error;

      await logAudit({
        userId: null,
        organizationId: org.id,
        action: 'organization_settings_updated',
        resourceType: 'organization',
        resourceId: org.id,
        details: { fields: Object.keys(update) },
      });

      alert('Settings saved successfully!');
      await fetchOrg(org.id);
    } catch (err: any) {
      alert('Save failed: ' + (err.message || err));
    } finally {
      setSaving(false);
    }
  };

  const handleBenchmarkFetch = async () => {
    if (!editBenchmark) {
      alert('Select a benchmark first');
      return;
    }
    const r = await fetchTreasuryRate(editBenchmark);
    if (r.error) alert('Error: ' + r.error);
    else alert(`Current rate for ${editBenchmark}: ${r.rate}% (as of ${r.date})`);
  };

  const handleRebase = async () => {
    if (!org || !editBenchmark) {
      alert('Select a benchmark first');
      return;
    }
    if (!confirm(`Rebase base rates for ${org.name} using ${editBenchmark}?`)) return;
    try {
      const res = await setOrgBenchmark(org.id, editBenchmark);
      if (res.error) throw new Error(res.error);
      alert('Rebase complete.');
    } catch (e: any) {
      alert('Rebase failed: ' + (e.message || e));
    }
  };

  if (loading && !org) {
    return <div className="p-10 text-center">Loading current organization settings...</div>;
  }

  if (!org) {
    return (
      <div className="p-8">
        <h1 className="text-3xl font-bold mb-4">My Company Settings</h1>
        <p className="text-gray-500">No organization context found.</p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">My Company Settings</h1>
        <p className="text-gray-500">
          Organization: <strong>{org.name}</strong> (ID: {org.id})
        </p>
        <p className="text-sm text-gray-400 mt-1">
          These settings control your white-label branding, from email, treasury benchmark, and credit report handling.
          {currentUserRole === 'ORG_ADMIN' && ' Changes apply to your organization and any sponsored children.'}
        </p>
      </div>

      <div className="bg-white rounded-3xl border p-8 mb-8">
        <h2 className="text-xl font-semibold mb-6">White Label &amp; Company Information</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium mb-2">Custom Domain</label>
            <input
              type="text"
              value={editDomain}
              onChange={(e) => setEditDomain(e.target.value)}
              className="w-full px-4 py-3 border rounded-2xl"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">From Email</label>
            <input
              type="email"
              value={editFromEmail}
              onChange={(e) => setEditFromEmail(e.target.value)}
              className="w-full px-4 py-3 border rounded-2xl"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Primary Color</label>
            <div className="flex gap-3 items-center">
              <input
                type="color"
                value={editPrimaryColor}
                onChange={(e) => setEditPrimaryColor(e.target.value)}
                className="w-12 h-12 p-1 border rounded"
              />
              <input
                type="text"
                value={editPrimaryColor}
                onChange={(e) => setEditPrimaryColor(e.target.value)}
                className="flex-1 px-4 py-3 border rounded-2xl font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Logo</label>
            <div className="flex items-center gap-4">
              {editLogo && <img src={editLogo} alt="logo" className="h-12 border rounded p-1 bg-white" />}
              <label className="px-4 py-2 text-sm bg-blue-600 text-white rounded-xl cursor-pointer hover:bg-blue-700">
                {uploading ? 'Uploading...' : 'Upload Logo'}
                <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" disabled={uploading} />
              </label>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Benchmark Treasury</label>
            <select
              value={editBenchmark}
              onChange={(e) => setEditBenchmark(e.target.value)}
              className="w-full px-4 py-3 border rounded-2xl"
            >
              <option value="">None</option>
              <option value="DGS2">2-Year</option>
              <option value="DGS5">5-Year</option>
              <option value="DGS10">10-Year</option>
              <option value="DGS30">30-Year</option>
            </select>
            <div className="flex gap-2 mt-2">
              <button onClick={handleBenchmarkFetch} className="px-3 py-1 text-sm bg-blue-600 text-white rounded" disabled={!editBenchmark}>
                Fetch Rate
              </button>
              <button onClick={handleRebase} className="px-3 py-1 text-sm bg-emerald-600 text-white rounded" disabled={!editBenchmark}>
                Rebase Rates
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Appraisal Fee Preset</label>
            <input
              type="number"
              step="0.01"
              value={editAppraisalFee}
              onChange={(e) => setEditAppraisalFee(e.target.value)}
              className="w-full px-4 py-3 border rounded-2xl"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-medium mb-2">Pass Credit Report Costs?</label>
            <div className="flex gap-6">
              <label>
                <input type="radio" checked={editPassCreditCosts} onChange={() => setEditPassCreditCosts(true)} /> Yes
              </label>
              <label>
                <input type="radio" checked={!editPassCreditCosts} onChange={() => setEditPassCreditCosts(false)} /> No
              </label>
            </div>
            {editPassCreditCosts && (
              <input
                type="number"
                step="0.01"
                value={editCreditReportCost}
                onChange={(e) => setEditCreditReportCost(e.target.value)}
                className="w-full mt-2 px-4 py-3 border rounded-2xl"
                placeholder="35.00"
              />
            )}
          </div>
        </div>

        <div className="mt-8 flex gap-3">
          <button onClick={saveWhiteLabel} disabled={saving} className="px-8 py-3 bg-green-600 text-white rounded-2xl disabled:opacity-50">
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
          <button onClick={() => router.push(`/admin/organizations/${org.id}`)} className="px-6 py-3 border rounded-2xl">
            Full Org Management →
          </button>
        </div>
      </div>

      <div className="text-xs text-gray-500">
        Settings for the current organization (resolved server-side from domain where possible).
      </div>
    </div>
  );
}

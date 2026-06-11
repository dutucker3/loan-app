'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
// Global AppHeader now lives in root layout (includes tenant branding + user profile/logout)
import { logAudit } from '@/lib/audit';

// Separate conditions (one document per condition) - per requirements
const TITLE_SEEDS = [
  { file_name: 'Title Commitment', ai_prompt: 'Provide current title commitment with all schedules and exceptions.' },
  { file_name: 'Closing Protection Letter', ai_prompt: 'Provide the required closing protection letter from the title insurer.' },
  { file_name: 'Prelim Combined Closing Statement', ai_prompt: 'Provide preliminary combined closing statement / HUD.' },
  { file_name: 'E & O Insurance', ai_prompt: 'Provide current E&O insurance certificate/declaration for the title company.' },
];

const INSURANCE_SEEDS = [
  { file_name: 'Invoice', ai_prompt: 'Provide the insurance premium invoice.' },
  { file_name: 'Certificate of Insurance', ai_prompt: 'Provide the ACORD or equivalent certificate of insurance.' },
  { file_name: 'Declarations', ai_prompt: 'Provide the policy declarations page.' },
];

const INITIAL_PURCHASE_SEEDS = [
  { file_name: 'A. Credit Report', ai_prompt: 'Pull and review full credit report (tri-merge preferred). Flag any issues per guidelines.' },
  { file_name: 'B. Purchase Contract', ai_prompt: 'Review executed purchase contract for key terms, contingencies, and parties.' },
  { file_name: 'C. Appraisal', ai_prompt: 'Review appraisal for value support, condition, and compliance.' },
  { file_name: 'D. Articles of Incorporation', ai_prompt: 'Verify entity formation documents.' },
  { file_name: 'E. EIN Letter from IRS', ai_prompt: 'Confirm IRS EIN issuance for the borrowing entity.' },
  { file_name: 'F. Operating Agreement or ByLaws', ai_prompt: 'Review governing documents for authority and structure.' },
  { file_name: 'G. Certificate of Good Standing', ai_prompt: 'Confirm current good standing with state of formation.' },
  { file_name: 'H. Bank statement most recent closing month (ie May)', ai_prompt: 'Review most recent bank statement for cash flow and reserves.' },
  { file_name: 'I. Bank Statement 2nd Most Recent month (ie April)', ai_prompt: 'Review second most recent bank statement for cash flow consistency.' },
];

const REFI_SEEDS = [
  { file_name: 'A. Credit Report', ai_prompt: 'Pull and review full credit report (tri-merge preferred). Flag any issues per guidelines.' },
  { file_name: 'B. Purchase HUD', ai_prompt: 'Review prior HUD/settlement statement for refinance context.' },
  { file_name: 'C. Appraisal', ai_prompt: 'Review appraisal for value support, condition, and compliance.' },
  { file_name: 'D. Articles of Incorporation', ai_prompt: 'Verify entity formation documents.' },
  { file_name: 'E. EIN Letter from IRS', ai_prompt: 'Confirm IRS EIN issuance for the borrowing entity.' },
  { file_name: 'F. Operating Agreement or ByLaws', ai_prompt: 'Review governing documents for authority and structure.' },
  { file_name: 'G. Certificate of Good Standing', ai_prompt: 'Confirm current good standing with state of formation.' },
  { file_name: 'H. Bank Statement Most recent closing month (ie May)', ai_prompt: 'Review most recent bank statement for cash flow and reserves.' },
  { file_name: 'I. Bank Statement 2nd Most Recent Closing Month (ie April)', ai_prompt: 'Review second most recent bank statement for cash flow consistency.' },
];

export default function NewProductPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [currentUserOrgId, setCurrentUserOrgId] = useState<string | null>(null);
  const [orgMortgagee, setOrgMortgagee] = useState<string>('');

  const [form, setForm] = useState({
    name: '',
    description: '',
    mortgagee_clause: '',
    insurance_requirements: '',
    // bridge_config (4 % per user answers) - only relevant for bridge products but shown for all for simplicity
    bridge_initial_loan_pct: '70',
    bridge_rehab_funded_pct: '90',
    bridge_arv_ltv_pct: '75',
    bridge_ltc_pct: '80',
  });

  useEffect(() => {
    async function loadContext() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }
      try {
        const { data: prof } = await supabase.from('profiles').select('organization_id').eq('id', user.id).maybeSingle();
        let orgId = prof?.organization_id || null;
        if (!orgId) {
          const { data: urow } = await supabase.from('profiles').select('organization_id').eq('id', user.id).maybeSingle();
          orgId = urow?.organization_id || null;
        }
        setCurrentUserOrgId(orgId);

        if (orgId) {
          const { data: org } = await supabase
            .from('organizations')
            .select('mortgagee_clause')
            .eq('id', orgId)
            .maybeSingle();
          if (org?.mortgagee_clause) {
            setOrgMortgagee(org.mortgagee_clause);
            setForm(prev => ({ ...prev, mortgagee_clause: org.mortgagee_clause }));
          }
        }
      } catch (e) {
        console.error('Context load error', e);
      }
      setLoading(false);
    }
    loadContext();
  }, [router]);

  // Prefill bridge config if coming from "Create Bridge Product" button on /admin/products
  useEffect(() => {
    if (searchParams.get('type') === 'bridge') {
      setForm(prev => ({
        ...prev,
        name: prev.name || 'Bridge / Fix & Flip',
        bridge_initial_loan_pct: '70',
        bridge_rehab_funded_pct: '90',
        bridge_arv_ltv_pct: '75',
        bridge_ltc_pct: '80',
      }));
    }
  }, [searchParams]);

  const handleChange = (field: string, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const createProduct = async () => {
    if (!form.name.trim()) {
      alert('Product name is required.');
      return;
    }
    if (!currentUserOrgId) {
      alert('No organization context. Please ensure you are logged in with an organization.');
      return;
    }

    setSaving(true);

    const initialStandardConditions = {
      purchase: [...TITLE_SEEDS, ...INSURANCE_SEEDS, ...INITIAL_PURCHASE_SEEDS],
      refinance: [...INSURANCE_SEEDS, ...REFI_SEEDS],
    };

    const bridgeConfig = {
      initialLoanPct: parseFloat(form.bridge_initial_loan_pct) || 0.7,
      rehabFundedPct: parseFloat(form.bridge_rehab_funded_pct) || 0.9,
      arvLtvPct: parseFloat(form.bridge_arv_ltv_pct) || 0.75,
      ltcPct: parseFloat(form.bridge_ltc_pct) || 0.8,
    };

    const insertPayload: any = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      pricing_matrix: {},
      default_profit_percent: 1.0,
      active: true,
      organization_id: currentUserOrgId,
      standard_conditions: initialStandardConditions,
      insurance_requirements: form.insurance_requirements.trim() || null,
      bridge_config: bridgeConfig,
    };

    const { data, error } = await supabase
      .from('loan_products')
      .insert(insertPayload)
      .select()
      .single();

    if (error) {
      alert('Error creating product: ' + error.message);
      setSaving(false);
      return;
    }

    // If a mortgagee clause was entered on this form and differs from org, persist it to the parent org (L1 level)
    const enteredMortgagee = form.mortgagee_clause.trim();
    if (enteredMortgagee && enteredMortgagee !== orgMortgagee) {
      await supabase
        .from('organizations')
        .update({ mortgagee_clause: enteredMortgagee })
        .eq('id', currentUserOrgId);
    }

    await logAudit({
      userId: null,
      organizationId: currentUserOrgId,
      action: 'product_created',
      resourceType: 'product',
      resourceId: data.id,
      details: {
        name: data.name,
        has_title_insurance_conditions: true,
        has_insurance_requirements: !!form.insurance_requirements,
        has_mortgagee_clause: !!enteredMortgagee,
        has_bridge_config: true,
      },
    });

    setSaving(false);
    alert('✅ Product created with separate conditions pre-seeded for Title (4), Insurance (3), Initial Purchase, and Refinance.');
    const isBridge = !!data.bridge_config || (data.name || '').toLowerCase().includes('bridge') || (data.name || '').toLowerCase().includes('fix');
    router.push(isBridge ? `/admin/products/bridge/${data.id}` : `/admin/products/${data.id}`);
  };

  if (loading) {
    return <div className="p-10 text-center text-xl">Loading...</div>;
  }

  return (
    <div className="max-w-4xl mx-auto p-8">
      {/* Global AppHeader (root layout) */}

      <div className="mb-8">
        <button
          onClick={() => router.push('/admin/products')}
          className="px-6 py-2 bg-gray-100 hover:bg-gray-200 rounded-2xl text-sm font-medium"
        >
          ← Back to Products
        </button>
      </div>

      <h1 className="text-3xl font-bold mb-2">New Loan Product</h1>
      <p className="text-gray-600 mb-8">
        Level 1 / parent organizations: specify the mortgagee clause here. It will be included in all automated title and insurance provider request emails for loans using products from this organization.
      </p>

      <div className="bg-white border rounded-3xl p-8 space-y-6">
        <div>
          <label className="block text-sm font-medium mb-2">Product Name *</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => handleChange('name', e.target.value)}
            className="w-full px-5 py-4 border rounded-2xl"
            placeholder="DSCR Standard 80% or Signature Series"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Description (optional)</label>
          <textarea
            value={form.description}
            onChange={(e) => handleChange('description', e.target.value)}
            className="w-full px-5 py-4 border rounded-2xl h-24"
            placeholder="Short description for internal use and borrower-facing materials"
          />
        </div>

        <div className="border-t pt-6">
          <label className="block text-sm font-semibold mb-2 text-blue-700">
            Mortgagee Clause (for Title &amp; Insurance Provider Emails)
          </label>
          <p className="text-xs text-gray-500 mb-2">
            This text is sent in the initial automated email to the title company and insurance company contacts when a loan using this product (or org) is created. It is typically the full legal mortgagee wording your investors require.
          </p>
          <textarea
            value={form.mortgagee_clause}
            onChange={(e) => handleChange('mortgagee_clause', e.target.value)}
            className="w-full px-5 py-4 border rounded-2xl h-32 font-mono text-sm"
            placeholder="e.g. Mortgage Electronic Registration Systems, Inc. (MERS), as nominee for [Lender Name], its successors and assigns, 123 Main St, Anytown, ST 12345"
          />
          {orgMortgagee && form.mortgagee_clause === orgMortgagee && (
            <p className="text-xs text-green-600 mt-1">Using organization default mortgagee clause.</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-semibold mb-2 text-blue-700">
            Insurance Requirements (sent to Insurance Provider)
          </label>
          <p className="text-xs text-gray-500 mb-2">
            This text is included in the automated request email to the insurance company contact. It should list coverage amounts, special wording, or any additional requirements the carrier must meet (e.g. "Minimum $1M general liability, lender named as additional insured, 30-day cancellation notice").
          </p>
          <textarea
            value={form.insurance_requirements}
            onChange={(e) => handleChange('insurance_requirements', e.target.value)}
            className="w-full px-5 py-4 border rounded-2xl h-32"
            placeholder="Minimum dwelling coverage equal to loan amount or replacement cost. Lender's loss payable clause with 30 days notice of cancellation. ..."
          />
        </div>

        {/* Bridge / Fix & Flip Config - the 4 % fields (shown when creating bridge products) */}
        <div className="border-t pt-6">
          <label className="block text-sm font-semibold mb-2 text-indigo-700">
            Bridge / Fix &amp; Flip Config (4 % values)
          </label>
          <p className="text-xs text-gray-500 mb-3">
            These are used on the bridge loan review page (/bridge-loans/[id]) for pre-filling and calculating term sheets. Stored in the product's <code>bridge_config</code> JSON.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs mb-1">Initial Loan % (of purchase)</label>
              <input type="number" step="0.1" value={form.bridge_initial_loan_pct} onChange={e => handleChange('bridge_initial_loan_pct', e.target.value)} className="w-full px-4 py-2 border rounded-xl" />
            </div>
            <div>
              <label className="block text-xs mb-1">% of Rehab Loan Funded</label>
              <input type="number" step="0.1" value={form.bridge_rehab_funded_pct} onChange={e => handleChange('bridge_rehab_funded_pct', e.target.value)} className="w-full px-4 py-2 border rounded-xl" />
            </div>
            <div>
              <label className="block text-xs mb-1">Total After Repaired LTV (ARV %)</label>
              <input type="number" step="0.1" value={form.bridge_arv_ltv_pct} onChange={e => handleChange('bridge_arv_ltv_pct', e.target.value)} className="w-full px-4 py-2 border rounded-xl" />
            </div>
            <div>
              <label className="block text-xs mb-1">Total Loan to Cost (LTC %)</label>
              <input type="number" step="0.1" value={form.bridge_ltc_pct} onChange={e => handleChange('bridge_ltc_pct', e.target.value)} className="w-full px-4 py-2 border rounded-xl" />
            </div>
          </div>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm">
          <strong>Automatic Conditions:</strong> When you create this product, two standard condition types will be pre-added to both Purchase and Refinance:
          <ul className="list-disc ml-5 mt-2">
            <li><strong>Separate Title conditions (4)</strong> — Title Commitment, Closing Protection Letter, Prelim Combined Closing Statement, E&amp;O Insurance</li>
            <li><strong>Separate Insurance conditions (3)</strong> — Invoice, Certificate of Insurance, Declarations</li>
            <li><strong>Initial Purchase conditions (9)</strong> — Credit Report, Purchase Contract, Appraisal, Articles of Incorporation, EIN Letter, Operating Agreement/ByLaws, Certificate of Good Standing, Bank Statement (most recent), Bank Statement (2nd most recent)</li>
            <li><strong>Refinance conditions (9)</strong> — Credit Report, Purchase HUD, Appraisal, Articles of Incorporation, EIN Letter, Operating Agreement/ByLaws, Certificate of Good Standing, Bank Statement (most recent), Bank Statement (2nd most recent)</li>
          </ul>
          These will automatically appear on every <code>/loans/[id]</code> page for loans using this product. When you (or a processor) enter title/insurance company contact details at loan creation time, the system will email secure upload links to those providers.
        </div>

        <div className="flex gap-4 pt-4">
          <button
            onClick={createProduct}
            disabled={saving || !form.name.trim()}
            className="flex-1 px-8 py-4 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-3xl font-semibold text-lg"
          >
            {saving ? 'Creating Product...' : 'Create Product with Provider Conditions'}
          </button>
          <button
            onClick={() => router.push('/admin/products')}
            className="px-8 py-4 bg-gray-100 hover:bg-gray-200 rounded-3xl font-semibold"
          >
            Cancel
          </button>
        </div>
      </div>

      <p className="text-xs text-gray-500 mt-6">
        Tip: Set the mortgagee clause at the organization level (or here) once for the parent/L1 org. It will be copied onto loans for provider emails. You can edit insurance requirements per product.
      </p>
    </div>
  );
}

'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
// TenantHeader removed - global AppHeader now provided by root layout
import { rebaseProductBaseRates, fetchTreasuryRate } from '@/app/actions/organization-actions';
import { isLevel2BrokerAE } from '@/lib/permissions';
import { logPageVisit, logAudit } from '@/lib/audit';

// Basic CSV parser for base rate schedule (2 columns: rate, price). Supports quoted fields minimally.
function parseBaseRateCsv(text: string): Record<string, number> {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  const result: Record<string, number> = {};
  for (let i = 0; i < lines.length; i++) {
    if (i === 0 && /base|rate|premium|price/i.test(lines[i])) continue; // skip header
    // Simple split on first comma (handle basic quoted)
    const line = lines[i].trim();
    const parts = line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
    if (parts.length < 2) continue;
    let rate = parts[0].replace(/"/g, '').trim();
    let priceStr = parts[1].replace(/"/g, '').trim();
    const price = parseFloat(priceStr);
    if (rate && !isNaN(price)) {
      // Normalize rate to 3 decimals like 5.000
      const normRate = parseFloat(rate).toFixed(3);
      result[normRate] = price;
    }
  }
  return result;
}

function roundToNearestEighth(n: number): number {
  return Math.round(n * 8) / 8;
}

type UnderwritingCondition = {
  file_name: string;
  ai_prompt: string;
};

export default function ProductDetailPage() {
  const params = useParams();
  const router = useRouter();
  const productId = params.id as string;

  const [product, setProduct] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // User context for L2 margin read-only on inherited + owner logic
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState<string>('BROKER_AE');
  const [currentUserParentId, setCurrentUserParentId] = useState<string | null>(null);

  const [purchaseConditions, setPurchaseConditions] = useState<UnderwritingCondition[]>([]);
  const [refinanceConditions, setRefinanceConditions] = useState<UnderwritingCondition[]>([]);

  // Provider request configuration (new for title/insurance automation)
  const [insuranceReq, setInsuranceReq] = useState<string>('');
  const [orgMortgageeClause, setOrgMortgageeClause] = useState<string>('');

  // Local state for adding new base rates (editable on main product page)
  const [newBaseRateKey, setNewBaseRateKey] = useState('');
  const [newBaseRateValue, setNewBaseRateValue] = useState('');

  // For CSV base rate upload + margin-based treasury adjustment (per user spec)
  const [currentBenchmark, setCurrentBenchmark] = useState('3.50'); // default example
  const [scheduleBenchmark, setScheduleBenchmark] = useState('3.50'); // the benchmark the current/last-uploaded schedule was for
  const [csvUploadStatus, setCsvUploadStatus] = useState('');

  useEffect(() => {
    fetchProduct();
  }, [productId]);

  // Load current user (for margin editability: L2 can set on inherited; parent sees read-only on inherited; owner full)
  useEffect(() => {
    async function loadUser() {
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!u) return;
      setCurrentUserId(u.id);
      try {
        const { data: prof } = await supabase.from('profiles').select('role, organization_id, parent_id').eq('id', u.id).maybeSingle();
        setCurrentUserRole(prof?.role || 'BROKER_AE');
        setCurrentUserParentId((prof as any)?.parent_id || null);
      } catch (e) {
        console.warn('[product detail] parent_id/role load (non-fatal, may be schema cache):', (e as any)?.message);
      }
    }
    loadUser();
  }, []);

  async function fetchProduct() {
    setLoading(true);
    const { data, error } = await supabase
      .from('loan_products')
      .select('*')
      .eq('id', productId)
      .single();

    if (data) {
      setProduct(data);
      setPurchaseConditions(data.standard_conditions?.purchase || []);
      setRefinanceConditions(data.standard_conditions?.refinance || []);
      setInsuranceReq(data.insurance_requirements || '');

      // Load org-level mortgagee clause (the parent org specifies this for provider emails)
      if (data.organization_id) {
        supabase
          .from('organizations')
          .select('mortgagee_clause')
          .eq('id', data.organization_id)
          .maybeSingle()
          .then(({ data: org }) => setOrgMortgageeClause(org?.mortgagee_clause || ''));
      }
    }
    setLoading(false);
  }

  // Light page visit logging for critical /admin/products/[id] (margin/base/conditions page).
  useEffect(() => {
    if (product?.organization_id) {
      // user not loaded here; call without for visit (server will capture what it can), or load like others
      const uid = null;
      logPageVisit(`/admin/products/${productId}`, uid, product.organization_id).catch(() => {});
    }
  }, [productId, product?.organization_id]);

  const saveProduct = async () => {
    if (!product) return;
    setSaving(true);

    // Log key mutation for margin/base updates + conditions changes (pricing_matrix holds margins/base, standard_conditions)
    await logAudit({
      userId: null,
      organizationId: product.organization_id,
      action: 'product_saved',
      resourceType: 'product',
      resourceId: productId,
      details: {
        name: product.name,
        has_pricing_matrix: !!product.pricing_matrix,
        baseRates_count: Object.keys(product.pricing_matrix?.baseRates || product.pricing_matrix?.['Base Rate'] || {}).length,
        conditions_purchase: purchaseConditions.length,
        conditions_refinance: refinanceConditions.length,
        markup: product.pricing_matrix?.markup || null,
      },
    });

    const { error } = await supabase
      .from('loan_products')
      .update({
        name: product.name,
        description: product.description,
        pricing_matrix: product.pricing_matrix,
        standard_conditions: {
          purchase: purchaseConditions,
          refinance: refinanceConditions,
        },
        default_profit_percent: product.default_profit_percent || 1.0,
        insurance_requirements: insuranceReq || null,
      })
      .eq('id', productId);

    if (error) {
      alert('Save failed: ' + error.message);
    } else {
      alert('✅ Product saved successfully!');
    }
    setSaving(false);
  };

  const copyProduct = async () => {
    if (!product) return;
    const newName = prompt("New Product Name:", `${product.name} (Copy)`);
    if (!newName) return;

    const isL2 = isLevel2BrokerAE({ id: currentUserId || '', role: currentUserRole, parent_id: currentUserParentId });
    const copyOwner = isL2 && currentUserId ? currentUserId : (product.owner_user_id || null);

    const { data: newProduct, error } = await supabase
      .from('loan_products')
      .insert({
        name: newName,
        description: product.description,
        pricing_matrix: product.pricing_matrix,
        default_profit_percent: product.default_profit_percent,
        standard_conditions: product.standard_conditions,
        organization_id: product.organization_id,
        active: true,
        // L2 copying an inherited product => new copy is their private own (hidden upward per rules)
        ...(copyOwner ? { owner_user_id: copyOwner } : {}),
      })
      .select()
      .single();

    if (error) {
      alert('Copy failed: ' + error.message);
    } else {
      await logAudit({
        userId: null,
        organizationId: product.organization_id,
        action: 'product_copied',
        resourceType: 'product',
        resourceId: newProduct?.id,
        details: { original_id: productId, new_name: newName },
      });
      alert(`✅ Product copied as "${newName}"!`);
      router.push(`/admin/products/${newProduct.id}`);
    }
  };

  // ==================== CONDITION FUNCTIONS ====================
  const addCondition = (type: 'purchase' | 'refinance') => {
    const newCond = { file_name: '', ai_prompt: '' };
    if (type === 'purchase') {
      setPurchaseConditions([...purchaseConditions, newCond]);
    } else {
      setRefinanceConditions([...refinanceConditions, newCond]);
    }
  };

  const updateCondition = (type: 'purchase' | 'refinance', index: number, field: 'file_name' | 'ai_prompt', value: string) => {
    if (type === 'purchase') {
      const updated = [...purchaseConditions];
      updated[index] = { ...updated[index], [field]: value };
      setPurchaseConditions(updated);
    } else {
      const updated = [...refinanceConditions];
      updated[index] = { ...updated[index], [field]: value };
      setRefinanceConditions(updated);
    }
  };

  const removeCondition = (type: 'purchase' | 'refinance', index: number) => {
    if (type === 'purchase') {
      setPurchaseConditions(purchaseConditions.filter((_, i) => i !== index));
    } else {
      setRefinanceConditions(refinanceConditions.filter((_, i) => i !== index));
    }
  };

  // Seed the required separate conditions (each as its own doc/condition, per user spec)
  const seedDefaultConditions = () => {
    const purchaseSeeds = [
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

    const refinanceSeeds = [
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

    // Title company separate conditions (4)
    const titleSeeds = [
      { file_name: 'Title Commitment', ai_prompt: 'Provide current title commitment with all schedules and exceptions.' },
      { file_name: 'Closing Protection Letter', ai_prompt: 'Provide the required closing protection letter from the title insurer.' },
      { file_name: 'Prelim Combined Closing Statement', ai_prompt: 'Provide preliminary combined closing statement / HUD.' },
      { file_name: 'E & O Insurance', ai_prompt: 'Provide current E&O insurance certificate/declaration for the title company.' },
    ];

    // Insurance separate (3)
    const insuranceSeeds = [
      { file_name: 'Invoice', ai_prompt: 'Provide the insurance premium invoice.' },
      { file_name: 'Certificate of Insurance', ai_prompt: 'Provide the ACORD or equivalent certificate of insurance.' },
      { file_name: 'Declarations', ai_prompt: 'Provide the policy declarations page.' },
    ];

    // Merge without obvious dups (by file_name)
    const existingPurchaseNames = new Set(purchaseConditions.map(c => c.file_name.trim().toLowerCase()));
    const newPurchase = [...purchaseConditions];
    [...purchaseSeeds, ...titleSeeds, ...insuranceSeeds].forEach(s => {
      if (!existingPurchaseNames.has(s.file_name.toLowerCase())) {
        newPurchase.push(s);
        existingPurchaseNames.add(s.file_name.toLowerCase());
      }
    });

    const existingRefiNames = new Set(refinanceConditions.map(c => c.file_name.trim().toLowerCase()));
    const newRefi = [...refinanceConditions];
    refinanceSeeds.forEach(s => {
      if (!existingRefiNames.has(s.file_name.toLowerCase())) {
        newRefi.push(s);
        existingRefiNames.add(s.file_name.toLowerCase());
      }
    });

    setPurchaseConditions(newPurchase);
    setRefinanceConditions(newRefi);
    alert('Default conditions seeded (separate entries for each required document). Save the product to persist.');
  };

  // CSV upload for base rate schedule (adds/replaces baseRates in pricing_matrix)
  const handleBaseRateCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvUploadStatus('Parsing...');
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target?.result as string;
        const parsed = parseBaseRateCsv(text);
        if (Object.keys(parsed).length === 0) {
          setCsvUploadStatus('No valid rows found. Expect columns like "Base Rate, Price"');
          return;
        }
        setProduct((prev: any) => {
          const pm = { ...(prev.pricing_matrix || {}) };
          pm.baseRates = parsed;
          if (pm['Base Rate']) delete pm['Base Rate'];
          return { ...prev, pricing_matrix: pm };
        });
        setCsvUploadStatus(`Loaded ${Object.keys(parsed).length} base rate rows. Set "Schedule Benchmark" above to the yield these rates correspond to, then use Adjust button.`);
        // Optionally set scheduleBenchmark to current for convenience
        setScheduleBenchmark(currentBenchmark);
      } catch (err) {
        setCsvUploadStatus('Parse error: ' + (err as Error).message);
      }
    };
    reader.readAsText(file);
    // reset input
    e.target.value = '';
  };

  // Core margin logic: Base Rate - Benchmark = Margin; new base = newBench + margin, round to nearest 1/8%
  const adjustBaseRatesWithMargin = () => {
    const cb = parseFloat(currentBenchmark);
    const sb = parseFloat(scheduleBenchmark);
    if (isNaN(cb) || isNaN(sb)) {
      alert('Please enter valid Current Benchmark and Schedule Benchmark (e.g. 4.0)');
      return;
    }
    setProduct((prev: any) => {
      const pm = { ...(prev.pricing_matrix || {}) };
      const br = { ...(pm.baseRates || pm['Base Rate'] || {}) };
      const newBr: Record<string, any> = {};
      Object.entries(br).forEach(([rateStr, price]) => {
        const oldBase = parseFloat(rateStr);
        if (isNaN(oldBase)) return;
        const margin = oldBase - sb;
        let newBase = cb + margin;
        newBase = roundToNearestEighth(newBase);
        // Keep 3 decimal display like 5.125
        const key = newBase.toFixed(3);
        newBr[key] = price;
      });
      if (pm['Base Rate']) delete pm['Base Rate'];
      pm.baseRates = newBr;
      // Record the anchor for future
      pm.benchmark_anchor_rate = cb;
      return { ...prev, pricing_matrix: pm };
    });
    setCsvUploadStatus(`Adjusted all base rates using margin (current bench ${cb}%, schedule bench was ${sb}%). Rounded to nearest 1/8%.`);
    // Update schedule to current for next adjustment
    setScheduleBenchmark(currentBenchmark);
  };

  if (loading) return <div className="p-10 text-center text-xl">Loading product...</div>;
  if (!product) return <div className="p-10">Product not found</div>;

  return (
    <div className="max-w-7xl mx-auto p-8">
      {/* Global header (branding + profile + logout) is rendered in root layout */}

      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold">{product.name}</h1>
          <p className="text-gray-500">{product.description || 'No description'}</p>
          {!!product.bridge_config && (
            <a href={`/admin/products/bridge/${productId}`} className="text-sm text-indigo-600 hover:underline mt-1 inline-block">
              → Use simplified Bridge Editor (recommended for bridge/fix &amp; flip)
            </a>
          )}
        </div>
 <button
            onClick={() => router.push(`/admin/products/${productId}/adjustments`)}
            className="px-8 py-4 bg-violet-600 text-white rounded-3xl font-semibold hover:bg-violet-700 flex items-center gap-2"
          >
            ⚙️ All Adjustments Tables
          </button>
        <div className="flex gap-4">
          <button
            onClick={saveProduct}
            disabled={saving}
            className="px-8 py-4 bg-green-600 text-white rounded-3xl font-semibold hover:bg-green-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : '💾 Save Product'}
          </button>
          <button
            onClick={copyProduct}
            className="px-8 py-4 bg-indigo-600 text-white rounded-3xl font-semibold hover:bg-indigo-700"
          >
            📋 Copy Product
          </button>
          <button
            onClick={() => router.push('/admin/products')}
            className="px-8 py-4 bg-gray-200 rounded-3xl font-semibold hover:bg-gray-300"
          >
            ← Back to Products
          </button>
        </div>
      </div>

      {/* ====================== BASE RATE TABLE (NOW EDITABLE) ====================== */}
      <div className="bg-white p-8 rounded-3xl border mb-12">
        <h2 className="text-2xl font-semibold mb-2">Base Rate Table</h2>
        <p className="text-gray-500 mb-6">
          Edit base rates directly here. Changes are saved when you click "Save Product". 
          For bulk FRED-driven updates across products, use the "Update All Products Rates" page.
        </p>
        
        <table className="w-full border border-gray-300 text-sm mb-4">
          <thead>
            <tr className="bg-gray-100">
              <th className="border p-3 w-1/3">Base Rate (%)</th>
              <th className="border p-3">Premium / Price</th>
              <th className="border p-3 w-12"></th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              const pm = product.pricing_matrix || {};
              // Support legacy key 'Base Rate' for backward compat, prefer 'baseRates'
              let br = pm.baseRates || pm['Base Rate'] || {};
              // If we found data under legacy key and not under new, migrate it in memory
              if (!pm.baseRates && pm['Base Rate']) {
                br = { ...pm['Base Rate'] };
              }
              const sortedRates = Object.keys(br).sort((a, b) => parseFloat(a) - parseFloat(b));
              if (sortedRates.length === 0) {
                return (
                  <tr>
                    <td colSpan={3} className="border p-3 text-center text-gray-500 italic">
                      No base rates yet. Add some below.
                    </td>
                  </tr>
                );
              }
              return sortedRates.map(rate => {
                // Safe value read that also handles legacy during render
                const currentValue = br[rate] ?? product.pricing_matrix?.baseRates?.[rate] ?? product.pricing_matrix?.['Base Rate']?.[rate] ?? '';
                return (
                  <tr key={rate}>
                    <td className="border p-2">
                      <input
                        type="text"
                        value={rate}
                        onChange={(e) => {
                          const oldRate = rate;
                          const newRate = e.target.value.trim();
                          if (!newRate || newRate === oldRate) return;
                          setProduct((prev: any) => {
                            const pm = { ...(prev.pricing_matrix || {}) };
                            // migrate legacy if needed
                            const currentBr = { ...(pm.baseRates || pm['Base Rate'] || {}) };
                            const val = currentBr[oldRate];
                            delete currentBr[oldRate];
                            if (pm['Base Rate']) delete pm['Base Rate'];
                            currentBr[newRate] = val;
                            pm.baseRates = currentBr;
                            return { ...prev, pricing_matrix: pm };
                          });
                        }}
                        className="w-full px-3 py-2 border rounded-xl font-mono text-sm"
                        placeholder="5.000"
                      />
                    </td>
                    <td className="border p-2">
                      <input
                        type="number"
                        step="0.001"
                        value={currentValue}
                        onChange={(e) => {
                          const newVal = parseFloat(e.target.value);
                          setProduct((prev: any) => {
                            const pm = { ...(prev.pricing_matrix || {}) };
                            // migrate legacy if needed
                            const currentBr = { ...(pm.baseRates || pm['Base Rate'] || {}) };
                            currentBr[rate] = isNaN(newVal) ? 0 : newVal;
                            if (pm['Base Rate']) delete pm['Base Rate'];
                            pm.baseRates = currentBr;
                            return { ...prev, pricing_matrix: pm };
                          });
                        }}
                        className="w-full px-3 py-2 border rounded-xl text-sm"
                        placeholder="98.50"
                      />
                    </td>
                    <td className="border p-2 text-center">
                      <button
                        onClick={() => {
                          if (!confirm(`Remove base rate ${rate}?`)) return;
                          setProduct((prev: any) => {
                            const pm = { ...(prev.pricing_matrix || {}) };
                            // migrate legacy if needed on delete
                            const currentBr = { ...(pm.baseRates || pm['Base Rate'] || {}) };
                            delete currentBr[rate];
                            if (pm['Base Rate']) delete pm['Base Rate'];
                            pm.baseRates = currentBr;
                            return { ...prev, pricing_matrix: pm };
                          });
                        }}
                        className="text-red-500 hover:text-red-700 px-2"
                        title="Remove this rate"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              });
            })()}
          </tbody>
        </table>

        {/* Add new base rate */}
        <div className="flex flex-wrap gap-3 items-end mb-4 p-3 bg-gray-50 rounded-2xl border">
          <div>
            <label className="block text-xs font-medium mb-1 text-gray-600">New Rate (%)</label>
            <input
              type="text"
              value={newBaseRateKey}
              onChange={(e) => setNewBaseRateKey(e.target.value)}
              className="w-28 px-3 py-2 border rounded-xl font-mono text-sm"
              placeholder="5.125"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1 text-gray-600">Premium / Price</label>
            <input
              type="number"
              step="0.001"
              value={newBaseRateValue}
              onChange={(e) => setNewBaseRateValue(e.target.value)}
              className="w-28 px-3 py-2 border rounded-xl text-sm"
              placeholder="98.25"
            />
          </div>
          <button
            onClick={() => {
              const rate = newBaseRateKey.trim();
              const val = parseFloat(newBaseRateValue);
              if (!rate || isNaN(val)) {
                alert('Please enter both a rate and a numeric price.');
                return;
              }
              setProduct((prev: any) => {
                const pm = { ...(prev.pricing_matrix || {}) };
                // migrate legacy + add new under canonical baseRates key
                const currentBr = { ...(pm.baseRates || pm['Base Rate'] || {}) };
                currentBr[rate] = val;
                if (pm['Base Rate']) delete pm['Base Rate'];
                pm.baseRates = currentBr;
                return { ...prev, pricing_matrix: pm };
              });
              setNewBaseRateKey('');
              setNewBaseRateValue('');
            }}
            className="px-5 py-2 bg-blue-600 text-white rounded-2xl text-sm font-semibold hover:bg-blue-700"
          >
            + Add Rate
          </button>
          <span className="text-xs text-gray-500 ml-2">Rates are sorted numerically on display.</span>
        </div>

        {product?.organization_id && (
          <button
            onClick={async () => {
              if (!confirm("Rebase this product's base rates using the organization's benchmark treasury delta? This will shift all base rate keys by the change in yield.")) return;
              const res = await rebaseProductBaseRates(product.id, product.organization_id);
              if (res.error) {
                alert('Rebase error: ' + res.error);
              } else {
                alert(`Rebase complete. Delta: ${res.delta?.toFixed(3) || 0}. Anchor now ${res.newAnchor || 'set'}. Reloading product...`);
                const { data: refreshed } = await supabase.from('loan_products').select('*').eq('id', product.id).single();
                if (refreshed) setProduct(refreshed);
              }
            }}
            className="mt-2 px-6 py-3 bg-emerald-600 text-white rounded-2xl hover:bg-emerald-700"
          >
            🔄 Rebase Base Rates (using Org Benchmark)
          </button>
        )}

        {/* CSV Uploader for Base Rate Schedule + Treasury Margin Adjustment (added per requirements) */}
        <div className="mt-6 p-4 border rounded-2xl bg-gray-50">
          <h4 className="font-semibold mb-2">CSV Upload for Base Rate Schedule</h4>
          <p className="text-xs text-gray-600 mb-2">Upload a 2-column CSV (Base Rate, Price/Premium). First row header optional. This will replace the baseRates table above.</p>
          <input
            type="file"
            accept=".csv"
            onChange={handleBaseRateCsvUpload}
            className="block mb-3"
          />
          {csvUploadStatus && <p className="text-xs text-blue-700 mb-2">{csvUploadStatus}</p>}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
            <div>
              <label className="block text-xs font-medium mb-1">Current Benchmark Yield (%) <span className="text-gray-500">(e.g. 4.0)</span></label>
              <input
                type="number"
                step="0.01"
                value={currentBenchmark}
                onChange={(e) => setCurrentBenchmark(e.target.value)}
                className="w-full border rounded-xl px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Schedule Benchmark at Upload Time (%)</label>
              <input
                type="number"
                step="0.01"
                value={scheduleBenchmark}
                onChange={(e) => setScheduleBenchmark(e.target.value)}
                className="w-full border rounded-xl px-3 py-2 text-sm"
              />
              <p className="text-[10px] text-gray-500">The benchmark yield when this schedule's rates were originally set (for margin calc).</p>
            </div>
            <div className="flex items-end">
              <button
                onClick={adjustBaseRatesWithMargin}
                className="px-4 py-2 bg-amber-600 text-white rounded-2xl text-sm hover:bg-amber-700 w-full"
              >
                Adjust Base Rates to Current Benchmark (nearest 1/8%)
              </button>
            </div>
          </div>
          <p className="text-[10px] text-gray-500 mt-2">
            Logic: For each rate, margin = (old base rate − schedule benchmark). New base = current benchmark + margin, then round to nearest 0.125 (1/8%).
          </p>
        </div>
      </div>

            {/* ====================== MARKUP SECTION ====================== */}
      <div className="bg-white p-8 rounded-3xl border mt-12">
        <h2 className="text-2xl font-semibold mb-8">Markup & Price Controls</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div>
            <label className="block text-sm font-medium mb-2">Wholesale Markup (%)</label>
            <input 
              type="number" 
              step="0.01" 
              value={product?.pricing_matrix?.markup?.wholesaleMarkup || 1} 
              onChange={(e) => {
                const newMarkup = {
                  ...(product.pricing_matrix?.markup || {}),
                  wholesaleMarkup: parseFloat(e.target.value) || 1
                };
                setProduct(prev => ({
                  ...prev,
                  pricing_matrix: {
                    ...prev.pricing_matrix,
                    markup: newMarkup
                  }
                }));
              }} 
              className="w-full px-4 py-3 border rounded-2xl" 
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Retail Markup (%)</label>
            <input 
              type="number" 
              step="0.01" 
              value={product?.pricing_matrix?.markup?.retailMarkup || 3} 
              onChange={(e) => {
                const newMarkup = {
                  ...(product.pricing_matrix?.markup || {}),
                  retailMarkup: parseFloat(e.target.value) || 3
                };
                setProduct(prev => ({
                  ...prev,
                  pricing_matrix: {
                    ...prev.pricing_matrix,
                    markup: newMarkup
                  }
                }));
              }} 
              className="w-full px-4 py-3 border rounded-2xl" 
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Wholesale Price Floor</label>
            <input 
              type="number" step="0.01" 
              value={product?.pricing_matrix?.markup?.wholesalePriceFloor || 97} 
              onChange={(e) => {
                const newMarkup = { ...(product.pricing_matrix?.markup || {}), wholesalePriceFloor: parseFloat(e.target.value) || 97 };
                setProduct(prev => ({ ...prev, pricing_matrix: { ...prev.pricing_matrix, markup: newMarkup } }));
              }} 
              className="w-full px-4 py-3 border rounded-2xl" 
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Wholesale Price Ceiling</label>
            <input 
              type="number" step="0.01" 
              value={product?.pricing_matrix?.markup?.wholesalePriceCeiling || 102} 
              onChange={(e) => {
                const newMarkup = { ...(product.pricing_matrix?.markup || {}), wholesalePriceCeiling: parseFloat(e.target.value) || 102 };
                setProduct(prev => ({ ...prev, pricing_matrix: { ...prev.pricing_matrix, markup: newMarkup } }));
              }} 
              className="w-full px-4 py-3 border rounded-2xl" 
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Retail Price Floor</label>
            <input 
              type="number" step="0.01" 
              value={product?.pricing_matrix?.markup?.retailPriceFloor || 97} 
              onChange={(e) => {
                const newMarkup = { ...(product.pricing_matrix?.markup || {}), retailPriceFloor: parseFloat(e.target.value) || 97 };
                setProduct(prev => ({ ...prev, pricing_matrix: { ...prev.pricing_matrix, markup: newMarkup } }));
              }} 
              className="w-full px-4 py-3 border rounded-2xl" 
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Retail Price Ceiling</label>
            <input 
              type="number" step="0.01" 
              value={product?.pricing_matrix?.markup?.retailPriceCeiling || 100} 
              onChange={(e) => {
                const newMarkup = { ...(product.pricing_matrix?.markup || {}), retailPriceCeiling: parseFloat(e.target.value) || 100 };
                setProduct(prev => ({ ...prev, pricing_matrix: { ...prev.pricing_matrix, markup: newMarkup } }));
              }} 
              className="w-full px-4 py-3 border rounded-2xl" 
            />
          </div>

          {/* Prepayment Ceilings */}
          <div className="md:col-span-2 mt-6">
            <h4 className="font-medium mb-4">Prepayment Penalty Price Ceilings</h4>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              {[1,2,3,4,5].map(years => (
                <div key={years}>
                  <label className="block text-sm font-medium mb-2">{years} Year Prepay Ceiling</label>
                  <input 
                    type="number" 
                    step="0.01" 
                    value={product?.pricing_matrix?.markup?.[`prepay${years}YearCeiling`] || 100} 
                    onChange={(e) => {
                      const newMarkup = { 
                        ...(product.pricing_matrix?.markup || {}), 
                        [`prepay${years}YearCeiling`]: parseFloat(e.target.value) || 100 
                      };
                      setProduct(prev => ({ ...prev, pricing_matrix: { ...prev.pricing_matrix, markup: newMarkup } }));
                    }} 
                    className="w-full px-4 py-3 border rounded-2xl" 
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ====================== UNDERWRITING GUIDELINES ====================== */}
      <div className="bg-white p-8 rounded-3xl border">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-semibold">Standard Underwriting Guidelines</h2>
          <button
            onClick={seedDefaultConditions}
            className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-2xl hover:bg-emerald-700"
          >
            Seed Default Loan Conditions (Purchase + Refi + Title/Ins)
          </button>
        </div>

        {/* Purchase Conditions */}
        <div className="mb-12">
          <h3 className="text-xl font-semibold mb-4">Purchase Conditions</h3>

          {purchaseConditions.length === 0 ? (
            <p className="text-sm text-gray-500 mb-4">No purchase conditions yet.</p>
          ) : (
            purchaseConditions.map((cond, index) => (
              <div key={index} className="border rounded-2xl p-6 mb-6 bg-gray-50">
                <input
                  type="text"
                  value={cond.file_name}
                  onChange={(e) => updateCondition('purchase', index, 'file_name', e.target.value)}
                  placeholder="Guideline / File Name (e.g. Bank Statements)"
                  className="w-full mb-4 px-5 py-4 border rounded-2xl"
                />
                <textarea
                  value={cond.ai_prompt}
                  onChange={(e) => updateCondition('purchase', index, 'ai_prompt', e.target.value)}
                  placeholder="xAI Prompt / Instructions for this guideline..."
                  rows={5}
                  className="w-full px-5 py-4 border rounded-2xl"
                />
                <button
                  onClick={() => removeCondition('purchase', index)}
                  className="text-red-600 hover:text-red-700 text-sm mt-3"
                >
                  Remove Guideline
                </button>
              </div>
            ))
          )}

          <button
            onClick={() => addCondition('purchase')}
            className="px-6 py-3 bg-blue-600 text-white rounded-2xl hover:bg-blue-700"
          >
            + Add Purchase Condition
          </button>
          <p className="text-xs text-gray-500 mt-1">Clicking adds a new editable condition row above this button.</p>
        </div>

        {/* Refinance Conditions */}
        <div>
          <h3 className="text-xl font-semibold mb-4">Refinance Conditions</h3>

          {refinanceConditions.length === 0 ? (
            <p className="text-sm text-gray-500 mb-4">No refinance conditions yet.</p>
          ) : (
            refinanceConditions.map((cond, index) => (
              <div key={index} className="border rounded-2xl p-6 mb-6 bg-gray-50">
                <input
                  type="text"
                  value={cond.file_name}
                  onChange={(e) => updateCondition('refinance', index, 'file_name', e.target.value)}
                  placeholder="Guideline / File Name"
                  className="w-full mb-4 px-5 py-4 border rounded-2xl"
                />
                <textarea
                  value={cond.ai_prompt}
                  onChange={(e) => updateCondition('refinance', index, 'ai_prompt', e.target.value)}
                  placeholder="xAI Prompt / Instructions for this guideline..."
                  rows={5}
                  className="w-full px-5 py-4 border rounded-2xl"
                />
                <button
                  onClick={() => removeCondition('refinance', index)}
                  className="text-red-600 hover:text-red-700 text-sm mt-3"
                >
                  Remove Guideline
                </button>
              </div>
            ))
          )}

          <button
            onClick={() => addCondition('refinance')}
            className="px-6 py-3 bg-blue-600 text-white rounded-2xl hover:bg-blue-700"
          >
            + Add Refinance Condition
          </button>
          <p className="text-xs text-gray-500 mt-1">Clicking adds a new editable condition row above this button.</p>
        </div>
      </div>

      {/* ====================== TITLE & INSURANCE PROVIDER REQUEST CONFIG (NEW) ====================== */}
      <div className="bg-white p-8 rounded-3xl border mt-12">
        <h2 className="text-2xl font-semibold mb-2">Title &amp; Insurance Provider Requests</h2>
        <p className="text-sm text-gray-600 mb-6">
          These settings power automated emails + secure magic links to external title and insurance companies when a loan is created using this product. The two condition types below are pre-seeded on product creation and will appear automatically on <code>/loans/[id]</code>.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="p-4 bg-blue-50 rounded-2xl border">
            <div className="text-sm font-semibold text-blue-800 mb-1">Mortgagee Clause (from Organization)</div>
            <div className="text-sm whitespace-pre-wrap font-mono bg-white p-3 rounded-xl border min-h-[80px]">
              {orgMortgageeClause || '— Not set on the parent organization yet. Set it when creating a product or in organization settings.'}
            </div>
            <p className="text-[11px] text-blue-700 mt-2">Included in every initial provider request email (loan #, amount, this clause). Edit at org level or on new product form.</p>
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1 text-blue-800">Insurance Requirements (included in Insurance Provider email)</label>
            <textarea
              value={insuranceReq}
              onChange={(e) => setInsuranceReq(e.target.value)}
              className="w-full h-32 px-4 py-3 border rounded-2xl font-mono text-sm"
              placeholder="Dwelling coverage minimum equal to loan amount or RCV. Lender's loss payable endorsement with 30-day cancellation notice to lender. List additional insured wording exactly as required..."
            />
            <p className="text-[11px] mt-1 text-gray-500">This text + loan number + loan amount + mortgagee clause is sent to the insurance company contact.</p>
          </div>
        </div>

        <div className="mt-6 text-xs bg-amber-50 border border-amber-200 p-3 rounded-2xl">
          <strong>Pre-seeded conditions (separate document conditions for Purchase &amp; Refinance):</strong>
          <div className="mt-2 text-amber-700">
            Use the "Seed Default Loan Conditions" button above to add (or re-add) the full set of separate conditions:
            <br />• Initial Purchase: Credit Report, Purchase Contract, Appraisal, Articles of Incorporation, EIN Letter, Operating Agreement/ByLaws, Certificate of Good Standing, Bank Statement (most recent), Bank Statement (2nd most recent).
            <br />• Refinance: Credit Report, Purchase HUD, Appraisal, Articles of Incorporation, EIN Letter, Operating Agreement/ByLaws, Certificate of Good Standing, Bank Statement (most recent), Bank Statement (2nd most recent).
            <br />• Title (4 separate): Title Commitment, Closing Protection Letter, Prelim Combined Closing Statement, E&amp;O Insurance.
            <br />• Insurance (3 separate): Invoice, Certificate of Insurance, Declarations.
          </div>
          <div className="mt-2 text-amber-700">Each is now a distinct condition entry (one document per condition) so they appear individually in the loan conditions list for uploads.</div>
        </div>
      </div>
    </div>
  );
}
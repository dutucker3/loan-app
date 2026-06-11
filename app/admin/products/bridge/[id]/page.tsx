'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { logPageVisit, logAudit } from '@/lib/audit';

type UnderwritingCondition = {
  file_name: string;
  ai_prompt: string;
};

const EXPERIENCE_OPTIONS = [
  'New - No Experience',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10+',
];

export default function BridgeProductDetailPage() {
  const params = useParams();
  const router = useRouter();
  const productId = params.id as string;

  const [product, setProduct] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [purchaseConditions, setPurchaseConditions] = useState<UnderwritingCondition[]>([]);
  const [refinanceConditions, setRefinanceConditions] = useState<UnderwritingCondition[]>([]);

  // Bridge-specific config (loaded into individual states for easy editing)
  const [initialLoanPct, setInitialLoanPct] = useState('70');
  const [rehabFundedPct, setRehabFundedPct] = useState('90');
  const [arvLtvPct, setArvLtvPct] = useState('75');
  const [ltcPct, setLtcPct] = useState('80');

  // Local state for the simple single base rate
  const [singleBaseRate, setSingleBaseRate] = useState('');
  const [singleBaseRatePremium, setSingleBaseRatePremium] = useState('');

  // New required fields
  const [minFicoScore, setMinFicoScore] = useState('');
  const [minExperience, setMinExperience] = useState('New - No Experience');

  useEffect(() => {
    fetchProduct();
  }, [productId]);

  async function fetchProduct() {
    setLoading(true);
    const { data, error } = await supabase
      .from('loan_products')
      .select('*')
      .eq('id', productId)
      .single();

    if (data) {
      setProduct(data);

      const bc = data.bridge_config || {};

      // Load the 4%
      setInitialLoanPct(bc.initialLoanPct != null ? String(bc.initialLoanPct) : '70');
      setRehabFundedPct(bc.rehabFundedPct != null ? String(bc.rehabFundedPct) : '90');
      setArvLtvPct(bc.arvLtvPct != null ? String(bc.arvLtvPct) : '75');
      setLtcPct(bc.ltcPct != null ? String(bc.ltcPct) : '80');

      // Single base rate
      setSingleBaseRate(bc.baseRate != null ? String(bc.baseRate) : '');
      setSingleBaseRatePremium(bc.baseRatePremium != null ? String(bc.baseRatePremium) : '');

      // New fields
      setMinFicoScore(bc.minFicoScore != null ? String(bc.minFicoScore) : '');
      setMinExperience(bc.minExperience || 'New - No Experience');

      setPurchaseConditions(data.standard_conditions?.purchase || []);
      setRefinanceConditions(data.standard_conditions?.refinance || []);
    }
    setLoading(false);
  }

  const saveProduct = async () => {
    if (!product) return;
    setSaving(true);

    const updatedBridgeConfig = {
      initialLoanPct: parseFloat(initialLoanPct) || 0.7,
      rehabFundedPct: parseFloat(rehabFundedPct) || 0.9,
      arvLtvPct: parseFloat(arvLtvPct) || 0.75,
      ltcPct: parseFloat(ltcPct) || 0.8,

      // Single base rate (simple for bridge)
      baseRate: parseFloat(singleBaseRate) || undefined,
      baseRatePremium: parseFloat(singleBaseRatePremium) || undefined,

      // New fields
      minFicoScore: parseInt(minFicoScore) || undefined,
      minExperience: minExperience,
    };

    const { error } = await supabase
      .from('loan_products')
      .update({
        bridge_config: updatedBridgeConfig,
        standard_conditions: {
          purchase: purchaseConditions,
          refinance: refinanceConditions,
        },
      })
      .eq('id', productId);

    if (error) {
      alert('Save failed: ' + error.message);
    } else {
      await logAudit({
        userId: null,
        organizationId: product.organization_id,
        action: 'bridge_product_saved',
        resourceType: 'product',
        resourceId: productId,
        details: {
          name: product.name,
          has_bridge_config: true,
          single_base_rate: !!updatedBridgeConfig.baseRate,
          min_fico: updatedBridgeConfig.minFicoScore,
          min_experience: updatedBridgeConfig.minExperience,
        },
      });
      alert('✅ Bridge product saved successfully!');
      // Refresh
      await fetchProduct();
    }
    setSaving(false);
  };

  // ==================== CONDITION FUNCTIONS (reused from rental logic) ====================
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

  const seedDefaultConditions = () => {
    // Simplified seed for bridge - core ones that make sense
    const purchaseSeeds = [
      { file_name: 'A. Credit Report', ai_prompt: 'Pull and review full credit report (tri-merge preferred).' },
      { file_name: 'B. Purchase Contract', ai_prompt: 'Review executed purchase contract.' },
      { file_name: 'C. Appraisal', ai_prompt: 'Review appraisal for value support and condition.' },
      { file_name: 'D. Articles of Incorporation', ai_prompt: 'Verify entity formation documents.' },
      { file_name: 'E. EIN Letter from IRS', ai_prompt: 'Confirm IRS EIN for borrowing entity.' },
      { file_name: 'F. Operating Agreement or ByLaws', ai_prompt: 'Review governing documents for authority.' },
      { file_name: 'G. Certificate of Good Standing', ai_prompt: 'Confirm current good standing.' },
      { file_name: 'H. Bank Statement (most recent)', ai_prompt: 'Review most recent bank statement.' },
      { file_name: 'I. Bank Statement (2nd most recent)', ai_prompt: 'Review second most recent bank statement.' },
    ];

    const refinanceSeeds = [
      { file_name: 'A. Credit Report', ai_prompt: 'Pull and review full credit report.' },
      { file_name: 'B. Purchase HUD / Settlement Statement', ai_prompt: 'Review prior settlement statement.' },
      { file_name: 'C. Appraisal', ai_prompt: 'Review appraisal for value support and condition.' },
      { file_name: 'D. Articles of Incorporation', ai_prompt: 'Verify entity formation documents.' },
      { file_name: 'E. EIN Letter from IRS', ai_prompt: 'Confirm IRS EIN.' },
      { file_name: 'F. Operating Agreement or ByLaws', ai_prompt: 'Review governing documents.' },
      { file_name: 'G. Certificate of Good Standing', ai_prompt: 'Confirm current good standing.' },
      { file_name: 'H. Bank Statement (most recent)', ai_prompt: 'Review most recent bank statement.' },
      { file_name: 'I. Bank Statement (2nd most recent)', ai_prompt: 'Review second most recent bank statement.' },
    ];

    const titleSeeds = [
      { file_name: 'Title Commitment', ai_prompt: 'Provide current title commitment.' },
      { file_name: 'Closing Protection Letter', ai_prompt: 'Provide closing protection letter.' },
      { file_name: 'Prelim Combined Closing Statement', ai_prompt: 'Provide preliminary closing statement.' },
      { file_name: 'E & O Insurance', ai_prompt: 'Provide E&O certificate for title company.' },
    ];

    const insuranceSeeds = [
      { file_name: 'Invoice', ai_prompt: 'Provide insurance premium invoice.' },
      { file_name: 'Certificate of Insurance', ai_prompt: 'Provide certificate of insurance.' },
      { file_name: 'Declarations', ai_prompt: 'Provide policy declarations page.' },
    ];

    // Avoid duplicates
    const existingP = new Set(purchaseConditions.map(c => c.file_name.toLowerCase()));
    const newP = [...purchaseConditions, ...purchaseSeeds, ...titleSeeds, ...insuranceSeeds].filter(c => !existingP.has(c.file_name.toLowerCase()));

    const existingR = new Set(refinanceConditions.map(c => c.file_name.toLowerCase()));
    const newR = [...refinanceConditions, ...refinanceSeeds].filter(c => !existingR.has(c.file_name.toLowerCase()));

    setPurchaseConditions(newP);
    setRefinanceConditions(newR);
    alert('Default bridge conditions seeded. Remember to Save.');
  };

  if (loading) return <div className="p-10 text-center text-xl">Loading bridge product...</div>;
  if (!product) return <div className="p-10">Product not found</div>;

  return (
    <div className="max-w-6xl mx-auto p-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold">{product.name} <span className="text-sm text-indigo-600">(Bridge / Fix &amp; Flip)</span></h1>
          <p className="text-gray-500">Simplified editor for bridge products — conditions + single base rate + key underwriting criteria.</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => router.push('/admin/products')}
            className="px-6 py-3 bg-gray-200 rounded-3xl font-semibold hover:bg-gray-300"
          >
            ← Back to Products
          </button>
          <button
            onClick={saveProduct}
            disabled={saving}
            className="px-8 py-3 bg-green-600 text-white rounded-3xl font-semibold hover:bg-green-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : '💾 Save Bridge Product'}
          </button>
          <button
            onClick={() => router.push(`/admin/products/${productId}`)}
            className="px-6 py-3 bg-gray-100 rounded-2xl text-sm hover:bg-gray-200"
            title="Full product editor (for advanced users)"
          >
            Advanced Editor
          </button>
        </div>
      </div>

      {/* Bridge Loan Value Adjustments (the 4 % fields) */}
      <div className="bg-white p-8 rounded-3xl border mb-8">
        <h2 className="text-2xl font-semibold mb-2">Bridge Loan Value Adjustments</h2>
        <p className="text-gray-500 mb-6">These control how much can be lent based on purchase, rehab, ARV, and cost.</p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div>
            <label className="block text-sm font-medium mb-2">Initial Loan % (of purchase)</label>
            <input
              type="number"
              step="0.1"
              value={initialLoanPct}
              onChange={(e) => setInitialLoanPct(e.target.value)}
              className="w-full px-4 py-3 border rounded-2xl"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">% of Rehab Loan Funded</label>
            <input
              type="number"
              step="0.1"
              value={rehabFundedPct}
              onChange={(e) => setRehabFundedPct(e.target.value)}
              className="w-full px-4 py-3 border rounded-2xl"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Total After Repaired LTV (ARV %)</label>
            <input
              type="number"
              step="0.1"
              value={arvLtvPct}
              onChange={(e) => setArvLtvPct(e.target.value)}
              className="w-full px-4 py-3 border rounded-2xl"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Total Loan to Cost (LTC %)</label>
            <input
              type="number"
              step="0.1"
              value={ltcPct}
              onChange={(e) => setLtcPct(e.target.value)}
              className="w-full px-4 py-3 border rounded-2xl"
            />
          </div>
        </div>
      </div>

      {/* Single Base Rate (simplified for bridge) */}
      <div className="bg-white p-8 rounded-3xl border mb-8">
        <h2 className="text-2xl font-semibold mb-2">Base Rate</h2>
        <p className="text-gray-500 mb-6">Set a single base rate for this bridge product (no complex adjustment grids).</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-lg">
          <div>
            <label className="block text-sm font-medium mb-2">Base Rate (%)</label>
            <input
              type="number"
              step="0.001"
              value={singleBaseRate}
              onChange={(e) => setSingleBaseRate(e.target.value)}
              placeholder="5.500"
              className="w-full px-4 py-3 border rounded-2xl"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Price / Premium</label>
            <input
              type="number"
              step="0.01"
              value={singleBaseRatePremium}
              onChange={(e) => setSingleBaseRatePremium(e.target.value)}
              placeholder="98.50"
              className="w-full px-4 py-3 border rounded-2xl"
            />
          </div>
        </div>
        <p className="text-xs text-gray-500 mt-2">This is the single rate used for pricing bridge loans (no FICO/DSCR/loan size matrices).</p>
      </div>

      {/* New Required Fields */}
      <div className="bg-white p-8 rounded-3xl border mb-8">
        <h2 className="text-2xl font-semibold mb-6">Key Underwriting Criteria</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-2xl">
          <div>
            <label className="block text-sm font-medium mb-2">Minimum FICO Score</label>
            <input
              type="number"
              value={minFicoScore}
              onChange={(e) => setMinFicoScore(e.target.value)}
              placeholder="680"
              className="w-full px-4 py-3 border rounded-2xl"
            />
            <p className="text-xs text-gray-500 mt-1">Borrower must meet or exceed this FICO.</p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Minimum Experience (last 3 years)</label>
            <select
              value={minExperience}
              onChange={(e) => setMinExperience(e.target.value)}
              className="w-full px-4 py-3 border rounded-2xl bg-white"
            >
              {EXPERIENCE_OPTIONS.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">Borrower or guarantor experience in real estate / fix &amp; flip / bridge.</p>
          </div>
        </div>
      </div>

      {/* Standard Conditions for Document Uploads (full rental-style logic, no adjustments) */}
      <div className="bg-white p-8 rounded-3xl border">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-semibold">Standard Underwriting Guidelines (Document Conditions)</h2>
          <button
            onClick={seedDefaultConditions}
            className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-2xl hover:bg-emerald-700"
          >
            Seed Default Bridge Conditions
          </button>
        </div>

        {/* Purchase Conditions */}
        <div className="mb-10">
          <h3 className="text-xl font-semibold mb-4">Purchase Conditions</h3>
          {purchaseConditions.length === 0 && <p className="text-sm text-gray-500 mb-3">No purchase conditions yet.</p>}
          {purchaseConditions.map((cond, index) => (
            <div key={index} className="border rounded-2xl p-5 mb-4 bg-gray-50">
              <input
                type="text"
                value={cond.file_name}
                onChange={(e) => updateCondition('purchase', index, 'file_name', e.target.value)}
                placeholder="Condition / Document Name (e.g. Credit Report)"
                className="w-full mb-3 px-4 py-3 border rounded-xl"
              />
              <textarea
                value={cond.ai_prompt}
                onChange={(e) => updateCondition('purchase', index, 'ai_prompt', e.target.value)}
                placeholder="Instructions / AI prompt for this condition..."
                rows={3}
                className="w-full px-4 py-3 border rounded-xl"
              />
              <button
                onClick={() => removeCondition('purchase', index)}
                className="text-red-600 hover:text-red-700 text-sm mt-2"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            onClick={() => addCondition('purchase')}
            className="px-6 py-2 bg-blue-600 text-white rounded-2xl hover:bg-blue-700 text-sm"
          >
            + Add Purchase Condition
          </button>
        </div>

        {/* Refinance Conditions */}
        <div>
          <h3 className="text-xl font-semibold mb-4">Refinance Conditions</h3>
          {refinanceConditions.length === 0 && <p className="text-sm text-gray-500 mb-3">No refinance conditions yet.</p>}
          {refinanceConditions.map((cond, index) => (
            <div key={index} className="border rounded-2xl p-5 mb-4 bg-gray-50">
              <input
                type="text"
                value={cond.file_name}
                onChange={(e) => updateCondition('refinance', index, 'file_name', e.target.value)}
                placeholder="Condition / Document Name"
                className="w-full mb-3 px-4 py-3 border rounded-xl"
              />
              <textarea
                value={cond.ai_prompt}
                onChange={(e) => updateCondition('refinance', index, 'ai_prompt', e.target.value)}
                placeholder="Instructions / AI prompt for this condition..."
                rows={3}
                className="w-full px-4 py-3 border rounded-xl"
              />
              <button
                onClick={() => removeCondition('refinance', index)}
                className="text-red-600 hover:text-red-700 text-sm mt-2"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            onClick={() => addCondition('refinance')}
            className="px-6 py-2 bg-blue-600 text-white rounded-2xl hover:bg-blue-700 text-sm"
          >
            + Add Refinance Condition
          </button>
        </div>
      </div>

      <div className="mt-8 text-xs text-gray-500">
        This is a simplified editor for bridge/fix &amp; flip products. It includes the full condition/document upload logic from rental products but omits the complex pricing adjustment grids.
        Changes are saved directly to this product's <code>bridge_config</code> and <code>standard_conditions</code>.
      </div>
    </div>
  );
}

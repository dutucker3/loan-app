'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useUser, useOrganization } from '@clerk/nextjs';
import { supabase } from '@/lib/supabase';
import TenantHeader from '@/components/TenantHeader';

type UnderwritingCondition = {
  file_name: string;
  ai_prompt: string;
};

export default function ProductDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useUser();
  const productId = params.id as string;

  const [product, setProduct] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [purchaseConditions, setPurchaseConditions] = useState<UnderwritingCondition[]>([]);
  const [refinanceConditions, setRefinanceConditions] = useState<UnderwritingCondition[]>([]);

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
      setPurchaseConditions(data.standard_conditions?.purchase || []);
      setRefinanceConditions(data.standard_conditions?.refinance || []);
    }
    setLoading(false);
  }

  const saveProduct = async () => {
    if (!product) return;
    setSaving(true);

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
      })
      .select()
      .single();

    if (error) {
      alert('Copy failed: ' + error.message);
    } else {
      alert(`✅ Product copied as "${newName}"!`);
      router.push(`/products/${newProduct.id}`);
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

  if (loading) return <div className="p-10 text-center text-xl">Loading product...</div>;
  if (!product) return <div className="p-10">Product not found</div>;

  return (
    <div className="max-w-7xl mx-auto p-8">
      <TenantHeader />

      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold">{product.name}</h1>
          <p className="text-gray-500">{product.description || 'No description'}</p>
        </div>
 <button
            onClick={() => router.push(`/products/${productId}/adjustments`)}
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
            onClick={() => router.push('/products')}
            className="px-8 py-4 bg-gray-200 rounded-3xl font-semibold hover:bg-gray-300"
          >
            ← Back to Products
          </button>
        </div>
      </div>

      {/* ====================== BASE RATE TABLE ====================== */}
      <div className="bg-white p-8 rounded-3xl border mb-12">
        <h2 className="text-2xl font-semibold mb-6">Base Rate Table</h2>
        <p className="text-gray-500 mb-6">This table is managed on the main product page.</p>
        
        {/* Simple Base Rate Table (you can expand later) */}
        <table className="w-full border border-gray-300 text-sm">
          <thead>
            <tr className="bg-gray-100">
              <th className="border p-3">Base Rate</th>
              <th className="border p-3">Premium / Price</th>
            </tr>
          </thead>
          <tbody>
            {Object.keys(product.pricing_matrix?.baseRates || {}).sort().map(rate => (
              <tr key={rate}>
                <td className="border p-3 font-medium">{rate}</td>
                <td className="border p-3">{product.pricing_matrix.baseRates[rate]}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
        <h2 className="text-2xl font-semibold mb-8">Standard Underwriting Guidelines</h2>

        {/* Purchase Conditions */}
        <div className="mb-12">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-xl font-semibold">Purchase Conditions</h3>
            <button
              onClick={() => addCondition('purchase')}
              className="px-6 py-3 bg-blue-600 text-white rounded-2xl hover:bg-blue-700"
            >
              + Add Purchase Guideline
            </button>
          </div>

          {purchaseConditions.map((cond, index) => (
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
          ))}
        </div>

        {/* Refinance Conditions */}
        <div>
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-xl font-semibold">Refinance Conditions</h3>
            <button
              onClick={() => addCondition('refinance')}
              className="px-6 py-3 bg-blue-600 text-white rounded-2xl hover:bg-blue-700"
            >
              + Add Refinance Guideline
            </button>
          </div>

          {refinanceConditions.map((cond, index) => (
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
          ))}
        </div>
      </div>
    </div>
  );
}
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
  const { organization: clerkOrg } = useOrganization();
   const productId = params.id as string;   // Keep as string

  const [product, setProduct] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('Base Rate');
  const [saving, setSaving] = useState(false);

  const [purchaseConditions, setPurchaseConditions] = useState<UnderwritingCondition[]>([]);
  const [refinanceConditions, setRefinanceConditions] = useState<UnderwritingCondition[]>([]);

  const tabs = [
    'Base Rate', 'DSCR Adjustment', 'Loan Balance Adjustment', 'FICO Adjustment',
    'Property Type Adjustment', 'Loan Structure Adjustment', 'Amortization Adjustment',
    'Prepayment Adjustment', 'Rent Adjustments', 'Other Adjustments', 'Markup'
  ];

  useEffect(() => {
    if (productId) fetchProduct();
  }, [productId]);

  async function fetchProduct() {
    setLoading(true);
    try {
      // Use string comparison (safer with Next.js params)
      const { data, error } = await supabase
        .from('loan_products')
        .select('*')
        .eq('id', String(productId))
        .single();

      if (error || !data) {
        console.error("Product fetch error:", error);
        alert('Product not found or you don’t have access.');
        router.push('/products');
        return;
      }

      setProduct(data);
      setPurchaseConditions(data.standard_conditions?.purchase || []);
      setRefinanceConditions(data.standard_conditions?.refinance || []);
    } catch (err) {
      console.error("Unexpected error:", err);
      alert('Error loading product');
      router.push('/products');
    } finally {
      setLoading(false);
    }
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
        default_profit_percent: product.default_profit_percent || 1.0,
        standard_conditions: {
          purchase: purchaseConditions,
          refinance: refinanceConditions,
        }
      })
      .eq('id', productId);

    if (error) alert('Save failed: ' + error.message);
    else alert('✅ Product saved successfully!');

    setSaving(false);
  };

  const updatePricingMatrix = (newMatrix: any) => {
    setProduct({ ...product, pricing_matrix: newMatrix });
  };

  const addCondition = (type: 'purchase' | 'refinance') => {
    const newCond = { file_name: '', ai_prompt: '' };
    if (type === 'purchase') setPurchaseConditions([...purchaseConditions, newCond]);
    else setRefinanceConditions([...refinanceConditions, newCond]);
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
    if (type === 'purchase') setPurchaseConditions(purchaseConditions.filter((_, i) => i !== index));
    else setRefinanceConditions(refinanceConditions.filter((_, i) => i !== index));
  };

  if (loading) return <div className="p-10 text-center text-xl">Loading product...</div>;
  if (!product) return <div className="p-10 text-center text-xl">Product not found</div>;

  return (
    <div className="max-w-7xl mx-auto p-8">
      <TenantHeader />

      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold">{product.name}</h1>
          <p className="text-gray-500">{product.description || 'No description provided'}</p>
        </div>
        <div className="flex gap-4">
          <button
            onClick={saveProduct}
            disabled={saving}
            className="px-8 py-4 bg-green-600 text-white rounded-3xl font-semibold hover:bg-green-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : '💾 Save Product'}
          </button>
          <button
            onClick={() => router.push('/products')}
            className="px-8 py-4 bg-gray-200 rounded-3xl font-semibold hover:bg-gray-300"
          >
            ← Back to Products
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b mb-8 overflow-x-auto pb-1">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-8 py-4 whitespace-nowrap rounded-t-2xl font-medium ${
              activeTab === tab ? 'bg-blue-600 text-white' : 'hover:bg-gray-100'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <PricingTableEditor
        tab={activeTab}
        data={product.pricing_matrix || {}}
        selectedProduct={product}
        updatePricingMatrix={updatePricingMatrix}
        onSave={(newData: any) => {
          const matrix = product.pricing_matrix || {};
          const keyMap: any = {
            'Base Rate': 'baseRates',
            'FICO Adjustment': 'ficoLtvGrid',
            'DSCR Adjustment': 'dscrLtvGrid',
            'Loan Balance Adjustment': 'loanBalanceLtvGrid',
            'Property Type Adjustment': 'propertyTypeAcquisition',
            'Prepayment Adjustment': 'Prepayment Adjustment'
          };
          const storageKey = keyMap[activeTab] || activeTab;
          const updatedMatrix = { ...matrix, [storageKey]: newData };
          updatePricingMatrix(updatedMatrix);
        }}
      />

           {/* Underwriting Conditions */}
      <div className="mt-12 bg-white border rounded-3xl p-8">
        <h3 className="text-2xl font-semibold mb-8">Standard Underwriting Files</h3>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
          {/* Purchase Conditions */}
          <div>
            <div className="flex justify-between items-center mb-6">
              <h4 className="font-semibold text-xl">Purchase Conditions</h4>
              <button 
                onClick={() => addCondition('purchase')} 
                className="px-6 py-3 bg-blue-600 text-white rounded-2xl text-sm hover:bg-blue-700"
              >
                + Add Condition
              </button>
            </div>

            {purchaseConditions.map((cond, index) => (
              <div key={index} className="bg-gray-50 border rounded-2xl p-6 mb-6">
                <input
                  type="text"
                  value={cond.file_name}
                  onChange={(e) => updateCondition('purchase', index, 'file_name', e.target.value)}
                  className="w-full mb-4 px-5 py-4 border rounded-2xl"
                  placeholder="File Name (e.g. Bank Statements)"
                />
                <textarea
                  value={cond.ai_prompt}
                  onChange={(e) => updateCondition('purchase', index, 'ai_prompt', e.target.value)}
                  rows={4}
                  className="w-full px-5 py-4 border rounded-2xl"
                  placeholder="AI Prompt for xAI review..."
                />
                <button 
                  onClick={() => removeCondition('purchase', index)} 
                  className="text-red-600 hover:text-red-700 text-sm mt-4"
                >
                  Remove Condition
                </button>
              </div>
            ))}
          </div>

          {/* Refinance Conditions */}
          <div>
            <div className="flex justify-between items-center mb-6">
              <h4 className="font-semibold text-xl">Refinance Conditions</h4>
              <button 
                onClick={() => addCondition('refinance')} 
                className="px-6 py-3 bg-blue-600 text-white rounded-2xl text-sm hover:bg-blue-700"
              >
                + Add Condition
              </button>
            </div>

            {refinanceConditions.map((cond, index) => (
              <div key={index} className="bg-gray-50 border rounded-2xl p-6 mb-6">
                <input
                  type="text"
                  value={cond.file_name}
                  onChange={(e) => updateCondition('refinance', index, 'file_name', e.target.value)}
                  className="w-full mb-4 px-5 py-4 border rounded-2xl"
                  placeholder="File Name (e.g. Bank Statements)"
                />
                <textarea
                  value={cond.ai_prompt}
                  onChange={(e) => updateCondition('refinance', index, 'ai_prompt', e.target.value)}
                  rows={4}
                  className="w-full px-5 py-4 border rounded-2xl"
                  placeholder="AI Prompt for xAI review..."
                />
                <button 
                  onClick={() => removeCondition('refinance', index)} 
                  className="text-red-600 hover:text-red-700 text-sm mt-4"
                >
                  Remove Condition
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ====================== FULL PricingTableEditor Component ======================
function PricingTableEditor({ 
  tab, 
  data, 
  selectedProduct, 
  updatePricingMatrix, 
  onSave 
}: any) {
  const [tableData, setTableData] = useState<any>({});
  const [markupData, setMarkupData] = useState<any>({
    wholesaleMarkup: 0,
    retailMarkup: 0,
    wholesalePriceFloor: 97,
    wholesalePriceCeiling: 102,
    prepay5YearCeiling: 102,
    prepay4YearCeiling: 102,
    prepay3YearCeiling: 102,
    prepay2YearCeiling: 101,
    prepay1YearCeiling: 100,
    retailPriceFloor: 97,
    retailPriceCeiling: 100,
  });

  useEffect(() => {
    const matrix = selectedProduct?.pricing_matrix || {};

    if (tab === 'Markup') {
      setMarkupData(matrix.markup || markupData);
      return;
    }

    let source = {};
    if (tab === 'Base Rate') source = matrix.baseRates || matrix['Base Rate'] || {};
    else if (tab === 'FICO Adjustment') source = matrix.ficoLtvGrid || matrix['FICO Adjustment'] || {};
    else if (tab === 'DSCR Adjustment') source = matrix.dscrLtvGrid || matrix['DSCR Adjustment'] || {};
    else if (tab === 'Loan Balance Adjustment') source = matrix.loanBalanceLtvGrid || matrix['Loan Balance Adjustment'] || {};
    else if (tab === 'Property Type Adjustment') source = matrix.propertyTypeAcquisition || matrix['Property Type Adjustment'] || {};
    else if (tab === 'Prepayment Adjustment') source = matrix['Prepayment Adjustment'] || matrix.prepayment || {};
    else if (tab === 'Rent Adjustments') source = matrix['Rent Adjustments'] || {};
    else if (tab === 'Other Adjustments') source = matrix['Other Adjustments'] || {};

    setTableData(source);
  }, [tab, selectedProduct]);

  const handleCellChange = (rowKey: string, colKey: string, value: string) => {
    setTableData((prev: any) => ({
      ...prev,
      [rowKey]: { ...(prev[rowKey] || {}), [colKey]: value }
    }));
  };

  const clearCurrentTab = () => {
    if (!confirm(`Clear all data in ${tab} tab?`)) return;
    const matrix = selectedProduct.pricing_matrix || {};
    const keyMap: any = {
      'Base Rate': 'baseRates',
      'FICO Adjustment': 'ficoLtvGrid',
      'DSCR Adjustment': 'dscrLtvGrid',
      'Loan Balance Adjustment': 'loanBalanceLtvGrid',
      'Property Type Adjustment': 'propertyTypeAcquisition',
      'Prepayment Adjustment': 'Prepayment Adjustment'
    };
    const storageKey = keyMap[tab] || tab;
    const updated = { ...matrix, [storageKey]: {} };
    updatePricingMatrix(updated);
  };

  // ==================== BASE RATE TAB ====================
  if (tab === 'Base Rate') {
    return (
      <div>
        <div className="flex justify-between mb-4">
          <button onClick={clearCurrentTab} className="px-6 py-3 text-red-600 hover:bg-red-50 rounded-2xl text-sm font-medium">🗑️ Clear Base Rate Table</button>
        </div>
        <table className="w-full border border-gray-300 text-sm">
          <thead>
            <tr className="bg-gray-100">
              <th className="border p-3 text-left">Base Rate</th>
              <th className="border p-3 text-left">Premium / Price</th>
            </tr>
          </thead>
          <tbody>
            {Object.keys(tableData).sort().map(rowKey => (
              <tr key={rowKey}>
                <td className="border p-3 font-medium">{rowKey}</td>
                <td className="border p-3">
                  <input 
                    type="text" 
                    value={tableData[rowKey] || ''} 
                    onChange={(e) => handleCellChange(rowKey, '', e.target.value)} 
                    className="w-full text-center focus:outline-none" 
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button onClick={() => onSave(tableData)} className="mt-6 px-8 py-4 bg-green-600 text-white rounded-3xl font-semibold hover:bg-green-700">
          Save Changes to Base Rate
        </button>
      </div>
    );
  }

  // ==================== PREPAYMENT ADJUSTMENT TAB ====================
  if (tab === 'Prepayment Adjustment') {
    const yearsOptions = ['1', '2', '3', '4', '5', 'None'];
    const typeOptions = ['Step Down', 'Fixed', 'None'];

    return (
      <div className="bg-white p-8 rounded-2xl border">
        <h3 className="text-2xl font-semibold mb-6">Prepayment Penalty Adjustment</h3>
        <p className="text-sm text-gray-600 mb-6">
          Keep your original uploaded keys. Use dropdowns to standardize.
        </p>

        <table className="w-full border border-gray-300 text-sm">
          <thead>
            <tr className="bg-gray-100">
              <th className="border p-3 text-left">Original Key (from CSV)</th>
              <th className="border p-3 text-left">Years</th>
              <th className="border p-3 text-left">Type</th>
              <th className="border p-3">≤50</th>
              <th className="border p-3">50.01-55</th>
              <th className="border p-3">55.01-60</th>
              <th className="border p-3">60.01-65</th>
              <th className="border p-3">65.01-70</th>
              <th className="border p-3">70.01-75</th>
              <th className="border p-3">75.01-80</th>
            </tr>
          </thead>
          <tbody>
            {Object.keys(tableData).map((originalKey) => (
              <tr key={originalKey}>
                <td className="border p-3 font-medium bg-gray-50">{originalKey}</td>
                <td className="border p-3">
                  <select className="w-full p-2 border rounded text-sm">
                    {yearsOptions.map(y => (
                      <option key={y} value={y}>
                        {y === 'None' ? 'None' : `${y} Year${y !== '1' ? 's' : ''}`}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="border p-3">
                  <select className="w-full p-2 border rounded text-sm">
                    {typeOptions.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </td>
                {['<=50','50.01-55','55.01-60','60.01-65','65.01-70','70.01-75','75.01-80'].map(colKey => {
                  const value = tableData[originalKey]?.[colKey];
                  return (
                    <td key={colKey} className="border p-3 text-center">
                      <input 
                        type="text" 
                        value={value !== undefined && value !== null ? value : ''} 
                        onChange={(e) => handleCellChange(originalKey, colKey, e.target.value)} 
                        className="w-full text-center focus:outline-none" 
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>

        <button onClick={() => onSave(tableData)} className="mt-6 px-8 py-4 bg-green-600 text-white rounded-3xl font-semibold hover:bg-green-700">
          Save Prepayment Adjustments
        </button>
      </div>
    );
  }

  // ==================== MARKUP TAB (FULL) ====================
  if (tab === 'Markup') {
    return (
      <div className="bg-white p-8 rounded-2xl border">
        <h3 className="text-2xl font-semibold mb-8">Markup & Price Controls</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div>
            <label className="block text-sm font-medium mb-2">Wholesale Markup (%)</label>
            <input 
              type="number" step="0.01" 
              value={markupData.wholesaleMarkup} 
              onChange={(e) => setMarkupData({...markupData, wholesaleMarkup: parseFloat(e.target.value) || 0})} 
              className="w-full px-4 py-3 border rounded-2xl" 
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Retail Markup (%)</label>
            <input 
              type="number" step="0.01" 
              value={markupData.retailMarkup} 
              onChange={(e) => setMarkupData({...markupData, retailMarkup: parseFloat(e.target.value) || 0})} 
              className="w-full px-4 py-3 border rounded-2xl" 
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Wholesale Price Floor</label>
            <input type="number" step="0.01" value={markupData.wholesalePriceFloor} onChange={(e) => setMarkupData({...markupData, wholesalePriceFloor: parseFloat(e.target.value) || 0})} className="w-full px-4 py-3 border rounded-2xl" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Wholesale Price Ceiling</label>
            <input type="number" step="0.01" value={markupData.wholesalePriceCeiling} onChange={(e) => setMarkupData({...markupData, wholesalePriceCeiling: parseFloat(e.target.value) || 0})} className="w-full px-4 py-3 border rounded-2xl" />
          </div>

          <div className="md:col-span-2 mt-6">
            <h4 className="font-medium mb-4">Prepayment Penalty Price Ceilings</h4>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              {[5,4,3,2,1].map(years => (
                <div key={years}>
                  <label className="block text-sm font-medium mb-2">{years} Year Prepay Ceiling</label>
                  <input 
                    type="number" 
                    step="0.01" 
                    value={markupData[`prepay${years}YearCeiling`] || 0} 
                    onChange={(e) => setMarkupData({...markupData, [`prepay${years}YearCeiling`]: parseFloat(e.target.value) || 0})} 
                    className="w-full px-4 py-3 border rounded-2xl" 
                  />
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Retail Price Floor</label>
            <input type="number" step="0.01" value={markupData.retailPriceFloor} onChange={(e) => setMarkupData({...markupData, retailPriceFloor: parseFloat(e.target.value) || 0})} className="w-full px-4 py-3 border rounded-2xl" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Retail Price Ceiling</label>
            <input type="number" step="0.01" value={markupData.retailPriceCeiling} onChange={(e) => setMarkupData({...markupData, retailPriceCeiling: parseFloat(e.target.value) || 0})} className="w-full px-4 py-3 border rounded-2xl" />
          </div>
        </div>

        <button onClick={() => onSave({ ...data, markup: markupData })} className="mt-10 px-8 py-4 bg-green-600 text-white rounded-3xl font-semibold hover:bg-green-700">
          Save Markup Settings
        </button>
      </div>
    );
  }

  // ==================== DEFAULT LTV GRID FOR OTHER TABS ====================
  const sortedRowKeys = Object.keys(tableData).sort((a, b) => {
    if (tab.includes('FICO')) {
      const getScore = (key: string) => {
        if (key.includes('780')) return 10;
        if (key.includes('760')) return 9;
        if (key.includes('740')) return 8;
        if (key.includes('720')) return 7;
        if (key.includes('700')) return 6;
        if (key.includes('680')) return 5;
        if (key.includes('660')) return 4;
        return 0;
      };
      return getScore(b) - getScore(a);
    }
    return a.localeCompare(b);
  });

  return (
    <div>
      <div className="flex justify-between mb-4">
        <button onClick={clearCurrentTab} className="px-6 py-3 text-red-600 hover:bg-red-50 rounded-2xl text-sm font-medium">🗑️ Clear {tab} Table</button>
      </div>

      <table className="w-full border border-gray-300 text-sm">
        <thead>
          <tr className="bg-gray-100">
            <th className="border p-3 text-left">Row / LTV</th>
            <th className="border p-3">≤50</th>
            <th className="border p-3">50.01-55</th>
            <th className="border p-3">55.01-60</th>
            <th className="border p-3">60.01-65</th>
            <th className="border p-3">65.01-70</th>
            <th className="border p-3">70.01-75</th>
            <th className="border p-3">75.01-80</th>
          </tr>
        </thead>
        <tbody>
          {sortedRowKeys.map(rowKey => (
            <tr key={rowKey}>
              <td className="border p-3 font-medium bg-gray-50">{rowKey}</td>
              {['<=50','50.01-55','55.01-60','60.01-65','65.01-70','70.01-75','75.01-80'].map(colKey => {
                const value = tableData[rowKey]?.[colKey];
                return (
                  <td key={colKey} className="border p-3 text-center">
                    <input 
                      type="text" 
                      value={value !== undefined && value !== null ? value : ''} 
                      onChange={(e) => handleCellChange(rowKey, colKey, e.target.value)} 
                      className="w-full text-center focus:outline-none" 
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={() => onSave(tableData)} className="mt-6 px-8 py-4 bg-green-600 text-white rounded-3xl font-semibold hover:bg-green-700">
        Save Changes to {tab}
      </button>
    </div>
  );
}
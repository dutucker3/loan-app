'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useUser, useOrganization } from '@clerk/nextjs';
import { supabase } from '@/lib/supabase';
import TenantHeader from '@/components/TenantHeader';
import Papa from 'papaparse';

const adjustmentTypes = [
  'FICO Adjustment', 
  'DSCR Adjustment', 
  'Loan Balance Adjustment',
  'Property Type Adjustment', 
  'Loan Structure Adjustment', 
  'Amortization Adjustment',
  'Prepayment Adjustment', 
  'Rent Adjustments', 
  'Other Adjustments'
  // Removed: 'Base Rate' and 'Markup'
];

export default function ProductAdjustmentsPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useUser();
  const productId = params.id as string;

  const [product, setProduct] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    fetchProduct();
  }, [productId]);

  async function fetchProduct() {
    setLoading(true);
    const { data } = await supabase
      .from('loan_products')
      .select('*')
      .eq('id', productId)
      .single();
    if (data) setProduct(data);
    setLoading(false);
  }

  const updatePricingMatrix = (newMatrix: any) => {
    setProduct((prev: any) => ({
      ...prev,
      pricing_matrix: { ...(prev?.pricing_matrix || {}), ...newMatrix }
    }));
  };

  const saveTable = async (tab: string) => {
    if (!product) return;
    setSaving(tab);
    const { error } = await supabase
      .from('loan_products')
      .update({ pricing_matrix: product.pricing_matrix })
      .eq('id', productId);
    if (error) alert('Save failed');
    else alert(`✅ ${tab} saved successfully!`);
    setSaving(null);
  };

  if (loading) return <div className="p-10 text-center text-xl">Loading adjustments...</div>;
  if (!product) return <div className="p-10">Product not found</div>;

  return (
    <div className="max-w-7xl mx-auto p-8">
      <TenantHeader />
      <div className="flex justify-between items-center mb-10">
        <h1 className="text-3xl font-bold">{product.name} — All Adjustments</h1>
        <button
          onClick={() => router.push(`/products/${productId}`)}
          className="px-8 py-4 bg-gray-200 rounded-3xl font-semibold hover:bg-gray-300"
        >
          ← Back to Main Product
        </button>
      </div>

      {adjustmentTypes.map((tab) => (
        <AdjustmentSection
          key={tab}
          tab={tab}
          product={product}
          updatePricingMatrix={updatePricingMatrix}
          onSave={() => saveTable(tab)}
          saving={saving === tab}
        />
      ))}
    </div>
  );
}

// ====================== UNIVERSAL ADJUSTMENT SECTION (Standard Key First) ======================
function AdjustmentSection({ tab, product, updatePricingMatrix, onSave, saving }: any) {
  const [tableData, setTableData] = useState<any>({});

  useEffect(() => {
    const matrix = product?.pricing_matrix || {};
    const storageKey = getStorageKey(tab);
    let source = matrix[storageKey] || {};

    setTableData((prev: any) => {
      const merged = JSON.parse(JSON.stringify(source));
      Object.keys(prev || {}).forEach(key => {
        if (prev[key]) merged[key] = { ...(merged[key] || {}), ...prev[key] };
      });
      return merged;
    });
  }, [tab, product]);

  const handleCellChange = (rowKey: string, colKey: string, value: string) => {
    setTableData((prev: any) => ({
      ...prev,
      [rowKey]: { ...(prev[rowKey] || {}), [colKey]: value }
    }));
  };

  const saveCurrentTableToParent = () => {
    const storageKey = getStorageKey(tab);
    let dataToSave = { ...tableData };

    // Ensure every row has standardKey
    Object.keys(dataToSave).forEach(key => {
      const row = dataToSave[key];
      dataToSave[key] = {
        ...row,
        standardKey: row.standardKey || key
      };
    });

    updatePricingMatrix({ [storageKey]: dataToSave });
  };

  const clearTable = () => {
    if (!confirm(`Clear all data in ${tab}?`)) return;
    updatePricingMatrix({ [getStorageKey(tab)]: {} });
    setTableData({});
  };

  const getStorageKey = (t: string): string => {
    const map: any = {
      'Base Rate': 'baseRates',
      'FICO Adjustment': 'ficoLtvGrid',
      'DSCR Adjustment': 'dscrLtvGrid',
      'Loan Balance Adjustment': 'loanBalanceLtvGrid',
      'Property Type Adjustment': 'propertyTypeAcquisition',
      'Prepayment Adjustment': 'Prepayment Adjustment',
      'Rent Adjustments': 'Rent Adjustments',
      'Other Adjustments': 'Other Adjustments',
      'Amortization Adjustment': 'amortizationAdjustment',
    };
    return map[t] || t;
  };

  // ... (keep your normalizeLoanSizeKey and handleCsvUpload exactly as they are)

  const normalizeLoanSizeKey = (key: string): string => {
    return key.toString().replace(/\$/g, '').replace(/,/g, '').trim().replace(/\s*-\s*/, '-');
  };

   const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results: any) => {
        const newData: any = {};
        const ltvColumns = ['<=50', '50.01-55', '55.01-60', '60.01-65', '65.01-70', '70.01-75', '75.01-80'];

        results.data.forEach((row: any) => {
          let rowKey = row['Standard Key'] || row['standardKey'] ||
                       row[Object.keys(row)[0]] || row[0]?.trim();

          if (!rowKey || typeof rowKey === 'object') return;
          rowKey = String(rowKey).trim();

          const finalKey = tab === 'Loan Balance Adjustment' 
            ? normalizeLoanSizeKey(rowKey) 
            : rowKey;

          if (tab === 'Base Rate' || tab === 'Amortization Adjustment' || tab === 'Markup') {
            newData[finalKey] = row['Price'] || row['Premium / Price'] || row['Adjustment'] || row[1] || '0';
          } else {
            newData[finalKey] = {
              standardKey: finalKey,
              ...Object.fromEntries(ltvColumns.map(col => [col, row[col] || '0']))
            };
          }
        });

        updatePricingMatrix({ [getStorageKey(tab)]: newData });
        alert(`✅ Imported ${Object.keys(newData).length} rows into ${tab}`);
      }
    });
  };

   return (
    <div className="bg-white border rounded-3xl p-8 mb-12">
      <div className="flex justify-between items-center mb-6 border-b pb-6">
        <h2 className="text-2xl font-semibold">{tab}</h2>
        <div className="flex gap-3">
          <button onClick={clearTable} className="px-6 py-3 text-red-600 hover:bg-red-50 rounded-2xl text-sm font-medium">🗑️ Clear Table</button>
          <label className="px-6 py-3 bg-purple-600 text-white rounded-2xl text-sm font-medium hover:bg-purple-700 cursor-pointer flex items-center gap-2">
            📤 Upload CSV
            <input type="file" accept=".csv" onChange={handleCsvUpload} className="hidden" />
          </label>
          <button 
            onClick={() => { saveCurrentTableToParent(); setTimeout(onSave, 100); }}
            disabled={saving}
            className="px-8 py-3 bg-green-600 text-white rounded-2xl font-semibold hover:bg-green-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : '💾 Save This Table'}
          </button>
        </div>
      </div>

      {/* Main Table - Standard Key is the primary column */}
      <table className="w-full border border-gray-300 text-sm">
        <thead>
          <tr className="bg-gray-100">
            <th className="border p-3 text-left">Standard Key (Primary)</th>
            <th className="border p-3 text-left">Original CSV Key (Reference)</th>
            {['<=50','50.01-55','55.01-60','60.01-65','65.01-70','70.01-75','75.01-80'].map(c => (
              <th key={c} className="border p-3">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Object.keys(tableData).map(originalKey => {
            const row = tableData[originalKey] || {};
            return (
              <tr key={originalKey}>
                {/* STANDARD KEY - Primary editable column */}
                <td className="border p-3 font-medium bg-gray-50">
                  <input 
                    type="text" 
                    value={row.standardKey || originalKey} 
                    onChange={e => handleCellChange(originalKey, 'standardKey', e.target.value)}
                    className="w-full bg-transparent focus:outline-none font-medium"
                  />
                </td>

                {/* Original CSV Key - Reference only */}
                <td className="border p-3 text-gray-500">
                  {originalKey}
                </td>

                {/* LTV Columns */}
                {['<=50','50.01-55','55.01-60','60.01-65','65.01-70','70.01-75','75.01-80'].map(col => (
                  <td key={col} className="border p-3 text-center">
                    <input 
                      type="text" 
                      value={row[col] || ''} 
                      onChange={e => handleCellChange(originalKey, col, e.target.value)} 
                      className="w-full text-center" 
                    />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
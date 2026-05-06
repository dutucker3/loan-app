'use client';

import { useState, useEffect } from 'react';
import { useUser } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function ProductsPage() {
  const { user } = useUser();
  const router = useRouter();
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [activeTab, setActiveTab] = useState('Base Rate');

  const tabs = [
    'Base Rate', 'DSCR Adjustment', 'Loan Balance Adjustment', 'FICO Adjustment',
    'Property Type Adjustment', 'Loan Structure Adjustment', 'Amortization Adjustment',
    'Prepayment Adjustment', 'Rent Adjustments', 'Other Adjustments', 'Price Ceiling'
  ];

  const isSuperAdmin = true;

  useEffect(() => {
    if (!isSuperAdmin) router.push('/dashboard');
    fetchProducts();
  }, []);

  async function fetchProducts() {
    const { data } = await supabase
      .from('loan_products')
      .select('*')
      .order('created_at', { ascending: false });
    setProducts(data || []);
    setLoading(false);
  }

  const createProduct = async () => {
    if (!newName.trim()) return alert('Product name is required');
    const { data, error } = await supabase
      .from('loan_products')
      .insert({ 
        name: newName.trim(), 
        description: newDesc.trim() || null, 
        pricing_matrix: {},
        default_profit_percent: 1.0,
        active: true 
      })
      .select()
      .single();

    if (error) alert(error.message);
    else {
      setProducts([data, ...products]);
      setNewName('');
      setNewDesc('');
    }
  };

  const toggleActive = async (productId: number, currentActive: boolean) => {
    const { error } = await supabase
      .from('loan_products')
      .update({ active: !currentActive })
      .eq('id', productId);
    if (error) alert(error.message);
    else fetchProducts();
  };

  const updateProfit = async (productId: number, newProfit: number) => {
    const { error } = await supabase
      .from('loan_products')
      .update({ default_profit_percent: newProfit })
      .eq('id', productId);

    if (error) alert(error.message);
    else fetchProducts();
  };

 
  // ✅ Fixed Guidelines PDF Upload
  const handleGuidelinesUpload = async (productId: string, file: File) => {
    if (!file) return;
    setUploadingId(productId);

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${productId}-${Date.now()}.${fileExt}`;

      // Upload file
      const { error: uploadError } = await supabase.storage
        .from('product-guidelines')
        .upload(fileName, file, { upsert: true });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('product-guidelines')
        .getPublicUrl(fileName);

      const publicUrl = urlData.publicUrl;

      // Save URL to product
      const { error: updateError } = await supabase
        .from('loan_products')
        .update({ guidelines_url: publicUrl })
        .eq('id', parseInt(productId));

      if (updateError) throw updateError;

      alert('✅ Guidelines PDF uploaded successfully!');
      fetchProducts();
    } catch (err: any) {
      console.error(err);
      alert('Upload failed: ' + err.message);
    } finally {
      setUploadingId(null);
    }
  };

  const updatePricingMatrix = (productId: number, newMatrix: any) => {
    setProducts(products.map(p => p.id === productId ? { ...p, pricing_matrix: newMatrix } : p));
  };

  const saveProduct = async (product: any) => {
    const { error } = await supabase
      .from('loan_products')
      .update({ 
        name: product.name,
        description: product.description,
        pricing_matrix: product.pricing_matrix 
      })
      .eq('id', product.id);

    if (error) alert(error.message);
    else alert('Product and pricing matrix saved successfully');
  };

  const handleCSVUpload = async (file: File) => {
    if (!selectedProduct) {
      alert('Please select a product first');
      return;
    }

    try {
      const text = await file.text();
      const rows = text.trim().split('\n').map(r => r.split(',').map(c => c.trim()));

      let newData: any = {};

      if (activeTab === 'Base Rate') {
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (row.length < 2) continue;
          const baseRate = row[0]?.trim();
          const premium = row[1]?.trim();
          if (baseRate) newData[baseRate] = premium || '';
        }
      } else {
        const header = rows[0];
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          const rowKey = row[0]?.trim();
          if (!rowKey) continue;
          newData[rowKey] = {};
          for (let j = 1; j < header.length; j++) {
            const colKey = header[j]?.trim();
            if (colKey) {
              let value = row[j]?.trim() || '';
              if (value.toUpperCase() === 'N/A') value = 'N/A';
              newData[rowKey][colKey] = value;
            }
          }
        }
      }

      const updatedMatrix = { ...selectedProduct.pricing_matrix, [activeTab]: newData };

      updatePricingMatrix(selectedProduct.id, updatedMatrix);

      const { error } = await supabase
        .from('loan_products')
        .update({ pricing_matrix: updatedMatrix })
        .eq('id', selectedProduct.id);

      if (error) alert('Saved locally but failed to save to database');
      else alert(`✅ CSV successfully imported into ${activeTab}`);
    } catch (err) {
      console.error(err);
      alert('Error reading CSV file');
    }
  };

  if (loading) return <div className="p-10 text-center text-xl">Loading products...</div>;

  return (
    <div className="max-w-7xl mx-auto p-8">
      <h1 className="text-4xl font-bold mb-10">Loan Products & Pricing Editor</h1>

      {/* Create New Product */}
      <div className="bg-white rounded-3xl border p-8 mb-12">
        <h2 className="text-2xl font-semibold mb-6">Create New Loan Product</h2>
        <div className="grid grid-cols-2 gap-6">
          <input 
            type="text" 
            placeholder="Product Name" 
            value={newName} 
            onChange={(e) => setNewName(e.target.value)} 
            className="px-5 py-3 border rounded-2xl w-full" 
          />
          <input 
            type="text" 
            placeholder="Description" 
            value={newDesc} 
            onChange={(e) => setNewDesc(e.target.value)} 
            className="px-5 py-3 border rounded-2xl w-full" 
          />
        </div>
        <button onClick={createProduct} className="mt-6 px-8 py-3 bg-blue-600 text-white rounded-2xl">
          Create Product
        </button>
      </div>

      {products.map((product) => {
        const matrix = product.pricing_matrix || {};

        return (
          <div key={product.id} className="bg-white border rounded-3xl p-10 mb-12">
            <div className="flex justify-between items-start mb-8">
              <div className="flex-1">
                <input 
                  type="text" 
                  value={product.name} 
                  onChange={(e) => setProducts(products.map(p => p.id === product.id ? {...p, name: e.target.value} : p))} 
                  className="text-3xl font-bold bg-transparent border-b focus:border-blue-500 outline-none w-full" 
                />
                <input 
                  type="text" 
                  value={product.description || ''} 
                  onChange={(e) => setProducts(products.map(p => p.id === product.id ? {...p, description: e.target.value} : p))} 
                  className="mt-2 text-gray-600 bg-transparent border-b w-full" 
                  placeholder="Description (optional)" 
                />
              </div>

              {/* Default Profit Setting */}
              <div className="ml-12 text-right border-l pl-8">
                <label className="block text-sm font-medium text-gray-600 mb-1">Default Broker Profit</label>
                <div className="flex items-center gap-2 justify-end">
                  <input
                    type="number"
                    step="0.01"
                    value={product.default_profit_percent ?? 1.0}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      setProducts(products.map(p => p.id === product.id ? {...p, default_profit_percent: val} : p));
                    }}
                    onBlur={(e) => updateProfit(product.id, parseFloat(e.target.value) || 1.0)}
                    className="w-28 text-center border rounded-2xl p-3 text-xl font-semibold"
                  />
                  <span className="text-2xl">%</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">This profit is deducted from base rate for brokers</p>
              </div>

              <div className="flex items-center gap-4 ml-8">
                <span className={`px-5 py-2 rounded-2xl text-sm font-medium ${product.active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                  {product.active ? '✅ Active' : '❌ Inactive'}
                </span>
                <button
                  onClick={() => toggleActive(product.id, product.active)}
                  className={`px-6 py-2 text-sm font-medium rounded-2xl ${product.active ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-green-600 hover:bg-green-700 text-white'}`}
                >
                  {product.active ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            </div>

            {/* Guidelines Upload */}
            <div className="mb-10">
              <p className="font-medium mb-3">Guidelines PDF</p>
              {product.guidelines_url && (
                <a href={product.guidelines_url} target="_blank" className="text-blue-600 underline block mb-3">
                  View Current Guidelines
                </a>
              )}
              <label className="cursor-pointer block bg-gray-50 border-2 border-dashed border-gray-300 rounded-3xl p-8 text-center hover:border-blue-600">
                {uploadingId === product.id.toString() ? 'Uploading...' : 'Upload / Replace Guidelines PDF'}
                <input 
                  type="file" 
                  accept=".pdf" 
                  className="hidden" 
                  onChange={(e) => e.target.files?.[0] && handleGuidelinesUpload(product.id.toString(), e.target.files[0])} 
                />
              </label>
            </div>

            {/* Tabbed Editor */}
            <div className="flex gap-1 border-b mb-6 overflow-x-auto">
              {tabs.map(tab => (
                <button
                  key={tab}
                  onClick={() => {
                    setSelectedProduct(product);
                    setActiveTab(tab);
                  }}
                  className={`px-6 py-3 whitespace-nowrap rounded-t-2xl font-medium ${activeTab === tab && selectedProduct?.id === product.id ? 'bg-blue-600 text-white' : 'hover:bg-gray-100'}`}
                >
                  {tab}
                </button>
              ))}
            </div>

            <PricingTableEditor
              tab={activeTab}
              data={matrix[activeTab] || {}}
              selectedProduct={product}
              updatePricingMatrix={updatePricingMatrix}
              onSave={(newData: any) => {
                const updatedMatrix = { ...matrix, [activeTab]: newData };
                updatePricingMatrix(product.id, updatedMatrix);
              }}
              onCSVUpload={handleCSVUpload}
            />
          </div>
        );
      })}
    </div>
  );
}

// ====================== PricingTableEditor (Unchanged) ======================
function PricingTableEditor({ 
  tab, 
  data, 
  selectedProduct, 
  updatePricingMatrix, 
  onSave, 
  onCSVUpload 
}: { 
  tab: string; 
  data: any; 
  selectedProduct: any;
  updatePricingMatrix: (productId: number, newMatrix: any) => void;
  onSave: (data: any) => void; 
  onCSVUpload: (file: File) => void;
}) {
  const [tableData, setTableData] = useState(data);

  useEffect(() => {
    setTableData(data);
  }, [data]);

  const handleCellChange = (rowKey: string, colKey: string, value: string) => {
    setTableData((prev: any) => ({
      ...prev,
      [rowKey]: { ...(prev[rowKey] || {}), [colKey]: value }
    }));
  };

  const clearCurrentTab = () => {
    if (confirm(`Clear all data in ${tab} tab?`)) {
      const updatedMatrix = { ...selectedProduct.pricing_matrix, [tab]: {} };
      updatePricingMatrix(selectedProduct.id, updatedMatrix);
      setTableData({});
    }
  };

  if (tab === 'Base Rate') {
    return (
      <div>
        <div className="flex justify-between mb-4">
          <label className="cursor-pointer px-6 py-3 bg-blue-600 text-white rounded-2xl hover:bg-blue-700 text-sm font-medium">
            📤 Upload CSV for Base Rate
            <input type="file" accept=".csv" className="hidden" onChange={(e) => e.target.files?.[0] && onCSVUpload(e.target.files[0])} />
          </label>
          <button onClick={clearCurrentTab} className="px-6 py-3 text-red-600 hover:bg-red-50 rounded-2xl text-sm font-medium">
            🗑️ Clear Base Rate Table
          </button>
        </div>

        <table className="w-full border border-gray-300 text-sm">
          <thead>
            <tr className="bg-gray-100">
              <th className="border p-3 text-left">Base Rate</th>
              <th className="border p-3 text-left">Premium</th>
            </tr>
          </thead>
          <tbody>
            {Object.keys(tableData).map(rowKey => (
              <tr key={rowKey}>
                <td className="border p-3 font-medium">{rowKey}</td>
                <td className="border p-3">
                  <input
                    type="text"
                    value={tableData[rowKey] || ''}
                    onChange={(e) => handleCellChange(rowKey, 'Premium', e.target.value)}
                    className="w-full text-center focus:outline-none"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <button onClick={() => onSave(tableData)} className="mt-6 px-8 py-4 bg-green-600 text-white rounded-2xl hover:bg-green-700">
          Save Changes to Base Rate
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between mb-4">
        <label className="cursor-pointer px-6 py-3 bg-blue-600 text-white rounded-2xl hover:bg-blue-700 text-sm font-medium">
          📤 Upload CSV for {tab}
          <input type="file" accept=".csv" className="hidden" onChange={(e) => e.target.files?.[0] && onCSVUpload(e.target.files[0])} />
        </label>
        <button onClick={clearCurrentTab} className="px-6 py-3 text-red-600 hover:bg-red-50 rounded-2xl text-sm font-medium">
          🗑️ Clear {tab} Table
        </button>
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
          {Object.keys(tableData).map(rowKey => (
            <tr key={rowKey}>
              <td className="border p-3 font-medium bg-gray-50">{rowKey}</td>
              {Object.keys(tableData[rowKey] || {}).map(colKey => (
                <td key={colKey} className="border p-3">
                  <input
                    type="text"
                    value={tableData[rowKey][colKey] || ''}
                    onChange={(e) => handleCellChange(rowKey, colKey, e.target.value)}
                    className="w-full text-center focus:outline-none"
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <button onClick={() => onSave(tableData)} className="mt-6 px-8 py-4 bg-green-600 text-white rounded-2xl hover:bg-green-700">
        Save Changes to {tab}
      </button>
    </div>
  );
}
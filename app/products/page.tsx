'use client';

import { useState, useEffect } from 'react';
import { useUser, useOrganization } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useTenant } from '@/lib/tenant-context';
import TenantHeader from '@/components/TenantHeader';   // ← Make sure this exists
import { OrganizationSwitcher } from '@clerk/nextjs';   // ← Add this for the fallback

export default function ProductsPage() {
  const { user } = useUser();
  const { organization: clerkOrg } = useOrganization();
  const router = useRouter();
  const tenant = useTenant(); // Supabase tenant (with logo, color, name)

  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);

  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState('Base Rate');

    const tabs = [
    'Base Rate', 'DSCR Adjustment', 'Loan Balance Adjustment', 'FICO Adjustment',
    'Property Type Adjustment', 'Loan Structure Adjustment', 'Amortization Adjustment',
    'Prepayment Adjustment', 'Rent Adjustments', 'Other Adjustments', 'Price Ceiling'
  ];

  useEffect(() => {
    if (!clerkOrg?.id) {
      router.push('/select-org');
      return;
    }

    if (tenant?.id) {
      fetchProducts();
    }
  }, [clerkOrg?.id, tenant?.id, router]);

  // Protection UI
  if (!clerkOrg?.id) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-md mx-auto p-10">
          <h2 className="text-3xl font-bold mb-6">Select an Organization</h2>
          <p className="mb-8 text-gray-600">
            You need to select or create an organization to access Products.
          </p>
          <OrganizationSwitcher 
            hidePersonal={true}
            afterSelectOrganizationUrl="/products"
            afterCreateOrganizationUrl="/products"
          />
        </div>
      </div>
    );
  }

  if (!tenant) {
    return <div className="p-10 text-center text-xl">Loading organization info...</div>;
  }

  if (!tenant?.id) {
    return (
      <div className="p-10 text-center">
        <h2 className="text-xl font-bold text-red-600 mb-4">Organization not found</h2>
        <p>Please make sure the organization record exists in Supabase.</p>
        <button 
          onClick={() => window.location.reload()} 
          className="mt-4 px-6 py-3 bg-blue-600 text-white rounded-2xl"
        >
          Refresh Page
        </button>
      </div>
    );
  }

  if (loading) return <div className="p-10 text-center text-xl">Loading products...</div>;

  async function fetchProducts() {
    if (!tenant?.id) return;

    const { data, error } = await supabase
      .from('loan_products')
      .select('*')
      .eq('organization_id', tenant.id)
      .order('created_at', { ascending: false });

    if (error) console.error(error);
    setProducts(data || []);
    setLoading(false);
  }

 const createProduct = async () => {
  if (!newName.trim() || !tenant?.id) return alert('Product name is required');

  const { data, error } = await supabase
    .from('loan_products')
    .insert({ 
      name: newName.trim(), 
      description: newDesc.trim() || null, 
      pricing_matrix: {},
      default_profit_percent: 1.0,           // ← Make sure this line exists
      active: true,
      organization_id: tenant.id
    })
    .select()
    .single();

  if (error) {
    console.error(error);
    alert('Error creating product: ' + error.message);
  } else {
    setProducts([data, ...products]);
    setNewName('');
    setNewDesc('');
    alert('✅ Product created!');
  }
};
    const toggleActive = async (productId: number, currentActive: boolean) => {
    const { error } = await supabase
      .from('loan_products')
      .update({ active: !currentActive })
      .eq('id', productId)
      .eq('organization_id', tenant?.id);

    if (error) alert(error.message);
    else fetchProducts();
  };

  const updateProfit = async (productId: number, newProfit: number) => {
    const { error } = await supabase
      .from('loan_products')
      .update({ default_profit_percent: newProfit })
      .eq('id', productId)
      .eq('organization_id', tenant?.id);

    if (error) alert(error.message);
    else fetchProducts();
  };

  const handleGuidelinesUpload = async (productId: string, file: File) => {
    if (!file || !tenant?.id) return;
    setUploadingId(productId);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${productId}-${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('product-guidelines')
        .upload(fileName, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('product-guidelines').getPublicUrl(fileName);

      const { error: updateError } = await supabase
        .from('loan_products')
        .update({ guidelines_url: urlData.publicUrl })
        .eq('id', parseInt(productId))
        .eq('organization_id', tenant.id);

      if (updateError) throw updateError;

      alert('✅ Guidelines PDF uploaded successfully!');
      fetchProducts();
    } catch (err: any) {
      alert('Upload failed: ' + err.message);
    } finally {
      setUploadingId(null);
    }
  };

  const updatePricingMatrix = (productId: number, newMatrix: any) => {
    setProducts(products.map(p => p.id === productId ? { ...p, pricing_matrix: newMatrix } : p));
  };

  const saveProduct = async (product: any) => {
    if (!tenant?.id) return;
    setSavingId(product.id);
    try {
      const { error } = await supabase
        .from('loan_products')
        .update({ 
          name: product.name,
          description: product.description || null,
          pricing_matrix: product.pricing_matrix,
          default_profit_percent: product.default_profit_percent
        })
        .eq('id', product.id)
        .eq('organization_id', tenant.id);

      if (error) throw error;
      alert('✅ Product saved successfully!');
      fetchProducts();
    } catch (err: any) {
      alert('Save failed: ' + err.message);
    } finally {
      setSavingId(null);
    }
  };

  const handleCSVUpload = async (file: File) => {
    const currentProduct = products.find(p => p.id === selectedProductId);
    if (!currentProduct || !tenant?.id) {
      alert('Please select a product and click on a tab first');
      return;
    }

    try {
      const text = await file.text();
      const lines = text.trim().split('\n');
      const rows: string[][] = [];

      for (const line of lines) {
        if (!line.trim()) continue;
        const parsedRow: string[] = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
          const char = line[i];
          if (char === '"') inQuotes = !inQuotes;
          else if (char === ',' && !inQuotes) {
            parsedRow.push(current.trim());
            current = '';
          } else {
            current += char;
          }
        }
        parsedRow.push(current.trim());
        rows.push(parsedRow);
      }

      let newData: any = {};
      const header = rows[0];

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (row.length < 2) continue;

        let rowKey = row[0]?.trim().replace(/^"|"$/g, '');
        if (!rowKey) continue;

        newData[rowKey] = {};

        for (let j = 1; j < header.length && j < row.length; j++) {
          let colKey = header[j]?.trim().replace(/^"|"$/g, '');

          if (colKey.includes('0-50')) colKey = '<=50';
          else if (colKey.includes('50.01')) colKey = '50.01-55';
          else if (colKey.includes('55.01')) colKey = '55.01-60';
          else if (colKey.includes('60.01')) colKey = '60.01-65';
          else if (colKey.includes('65.01')) colKey = '65.01-70';
          else if (colKey.includes('70.01')) colKey = '70.01-75';
          else if (colKey.includes('75.01')) colKey = '75.01-80';

          let rawValue = row[j].trim().replace(/^"|"$/g, '');

          if (rawValue.startsWith('(') && rawValue.endsWith(')')) {
            rawValue = '-' + rawValue.slice(1, -1);
          }

          if (rawValue.toUpperCase() === 'N/A' || rawValue === '' || rawValue.toUpperCase() === 'NA') {
            newData[rowKey][colKey] = 'N/A';
          } else {
            newData[rowKey][colKey] = parseFloat(rawValue) || 0;
          }
        }
      }

      const currentMatrix = currentProduct.pricing_matrix || {};
      const keyMap: any = {
        'Base Rate': 'baseRates',
        'FICO Adjustment': 'ficoLtvGrid',
        'DSCR Adjustment': 'dscrLtvGrid',
        'Loan Balance Adjustment': 'loanBalanceLtvGrid',
        'Property Type Adjustment': 'propertyTypeAcquisition',
        'Prepayment Adjustment': 'Prepayment Adjustment'
      };

      const storageKey = keyMap[activeTab] || activeTab;
      const updatedMatrix = { ...currentMatrix, [storageKey]: newData };

      const { error } = await supabase
        .from('loan_products')
        .update({ pricing_matrix: updatedMatrix })
        .eq('id', currentProduct.id)
        .eq('organization_id', tenant.id);

      if (error) alert('Failed to save: ' + error.message);
      else {
        alert(`✅ ${activeTab} CSV imported successfully!`);
        fetchProducts();
      }
    } catch (err) {
      console.error(err);
      alert('Error reading CSV file');
    }
  };

  const deleteProduct = async (productId: number, productName: string) => {
    if (!confirm(`🗑️ Delete product "${productName}"?\n\nThis action cannot be undone.`)) return;
    if (!tenant?.id) return;

    setDeletingId(productId);
    try {
      const { error } = await supabase
        .from('loan_products')
        .delete()
        .eq('id', productId)
        .eq('organization_id', tenant.id);

      if (error) throw error;
      alert(`✅ Product "${productName}" deleted.`);
      fetchProducts();
    } catch (err: any) {
      alert('Failed to delete: ' + err.message);
    } finally {
      setDeletingId(null);
    }
  };

     if (!clerkOrg?.id) return <div className="p-10 text-center">No active organization</div>;
  
  if (!tenant) return <div className="p-10 text-center text-xl">Loading organization info...</div>;
  
  if (!tenant?.id) {
    return (
      <div className="p-10 text-center">
        <h2 className="text-xl font-bold text-red-600 mb-4">Organization not found in database</h2>
        <p>Please make sure the organization record exists in Supabase.</p>
      </div>
    );
  }

    if (!clerkOrg?.id) return <div className="p-10 text-center">No active organization</div>;
  
  if (!tenant) return <div className="p-10 text-center text-xl">Loading organization info...</div>;
  
  if (!tenant?.id) {
    return (
      <div className="p-10 text-center">
        <h2 className="text-xl font-bold text-red-600 mb-4">Organization not found in database</h2>
        <p>Please make sure the organization record exists in Supabase.</p>
      </div>
    );
  }

   if (!clerkOrg?.id) return <div className="p-10 text-center">No active organization</div>;
  
  if (!tenant) return <div className="p-10 text-center text-xl">Loading organization info...</div>;
  
  if (!tenant?.id) {
    return (
      <div className="p-10 text-center">
        <h2 className="text-xl font-bold text-red-600 mb-4">Organization not found in database</h2>
        <p>Please make sure the organization record exists in Supabase.</p>
      </div>
    );
  }

  if (loading) return <div className="p-10 text-center text-xl">Loading products...</div>;

     return (
    <div className="max-w-7xl mx-auto p-8">
      {/* White-Label Header */}
      <TenantHeader />

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
        const isSelected = selectedProductId === product.id;
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

              <div className="flex items-center gap-4">
                <span className={`px-5 py-2 rounded-2xl text-sm font-medium ${product.active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                  {product.active ? '✅ Active' : '❌ Inactive'}
                </span>
                <button 
                  onClick={() => toggleActive(product.id, product.active)} 
                  className={`px-6 py-2 text-sm font-medium rounded-2xl ${product.active ? 'bg-red-600 text-white' : 'bg-green-600 text-white'}`}
                >
                  {product.active ? 'Deactivate' : 'Activate'}
                </button>

                <button 
                  onClick={() => deleteProduct(product.id, product.name)} 
                  disabled={deletingId === product.id} 
                  className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-2xl disabled:opacity-50"
                >
                  {deletingId === product.id ? 'Deleting...' : '🗑️ Delete'}
                </button>

                <button 
                  onClick={() => saveProduct(product)} 
                  disabled={savingId === product.id} 
                  className="px-8 py-3 bg-green-600 hover:bg-green-700 text-white font-medium rounded-2xl disabled:opacity-50"
                >
                  {savingId === product.id ? 'Saving...' : '💾 Save Product'}
                </button>
              </div>
            </div>

            {/* Guidelines Upload */}
            <div className="mb-10">
              <p className="font-medium mb-3">Guidelines PDF</p>
              {product.guidelines_url && <a href={product.guidelines_url} target="_blank" className="text-blue-600 underline block mb-3">View Current Guidelines</a>}
              <label className="cursor-pointer block bg-gray-50 border-2 border-dashed border-gray-300 rounded-3xl p-8 text-center hover:border-blue-600">
                {uploadingId === product.id.toString() ? 'Uploading...' : 'Upload / Replace Guidelines PDF'}
                <input type="file" accept=".pdf" className="hidden" onChange={(e) => e.target.files?.[0] && handleGuidelinesUpload(product.id.toString(), e.target.files[0])} />
              </label>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 border-b mb-6 overflow-x-auto">
              {tabs.map(tab => (
                <button
                  key={tab}
                  onClick={() => {
                    setSelectedProductId(product.id);
                    setActiveTab(tab);
                  }}
                  className={`px-6 py-3 whitespace-nowrap rounded-t-2xl font-medium ${activeTab === tab && isSelected ? 'bg-blue-600 text-white' : 'hover:bg-gray-100'}`}
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
                updatePricingMatrix(product.id, updatedMatrix);

                const tempProduct = { ...product, pricing_matrix: updatedMatrix };
                saveProduct(tempProduct);
              }}
              onCSVUpload={handleCSVUpload}
            />
          </div>
        );
      })}
    </div>
  );
}

// ====================== PricingTableEditor ======================
function PricingTableEditor({ 
  tab, 
  data, 
  selectedProduct, 
  updatePricingMatrix, 
  onSave, 
  onCSVUpload 
}: any) {
  const [tableData, setTableData] = useState({});

  useEffect(() => {
    const matrix = selectedProduct?.pricing_matrix || {};
    let source = {};

    if (tab === 'Base Rate') {
      source = matrix.baseRates || matrix['Base Rate'] || {};
    } else if (tab === 'FICO Adjustment') {
      source = matrix.ficoLtvGrid || matrix['FICO Adjustment'] || {};
    } else if (tab === 'DSCR Adjustment') {
      source = matrix.dscrLtvGrid || matrix['DSCR Adjustment'] || {};
    } else if (tab === 'Loan Balance Adjustment') {
      source = matrix.loanBalanceLtvGrid || {};
    } else if (tab === 'Property Type Adjustment') {
      source = matrix.propertyTypeAcquisition || matrix['Property Type Adjustment'] || {};
    } else if (tab === 'Prepayment Adjustment') {
      source = matrix['Prepayment Adjustment'] || matrix.prepayment || {};
    }

    setTableData(source || {});
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
    updatePricingMatrix(selectedProduct.id, updated);
  };

  if (tab === 'Base Rate') {
    return (
      <div>
        <div className="flex justify-between mb-4">
          <label className="cursor-pointer px-6 py-3 bg-blue-600 text-white rounded-2xl hover:bg-blue-700 text-sm font-medium">
            📤 Upload CSV for Base Rate
            <input type="file" accept=".csv" className="hidden" onChange={(e) => e.target.files?.[0] && onCSVUpload(e.target.files[0])} />
          </label>
          <button onClick={clearCurrentTab} className="px-6 py-3 text-red-600 hover:bg-red-50 rounded-2xl text-sm font-medium">🗑️ Clear Base Rate Table</button>
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
                  <input type="text" value={tableData[rowKey] || ''} onChange={(e) => handleCellChange(rowKey, '', e.target.value)} className="w-full text-center focus:outline-none" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button onClick={() => onSave(tableData)} className="mt-6 px-8 py-4 bg-green-600 text-white rounded-2xl hover:bg-green-700">Save Changes to Base Rate</button>
      </div>
    );
  }

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
        <label className="cursor-pointer px-6 py-3 bg-blue-600 text-white rounded-2xl hover:bg-blue-700 text-sm font-medium">
          📤 Upload CSV for {tab}
          <input type="file" accept=".csv" className="hidden" onChange={(e) => e.target.files?.[0] && onCSVUpload(e.target.files[0])} />
        </label>
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
      <button onClick={() => onSave(tableData)} className="mt-6 px-8 py-4 bg-green-600 text-white rounded-2xl hover:bg-green-700">
        Save Changes to {tab}
      </button>
    </div>
  );
}
'use client';

import { useState, useEffect } from 'react';
import { useUser, useOrganization } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useTenant } from '@/lib/tenant-context';   // ← Important: keep this
import TenantHeader from '@/components/TenantHeader';
import { OrganizationSwitcher } from '@clerk/nextjs';

export default function ProductsPage() {
  const { user } = useUser();
  const { organization: clerkOrg } = useOrganization();
  const router = useRouter();
  const tenant = useTenant();   // ← This matches your white-label setup

  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!clerkOrg?.id) {
      router.push('/select-org');
      return;
    }
    if (tenant?.id) {
      fetchProducts();
    }
  }, [clerkOrg?.id, tenant?.id, router]);

  async function fetchProducts() {
    if (!tenant?.id) return;

    const { data, error } = await supabase
      .from('loan_products')
      .select('*')
      .eq('organization_id', tenant.id)
      .order('created_at', { ascending: false });

    if (error) console.error("Fetch products error:", error);
    setProducts(data || []);
    setLoading(false);
  }

  const createProduct = async () => {
    const name = prompt("Enter new product name:");
    if (!name?.trim() || !tenant?.id) return;

    const { data, error } = await supabase
      .from('loan_products')
      .insert({
        name: name.trim(),
        description: '',
        pricing_matrix: {},
        default_profit_percent: 1.0,
        active: true,
        organization_id: tenant.id,
        standard_conditions: { purchase: [], refinance: [] }
      })
      .select()
      .single();

    if (error) {
      alert('Error creating product: ' + error.message);
    } else {
      router.push(`/products/${data.id}`);
    }
  };

  if (loading) return <div className="p-10 text-center text-xl">Loading products...</div>;

  return (
    <div className="max-w-6xl mx-auto p-8">
      <TenantHeader />

      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Loan Products</h1>
        <button
          onClick={createProduct}
          className="px-8 py-4 bg-blue-600 text-white rounded-3xl font-semibold hover:bg-blue-700"
        >
          + Create New Product
        </button>
        <button
  onClick={() => router.push('/products/keys')}
  className="px-6 py-3 bg-amber-600 text-white rounded-2xl hover:bg-amber-700"
>
  🔑 Manage Standard Keys
</button>
      </div>

      <div className="bg-white rounded-3xl border">
        {products.length === 0 ? (
          <div className="p-20 text-center text-gray-500">
            No products yet. Click "Create New Product" to get started.
          </div>
        ) : (
          products.map((product: any) => (
            <div
              key={product.id}
              onClick={() => router.push(`/products/${product.id}`)}
              className="p-8 border-b hover:bg-gray-50 cursor-pointer flex justify-between items-center group"
            >
              <div>
                <h3 className="text-xl font-semibold">{product.name}</h3>
                <p className="text-gray-500 text-sm">{product.description || 'No description'}</p>
              </div>
              <div className="flex items-center gap-4">
                <span className={`px-5 py-2 rounded-2xl text-sm font-medium ${product.active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                  {product.active ? '✅ Active' : '❌ Inactive'}
                </span>
                <button 
                  onClick={(e) => { e.stopPropagation(); router.push(`/products/${product.id}`); }}
                  className="px-6 py-3 text-blue-600 hover:bg-blue-50 rounded-2xl font-medium group-hover:opacity-100"
                >
                  View / Edit →
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
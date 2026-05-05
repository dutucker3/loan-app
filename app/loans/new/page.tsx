'use client';

import { useState, useEffect } from 'react';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';

function NewLoanContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const appId = searchParams.get('id');

  const [application, setApplication] = useState<any>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);

  useEffect(() => {
    if (!appId) return;

    const loadApplication = async () => {
      const { data } = await supabase
        .from('loan_applications')
        .select('*')
        .eq('id', appId)
        .single();
      setApplication(data);
    };

    const loadProducts = async () => {
      const { data } = await supabase.from('loan_products').select('*');
      setProducts(data || []);
    };

    loadApplication();
    loadProducts();
  }, [appId]);

  if (!application) return <div className="p-10 text-center">Loading application...</div>;

  const form = application.form_data;
  const borrowers = application.borrowers || [];

  // Key metrics from application
  const propertyValue = parseFloat((form.estimatedValue || '').replace(/,/g, '')) || 0;
  const loanAmount = parseFloat((form.loanAmount || '').replace(/,/g, '')) || 0;
  const ltv = parseFloat(form.ltv || '0');
  const fico = parseFloat(borrowers[0]?.fico || '0');
  const dscr = 1.05; // placeholder – you can calculate from rental vs expenses

  return (
    <div className="max-w-7xl mx-auto p-8">
      <h1 className="text-4xl font-bold mb-8">
        Pricing Matrix – {application?.form_data?.propertyAddress || 'New Loan'}
      </h1>

      {/* Product Selector */}
      <select 
        onChange={(e) => {
          const product = products.find(p => p.id === parseInt(e.target.value));
          setSelectedProduct(product);
        }}
        className="w-full max-w-xs border rounded-2xl p-4 mb-8 text-lg"
      >
        <option value="">Select Loan Product</option>
        {products.map(p => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>

      {selectedProduct && (
        <div className="bg-white border rounded-3xl p-8 shadow-sm">
          <div className="text-center text-2xl font-semibold mb-6">
            Pricing for {selectedProduct.name} • {ltv}% LTV • {fico} FICO • {dscr.toFixed(2)}x DSCR
          </div>
          {/* Your pricing matrix table will go here in the next step */}
        </div>
      )}

      <button 
        onClick={() => router.push('/dashboard')}
        className="mt-12 px-8 py-4 bg-black text-white rounded-3xl text-lg hover:bg-gray-800"
      >
        ← Back to Dashboard
      </button>
    </div>
  );
}

export default function NewLoanPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-xl">Loading loan pricing page...</div>}>
      <NewLoanContent />
    </Suspense>
  );
}

export const dynamic = 'force-dynamic';
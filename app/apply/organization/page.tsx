'use client';

import { useState, useEffect } from 'react';
import { useUser } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { createClientComponentClient } from '@/lib/supabase';

export default function OrganizationApplyPage() {
  const { user, isLoaded } = useUser();
  const router = useRouter();
  const supabase = createClientComponentClient();

  const [form, setForm] = useState({
    address: '',
    city: '',
    state: '',
    zip: '',
    website: '',
    owners: [{ name: '', percentage: '' }] as { name: string; percentage: string }[],
    managers: [''] as string[],
    products: [] as string[],
    notes: '',
  });

  const [loading, setLoading] = useState(false);

  // Redirect if not logged in
  useEffect(() => {
    if (isLoaded && !user) {
      router.push('/sign-up?redirect=/apply/organization');
    }
  }, [user, isLoaded, router]);

  // Helper Functions
  const addOwner = () => {
    setForm(prev => ({ ...prev, owners: [...prev.owners, { name: '', percentage: '' }] }));
  };

  const updateOwner = (index: number, field: 'name' | 'percentage', value: string) => {
    const newOwners = [...form.owners];
    newOwners[index][field] = value;
    setForm(prev => ({ ...prev, owners: newOwners }));
  };

  const removeOwner = (index: number) => {
    setForm(prev => ({ ...prev, owners: prev.owners.filter((_, i) => i !== index) }));
  };

  const addManager = () => {
    setForm(prev => ({ ...prev, managers: [...prev.managers, ''] }));
  };

  const updateManager = (index: number, value: string) => {
    const newManagers = [...form.managers];
    newManagers[index] = value;
    setForm(prev => ({ ...prev, managers: newManagers }));
  };

  const removeManager = (index: number) => {
    setForm(prev => ({ ...prev, managers: prev.managers.filter((_, i) => i !== index) }));
  };

  const toggleProduct = (product: string) => {
    setForm(prev => ({
      ...prev,
      products: prev.products.includes(product)
        ? prev.products.filter(p => p !== product)
        : [...prev.products, product]
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { error } = await supabase
        .from('pending_organizations')
        .insert({
          company_name: user?.fullName || 'Unnamed Company',
          contact_name: user?.fullName,
          email: user?.primaryEmailAddress?.emailAddress,
          phone: user?.primaryPhoneNumber?.phoneNumber,
          clerk_user_id: user?.id,
          address: form.address,
          city: form.city,
          state: form.state,
          zip: form.zip,
          website: form.website,
          owners: form.owners,
          managers: form.managers,
          products_offered: form.products,
          notes: form.notes,
          status: 'pending',
        });

      if (error) {
        alert('Error: ' + error.message);
      } else {
        alert('✅ Application submitted successfully!');
        router.push('/thank-you');
      }
    } catch (err: any) {
      alert('Unexpected error: ' + err.message);
    }

    setLoading(false);
  };

  if (!isLoaded) return <div className="p-10 text-center">Loading...</div>;
  if (!user) return <div>Redirecting to sign up...</div>;

  return (
    <div className="max-w-3xl mx-auto p-8">
      <h1 className="text-4xl font-bold mb-2">Organization Application</h1>
      <p className="text-gray-600 mb-10">Welcome, {user.fullName}</p>

      <form onSubmit={handleSubmit} className="bg-white rounded-3xl border p-10 space-y-10">
        
        <div>
          <label className="block text-sm font-medium mb-2">Company Name</label>
          <input value={user.fullName || ''} disabled className="w-full px-5 py-4 border rounded-2xl bg-gray-50" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium mb-2">Address</label>
            <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="w-full px-5 py-4 border rounded-2xl" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">City</label>
            <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className="w-full px-5 py-4 border rounded-2xl" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">State</label>
            <input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} className="w-full px-5 py-4 border rounded-2xl" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">ZIP Code</label>
            <input value={form.zip} onChange={(e) => setForm({ ...form, zip: e.target.value })} className="w-full px-5 py-4 border rounded-2xl" />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Website URL</label>
          <input type="text" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} className="w-full px-5 py-4 border rounded-2xl" placeholder="yourcompany.com" />
        </div>

        {/* Owners */}
        <div>
          <label className="block text-sm font-medium mb-3">Company Owners (25%+ ownership)</label>
          {form.owners.map((owner, index) => (
            <div key={index} className="flex gap-4 mb-4">
              <input placeholder="Owner Name" value={owner.name} onChange={(e) => updateOwner(index, 'name', e.target.value)} className="flex-1 px-5 py-4 border rounded-2xl" />
              <input placeholder="% Ownership" type="number" value={owner.percentage} onChange={(e) => updateOwner(index, 'percentage', e.target.value)} className="w-32 px-5 py-4 border rounded-2xl" />
              <button type="button" onClick={() => removeOwner(index)} className="text-red-600">Remove</button>
            </div>
          ))}
          <button type="button" onClick={addOwner} className="text-blue-600 hover:underline">+ Add Owner</button>
        </div>

        {/* Managers */}
        <div>
          <label className="block text-sm font-medium mb-3">Managers / Key Personnel</label>
          {form.managers.map((manager, index) => (
            <div key={index} className="flex gap-4 mb-3">
              <input placeholder="Manager Name" value={manager} onChange={(e) => updateManager(index, e.target.value)} className="flex-1 px-5 py-4 border rounded-2xl" />
              <button type="button" onClick={() => removeManager(index)} className="text-red-600">Remove</button>
            </div>
          ))}
          <button type="button" onClick={addManager} className="text-blue-600 hover:underline">+ Add Manager</button>
        </div>

        {/* Products */}
        <div>
          <label className="block text-sm font-medium mb-3">Products Offered</label>
          <div className="grid grid-cols-2 gap-3">
            {['Bridge Loans', 'RTL Loans', 'DSCR Loans', 'Business Purpose', 'Retail Loans'].map(product => (
              <label key={product} className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={form.products.includes(product)} onChange={() => toggleProduct(product)} className="w-5 h-5" />
                <span>{product}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Additional Notes</label>
          <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={5} className="w-full px-5 py-4 border rounded-2xl" />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-5 bg-blue-600 text-white rounded-3xl font-semibold text-xl hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Submitting Application...' : 'Submit Organization Application'}
        </button>
      </form>
    </div>
  );
}
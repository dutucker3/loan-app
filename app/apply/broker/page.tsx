'use client';

import { useState, useEffect } from 'react';
import { useUser } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { createClientComponentClient } from '@/lib/supabase';
import Link from 'next/link';

export default function BrokerApplyPage() {
  const { user, isLoaded } = useUser();
  const router = useRouter();
  const supabase = createClientComponentClient();

  const [organizations, setOrganizations] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({
    full_name: '',
    email: '',
    phone: '',
    broker_company_name: '',
    experience_years: '',
    monthly_volume_estimate: '',
    target_organization_id: '',
    notes: '',
  });

  // Load available organizations for broker to choose from
  useEffect(() => {
    const loadOrganizations = async () => {
      const { data } = await supabase
        .from('organizations')
        .select('id, name, slug')
        .eq('active', true)
        .order('name');
      setOrganizations(data || []);
    };

    loadOrganizations();
  }, [supabase]);

  useEffect(() => {
    if (isLoaded && !user) {
      router.push('/sign-up?redirect=/apply/broker');
    } else if (user && !form.full_name) {
      setForm(prev => ({
        ...prev,
        full_name: user.fullName || '',
        email: user.primaryEmailAddress?.emailAddress || '',
      }));
    }
  }, [user, isLoaded, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { error } = await supabase
      .from('pending_brokers')   // We'll create this table later if needed
      .insert({
        ...form,
        clerk_user_id: user?.id,
        status: 'pending',
      });

    if (error) {
      alert('Error: ' + error.message);
    } else {
      alert('✅ Broker application submitted successfully!');
      router.push('/thank-you');
    }

    setLoading(false);
  };

  if (!isLoaded) return <div className="p-10 text-center">Loading...</div>;

  return (
    <div className="max-w-2xl mx-auto p-8">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-4xl font-bold">Broker Application</h1>
        <Link href="/apply/organization" className="text-blue-600 hover:underline font-medium">
          Apply as Organization →
        </Link>
      </div>

      <p className="text-gray-600 mb-10">Welcome, {user?.fullName}</p>

      <form onSubmit={handleSubmit} className="bg-white rounded-3xl border p-10 space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium mb-2">Full Name *</label>
            <input 
              required 
              value={form.full_name} 
              onChange={(e) => setForm({ ...form, full_name: e.target.value })} 
              className="w-full px-5 py-4 border rounded-2xl" 
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Phone *</label>
            <input 
              type="tel" 
              required 
              value={form.phone} 
              onChange={(e) => setForm({ ...form, phone: e.target.value })} 
              className="w-full px-5 py-4 border rounded-2xl" 
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Broker Company Name (if any)</label>
            <input 
              value={form.broker_company_name} 
              onChange={(e) => setForm({ ...form, broker_company_name: e.target.value })} 
              className="w-full px-5 py-4 border rounded-2xl" 
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Years of Experience</label>
            <input 
              type="number" 
              value={form.experience_years} 
              onChange={(e) => setForm({ ...form, experience_years: e.target.value })} 
              className="w-full px-5 py-4 border rounded-2xl" 
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-medium mb-2">Target Organization (if known)</label>
            <select 
              value={form.target_organization_id} 
              onChange={(e) => setForm({ ...form, target_organization_id: e.target.value })}
              className="w-full px-5 py-4 border rounded-2xl"
            >
              <option value="">— Select Organization (Optional) —</option>
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-medium mb-2">Estimated Monthly Loan Volume</label>
            <input 
              value={form.monthly_volume_estimate} 
              onChange={(e) => setForm({ ...form, monthly_volume_estimate: e.target.value })} 
              className="w-full px-5 py-4 border rounded-2xl" 
              placeholder="$250,000+" 
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Notes / Experience Summary</label>
          <textarea 
            value={form.notes} 
            onChange={(e) => setForm({ ...form, notes: e.target.value })} 
            rows={6} 
            className="w-full px-5 py-4 border rounded-2xl" 
            placeholder="Brief summary of your lending experience..." 
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-5 bg-emerald-600 text-white rounded-3xl font-semibold text-xl hover:bg-emerald-700 disabled:opacity-50"
        >
          {loading ? 'Submitting Application...' : 'Submit Broker Application'}
        </button>
      </form>
    </div>
  );
}
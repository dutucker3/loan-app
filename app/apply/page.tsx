'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function OrganizationApplyPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({
    company_name: '',
    contact_name: '',
    email: '',
    phone: '',
    website: '',
    loan_volume_estimate: '',
    address: '',
    city: '',
    state: '',
    zip: '',
    notes: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { error } = await supabase
      .from('pending_organizations')
      .insert({
        ...form,
        status: 'pending',
      });

    if (error) {
      alert('Submission failed: ' + error.message);
    } else {
      alert('✅ Application submitted successfully! We will review it shortly.');
      router.push('/thank-you');
    }

    setLoading(false);
  };

  return (
    <div className="max-w-2xl mx-auto p-8">
      <h1 className="text-4xl font-bold mb-8 text-center">Apply for Organization Access</h1>
      <p className="text-center text-gray-600 mb-10">Join our lending platform as an organization</p>

      <form onSubmit={handleSubmit} className="space-y-6 bg-white p-10 rounded-3xl border">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium mb-2">Company Name *</label>
            <input type="text" required value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} className="w-full px-5 py-4 border rounded-2xl" />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Contact Name *</label>
            <input type="text" required value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} className="w-full px-5 py-4 border rounded-2xl" />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Business Email *</label>
            <input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full px-5 py-4 border rounded-2xl" />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Phone *</label>
            <input type="tel" required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full px-5 py-4 border rounded-2xl" />
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-medium mb-2">Website / URL</label>
            <input type="url" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} className="w-full px-5 py-4 border rounded-2xl" placeholder="https://yourcompany.com" />
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-medium mb-2">Address</label>
            <input type="text" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="w-full px-5 py-4 border rounded-2xl" />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">City</label>
            <input type="text" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className="w-full px-5 py-4 border rounded-2xl" />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">State</label>
            <input type="text" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} className="w-full px-5 py-4 border rounded-2xl" />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Estimated Monthly Loan Volume</label>
            <input type="text" value={form.loan_volume_estimate} onChange={(e) => setForm({ ...form, loan_volume_estimate: e.target.value })} className="w-full px-5 py-4 border rounded-2xl" placeholder="$500,000+" />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Additional Notes / Message</label>
          <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={5} className="w-full px-5 py-4 border rounded-2xl" placeholder="Tell us about your lending business..." />
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
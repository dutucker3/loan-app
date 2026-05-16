'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function ApplyPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const [formData, setFormData] = useState({
    company_name: '',
    contact_name: '',
    email: '',
    phone: '',
    website: '',
    loan_volume_estimate: '',
    notes: '',
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { error } = await supabase
      .from('pending_organizations')
      .insert({
        company_name: formData.company_name,
        contact_name: formData.contact_name,
        email: formData.email,
        phone: formData.phone,
        website: formData.website || null,
        loan_volume_estimate: formData.loan_volume_estimate,
        notes: formData.notes || null,
        status: 'pending',
      });

    setLoading(false);

    if (error) {
      alert('Error submitting application: ' + error.message);
    } else {
      setSubmitted(true);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="max-w-lg w-full bg-white rounded-3xl p-12 text-center shadow-xl">
          <div className="text-6xl mb-6">🎉</div>
          <h1 className="text-4xl font-bold mb-4">Application Received</h1>
          <p className="text-gray-600 text-lg">
            Thank you! Our team will review your application shortly.
            <br />You will receive an email once your organization is approved.
          </p>
          <button
            onClick={() => router.push('/')}
            className="mt-10 px-8 py-4 bg-blue-600 text-white rounded-2xl font-semibold hover:bg-blue-700"
          >
            Return to Homepage
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-2xl mx-auto px-6">
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold mb-4">Become a Partner Lender</h1>
          <p className="text-xl text-gray-600">
            Join our platform and start offering competitive loan products
          </p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-3xl shadow-xl p-10 space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium mb-2">Company Name *</label>
              <input
                type="text"
                name="company_name"
                required
                value={formData.company_name}
                onChange={handleChange}
                className="w-full px-5 py-3 border rounded-2xl focus:outline-none focus:border-blue-500"
                placeholder="Acme Capital LLC"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Contact Name *</label>
              <input
                type="text"
                name="contact_name"
                required
                value={formData.contact_name}
                onChange={handleChange}
                className="w-full px-5 py-3 border rounded-2xl focus:outline-none focus:border-blue-500"
                placeholder="John Smith"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium mb-2">Business Email *</label>
              <input
                type="email"
                name="email"
                required
                value={formData.email}
                onChange={handleChange}
                className="w-full px-5 py-3 border rounded-2xl focus:outline-none focus:border-blue-500"
                placeholder="john@acmecapital.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Phone Number</label>
              <input
                type="tel"
                name="phone"
                value={formData.phone}
                onChange={handleChange}
                className="w-full px-5 py-3 border rounded-2xl focus:outline-none focus:border-blue-500"
                placeholder="(555) 123-4567"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Website (optional)</label>
            <input
              type="url"
              name="website"
              value={formData.website}
              onChange={handleChange}
              className="w-full px-5 py-3 border rounded-2xl focus:outline-none focus:border-blue-500"
              placeholder="https://acmecapital.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Estimated Monthly Loan Volume</label>
            <select
              name="loan_volume_estimate"
              value={formData.loan_volume_estimate}
              onChange={handleChange}
              className="w-full px-5 py-3 border rounded-2xl focus:outline-none focus:border-blue-500"
            >
              <option value="">Select range</option>
              <option value="Under $1M">Under $1M</option>
              <option value="$1M - $5M">$1M - $5M</option>
              <option value="$5M - $15M">$5M - $15M</option>
              <option value="$15M+">$15M+</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Additional Notes / Questions</label>
            <textarea
              name="notes"
              value={formData.notes}
              onChange={handleChange}
              rows={4}
              className="w-full px-5 py-3 border rounded-2xl focus:outline-none focus:border-blue-500"
              placeholder="Tell us about your lending focus, target markets, etc."
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-5 bg-blue-600 hover:bg-blue-700 text-white text-xl font-semibold rounded-3xl disabled:opacity-50 transition"
          >
            {loading ? 'Submitting Application...' : 'Submit Application'}
          </button>

          <p className="text-center text-sm text-gray-500">
            Your information is secure and will only be reviewed by our team.
          </p>
        </form>
      </div>
    </div>
  );
}
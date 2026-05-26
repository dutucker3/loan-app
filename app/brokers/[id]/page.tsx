'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

type Broker = {
  id: string;
  full_name?: string;
  email?: string;
  role?: string;
  organization_id?: string;
  broker_logo_url?: string;
  broker_company_name?: string;
  broker_custom_url?: string;
};

export default function BrokerDetailPage() {
  const params = useParams();
  const router = useRouter();
  const brokerId = params.id as string;

  const [broker, setBroker] = useState<Broker | null>(null);
  const [retailMarkup, setRetailMarkup] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    fetchBroker();
  }, [brokerId]);

  async function fetchBroker() {
    // Fetch broker details
    const { data: brokerData } = await supabase
      .from('users')
      .select('*')
      .eq('id', brokerId)
      .single();

    setBroker(brokerData || null);

    // Fetch retail markup
    const { data: markupData } = await supabase
      .from('pricing_markups')
      .select('value')
      .eq('broker_id', brokerId)
      .eq('markup_type', 'retail')
      .single();

    if (markupData) setRetailMarkup(Number(markupData.value));

    setLoading(false);
  }

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !broker) return;

    setUploading(true);
    const fileName = `broker-${brokerId}-${Date.now()}.${file.name.split('.').pop()}`;

    try {
      const { error: uploadError } = await supabase.storage
        .from('logos')
        .upload(fileName, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('logos').getPublicUrl(fileName);

      // Update local state
      setBroker(prev => prev ? { ...prev, broker_logo_url: urlData.publicUrl } : null);
      alert('Logo uploaded! Click Save to persist.');
    } catch (err: any) {
      alert('Upload failed: ' + err.message);
    } finally {
      setUploading(false);
    }
  };

  const saveBroker = async () => {
    if (!broker) return;
    setSaving(true);

    // Save markup
    await supabase.from('pricing_markups').upsert({
      organization_id: broker.organization_id,
      broker_id: brokerId,
      markup_type: 'retail',
      value: retailMarkup,
      description: `Broker retail markup`,
    }, { onConflict: 'organization_id,broker_id,markup_type' });

    // Save broker profile fields
    await supabase
      .from('users')
      .update({
        full_name: broker.full_name,
        broker_company_name: broker.broker_company_name,
        broker_logo_url: broker.broker_logo_url,
        broker_custom_url: broker.broker_custom_url,
      })
      .eq('id', brokerId);

    alert('✅ Broker settings saved successfully!');
    setSaving(false);
  };

  if (loading) return <div className="p-10 text-center">Loading broker...</div>;
  if (!broker) return <div className="p-10">Broker not found</div>;

  return (
    <div className="max-w-3xl mx-auto p-8">
      <button 
        onClick={() => router.push('/brokers')} 
        className="mb-8 text-blue-600 hover:underline flex items-center gap-2"
      >
        ← Back to Brokers
      </button>

      <h1 className="text-3xl font-bold mb-2">{broker.full_name || 'Broker'}</h1>
      <p className="text-gray-600 mb-10">{broker.email}</p>

      <div className="bg-white rounded-3xl border p-10 space-y-12">
        
        {/* Broker Branding */}
        <div>
          <h2 className="text-2xl font-semibold mb-8">Broker Branding (White Label)</h2>
          
          <div className="space-y-8">
            <div>
              <label className="block text-sm font-medium mb-3">Broker Company Name</label>
              <input
                type="text"
                value={broker.broker_company_name || ''}
                onChange={(e) => setBroker({ ...broker, broker_company_name: e.target.value })}
                className="w-full px-5 py-4 border rounded-2xl"
                placeholder="John Smith Mortgage"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-3">Broker Logo</label>
              <div className="border-2 border-dashed border-gray-300 rounded-3xl p-8 text-center">
                {broker.broker_logo_url && (
                  <img src={broker.broker_logo_url} alt="broker logo" className="mx-auto max-h-32 mb-4" />
                )}
                <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" id="broker-logo" />
                <label htmlFor="broker-logo" className="cursor-pointer text-blue-600 font-medium">
                  {uploading ? 'Uploading...' : 'Upload Broker Logo'}
                </label>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-3">Custom Broker URL (optional)</label>
              <input
                type="text"
                value={broker.broker_custom_url || ''}
                onChange={(e) => setBroker({ ...broker, broker_custom_url: e.target.value })}
                className="w-full px-5 py-4 border rounded-2xl"
                placeholder="johnsmith.loans.yourcompany.com"
              />
            </div>
          </div>
        </div>

        {/* Retail Markup */}
        <div>
          <h2 className="text-2xl font-semibold mb-6">Retail Markup (This Broker)</h2>
          <p className="text-gray-500 mb-6">
            This is added on top of the organization's retail markup for clients referred by this broker.
          </p>

          <div>
            <label className="block text-sm font-medium mb-3">Retail Markup (%)</label>
            <input
              type="number"
              step="0.01"
              value={retailMarkup}
              onChange={(e) => setRetailMarkup(parseFloat(e.target.value) || 0)}
              className="w-full px-6 py-5 border rounded-2xl text-2xl font-medium"
            />
          </div>
        </div>

        <button
          onClick={saveBroker}
          disabled={saving}
          className="w-full py-5 bg-green-600 text-white rounded-2xl font-semibold text-lg hover:bg-green-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Broker Settings'}
        </button>
      </div>
    </div>
  );
}
'use client';

import { useState, useEffect } from 'react';
import { createClientComponentClient } from '@/lib/supabase';

export default function PendingBrokersPage() {
  const supabase = createClientComponentClient();
  const [pendingBrokers, setPendingBrokers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPendingBrokers();
  }, []);

  const fetchPendingBrokers = async () => {
    const { data } = await supabase
      .from('pending_brokers')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    setPendingBrokers(data || []);
    setLoading(false);
  };

  const approveBroker = async (id: number) => {
    if (!confirm("Approve this broker?")) return;

    const { error } = await supabase
      .from('pending_brokers')
      .update({ 
        status: 'approved',
        reviewed_at: new Date().toISOString()
      })
      .eq('id', id);

    if (error) {
      alert('Error approving: ' + error.message);
    } else {
      alert('✅ Broker approved!');
      fetchPendingBrokers();
    }
  };

  const rejectBroker = async (id: number) => {
    if (!confirm("Reject this broker?")) return;

    const { error } = await supabase
      .from('pending_brokers')
      .update({ 
        status: 'rejected',
        reviewed_at: new Date().toISOString()
      })
      .eq('id', id);

    if (error) {
      alert('Error rejecting: ' + error.message);
    } else {
      alert('Broker rejected.');
      fetchPendingBrokers();
    }
  };

  if (loading) return <div className="p-10">Loading pending brokers...</div>;

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-8">Pending Broker Applications</h1>

      {pendingBrokers.length === 0 ? (
        <p className="text-gray-500 text-center py-20">No pending broker applications at this time.</p>
      ) : (
        <div className="space-y-6">
          {pendingBrokers.map((broker) => (
            <div key={broker.id} className="bg-white border rounded-3xl p-8">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-2xl font-semibold">{broker.full_name}</h3>
                  <p className="text-gray-600">{broker.email} • {broker.phone}</p>
                  {broker.broker_company_name && (
                    <p className="text-lg font-medium mt-2">{broker.broker_company_name}</p>
                  )}
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => approveBroker(broker.id)}
                    className="px-8 py-3 bg-green-600 text-white rounded-2xl hover:bg-green-700"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => rejectBroker(broker.id)}
                    className="px-8 py-3 bg-red-600 text-white rounded-2xl hover:bg-red-700"
                  >
                    Reject
                  </button>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-2 gap-4 text-sm">
                <div><strong>Experience:</strong> {broker.experience_years || '—'} years</div>
                <div><strong>Est. Volume:</strong> {broker.monthly_volume_estimate || '—'}</div>
                {broker.target_organization_id && (
                  <div className="col-span-2"><strong>Target Organization ID:</strong> {broker.target_organization_id}</div>
                )}
              </div>

              {broker.notes && (
                <div className="mt-6 p-4 bg-gray-50 rounded-2xl">
                  <strong>Notes:</strong> {broker.notes}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
'use client';

import { useState, useEffect } from 'react';
import { createClientComponentClient } from '@/lib/supabase';

export default function AdminOrganizationsPage() {
  const supabase = createClientComponentClient();
  const [pending, setPending] = useState<any[]>([]);

  useEffect(() => {
    fetchPending();
  }, []);

  const fetchPending = async () => {
    const { data } = await supabase
      .from('pending_organizations')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    setPending(data || []);
  };

  const approve = async (id: string) => {
    // TODO: Create Clerk Organization + Supabase record
    alert("Organization approved! (Clerk sync coming soon)");
    fetchPending();
  };

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-8">Pending Organization Applications</h1>
      {pending.map((app) => (
        <div key={app.id} className="bg-white border rounded-3xl p-8 mb-6">
          <h3 className="text-xl font-semibold">{app.company_name}</h3>
          <p className="text-gray-600">{app.contact_name} • {app.email}</p>
          <button onClick={() => approve(app.id)} className="mt-4 px-8 py-3 bg-green-600 text-white rounded-2xl">
            Approve Organization
          </button>
        </div>
      ))}
    </div>
  );
}
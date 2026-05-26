'use client';

import { useState, useEffect } from 'react';
import { useUser } from '@clerk/nextjs';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';

type Broker = {
  id: string;
  full_name?: string;
  email?: string;
  role: string;
  organization_id: string;
  created_at: string;
};

export default function BrokersPage() {
  const { user } = useUser();
  const [brokers, setBrokers] = useState<Broker[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchBrokers();
  }, []);

  async function fetchBrokers() {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .in('role', ['BROKER', 'SENIOR_BROKER', 'JUNIOR_BROKER', 'BROKER_AE'])
      .order('full_name');

    if (error) console.error(error);
    setBrokers(data || []);
    setLoading(false);
  }

  if (loading) return <div className="p-10">Loading brokers...</div>;

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Broker Management</h1>
        <Link href="/brokers/new" className="px-6 py-3 bg-green-600 text-white rounded-2xl hover:bg-green-700">
          + Add New Broker
        </Link>
      </div>

      <div className="bg-white rounded-3xl border">
        <table className="w-full">
          <thead>
            <tr className="border-b">
              <th className="text-left p-6">Broker Name</th>
              <th className="text-left p-6">Email</th>
              <th className="text-left p-6">Role</th>
              <th className="p-6 w-32">Actions</th>
            </tr>
          </thead>
          <tbody>
            {brokers.map((broker) => (
              <tr key={broker.id} className="border-b hover:bg-gray-50">
                <td className="p-6 font-medium">{broker.full_name || 'Unnamed Broker'}</td>
                <td className="p-6 text-gray-600">{broker.email}</td>
                <td className="p-6">
                  <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm">
                    {broker.role.replace('_', ' ')}
                  </span>
                </td>
                <td className="p-6">
                  <Link
                    href={`/brokers/${broker.id}`}
                    className="px-5 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 text-sm"
                  >
                    Edit Markup
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
'use client';

import { useState, useEffect } from 'react';
import { approveOrganization, rejectOrganization } from '@/app/actions/organization-actions';

type PendingOrg = {
  id: string;
  company_name: string;
  contact_name?: string;
  email: string;
  phone?: string;
  website?: string;
  loan_volume_estimate?: string;
  notes?: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
};

export default function AdminApplicationsPage() {
  const [applications, setApplications] = useState<PendingOrg[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchApplications();
  }, []);

  async function fetchApplications() {
    const { supabase } = await import('@/lib/supabase');
    const { data } = await supabase
      .from('pending_organizations')
      .select('*')
      .order('created_at', { ascending: false });
    
    setApplications(data || []);
    setLoading(false);
  }

  const handleApprove = async (id: string) => {
    if (!confirm("Approve this application and create the organization?")) return;
    
    const result = await approveOrganization(id);
    if (result.success) {
      alert('✅ Organization approved and created successfully!');
      fetchApplications();
    } else {
      alert('Error: ' + result.error);
    }
  };

  const handleReject = async (id: string) => {
    if (!confirm("Reject this application?")) return;
    
    const result = await rejectOrganization(id);
    if (result.success) {
      alert('Application rejected');
      fetchApplications();
    }
  };

  if (loading) return <div className="p-10 text-center">Loading applications...</div>;

  return (
    <div className="max-w-7xl mx-auto p-8">
      <h1 className="text-4xl font-bold mb-8">Sales Applications</h1>

      <div className="bg-white rounded-3xl border">
        {applications.map((app) => (
          <div key={app.id} className="p-8 border-b last:border-b-0 flex justify-between items-start">
            <div>
              <h3 className="text-2xl font-semibold">{app.company_name}</h3>
              <p className="text-gray-600 mt-1">{app.contact_name} • {app.email}</p>
              {app.phone && <p>📞 {app.phone}</p>}
              {app.website && <p>🌐 {app.website}</p>}
              {app.loan_volume_estimate && <p>📊 Est. Volume: {app.loan_volume_estimate}</p>}
              {app.notes && <p className="mt-3 text-sm italic">Notes: {app.notes}</p>}
            </div>

            <div className="flex flex-col gap-3 items-end">
              <span className={`px-4 py-1.5 rounded-full text-sm font-medium ${
                app.status === 'approved' ? 'bg-green-100 text-green-700' :
                app.status === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
              }`}>
                {app.status.toUpperCase()}
              </span>

              {app.status === 'pending' && (
                <div className="flex gap-3">
                  <button
                    onClick={() => handleApprove(app.id)}
                    className="px-6 py-2 bg-green-600 text-white rounded-2xl hover:bg-green-700 font-medium"
                  >
                    Approve & Create Org
                  </button>
                  <button
                    onClick={() => handleReject(app.id)}
                    className="px-6 py-2 bg-red-600 text-white rounded-2xl hover:bg-red-700 font-medium"
                  >
                    Reject
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}

        {applications.length === 0 && (
          <p className="p-12 text-center text-gray-500">No applications yet.</p>
        )}
      </div>
    </div>
  );
}
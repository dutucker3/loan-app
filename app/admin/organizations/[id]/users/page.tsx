'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

type OrgUser = {
  id: string;
  email: string;
  full_name?: string;
  role: string;
  created_at: string;
};

export default function OrganizationUsersPage() {
  const { id: orgId } = useParams();
  const router = useRouter();

  const [users, setUsers] = useState<OrgUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [orgName, setOrgName] = useState('');

  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserRole, setNewUserRole] = useState('BROKER_AE');

  useEffect(() => {
    fetchOrganizationAndUsers();
  }, [orgId]);

  async function fetchOrganizationAndUsers() {
    // Get organization name
    const { data: org } = await supabase
      .from('organizations')
      .select('name')
      .eq('id', orgId)
      .single();

    if (org) setOrgName(org.name);

    // Get users (you may need to adjust this based on your users table structure)
    const { data } = await supabase
      .from('users')
      .select('*')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false });

    setUsers(data || []);
    setLoading(false);
  }

  const addUser = async () => {
    if (!newUserEmail) return alert("Email is required");

    const { error } = await supabase
      .from('users')
      .insert({
        email: newUserEmail,
        full_name: newUserEmail.split('@')[0],
        role: newUserRole,
        organization_id: orgId,
      });

    if (error) alert(error.message);
    else {
      alert('User added successfully!');
      setNewUserEmail('');
      fetchOrganizationAndUsers();
    }
  };

  const removeUser = async (userId: string) => {
    if (!confirm("Remove this user from the organization?")) return;

    const { error } = await supabase
      .from('users')
      .delete()
      .eq('id', userId);

    if (error) alert(error.message);
    else fetchOrganizationAndUsers();
  };

  if (loading) return <div>Loading users...</div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold">Users — {orgName}</h1>
          <p className="text-gray-500">Manage team members for this organization</p>
        </div>
        <button
          onClick={() => router.push('/admin/organizations')}
          className="px-6 py-3 border rounded-2xl hover:bg-gray-100"
        >
          ← Back to Organizations
        </button>
      </div>

      {/* Add New User */}
      <div className="bg-white rounded-3xl border p-8 mb-8">
        <h2 className="font-semibold mb-4">Add New User</h2>
        <div className="flex gap-4">
          <input
            type="email"
            value={newUserEmail}
            onChange={(e) => setNewUserEmail(e.target.value)}
            placeholder="user@example.com"
            className="flex-1 px-5 py-3 border rounded-2xl"
          />
          <select
            value={newUserRole}
            onChange={(e) => setNewUserRole(e.target.value)}
            className="px-5 py-3 border rounded-2xl"
          >
            <option value="BROKER_AE">Broker AE</option>
            <option value="ACCOUNT_EXECUTIVE">Account Executive</option>
            <option value="UNDERWRITER">Underwriter</option>
            <option value="LOAN_PROCESSOR">Loan Processor</option>
          </select>
          <button
            onClick={addUser}
            className="px-8 py-3 bg-green-600 text-white rounded-2xl hover:bg-green-700"
          >
            Add User
          </button>
        </div>
      </div>

      {/* Users List */}
      <div className="bg-white rounded-3xl border">
        {users.map((user) => (
          <div key={user.id} className="p-8 border-b last:border-0 flex justify-between items-center">
            <div>
              <p className="font-medium">{user.full_name || user.email}</p>
              <p className="text-sm text-gray-500">{user.email}</p>
            </div>
            <div className="flex items-center gap-6">
              <span className="px-4 py-2 bg-gray-100 rounded-xl text-sm font-medium">
                {user.role.replace(/_/g, ' ')}
              </span>
              <button
                onClick={() => removeUser(user.id)}
                className="text-red-600 hover:text-red-700 font-medium"
              >
                Remove
              </button>
            </div>
          </div>
        ))}

        {users.length === 0 && (
          <p className="p-12 text-center text-gray-500">No users yet. Add the first one above.</p>
        )}
      </div>
    </div>
  );
}
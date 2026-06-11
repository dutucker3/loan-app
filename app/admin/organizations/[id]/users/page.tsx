'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { addUserToOrganization, removeUserFromOrganization, getOrganizationUsers, updateUserInOrganization } from '@/app/actions/organization-actions';

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

  // Edit user state (to avoid delete+recreate flow)
  const [editingUser, setEditingUser] = useState<OrgUser | null>(null);
  const [editFullName, setEditFullName] = useState('');
  const [editRole, setEditRole] = useState('');

  useEffect(() => {
    if (orgId) {
      fetchOrganizationAndUsers();
    } else {
      setLoading(false);
    }
  }, [orgId]);

  async function fetchOrganizationAndUsers() {
    setLoading(true);
    try {
      // Use server action (admin client) so we bypass RLS and SUPER_ADMIN / org admins always see the full team
      const res = await getOrganizationUsers(orgId as string);
      if (res.users) setUsers(res.users);
      if (res.orgName) setOrgName(res.orgName);
    } catch (e) {
      console.error('Failed to load org users:', e);
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }

  const addUser = async () => {
    if (!newUserEmail) return alert("Email is required");
    if (!orgId) return alert("No organization ID");

    try {
      const fullName = newUserEmail.split('@')[0];
      const result = await addUserToOrganization(newUserEmail, fullName, newUserRole, orgId as string);

      if (result.success) {
        const msg = result.tempPassword 
          ? `User added! Temp password: ${result.tempPassword} (tell the user to change it on first login)`
          : 'User added successfully!';
        alert(msg);
        setNewUserEmail('');
        fetchOrganizationAndUsers();
      }
    } catch (err: any) {
      alert('Failed to add user: ' + (err.message || err));
    }
  };

  const removeUser = async (userId: string) => {
    if (!confirm("Remove this user from the organization? (This clears their org membership but does not delete the account.)")) return;

    try {
      await removeUserFromOrganization(userId);
      fetchOrganizationAndUsers();
    } catch (err: any) {
      alert('Failed to remove user: ' + (err.message || err));
    }
  };

  const startEdit = (user: OrgUser) => {
    setEditingUser(user);
    setEditFullName(user.full_name || '');
    setEditRole(user.role);
  };

  const cancelEdit = () => {
    setEditingUser(null);
    setEditFullName('');
    setEditRole('');
  };

  const saveEdit = async () => {
    if (!editingUser || !orgId) return;

    try {
      await updateUserInOrganization(editingUser.id, editFullName || undefined, editRole || undefined);
      alert('User updated successfully!');
      setEditingUser(null);
      setEditFullName('');
      setEditRole('');
      fetchOrganizationAndUsers();
    } catch (err: any) {
      alert('Failed to update user: ' + (err.message || err));
    }
  };

  if (loading) return <div>Loading users...</div>;

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold">Users — {orgName}</h1>
          <p className="text-gray-500">Manage team members for this organization</p>
        </div>
        <button
          onClick={() => router.push(`/admin/organizations/${orgId}`)}
          className="px-6 py-3 border rounded-2xl hover:bg-gray-100"
        >
          ← Back to Organization
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
            <option value="PENDING">Pending (applicant)</option>
            <option value="BROKER_AE">Broker AE</option>
            <option value="ACCOUNT_EXECUTIVE">Account Executive</option>
            <option value="UNDERWRITER">Underwriter</option>
            <option value="LOAN_PROCESSOR">Loan Processor</option>
            <option value="TECH_SUPPORT">Tech Support</option>
            <option value="ADMIN">Admin</option>
            <option value="ORG_ADMIN">Org Admin (L1 + subtree)</option>
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
            {editingUser?.id === user.id ? (
              // Edit mode - inline form (name + role)
              <div className="flex-1 flex flex-col md:flex-row gap-3 items-center">
                <input
                  type="text"
                  value={editFullName}
                  onChange={(e) => setEditFullName(e.target.value)}
                  placeholder="Full name"
                  className="flex-1 px-4 py-2 border rounded-2xl"
                />
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value)}
                  className="px-4 py-2 border rounded-2xl"
                >
                  <option value="PENDING">Pending (applicant)</option>
                  <option value="BROKER_AE">Broker AE</option>
                  <option value="ACCOUNT_EXECUTIVE">Account Executive</option>
                  <option value="UNDERWRITER">Underwriter</option>
                  <option value="LOAN_PROCESSOR">Loan Processor</option>
                  <option value="TECH_SUPPORT">Tech Support</option>
                  <option value="ADMIN">Admin</option>
                  <option value="ORG_ADMIN">Org Admin (L1 + subtree)</option>
                </select>
                <div className="flex gap-2">
                  <button
                    onClick={saveEdit}
                    className="px-5 py-2 bg-blue-600 text-white rounded-2xl hover:bg-blue-700 text-sm"
                  >
                    Save
                  </button>
                  <button
                    onClick={cancelEdit}
                    className="px-5 py-2 border rounded-2xl hover:bg-gray-50 text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <p className="font-medium">{user.full_name || user.email}</p>
                <p className="text-sm text-gray-500">{user.email}</p>
              </div>
            )}

            {editingUser?.id !== user.id && (
              <div className="flex items-center gap-6">
                <span className="px-4 py-2 bg-gray-100 rounded-xl text-sm font-medium">
                  {user.role.replace(/_/g, ' ')}
                </span>
                <button
                  onClick={() => startEdit(user)}
                  className="text-blue-600 hover:text-blue-700 font-medium"
                >
                  Edit
                </button>
                <button
                  onClick={() => removeUser(user.id)}
                  className="text-red-600 hover:text-red-700 font-medium"
                >
                  Remove
                </button>
              </div>
            )}
          </div>
        ))}

        {users.length === 0 && (
          <p className="p-12 text-center text-gray-500">No users yet. Add the first one above.</p>
        )}
      </div>
    </div>
  );
}
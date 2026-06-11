'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import * as XLSX from 'xlsx';
import { logAudit } from '@/lib/audit';
import {
  sendAEProspectInvite,
  addUserToOrganization,
  ensureUserInOrg,
} from '@/app/actions/organization-actions';

export default function AdminUsersPage() {
  const router = useRouter();

  const [sbUser, setSbUser] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserRole, setCurrentUserRole] = useState<string>('BROKER_AE');
  const [currentUserOrgId, setCurrentUserOrgId] = useState<string | null>(null);
  const [currentUserParentId, setCurrentUserParentId] = useState<string | null>(null);

  // Add user form
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserRole, setNewUserRole] = useState('BROKER_AE');
  const [selectedParentIdForJunior, setSelectedParentIdForJunior] = useState('');

  // Edit
  const [editingUser, setEditingUser] = useState<any>(null);
  const [editEmail, setEditEmail] = useState('');
  const [editRole, setEditRole] = useState('');

  // AE invite
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');

  // Hierarchy
  const [seniorAEs, setSeniorAEs] = useState<any[]>([]);
  const [aeJuniors, setAeJuniors] = useState<any[]>([]);
  const [aeChildBrokers, setAeChildBrokers] = useState<any[]>([]);

  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  useEffect(() => {
    async function loadUser() {
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!u) {
        router.push('/sign-in');
        return;
      }
      setSbUser(u);
      try {
        let { data: prof } = await supabase
          .from('profiles')
          .select('role, organization_id')
          .eq('id', u.id)
          .maybeSingle();
        let role = prof?.role || 'BROKER_AE';
        let orgId = prof?.organization_id || null;
        let parentId = null; // parent_id not selected to avoid 400 errors (column may not be present on profiles)

        if (!orgId) {
          const { data: urow } = await supabase.from('users').select('role, organization_id').eq('id', u.id).maybeSingle();
          if (urow) {
            role = urow.role || role;
            orgId = urow.organization_id || orgId;
            // parentId remains null
          }
        }

        setCurrentUserRole(role);
        setCurrentUserOrgId(orgId);
        setCurrentUserParentId(parentId);
        setIsSuperAdmin(role === 'SUPER_ADMIN');

        // Load hierarchy data similar to dashboard
        await loadHierarchy(u.id, role, orgId, parentId);
      } catch (e) {
        console.error('User load error', e);
      }
    }
    loadUser();
  }, [router]);

  async function loadHierarchy(userId: string, role: string, orgId: string | null, parentId: string | null) {
    try {
      // Seniors
      const { data: seniorsData } = await supabase
        .from('profiles')
        .select('id, full_name, email, role')
        .eq('role', 'SENIOR_ACCOUNT_EXECUTIVE')
        .order('created_at', { ascending: false });
      setSeniorAEs(seniorsData || []);

      if (role === 'SENIOR_ACCOUNT_EXECUTIVE' || role === 'ACCOUNT_EXECUTIVE') {
        // Load all users in the org as team (parent_id select avoided to prevent 400; hierarchy simplified)
        if (orgId) {
          const { data: orgUsers } = await supabase
            .from('profiles')
            .select('id, full_name, email, role')
            .eq('organization_id', orgId);
          setAeJuniors((orgUsers || []).filter((u: any) => ['ACCOUNT_EXECUTIVE', 'JUNIOR_BROKER'].includes(u.role)));
          setAeChildBrokers((orgUsers || []).filter((u: any) => ['BROKER_AE', 'SENIOR_BROKER', 'JUNIOR_BROKER'].includes(u.role)));
        }
      }
    } catch (e) {
      console.warn('Hierarchy load failed', e);
    }
  }

  async function loadUsers() {
    setLoading(true);
    try {
      let query = supabase.from('profiles').select('*').order('created_at', { ascending: false });

      if (currentUserOrgId && currentUserRole !== 'SUPER_ADMIN') {
        query = query.eq('organization_id', currentUserOrgId);
      }
      // For AE, further scope could be added here using aeChildBrokers etc.

      const { data } = await query;
      setUsers(data || []);
    } catch (e) {
      console.error('Load users error', e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (currentUserOrgId || isSuperAdmin) {
      loadUsers();
    }
  }, [currentUserOrgId, currentUserRole, isSuperAdmin]);

  const addNewUser = async () => {
    if (!newUserEmail) return alert('Email required');
    try {
      await addUserToOrganization(newUserEmail.trim(), newUserRole, currentUserOrgId, sbUser?.id, selectedParentIdForJunior || undefined);
      alert('User added / invited.');
      setNewUserEmail('');
      setNewUserRole('BROKER_AE');
      setSelectedParentIdForJunior('');
      loadUsers();
    } catch (e: any) {
      alert('Failed to add user: ' + (e.message || e));
    }
  };

  const startEdit = (u: any) => {
    setEditingUser(u);
    setEditEmail(u.email || '');
    setEditRole(u.role || '');
  };

  const saveEdit = async () => {
    if (!editingUser) return;
    try {
      await supabase.from('profiles').update({ email: editEmail, role: editRole }).eq('id', editingUser.id);
      // Also update legacy if needed, but profiles primary
      alert('User updated.');
      setEditingUser(null);
      setEditEmail('');
      setEditRole('');
      loadUsers();
    } catch (e: any) {
      alert('Update failed: ' + (e.message || e));
    }
  };

  const deleteUser = async (userId: string) => {
    if (!isSuperAdmin) return alert('Only Super Admin can delete users.');
    if (!confirm('Delete this user (auth + profile)?')) return;
    try {
      const { fullDeleteUser } = await import('@/app/actions/organization-actions');
      await fullDeleteUser(userId, sbUser?.id);
      alert('User deleted.');
      loadUsers();
    } catch (e: any) {
      alert('Delete failed: ' + (e.message || e));
    }
  };

  const handleAEInvite = async () => {
    if (!inviteEmail) return alert('Email required for invite');
    try {
      await sendAEProspectInvite(inviteEmail.trim(), inviteName.trim() || undefined, sbUser?.id, currentUserOrgId);
      alert('Invite sent (apply link emailed).');
      setInviteName('');
      setInviteEmail('');
    } catch (e: any) {
      alert('Invite failed: ' + (e.message || e));
    }
  };

  // Simple bulk template (reuse logic, simplified)
  const downloadBulkUserTemplate = () => {
    const wsData = [
      ['Email*', 'Full Name', 'Role*'],
      ['example@co.com', 'Example User', 'BROKER_AE'],
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Users');
    XLSX.writeFile(wb, 'bulk-users-template.xlsx');
  };

  const handleBulkUserUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json: any[] = XLSX.utils.sheet_to_json(ws);
      for (const row of json) {
        if (row['Email*']) {
          await addUserToOrganization(row['Email*'].trim(), row['Role*'] || 'BROKER_AE', currentUserOrgId, sbUser?.id);
        }
      }
      alert('Bulk users processed.');
      loadUsers();
    } catch (err: any) {
      alert('Bulk upload error: ' + (err.message || err));
    } finally {
      e.target.value = '';
    }
  };

  if (loading) return <div className="p-10">Loading users...</div>;

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Users Management</h1>
        <p className="text-gray-500">Full management for your organization and all sub-users / hierarchy.</p>
      </div>

      {/* AE Referral */}
      {(currentUserRole === 'SENIOR_ACCOUNT_EXECUTIVE' || currentUserRole === 'ACCOUNT_EXECUTIVE') && (
        <div className="bg-indigo-50 border border-indigo-200 p-6 rounded-2xl mb-8">
          <h3 className="font-medium mb-2 text-indigo-900">AE Referral Invite (name + email only)</h3>
          <div className="flex gap-4 flex-wrap">
            <input type="text" value={inviteName} onChange={e => setInviteName(e.target.value)} placeholder="Prospect Name (opt)" className="flex-1 px-4 py-3 border rounded-2xl bg-white" />
            <input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="prospect@company.com *" className="flex-1 px-4 py-3 border rounded-2xl bg-white" />
            <button onClick={handleAEInvite} className="px-8 py-3 bg-indigo-600 text-white rounded-2xl hover:bg-indigo-700">Send Apply Link</button>
          </div>
        </div>
      )}

      {/* AE Hierarchy summary */}
      {(aeJuniors.length > 0 || aeChildBrokers.length > 0) && (
        <div className="bg-white border p-4 rounded-2xl mb-6 text-sm">
          <div className="font-medium mb-1">Your AE Hierarchy</div>
          {aeJuniors.length > 0 && <div>Juniors: {aeJuniors.map(j => j.full_name || j.email).join(', ')}</div>}
          {aeChildBrokers.length > 0 && <div>Child brokers: {aeChildBrokers.map(b => b.full_name || b.email).join(', ')}</div>}
        </div>
      )}

      {/* Add User */}
      <div className="bg-gray-50 p-6 rounded-2xl mb-8">
        <h3 className="font-medium mb-4">Add New User</h3>
        <div className="flex gap-4 flex-wrap">
          <input type="email" value={newUserEmail} onChange={e => setNewUserEmail(e.target.value)} placeholder="user@example.com" className="flex-1 min-w-[280px] px-4 py-3 border rounded-2xl" />
          <select value={newUserRole} onChange={e => setNewUserRole(e.target.value)} className="px-4 py-3 border rounded-2xl min-w-[200px]">
            {['PENDING', 'BROKER_AE', 'SENIOR_BROKER', 'JUNIOR_BROKER', 'ACCOUNT_EXECUTIVE', 'SENIOR_ACCOUNT_EXECUTIVE', 'LOAN_PROCESSOR', 'LOAN_UNDERWRITER', 'TECH_SUPPORT', 'ADMIN', 'ORG_ADMIN'].map(r => (
              <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
            ))}
          </select>
          {newUserRole === 'ACCOUNT_EXECUTIVE' && seniorAEs.length > 0 && (
            <select value={selectedParentIdForJunior} onChange={e => setSelectedParentIdForJunior(e.target.value)} className="px-4 py-3 border rounded-2xl min-w-[220px] bg-amber-50 text-sm">
              <option value="">Select Senior AE parent...</option>
              {seniorAEs.map(s => <option key={s.id} value={s.id}>{s.full_name || s.email}</option>)}
            </select>
          )}
          <button onClick={addNewUser} className="px-8 py-3 bg-green-600 text-white rounded-2xl hover:bg-green-700">Add User</button>
        </div>

        <div className="mt-4 pt-4 border-t flex flex-wrap items-center gap-3">
          <button onClick={downloadBulkUserTemplate} className="px-4 py-2 text-sm border border-blue-300 text-blue-700 rounded-xl hover:bg-blue-50">Download XLS Template</button>
          <label className="px-4 py-2 text-sm bg-blue-600 text-white rounded-xl cursor-pointer hover:bg-blue-700 inline-flex items-center gap-2">
            Upload Filled XLS
            <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleBulkUserUpload} />
          </label>
          <span className="text-xs text-gray-500">Bulk add users via template.</span>
        </div>
      </div>

      {/* Edit Modal */}
      {editingUser && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-white rounded-3xl p-8 w-full max-w-md">
            <h3 className="text-xl font-semibold mb-6">Edit User</h3>
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium mb-2">Email</label>
                <input type="email" value={editEmail} onChange={e => setEditEmail(e.target.value)} className="w-full px-4 py-3 border rounded-2xl" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Role</label>
                <select value={editRole} onChange={e => setEditRole(e.target.value)} className="w-full px-4 py-3 border rounded-2xl">
                  {['PENDING', 'BROKER_AE', 'SENIOR_BROKER', 'JUNIOR_BROKER', 'ACCOUNT_EXECUTIVE', 'SENIOR_ACCOUNT_EXECUTIVE', 'LOAN_PROCESSOR', 'LOAN_UNDERWRITER', 'TECH_SUPPORT', 'ADMIN'].map(r => (
                    <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-3 mt-8">
              <button onClick={saveEdit} className="flex-1 py-3 bg-blue-600 text-white rounded-2xl hover:bg-blue-700">Save</button>
              <button onClick={() => { setEditingUser(null); setEditEmail(''); setEditRole(''); }} className="flex-1 py-3 bg-gray-200 rounded-2xl">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Users List */}
      <div className="bg-white rounded-3xl border p-8">
        <h3 className="text-xl font-semibold mb-4">All Users in Org + Subs</h3>
        <div className="divide-y">
          {users.length === 0 ? (
            <p className="text-gray-500 py-8 text-center">No users found.</p>
          ) : (
            users.map((u: any) => (
              <div key={u.id} className="py-6 flex justify-between items-center">
                <div>
                  <div className="font-medium">{u.full_name || u.email}</div>
                  <div className="text-sm text-gray-500">{u.email} • {u.role}</div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="font-mono text-sm bg-gray-100 px-4 py-1.5 rounded-xl">{u.role}</span>
                  <button onClick={() => startEdit(u)} className="text-blue-600 hover:text-blue-700 px-4 py-1 font-medium">Edit</button>
                  {isSuperAdmin && (
                    <button onClick={() => deleteUser(u.id)} className="text-red-600 hover:text-red-700 px-4 py-1 font-medium">Delete</button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <p className="mt-6 text-xs text-gray-500">Scoped to your organization and sub-users per hierarchy. Full management for ORG_ADMIN / admins.</p>
    </div>
  );
}

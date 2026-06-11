'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function WholesaleUsersPage() {
  const router = useRouter();
  const [sbUser, setSbUser] = useState<any>(null);
  const [userRole, setUserRole] = useState<string>('');
  const [userOrgId, setUserOrgId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [childOrgs, setChildOrgs] = useState<any[]>([]);
  const [orgUsersMap, setOrgUsersMap] = useState<Record<string, any[]>>({});
  const [editingUser, setEditingUser] = useState<any>(null);
  const [editRole, setEditRole] = useState('');

  useEffect(() => {
    async function loadUserAndData() {
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
        let role = prof?.role || '';
        let orgId = prof?.organization_id || null;
        if (!orgId) {
          const { data: urow } = await supabase.from('users').select('role, organization_id').eq('id', u.id).maybeSingle();
          if (urow) {
            role = urow.role || role;
            orgId = urow.organization_id || orgId;
          }
        }
        setUserRole(role);
        setUserOrgId(orgId);

        if (orgId) {
          // Fetch child organizations (wholesale / sub orgs managed by this AE's org)
          const { data: children } = await supabase
            .from('organizations')
            .select('*')
            .eq('parent_organization_id', orgId)
            .order('created_at', { ascending: false });
          setChildOrgs(children || []);

          // For each child, load users
          const usersMap: Record<string, any[]> = {};
          for (const child of (children || [])) {
            const { data: users } = await supabase
              .from('profiles')
              .select('id, email, full_name, role, created_at')
              .eq('organization_id', child.id)
              .order('created_at', { ascending: false });
            usersMap[child.id] = users || [];
          }
          setOrgUsersMap(usersMap);
        }
      } catch (e) {
        console.error('Load wholesale data error', e);
      } finally {
        setLoading(false);
      }
    }
    loadUserAndData();
  }, [router]);

  const startEditUser = (u: any) => {
    setEditingUser(u);
    setEditRole(u.role || '');
  };

  const saveUserEdit = async () => {
    if (!editingUser) return;
    try {
      await supabase.from('profiles').update({ role: editRole }).eq('id', editingUser.id);
      alert('User role updated.');
      // Refresh the map
      setOrgUsersMap(prev => {
        const newMap = { ...prev };
        for (const orgId in newMap) {
          newMap[orgId] = newMap[orgId].map((u: any) => u.id === editingUser.id ? { ...u, role: editRole } : u);
        }
        return newMap;
      });
      setEditingUser(null);
      setEditRole('');
    } catch (e: any) {
      alert('Update failed: ' + (e.message || e));
    }
  };

  const updateOrgInfo = async (orgId: string, field: string, value: any) => {
    try {
      await supabase.from('organizations').update({ [field]: value }).eq('id', orgId);
      alert('Organization updated.');
      // Refresh child orgs
      const { data: children } = await supabase
        .from('organizations')
        .select('*')
        .eq('parent_organization_id', userOrgId)
        .order('created_at', { ascending: false });
      setChildOrgs(children || []);
    } catch (e: any) {
      alert('Update failed: ' + (e.message || e));
    }
  };

  if (loading) return <div className="p-10 text-center">Loading wholesale users...</div>;

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Sidebar - same layout as /admin/page */}
      <div className="w-64 bg-white border-r p-6 flex flex-col">
        <div className="mb-10">
          <h1 className="text-2xl font-bold text-blue-600">Wholesale Users</h1>
          <p className="text-sm text-gray-500">AE Management Portal</p>
        </div>

        <nav className="flex-1 space-y-2">
          <Link href="/dashboard" className="block px-4 py-3 rounded-2xl font-medium hover:bg-gray-100">
            ← Back to Dashboard
          </Link>
          <Link href="/wholesaleusers" className="block px-4 py-3 rounded-2xl font-medium bg-blue-600 text-white">
            Manage Wholesale Users
          </Link>
          <Link href="/admin" className="block px-4 py-3 rounded-2xl font-medium hover:bg-gray-100">
            Admin Portal
          </Link>
        </nav>

        <div className="mt-auto pt-6 border-t text-xs text-gray-500">
          Manage child orgs and their users. Changes are audited.
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 p-8 max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold">Manage Wholesale Users</h1>
          <p className="text-gray-500">List of all child organizations and their users. You can manage users (roles) and basic org info.</p>
          <p className="text-sm text-gray-400 mt-1">Current Org: {userOrgId}</p>
        </div>

        {childOrgs.length === 0 ? (
          <div className="bg-white rounded-3xl border p-8 text-center text-gray-500">
            No child organizations found under your org.
          </div>
        ) : (
          childOrgs.map((org: any) => (
            <div key={org.id} className="bg-white rounded-3xl border p-8 mb-8">
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h2 className="text-2xl font-semibold">{org.name}</h2>
                  <p className="text-sm text-gray-500">ID: {org.id} • Domain: {org.domain || '—'}</p>
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={() => {
                      const newDomain = prompt('New domain for this org?', org.domain || '');
                      if (newDomain !== null) updateOrgInfo(org.id, 'domain', newDomain || null);
                    }}
                    className="px-4 py-2 text-sm border rounded-2xl hover:bg-gray-50"
                  >
                    Edit Domain
                  </button>
                  <button 
                    onClick={() => {
                      const newEmail = prompt('New from email for this org?', org.from_email || '');
                      if (newEmail !== null) updateOrgInfo(org.id, 'from_email', newEmail || null);
                    }}
                    className="px-4 py-2 text-sm border rounded-2xl hover:bg-gray-50"
                  >
                    Edit From Email
                  </button>
                </div>
              </div>

              <h3 className="font-medium mb-3">Users in this organization ({(orgUsersMap[org.id] || []).length})</h3>
              <div className="divide-y">
                {(orgUsersMap[org.id] || []).length === 0 ? (
                  <p className="text-gray-500 py-4">No users in this org yet.</p>
                ) : (
                  (orgUsersMap[org.id] || []).map((u: any) => (
                    <div key={u.id} className="py-4 flex justify-between items-center">
                      <div>
                        <div className="font-medium">{u.full_name || u.email}</div>
                        <div className="text-sm text-gray-500">{u.email} • {u.role}</div>
                      </div>
                      <div>
                        <button onClick={() => startEditUser(u)} className="px-4 py-1 text-sm text-blue-600 border border-blue-200 rounded-xl hover:bg-blue-50">Edit Role</button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          ))
        )}

        {/* Edit User Modal */}
        {editingUser && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
            <div className="bg-white rounded-3xl p-8 w-full max-w-md">
              <h3 className="text-xl font-semibold mb-6">Edit User Role</h3>
              <div>
                <label className="block text-sm font-medium mb-2">Role for {editingUser.email}</label>
                <select value={editRole} onChange={(e) => setEditRole(e.target.value)} className="w-full px-4 py-3 border rounded-2xl">
                  {['PENDING', 'BROKER_AE', 'SENIOR_BROKER', 'JUNIOR_BROKER', 'ACCOUNT_EXECUTIVE', 'SENIOR_ACCOUNT_EXECUTIVE', 'LOAN_PROCESSOR', 'LOAN_UNDERWRITER', 'TECH_SUPPORT', 'ADMIN', 'ORG_ADMIN'].map(r => (
                    <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-3 mt-8">
                <button onClick={saveUserEdit} className="flex-1 py-3 bg-blue-600 text-white rounded-2xl hover:bg-blue-700">Save Role</button>
                <button onClick={() => { setEditingUser(null); setEditRole(''); }} className="flex-1 py-3 bg-gray-200 rounded-2xl hover:bg-gray-300">Cancel</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

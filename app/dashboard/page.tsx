'use client';

import { useState, useEffect } from 'react';
import { useUser, useClerk } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import Image from 'next/image';

const loanStatuses = [
  'Processing', 'Underwriting', 'Clear to Close', 
  'Closed and Funded', 'On Hold', 'Rejected'
];

export default function DashboardPage() {
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();
  const router = useRouter();

  const [activeLoans, setActiveLoans] = useState<any[]>([]);
  const [closedLoans, setClosedLoans] = useState<any[]>([]);
  const [applications, setApplications] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserRole, setCurrentUserRole] = useState<string>('BROKER_AE');

  const [activeTab, setActiveTab] = useState<'start' | 'price' | 'applications' | 'inprocess' | 'active' | 'closed' | 'users'>('start');

  // Users management state
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserRole, setNewUserRole] = useState('BROKER_AE');
  const [editingUser, setEditingUser] = useState<any>(null);
  const [editEmail, setEditEmail] = useState('');
  const [editRole, setEditRole] = useState('');

  const isSuperAdmin = currentUserRole === 'SUPER_ADMIN';
  const isLendingSupervisor = currentUserRole === 'LENDING_SUPERVISOR';
  const isSeniorAE = currentUserRole === 'SENIOR_AE';
  const isAE = currentUserRole === 'ACCOUNT_EXECUTIVE';
  const isBroker = currentUserRole === 'BROKER_AE';

  const canAddUser = isSuperAdmin || isSeniorAE || isAE || isBroker;
  const canEditUser = isSuperAdmin || isLendingSupervisor || isSeniorAE;

  const getAllowedRoles = () => {
    if (isSuperAdmin) return ['SUPER_ADMIN', 'LENDING_SUPERVISOR', 'UNDERWRITER', 'SENIOR_AE', 'ACCOUNT_EXECUTIVE', 'LOAN_PROCESSOR', 'BROKER_AE'];
    if (isSeniorAE) return ['ACCOUNT_EXECUTIVE', 'BROKER_AE'];
    if (isAE) return ['BROKER_AE'];
    if (isBroker) return ['BROKER_AE'];
    return [];
  };

  useEffect(() => {
    if (!isLoaded) return;
    if (!user) {
      router.push('/sign-in');
      return;
    }

    async function loadAllData() {
      if (!user) return;

      const { data: userData } = await supabase
        .from('users')
        .select('role')
        .eq('id', user.id)
        .single();

      const role = userData?.role || 'BROKER_AE';
      setCurrentUserRole(role);

      const { data: loansData } = await supabase
        .from('loans')
        .select('*')
        .order('created_at', { ascending: false });

      const active = loansData?.filter(l => 
        ['Processing', 'Underwriting', 'Clear to Close'].includes(l.loan_status || 'Processing')
      ) || [];
      const closed = loansData?.filter(l => 
        ['Closed and Funded', 'On Hold', 'Rejected'].includes(l.loan_status || '')
      ) || [];

      setActiveLoans(active);
      setClosedLoans(closed);

      const { data: appData } = await supabase
        .from('loan_applications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      setApplications(appData || []);

      if (isSuperAdmin || isLendingSupervisor || isSeniorAE || isAE || isBroker) {
        const { data: usersData } = await supabase
          .from('users')
          .select('*')
          .order('created_at', { ascending: false });
        setUsers(usersData || []);
      }

      setLoading(false);
    }

    loadAllData();
  }, [isLoaded, user, router]);

 const handleLogout = () => {
  signOut({ redirectUrl: '/' });   // Go to home page instead of /sign-in
};

  const addNewUser = async () => {
    if (!newUserEmail.trim()) return;
    const allowedRoles = getAllowedRoles();
    if (!allowedRoles.includes(newUserRole)) {
      alert("You are not allowed to add this role.");
      return;
    }

    const { error } = await supabase
      .from('users')
      .insert({
        id: 'clerk_' + Date.now(),
        email: newUserEmail.trim(),
        full_name: newUserEmail.split('@')[0],
        role: newUserRole,
        parent_id: user?.id,
      });

    if (error) alert('Failed to add user: ' + error.message);
    else {
      alert('User added successfully!');
      setNewUserEmail('');
      window.location.reload();
    }
  };

  const startEdit = (u: any) => {
    if (!canEditUser) {
      alert("You don't have permission to edit users.");
      return;
    }
    setEditingUser(u);
    setEditEmail(u.email || '');
    setEditRole(u.role || 'BROKER_AE');
  };

  const saveEdit = async () => {
    if (!editingUser) return;

    const { error } = await supabase
      .from('users')
      .update({
        email: editEmail,
        role: editRole,
        updated_at: new Date().toISOString()
      })
      .eq('id', editingUser.id);

    if (error) alert('Failed to update user: ' + error.message);
    else {
      alert('User updated successfully!');
      setEditingUser(null);
      setEditEmail('');
      setEditRole('');
      window.location.reload();
    }
  };

  const deleteUser = async (userId: string) => {
    if (!isSuperAdmin) {
      alert("Only Super Admin can delete users.");
      return;
    }
    if (!confirm("Are you sure you want to delete this user?")) return;

    const { error } = await supabase
      .from('users')
      .delete()
      .eq('id', userId);

    if (error) alert('Failed to delete user: ' + error.message);
    else {
      alert('User deleted successfully!');
      window.location.reload();
    }
  };

  if (!isLoaded || loading) return <div className="p-8 text-center">Loading dashboard...</div>;

  const drafts = applications.filter(a => a.status === 'draft');
  const inProcess = applications.filter(a => ['submitted', 'priced', 'in_process'].includes(a.status || ''));

  return (
    <div className="max-w-7xl mx-auto p-8">
      {/* Header with Profile Picture */}
      <div className="flex justify-between items-center mb-10 border-b pb-6">
        <div className="flex items-center gap-4">
          {user?.imageUrl && (
            <Image 
              src={user.imageUrl} 
              alt="Profile" 
              width={64} 
              height={64} 
              className="rounded-full border-2 border-gray-200"
            />
          )}
          <div>
            <h1 className="text-4xl font-bold">Dashboard</h1>
            <p className="text-gray-600">
              Welcome back, <span className="font-medium">
                {user?.fullName || user?.primaryEmailAddress?.emailAddress || 'User'}
              </span>
            </p>
            <p className="text-sm text-gray-500">Role: <span className="font-medium">{currentUserRole}</span></p>
          </div>
        </div>

        <button
          onClick={handleLogout}
          className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-2xl font-medium transition-colors"
        >
          Logout
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b mb-8 gap-2 flex-wrap">
        <button onClick={() => setActiveTab('start')} className={`px-8 py-4 font-medium ${activeTab === 'start' ? 'border-b-4 border-blue-600 text-blue-600' : 'text-gray-600 hover:text-gray-900'}`}>Start New Application</button>
        <button onClick={() => setActiveTab('price')} className={`px-8 py-4 font-medium ${activeTab === 'price' ? 'border-b-4 border-blue-600 text-blue-600' : 'text-gray-600 hover:text-gray-900'}`}>Price a Loan</button>
        <button onClick={() => setActiveTab('applications')} className={`px-8 py-4 font-medium ${activeTab === 'applications' ? 'border-b-4 border-blue-600 text-blue-600' : 'text-gray-600 hover:text-gray-900'}`}>Applications ({drafts.length})</button>
        <button onClick={() => setActiveTab('inprocess')} className={`px-8 py-4 font-medium ${activeTab === 'inprocess' ? 'border-b-4 border-blue-600 text-blue-600' : 'text-gray-600 hover:text-gray-900'}`}>Loans in Process ({inProcess.length})</button>
        <button onClick={() => setActiveTab('active')} className={`px-8 py-4 font-medium ${activeTab === 'active' ? 'border-b-4 border-blue-600 text-blue-600' : 'text-gray-600 hover:text-gray-900'}`}>Active Loans ({activeLoans.length})</button>
        <button onClick={() => setActiveTab('closed')} className={`px-8 py-4 font-medium ${activeTab === 'closed' ? 'border-b-4 border-blue-600 text-blue-600' : 'text-gray-600 hover:text-gray-900'}`}>Closed Loans ({closedLoans.length})</button>
        {(isSuperAdmin || isLendingSupervisor || isSeniorAE || isAE || isBroker) && (
          <button onClick={() => setActiveTab('users')} className={`px-8 py-4 font-medium ${activeTab === 'users' ? 'border-b-4 border-blue-600 text-blue-600' : 'text-gray-600 hover:text-gray-900'}`}>Users Management</button>
        )}
      </div>

      {/* Tab Content */}
      {activeTab === 'start' && (
        <div className="text-center py-20">
          <button onClick={() => router.push('/loan-application')} className="px-12 py-6 bg-blue-600 text-white text-2xl rounded-3xl hover:bg-blue-700">Start New Application →</button>
        </div>
      )}

      {activeTab === 'price' && (
        <div className="text-center py-20">
          <button onClick={() => router.push('/loans/new')} className="px-12 py-6 bg-blue-600 text-white text-2xl rounded-3xl hover:bg-blue-700">Go to Pricing Tool →</button>
        </div>
      )}

      {activeTab === 'applications' && (
        <div>
          <h2 className="text-2xl font-semibold mb-6">Draft Applications</h2>
          {drafts.length === 0 ? <p className="text-gray-500">No draft applications yet.</p> : (
            drafts.map(app => (
              <div key={app.id} className="border rounded-3xl p-6 mb-4 flex justify-between items-center">
                <div>
                  <p className="font-medium">{app.form_data?.propertyAddress || 'Untitled Property'}</p>
                  <p className="text-sm text-gray-500">{new Date(app.created_at).toLocaleDateString()}</p>
                </div>
                <button onClick={() => router.push(`/loan-application?edit=${app.id}`)} className="px-8 py-3 border border-blue-600 text-blue-600 rounded-2xl">Continue Editing</button>
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === 'inprocess' && (
        <div>
          <h2 className="text-2xl font-semibold mb-6">Loans in Process</h2>
          {inProcess.length === 0 ? <p className="text-gray-500">No loans in process yet.</p> : (
            inProcess.map(app => (
              <div key={app.id} className="border rounded-3xl p-6 mb-4 flex justify-between items-center">
                <div>
                  <p className="font-medium">{app.form_data?.propertyAddress || 'Untitled Property'}</p>
                  <p className="text-sm text-gray-500 capitalize">Status: {app.status}</p>
                </div>
                <button onClick={() => router.push(`/loans/new?id=${app.id}`)} className="px-8 py-3 bg-blue-600 text-white rounded-2xl">View Pricing</button>
              </div>
            ))
          )}
        </div>
      )}

      {(activeTab === 'active' || activeTab === 'closed') && (
        <div className="bg-white rounded-3xl shadow-sm border divide-y">
          {(activeTab === 'active' ? activeLoans : closedLoans).map((loan) => (
            <div key={loan.id} className="p-8 hover:bg-gray-50 flex justify-between items-center group cursor-pointer" onClick={() => router.push(`/loans/${loan.id}`)}>
              <div>
                <div className="font-semibold text-xl">Loan #{loan.id}</div>
                <div className="text-gray-600 mt-1">{loan.property_address || 'No address'}</div>
              </div>
              <div className="flex items-center gap-6">
                <select defaultValue={loan.loan_status || 'Processing'} onClick={(e) => e.stopPropagation()} className="bg-white border border-gray-300 rounded-xl px-4 py-2 text-sm">
                  {loanStatuses.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <div className="opacity-0 group-hover:opacity-100 text-blue-600 font-medium">View Details →</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'users' && (
        <div className="bg-white rounded-3xl border p-8">
          <h2 className="text-2xl font-semibold mb-6">Users Management</h2>

          {canAddUser && (
            <div className="bg-gray-50 p-6 rounded-2xl mb-8">
              <h3 className="font-medium mb-4">Add New User</h3>
              <div className="flex gap-4 flex-wrap">
                <input 
                  type="email" 
                  value={newUserEmail} 
                  onChange={(e) => setNewUserEmail(e.target.value)} 
                  placeholder="user@example.com" 
                  className="flex-1 min-w-[280px] px-4 py-3 border rounded-2xl" 
                />
                <select 
                  value={newUserRole} 
                  onChange={(e) => setNewUserRole(e.target.value)} 
                  className="px-4 py-3 border rounded-2xl min-w-[200px]"
                >
                  {getAllowedRoles().map(role => (
                    <option key={role} value={role}>{role.replace(/_/g, ' ')}</option>
                  ))}
                </select>
                <button onClick={addNewUser} className="px-8 py-3 bg-green-600 text-white rounded-2xl hover:bg-green-700">Add User</button>
              </div>
            </div>
          )}

          {editingUser && (
            <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
              <div className="bg-white rounded-3xl p-8 w-full max-w-md">
                <h3 className="text-xl font-semibold mb-6">Edit User</h3>
                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium mb-2">Email Address</label>
                    <input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} className="w-full px-4 py-3 border rounded-2xl focus:outline-none focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Role</label>
                    <select value={editRole} onChange={(e) => setEditRole(e.target.value)} className="w-full px-4 py-3 border rounded-2xl focus:outline-none focus:border-blue-500">
                      {getAllowedRoles().map(role => (
                        <option key={role} value={role}>{role.replace(/_/g, ' ')}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex gap-3 mt-8">
                  <button onClick={saveEdit} className="flex-1 py-3 bg-blue-600 text-white rounded-2xl hover:bg-blue-700 font-medium">Save Changes</button>
                  <button onClick={() => { setEditingUser(null); setEditEmail(''); setEditRole(''); }} className="flex-1 py-3 bg-gray-200 rounded-2xl hover:bg-gray-300 font-medium">Cancel</button>
                </div>
              </div>
            </div>
          )}

          <div className="divide-y">
            {users.length === 0 ? (
              <p className="text-gray-500 py-8 text-center">No users found.</p>
            ) : (
              users.map((u) => (
                <div key={u.id} className="py-6 flex justify-between items-center">
                  <div>
                    <div className="font-medium">{u.full_name || u.email}</div>
                    <div className="text-sm text-gray-500">{u.email}</div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="font-mono text-sm bg-gray-100 px-4 py-1.5 rounded-xl">{u.role}</span>
                    {canEditUser && (
                      <button onClick={() => startEdit(u)} className="text-blue-600 hover:text-blue-700 px-4 py-1 font-medium">Edit</button>
                    )}
                    {isSuperAdmin && (
                      <button onClick={() => deleteUser(u.id)} className="text-red-600 hover:text-red-700 px-4 py-1 font-medium">Delete</button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
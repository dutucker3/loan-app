'use client';

import { useState, useEffect } from 'react';
import { useUser, useClerk, OrganizationSwitcher } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import TenantHeader from '@/components/TenantHeader';
import NextImage from 'next/image';
import { hasPermission } from '@/lib/permissions';

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
  const [unassignedLoans, setUnassignedLoans] = useState<any[]>([]);
  const [applications, setApplications] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [processors, setProcessors] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  // New Organizations
  const [pendingOrgs, setPendingOrgs] = useState<any[]>([]);
  const [pendingOrgsCount, setPendingOrgsCount] = useState(0);
  const [allOrgs, setAllOrgs] = useState<any[]>([]);

  const [loading, setLoading] = useState(true);
const [activeTab, setActiveTab] = useState<
  'price' | 'applications' | 'pending' | 'processing' | 'closed' | 'unassigned' | 'users' | 'new-orgs' | 'organizations' | 'products'
>('processing');

  const [currentUserRole, setCurrentUserRole] = useState<string>('BROKER_AE');
  const [currentUserOrgId, setCurrentUserOrgId] = useState<string | null>(null);

  // User Management States
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserRole, setNewUserRole] = useState('BROKER_AE');
  const [editingUser, setEditingUser] = useState<any>(null);
  const [editEmail, setEditEmail] = useState('');
  const [editRole, setEditRole] = useState('');

  // Permission helpers
  const currentUserForPerms = {
    id: user?.id || '',
    role: currentUserRole as any,
    organization_id: currentUserOrgId,
  };

  const isSuperAdmin = hasPermission(currentUserForPerms, 'SUPER_ADMIN');
  const isAdminOrHigher = hasPermission(currentUserForPerms, ['ADMIN', 'SUPER_ADMIN', 'LENDING_SUPERVISOR']);
  const isProcessorOrHigher = hasPermission(currentUserForPerms, ['LOAN_PROCESSOR', 'LOAN_UNDERWRITER', 'ADMIN', 'SUPER_ADMIN', 'LENDING_SUPERVISOR']);
  const canManageUsers = hasPermission(currentUserForPerms, ['SUPER_ADMIN', 'ADMIN', 'LENDING_SUPERVISOR', 'SENIOR_ACCOUNT_EXECUTIVE']);

  const handleLogout = () => signOut({ redirectUrl: '/' });

  useEffect(() => {
    if (!isLoaded || !user) {
      if (isLoaded) router.push('/sign-in');
      return;
    }

    async function loadAllData() {
      const { data: userData } = await supabase
        .from('users')
        .select('role, organization_id')
        .eq('id', user.id)
        .single();

      const role = userData?.role || 'BROKER_AE';
      setCurrentUserRole(role);
      setCurrentUserOrgId(userData?.organization_id || null);

      // Loans
      let loansQuery = supabase.from('loans').select('*').order('created_at', { ascending: false });
      if (!isAdminOrHigher) {
        loansQuery = loansQuery.or(`originator_id.eq.${user.id},processor_id.eq.${user.id},underwriter_id.eq.${user.id}`);
      }
      const { data: loansData } = await loansQuery;

      setActiveLoans(loansData?.filter(l => 
        ['Processing', 'Underwriting', 'Clear to Close'].includes(l.loan_status || '')
      ) || []);

      setClosedLoans(loansData?.filter(l => 
        ['Closed and Funded', 'On Hold', 'Rejected'].includes(l.loan_status || '')
      ) || []);

      // Applications
      const { data: appData } = await supabase
        .from('loan_applications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      setApplications(appData || []);

      if (canManageUsers) {
        const { data: usersData } = await supabase.from('users').select('*').order('created_at', { ascending: false });
        setUsers(usersData || []);
      }

      if (isProcessorOrHigher) {
        const { data: procData } = await supabase
          .from('users')
          .select('id, full_name, email, role')
          .in('role', ['LOAN_PROCESSOR', 'LENDING_SUPERVISOR', 'SUPER_ADMIN', 'ADMIN']);
        setProcessors(procData || []);
      }

        // === SUPER ADMIN: Show ALL products across all organizations ===
      if (isSuperAdmin) {
        const { data: productsData } = await supabase
          .from('loan_products')
          .select('*')
          .order('created_at', { ascending: false });
        setProducts(productsData || []);
      } 
      // Regular admins / org users
      else if (isAdminOrHigher || hasPermission(currentUserForPerms, 'manage_products')) {
        let orgIdToUse = userData?.organization_id || clerkOrg?.id;

        if (orgIdToUse) {
          const { data: productsData } = await supabase
            .from('loan_products')
            .select('*')
            .eq('organization_id', orgIdToUse)
            .order('created_at', { ascending: false });
          setProducts(productsData || []);
        }
      }

      setLoading(false);
    }

    loadAllData();
  }, [isLoaded, user, router, isAdminOrHigher, canManageUsers, isProcessorOrHigher]);
  // Refresh Products when Products tab is selected
  useEffect(() => {
    if (activeTab === 'products') {
      const fetchProducts = async () => {
        if (isSuperAdmin) {
          // Super Admin sees ALL products
          const { data } = await supabase
            .from('loan_products')
            .select('*')
            .order('created_at', { ascending: false });
          setProducts(data || []);
        } else {
          // Normal org-scoped access
          let orgIdToUse = currentUserOrgId;

          if (!orgIdToUse) {
            // Fallback: try to get from Clerk if user record doesn't have it
            const { data: userData } = await supabase
              .from('users')
              .select('organization_id')
              .eq('id', user?.id)
              .single();
            
            orgIdToUse = userData?.organization_id;
          }

          if (orgIdToUse) {
            const { data } = await supabase
              .from('loan_products')
              .select('*')
              .eq('organization_id', orgIdToUse)
              .order('created_at', { ascending: false });
            setProducts(data || []);
          }
        }
      };

      fetchProducts();
    }
  }, [activeTab, isSuperAdmin, currentUserOrgId, user?.id]);
  const fetchUnassignedLoans = async () => {
    if (!isProcessorOrHigher) return;
    const { data } = await supabase
      .from('loans')
      .select('*')
      .is('processor_id', null)
      .order('created_at', { ascending: false });
    setUnassignedLoans(data || []);
  };

  const fetchPendingOrgs = async () => {
    const { data, count } = await supabase
      .from('pending_organizations')
      .select('*', { count: 'exact' })
      .eq('status', 'pending');
    setPendingOrgs(data || []);
    setPendingOrgsCount(count || 0);
  };

  const fetchAllOrganizations = async () => {
    const { data } = await supabase
      .from('organizations')
      .select('*')
      .order('created_at', { ascending: false });
    setAllOrgs(data || []);
  };
    const fetchProducts = async () => {
    if (!currentUserOrgId) return;
    const { data } = await supabase
      .from('loan_products')
      .select('*')
      .eq('organization_id', currentUserOrgId)
      .order('created_at', { ascending: false });
    
    setProducts(data || []);
  };

  const assignProcessor = async (loanId: number, processorClerkId: string) => {
    if (!processorClerkId) return;

    const { error } = await supabase
      .from('loans')
      .update({ assigned_processor_id: processorClerkId })
      .eq('id', loanId);

    if (error) {
      alert('Failed to assign processor: ' + error.message);
    } else {
      alert('Processor assigned successfully!');
      fetchUnassignedLoans();
    }
  };

  const addNewUser = async () => {
    if (!newUserEmail.trim()) return;
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

    if (error) alert('Failed to update: ' + error.message);
    else {
      alert('User updated successfully!');
      setEditingUser(null);
      setEditEmail('');
      setEditRole('');
      window.location.reload();
    }
  };

  const deleteUser = async (userId: string) => {
    if (!isSuperAdmin) return alert("Only Super Admin can delete users.");
    if (!confirm("Delete this user?")) return;

    const { error } = await supabase.from('users').delete().eq('id', userId);
    if (error) alert('Failed to delete: ' + error.message);
    else window.location.reload();
  };

  const approveOrganization = async (id: string) => {
    alert("Organization approved! (Full logic coming soon)");
    fetchPendingOrgs();
  };

  const rejectOrganization = async (id: string) => {
    const { error } = await supabase
      .from('pending_organizations')
      .update({ status: 'rejected' })
      .eq('id', id);
    if (error) alert('Error: ' + error.message);
    else fetchPendingOrgs();
  };

  if (!isLoaded || loading) return <div className="p-8 text-center">Loading dashboard...</div>;

  const drafts = applications.filter(a => a.status === 'draft');
  const pendingApps = applications.filter(a => ['submitted', 'priced', 'in_process'].includes(a.status || ''));

  return (
    <div className="max-w-7xl mx-auto p-8">
      {/* Header */}
      <div className="flex justify-between items-center mb-10 border-b pb-6">
        <div className="flex items-center gap-4">
          {user?.imageUrl && (
            <NextImage src={user.imageUrl} alt="Profile" width={64} height={64} className="rounded-full border-2 border-gray-200" />
          )}
          <div>
            <h1 className="text-4xl font-bold">Dashboard</h1>
            <p className="text-gray-600">Welcome back, <span className="font-medium">{user?.fullName || user?.primaryEmailAddress?.emailAddress}</span></p>
            <p className="text-sm text-gray-500">Role: <span className="font-medium">{currentUserRole}</span></p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button 
            onClick={() => router.push('/loan-application')}
            className="px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-medium flex items-center gap-2"
          >
            + Start New Application
          </button>
          <OrganizationSwitcher hidePersonal={true} afterSelectOrganizationUrl="/dashboard" />
          <button onClick={handleLogout} className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-2xl font-medium">
            Logout
          </button>
        </div>
         </div>

      {/* Tabs */}
      <div className="flex border-b mb-8 gap-6 text-lg flex-wrap">
        <button onClick={() => setActiveTab('price')} className={`pb-4 font-medium ${activeTab === 'price' ? 'border-b-4 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>
          Price a Loan
        </button>

        <button onClick={() => setActiveTab('applications')} className={`pb-4 font-medium ${activeTab === 'applications' ? 'border-b-4 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>
          Draft Applications ({drafts.length})
        </button>

        <button onClick={() => setActiveTab('pending')} className={`pb-4 font-medium ${activeTab === 'pending' ? 'border-b-4 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>
          Pending Applications ({pendingApps.length})
        </button>

        <button onClick={() => setActiveTab('processing')} className={`pb-4 font-medium ${activeTab === 'processing' ? 'border-b-4 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>
          Processing ({activeLoans.length})
        </button>

        <button onClick={() => setActiveTab('closed')} className={`pb-4 font-medium ${activeTab === 'closed' ? 'border-b-4 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>
          Closed Loans ({closedLoans.length})
        </button>

        {isProcessorOrHigher && (
          <button 
            onClick={() => { setActiveTab('unassigned'); fetchUnassignedLoans(); }}
            className={`pb-4 font-medium ${activeTab === 'unassigned' ? 'border-b-4 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Assign to Processor
          </button>
        )}
   {/* === PRODUCTS TAB === */}
        {(isSuperAdmin || isAdmin || hasPermission('manage_products')) && (
          <button 
            onClick={() => { setActiveTab('products'); }}
            className={`pb-4 font-medium whitespace-nowrap flex items-center gap-2 ${activeTab === 'products' ? 'border-b-4 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
          >
            📦 Products
          </button>
        )}

        {(isAdminOrHigher || isSuperAdmin) && (
          <>
            <button
              onClick={() => { setActiveTab('new-orgs'); fetchPendingOrgs(); }}
              className={`pb-4 font-medium capitalize flex items-center gap-2 ${activeTab === 'new-orgs' ? 'border-b-4 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
            >
              New Organizations
              {pendingOrgsCount > 0 && <span className="bg-red-500 text-white text-xs px-2 py-0.5 rounded-full">{pendingOrgsCount}</span>}
            </button>

            <button
              onClick={() => { setActiveTab('organizations'); fetchAllOrganizations(); }}
              className={`pb-4 font-medium capitalize ${activeTab === 'organizations' ? 'border-b-4 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
            >
              Organizations
            </button>
          </>
        )}

        {canManageUsers && (
          <button onClick={() => setActiveTab('users')} className={`pb-4 font-medium ${activeTab === 'users' ? 'border-b-4 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>
            Users
          </button>
        )}
      </div>

      {/* Tab Contents */}
      {activeTab === 'price' && (
        <div className="text-center py-20">
          <button onClick={() => router.push('/loans/new')} className="px-12 py-6 bg-blue-600 text-white text-2xl rounded-3xl hover:bg-blue-700">
            Go to Pricing Tool →
          </button>
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

      {activeTab === 'pending' && (
        <div>
          <h2 className="text-2xl font-semibold mb-6">Pending Applications</h2>
          {pendingApps.length === 0 ? <p className="text-gray-500">No pending applications yet.</p> : (
            pendingApps.map(app => (
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

      {(activeTab === 'processing' || activeTab === 'closed') && (
        <div className="bg-white rounded-3xl shadow-sm border divide-y">
          {(activeTab === 'processing' ? activeLoans : closedLoans).map((loan) => (
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
      {/* ====================== PRODUCTS TAB ====================== */}
      {activeTab === 'products' && (isSuperAdmin || isAdminOrHigher || hasPermission(currentUserForPerms, 'manage_products')) && (
        <div className="bg-white rounded-3xl border p-8">
          <div className="flex justify-between items-center mb-8">
            <h2 className="text-2xl font-semibold">Loan Products</h2>
            <button
              onClick={() => router.push('/products')}
              className="px-8 py-4 bg-blue-600 text-white rounded-3xl font-semibold hover:bg-blue-700"
            >
              + Create New Product
            </button>
          </div>

          <div className="space-y-4">
            {products.length === 0 ? (
              <div className="text-center py-16 text-gray-500">
                No products found for this organization.
              </div>
            ) : (
              products.map((product: any) => (
                <div 
                  key={product.id}
                  className="flex justify-between items-center p-6 border rounded-2xl hover:bg-gray-50 cursor-pointer"
                  onClick={() => router.push(`/products/${product.id}`)}
                >
                  <div>
                    <h3 className="font-semibold text-lg">{product.name}</h3>
                    <p className="text-sm text-gray-500">{product.description || 'No description'}</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className={`px-5 py-2 rounded-2xl text-sm font-medium ${product.active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {product.active ? 'Active' : 'Inactive'}
                    </span>
                    <button 
                      onClick={(e) => { e.stopPropagation(); router.push(`/products/${product.id}`); }}
                      className="px-6 py-2 text-blue-600 hover:bg-blue-50 rounded-2xl"
                    >
                      View / Edit →
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {activeTab === 'unassigned' && isProcessorOrHigher && (
        <div className="bg-white rounded-3xl border overflow-hidden">
          <div className="p-8 border-b">
            <h2 className="text-2xl font-semibold">Assign to Processor</h2>
            <p className="text-gray-500">These loans need to be assigned to a processor</p>
          </div>
          <div className="divide-y">
            {unassignedLoans.length === 0 ? (
              <p className="p-12 text-center text-gray-500">No unassigned loans at the moment.</p>
            ) : (
              unassignedLoans.map((loan) => (
                <div key={loan.id} className="p-8 flex justify-between items-center hover:bg-gray-50">
                  <div>
                    <p className="font-medium">Loan #{loan.id} — {loan.property_address}</p>
                    <p className="text-sm text-gray-500">{loan.borrower_name}</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <select 
                      onChange={(e) => assignProcessor(loan.id, e.target.value)}
                      className="border border-gray-300 rounded-2xl px-5 py-3 focus:outline-none focus:border-blue-500"
                      defaultValue=""
                    >
                      <option value="">Assign to Processor...</option>
                      {processors.map((proc) => (
                        <option key={proc.id} value={proc.id}>
                          {proc.full_name || proc.email} ({proc.role})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Users Tab - Fixed */}
      {activeTab === 'users' && canManageUsers && (
        <div className="bg-white rounded-3xl border p-8">
          <h2 className="text-2xl font-semibold mb-6">Users Management</h2>

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
                {['BROKER_AE', 'SENIOR_BROKER', 'JUNIOR_BROKER', 'ACCOUNT_EXECUTIVE', 'SENIOR_ACCOUNT_EXECUTIVE', 'LOAN_PROCESSOR', 'LOAN_UNDERWRITER'].map(r => (
                  <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
                ))}
              </select>
              <button onClick={addNewUser} className="px-8 py-3 bg-green-600 text-white rounded-2xl hover:bg-green-700">Add User</button>
            </div>
          </div>

          {/* Edit Modal */}
          {editingUser && (
            <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
              <div className="bg-white rounded-3xl p-8 w-full max-w-md">
                <h3 className="text-xl font-semibold mb-6">Edit User</h3>
                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium mb-2">Email Address</label>
                    <input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} className="w-full px-4 py-3 border rounded-2xl" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Role</label>
                    <select value={editRole} onChange={(e) => setEditRole(e.target.value)} className="w-full px-4 py-3 border rounded-2xl">
                      {['BROKER_AE', 'SENIOR_BROKER', 'JUNIOR_BROKER', 'ACCOUNT_EXECUTIVE', 'SENIOR_ACCOUNT_EXECUTIVE', 'LOAN_PROCESSOR', 'LOAN_UNDERWRITER'].map(r => (
                        <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex gap-3 mt-8">
                  <button onClick={saveEdit} className="flex-1 py-3 bg-blue-600 text-white rounded-2xl hover:bg-blue-700">Save Changes</button>
                  <button onClick={() => { setEditingUser(null); setEditEmail(''); setEditRole(''); }} className="flex-1 py-3 bg-gray-200 rounded-2xl hover:bg-gray-300">Cancel</button>
                </div>
              </div>
            </div>
          )}

          <div className="divide-y">
            {users.length === 0 ? (
              <p className="text-gray-500 py-8 text-center">No users found.</p>
            ) : (
              users.map((u: any) => (
                <div key={u.id} className="py-6 flex justify-between items-center">
                  <div>
                    <div className="font-medium">{u.full_name || u.email}</div>
                    <div className="text-sm text-gray-500">{u.email}</div>
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
      )}

      {/* New Organizations & Organizations Tabs */}
      {activeTab === 'new-orgs' && (isAdminOrHigher || isSuperAdmin) && (
        <div className="bg-white rounded-3xl border overflow-hidden">
          <div className="p-8 border-b">
            <h2 className="text-2xl font-semibold">New Organization Requests</h2>
          </div>
          <div className="divide-y">
            {pendingOrgs.length === 0 ? (
              <p className="p-12 text-center text-gray-500">No pending requests.</p>
            ) : (
              pendingOrgs.map((org) => (
                <div key={org.id} className="p-8 flex justify-between items-center">
                  <div>
                    <p className="font-medium">{org.company_name}</p>
                    <p className="text-sm text-gray-500">{org.email}</p>
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => approveOrganization(org.id)} className="px-6 py-2 bg-green-600 text-white rounded-2xl">Approve</button>
                    <button onClick={() => rejectOrganization(org.id)} className="px-6 py-2 bg-red-600 text-white rounded-2xl">Reject</button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {activeTab === 'organizations' && (isAdminOrHigher || isSuperAdmin) && (
  <div className="bg-white rounded-3xl border p-8">
    <div className="flex justify-between items-center mb-6">
      <h2 className="text-2xl font-semibold">All Organizations</h2>
      <button
        onClick={() => router.push('/admin/organizations')}
        className="px-6 py-3 bg-blue-600 text-white rounded-2xl hover:bg-blue-700 font-medium"
      >
        Manage White Label Settings →
      </button>
    </div>
      {/* NEW: Products Button - Visible to Admins */}
{activeTab === 'products' && (isSuperAdmin || isAdminOrHigher) && (
  <div>
    <div className="flex justify-between items-center mb-6">
      <h2 className="text-3xl font-bold">Loan Products & Standards</h2>
      <button 
        onClick={() => router.push('/products')}
        className="px-8 py-4 bg-blue-600 text-white rounded-3xl font-semibold hover:bg-blue-700"
      >
        Manage Products →
      </button>
    </div>
  </div>
)}

    {allOrgs.length === 0 ? (
      <p className="text-gray-500 py-12 text-center">No organizations found.</p>
    ) : (
      allOrgs.map((org) => (
        <div key={org.id} className="border-b py-6 flex justify-between items-center hover:bg-gray-50 px-4 rounded-2xl transition">
          <div className="flex items-center gap-4">
            {org.logo_url && (
              <img src={org.logo_url} alt="logo" className="w-10 h-10 object-contain rounded-lg" />
            )}
            <div>
              <div className="font-semibold text-lg">{org.name}</div>
              <div className="text-sm text-gray-500">
                {org.domain ? `Domain: ${org.domain}` : 'No custom domain'} 
                {org.from_email && ` • From: ${org.from_email}`}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-sm text-gray-500">
              {new Date(org.created_at).toLocaleDateString()}
            </div>
            <button
              onClick={() => router.push('/admin/organizations')}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-2xl font-medium transition"
            >
              Edit White Label
            </button>
          </div>
        </div>
      ))
    )}
  </div>
)}
    </div>
  );
}
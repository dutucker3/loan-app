'use client';

import { useState, useEffect } from 'react';
import { useUser, useOrganizationList } from '@clerk/nextjs';
import { createClientComponentClient } from '@/lib/supabase';
import { canAccessAppDashboard, canSeeAllOrganizations } from '@/lib/permissions';

export default function AppDashboard() {
  const { user, isLoaded } = useUser();
  const { userMemberships } = useOrganizationList({ userMemberships: { infinite: true } });
  const supabase = createClientComponentClient();

  const [organizations, setOrganizations] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserRole, setCurrentUserRole] = useState<string>('BROKER_AE');

  useEffect(() => {
    if (!isLoaded || !user) return;

    const loadData = async () => {
      try {
        // Get fresh role from Supabase
        const { data: userData } = await supabase
          .from('users')
          .select('role, organization_id')
          .eq('id', user.id)
          .single();

        const role = userData?.role || 'BROKER_AE';
        setCurrentUserRole(role);

        console.log("✅ Loaded role from Supabase:", role);

        // Load organizations
        const { data: orgs } = await supabase
          .from('organizations')
          .select('*')
          .order('created_at', { ascending: false });
        setOrganizations(orgs || []);

        // Load users for admins
        if (['SUPER_ADMIN', 'ADMIN'].includes(role)) {
          const { data: allUsers } = await supabase
            .from('users')
            .select('*')
            .order('created_at', { ascending: false });
          setUsers(allUsers || []);
        }
      } catch (err) {
        console.error("Dashboard load error:", err);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [user, isLoaded, supabase]);

  if (!isLoaded || !user) {
    return <div className="p-10 text-center">Loading...</div>;
  }

  const hasClerkOrgs = userMemberships?.data && userMemberships.data.length > 0;

  if (!canAccessAppDashboard({ id: user.id, role: currentUserRole }) && !hasClerkOrgs) {
    return <div className="p-10 text-center text-red-600">Access Denied. Please contact Super Admin.</div>;
  }

  // Organization Selector
  if (hasClerkOrgs && !user.publicMetadata?.organization_id) {
    return (
      <div className="p-10">
        <h1 className="text-3xl font-bold mb-8">Select Organization</h1>
        <p className="text-gray-600 mb-6">Please select an organization to continue:</p>
        <div className="grid gap-4 max-w-md">
          {userMemberships.data.map((membership: any) => (
            <button
              key={membership.id}
              onClick={async () => {
                await supabase
                  .from('users')
                  .update({ organization_id: membership.organization.id })
                  .eq('id', user.id);
                window.location.reload();
              }}
              className="p-6 border-2 border-gray-200 hover:border-blue-600 rounded-3xl text-left transition-all hover:shadow-md"
            >
              <div className="font-semibold text-lg">{membership.organization.name}</div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <h1 className="text-4xl font-bold mb-8">App Level Management Dashboard</h1>
      <p className="text-green-600 mb-6">Welcome, {user.fullName} ({currentUserRole})</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-3xl border p-8">
          <h2 className="text-2xl font-semibold mb-4">Organizations ({organizations.length})</h2>
          {organizations.map((org) => (
            <div key={org.id} className="py-3 border-b last:border-0">
              {org.name}
            </div>
          ))}
        </div>

        <div className="bg-white rounded-3xl border p-8">
          <h2 className="text-2xl font-semibold mb-4">Users ({users.length})</h2>
          {users.slice(0, 10).map((u: any) => (
            <div key={u.id} className="py-2 text-sm">
              {u.full_name} — <span className="font-medium">{u.role}</span>
            </div>
          ))}
        </div>

        <div className="bg-white rounded-3xl border p-8">
          <h2 className="text-2xl font-semibold mb-4">Tech Support Requests</h2>
          <p className="text-gray-500">Coming soon...</p>
        </div>
      </div>
    </div>
  );
}
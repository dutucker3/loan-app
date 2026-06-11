'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export default function SelectOrgPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [userOrgId, setUserOrgId] = useState<string | null>(null);
  const [userOrgName, setUserOrgName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadUserOrg() {
      try {
        const { data: { user: sbUser } } = await supabase.auth.getUser();
        if (!sbUser) {
          router.push('/sign-in');
          return;
        }

        // Load role and org from profiles
        const { data: prof } = await supabase
          .from('profiles')
          .select('organization_id, role')
          .eq('id', sbUser.id)
          .maybeSingle();

        const role = prof?.role || '';
        const allowedSwitchRoles = ['SUPER_ADMIN', 'ADMIN', 'TECH_SUPPORT'];
        const canSwitch = allowedSwitchRoles.includes(role);

        const orgId = prof?.organization_id;
        if (orgId) {
          const { data: org } = await supabase
            .from('organizations')
            .select('name')
            .eq('id', orgId)
            .maybeSingle();
          setUserOrgId(orgId);
          setUserOrgName(org?.name || orgId);

          if (!canSwitch) {
            // Non-privileged users (ORG_ADMIN, BROKER_AE etc) cannot switch; send to their dashboard/products
            router.push('/dashboard');
            return;
          }
          // Allowed users with org can stay or we can let them choose, but for switch they may want to see list
          setLoading(false);
          return;
        }

        // No org - allow the page for setup (even if role limited, but typically for new)
        setLoading(false);
      } catch (e: any) {
        console.error(e);
        setError(e.message || 'Failed to load organization');
        setLoading(false);
      }
    }
    loadUserOrg();
  }, [router]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading organization context...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-3xl p-12 shadow-xl text-center">
        <h1 className="text-4xl font-bold mb-6">Select Organization</h1>

        {userOrgId ? (
          <p className="text-gray-600 mb-6">You belong to: <strong>{userOrgName}</strong></p>
        ) : (
          <p className="text-gray-600 mb-6">
            No organization is currently assigned to your profile.
            Please contact your administrator, or return to the dashboard.
          </p>
        )}

        {error && <p className="text-red-600 mb-4">{error}</p>}

        <div className="flex flex-col gap-3">
          <button
            onClick={() => router.push('/dashboard')}
            className="w-full py-4 bg-blue-600 text-white rounded-2xl font-semibold hover:bg-blue-700"
          >
            Go to Dashboard
          </button>
          <button
            onClick={() => router.push('/admin/products')}
            className="w-full py-3 border rounded-2xl hover:bg-gray-50"
          >
            Try Products anyway
          </button>
          <button
            onClick={() => router.push('/sign-in')}
            className="text-sm text-gray-500 hover:underline"
          >
            Sign in as different user
          </button>
        </div>

        <p className="mt-8 text-xs text-gray-400">
          Organization membership is now managed via your profile in Supabase (post-Clerk migration).
        </p>
      </div>
    </div>
  );
}
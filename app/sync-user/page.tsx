'use client';

import { useUser, useOrganizationList } from '@clerk/nextjs';
import { useEffect, useState } from 'react';
import { createClientComponentClient } from '@/lib/supabase';
import { useRouter } from 'next/navigation';

export default function SyncUserPage() {
  const { user, isLoaded } = useUser();
  const { userMemberships } = useOrganizationList({ userMemberships: { infinite: true } });
  const router = useRouter();
  const [status, setStatus] = useState("Setting up your account...");

  useEffect(() => {
    if (!isLoaded || !user) return;

    const syncAndRedirect = async () => {
      const supabase = createClientComponentClient();

      try {
        await supabase.from('users').upsert({
          id: user.id,
          email: user.primaryEmailAddress?.emailAddress,
          full_name: user.fullName || `${user.firstName || ''} ${user.lastName || ''}`.trim(),
          role: 'PENDING_ORG_ADMIN',
          organization_id: null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'id' });

        // If user has an organization, go to application form
        if (userMemberships?.data && userMemberships.data.length > 0) {
          setStatus("✅ Organization detected! Going to application...");
          setTimeout(() => router.push('/apply/organization'), 800);
        } else {
          setStatus("✅ Account ready! Going to application...");
          setTimeout(() => router.push('/apply/organization'), 1200);
        }
      } catch (err) {
        console.error(err);
        router.push('/apply/organization'); // fallback
      }
    };

    syncAndRedirect();
  }, [user, isLoaded, router, userMemberships]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <h1 className="text-3xl font-bold mb-4">{status}</h1>
        <p className="text-gray-600">Please wait...</p>
      </div>
    </div>
  );
}
'use client';

import { useEffect } from 'react';
import { useUser, useOrganizationList } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';

export default function ClerkOrganizationPage() {
  const { user } = useUser();
  const { createOrganization } = useOrganizationList();
  const router = useRouter();

  useEffect(() => {
    if (!user) return;

    // Auto-redirect to Clerk's native organization creation
    window.location.href = "/clerk/organizations/create";
  }, [user]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-4">Creating Your Organization...</h1>
        <p>Redirecting to Clerk's organization setup...</p>
      </div>
    </div>
  );
}
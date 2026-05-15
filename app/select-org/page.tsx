'use client';

import { OrganizationSwitcher, useOrganization } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function SelectOrgPage() {
  const router = useRouter();
  const { organization } = useOrganization();

  // Auto-redirect if user already has an active organization
  useEffect(() => {
    if (organization?.id) {
      router.push('/products');
    }
  }, [organization?.id, router]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-3xl p-12 shadow-xl text-center">
        <h1 className="text-4xl font-bold mb-6">Select Organization</h1>
        <p className="text-gray-600 mb-10">
          Choose or create an organization to continue
        </p>

        <OrganizationSwitcher 
          hidePersonal={true}
          afterCreateOrganizationUrl="/products"
          afterSelectOrganizationUrl="/products"
          appearance={{
            elements: {
              rootBox: "w-full mb-8",
              organizationSwitcherTrigger: "w-full py-5 px-6 text-lg border-2 border-gray-300 rounded-3xl hover:bg-gray-50",
            }
          }}
        />

        {organization?.id && (
          <button
            onClick={() => router.push('/products')}
            className="w-full py-4 bg-blue-600 text-white rounded-2xl font-semibold hover:bg-blue-700 mt-4"
          >
            Continue to Products →
          </button>
        )}
      </div>
    </div>
  );
}
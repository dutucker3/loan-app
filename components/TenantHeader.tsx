'use client';

import { useTenant } from '@/lib/tenant-context';
import Image from 'next/image';

export default function TenantHeader() {
  const tenant = useTenant();

  // White-label: prefer full tenant (from domain or user-org fallback in context).
  // Root "Loan-App Platform" only intended for root home (app/page.tsx) or super views; child pages should have tenant override (no leak).
  // If somehow root tenant reaches here on a child page for a non-root user, the context user-fallback + org.is_root should ensure proper org name.
  const displayName = tenant?.name || 'Lending Platform';
  const isPlatformRoot = tenant?.is_root || displayName === 'Loan-App Platform';

  return (
    <div className="flex items-center gap-4 mb-8">
      {tenant?.logo_url && (
        <Image 
          src={tenant.logo_url} 
          alt={displayName} 
          width={48} 
          height={48} 
          className="rounded-xl"
        />
      )}
      <div>
        <h1 
          className="text-3xl font-bold"
          style={{ color: tenant?.primary_color || (isPlatformRoot ? '#111827' : '#111') }}
        >
          {displayName}
        </h1>
        {tenant?.domain && (
          <p className="text-sm text-gray-500">{tenant.domain}</p>
        )}
        {isPlatformRoot && !tenant?.domain && (
          <p className="text-xs text-gray-400">Platform Root (Level 0)</p>
        )}
      </div>
    </div>
  );
}
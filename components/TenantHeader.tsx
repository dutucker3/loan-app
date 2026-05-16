'use client';

import { useTenant } from '@/lib/tenant-context';
import Image from 'next/image';

export default function TenantHeader() {
  const tenant = useTenant();

  return (
    <div className="flex items-center gap-4 mb-8">
      {tenant?.logo_url && (
        <Image 
          src={tenant.logo_url} 
          alt={tenant.name} 
          width={48} 
          height={48} 
          className="rounded-xl"
        />
      )}
      <div>
        <h1 
          className="text-3xl font-bold"
          style={{ color: tenant?.primary_color || '#111' }}
        >
          {tenant?.name || 'Lending Platform'}
        </h1>
        {tenant?.domain && (
          <p className="text-sm text-gray-500">{tenant.domain}</p>
        )}
      </div>
    </div>
  );
}
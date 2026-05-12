// lib/tenant-context.tsx
'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { useOrganization, useUser } from '@clerk/nextjs';
import { supabase } from './supabase';

type Tenant = {
  id: string;
  name: string;
  logo_url?: string;
  primary_color?: string;
  slug: string;
  domain?: string;
};

const TenantContext = createContext<Tenant | null>(null);

export function TenantProvider({ children }: { children: React.ReactNode }) {
  const { organization } = useOrganization();
  const { user } = useUser();
  const [tenant, setTenant] = useState<Tenant | null>(null);

  useEffect(() => {
    const loadTenant = async () => {
      if (!organization?.id) return;

      const { data } = await supabase
        .from('organizations')
        .select('*')
        .eq('clerk_org_id', organization.id)
        .single();

      if (data) setTenant(data);
    };

    loadTenant();
  }, [organization]);

  return (
    <TenantContext.Provider value={tenant}>
      {children}
    </TenantContext.Provider>
  );
}

export const useTenant = () => useContext(TenantContext);
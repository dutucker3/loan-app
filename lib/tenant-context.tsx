'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { useOrganization } from '@clerk/nextjs';
import { supabase } from './supabase';

type Tenant = {
  id: string;
  clerk_org_id: string;
  name: string;
  slug?: string;
  logo_url?: string;
  primary_color?: string;
  domain?: string;
};

const TenantContext = createContext<Tenant | null>(null);

export function TenantProvider({ children }: { children: React.ReactNode }) {
  const { organization } = useOrganization();
  const [tenant, setTenant] = useState<Tenant | null>(null);

  useEffect(() => {
    const loadTenant = async () => {
      const hostname = window.location.hostname;

      // 1. First try custom domain
      let { data } = await supabase
        .from('organizations')
        .select('*')
        .eq('domain', hostname)
        .maybeSingle();

      // 2. Fallback to current Clerk organization
      if (!data && organization?.id) {
        const { data: clerkData } = await supabase
          .from('organizations')
          .select('*')
          .eq('clerk_org_id', organization.id)
          .maybeSingle();
        data = clerkData;
      }

      setTenant(data || null);
    };

    loadTenant();
  }, [organization?.id]);

  return <TenantContext.Provider value={tenant}>{children}</TenantContext.Provider>;
}

export const useTenant = () => useContext(TenantContext);
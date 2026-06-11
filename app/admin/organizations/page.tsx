import { headers } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';
import { ROOT_ORG_NAME } from '@/lib/constants';
import OrganizationsClient from './OrganizationsClient';

export default async function OrganizationsPage() {
  // Server-side domain/tenant resolution (same pattern as /admin/settings and public tenant pages).
  // This lets the initial HTML include the correct "Child / Sponsored Organizations" heading for L1 tenants
  // without waiting for client-side profile lookup + useTenant flash of root/parent company context.
  const headersList = await headers();
  const host = headersList.get('x-forwarded-host') || headersList.get('host') || '';
  const hostname = (host || '').split(':')[0].toLowerCase().trim();

  let tenantOrg: any = null;

  if (hostname) {
    const { data: domainOrg } = await supabaseAdmin
      .from('organizations')
      .select('*')
      .eq('domain', hostname)
      .eq('hidden', false)
      .maybeSingle();

    if (domainOrg) {
      tenantOrg = domainOrg;
    }
  }

  if (!tenantOrg) {
    const { data: rootOrg } = await supabaseAdmin
      .from('organizations')
      .select('*')
      .eq('name', ROOT_ORG_NAME)
      .maybeSingle();
    tenantOrg = rootOrg;
  }

  // Pass the server-resolved tenant org down. The client still performs authenticated user role/org lookup
  // (profiles → users fallback) to decide real data scoping for the table (so supers see everything even on a tenant domain).
  return <OrganizationsClient initialTenantOrg={tenantOrg} />;
}

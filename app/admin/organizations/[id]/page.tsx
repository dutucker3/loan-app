import { headers } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';
import OrgDetailClient from './OrgDetailClient';

export default async function OrganizationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: orgId } = await params;

  // Server-side preload of the exact org by id (so the detail view has correct company data in the initial HTML).
  // Also perform the domain/tenant lookup (same treatment as settings + organizations list) so we have
  // context about whether the viewed org is under the current tenant domain (useful for future header context or warnings).
  const headersList = await headers();
  const host = headersList.get('x-forwarded-host') || headersList.get('host') || '';
  const hostname = (host || '').split(':')[0].toLowerCase().trim();

  let initialOrg: any = null;
  let tenantContextOrg: any = null;

  // Load the requested org (by route id) — this is the source of truth for the detail page.
  if (orgId) {
    const { data: orgData } = await supabaseAdmin
      .from('organizations')
      .select('*')
      .eq('id', orgId)
      .maybeSingle();
    initialOrg = orgData;
  }

  // Domain tenant context (for "no flash of parent/root company" on admin surfaces that show org info).
  if (hostname) {
    const { data: domainOrg } = await supabaseAdmin
      .from('organizations')
      .select('*')
      .eq('domain', hostname)
      .eq('hidden', false)
      .maybeSingle();
    if (domainOrg) tenantContextOrg = domainOrg;
  }

  if (!initialOrg) {
    // Still render the client so it can show the friendly "not found" state.
  }

  return (
    <OrgDetailClient
      orgId={orgId || ''}
      initialOrg={initialOrg}
      // tenantContextOrg is available if a future enhancement wants to show "Viewing as child of X" etc.
    />
  );
}

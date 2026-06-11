import { headers } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase';
import { ROOT_ORG_NAME } from '@/lib/constants';
import SettingsClient from './SettingsClient'; // client component for the interactive form

export default async function AdminSettingsPage() {
  // Server-side tenant resolution using domain (avoids client-side flash of parent/root org).
  // Matches the established pattern from app/page.tsx and app/thank-you/page.tsx.
  const headersList = await headers();
  const host = headersList.get('x-forwarded-host') || headersList.get('host') || '';
  const hostname = (host || '').split(':')[0].toLowerCase().trim();

  let currentOrg: any = null;

  if (hostname) {
    // Lookup by domain first (the "is tenant" filter on server)
    const { data: domainOrg } = await supabaseAdmin
      .from('organizations')
      .select('*')
      .eq('domain', hostname)
      .eq('hidden', false)
      .maybeSingle();

    if (domainOrg) {
      currentOrg = domainOrg;
    }
  }

  if (!currentOrg) {
    // Fallback: try to load the root/platform org (for level 0 or when no domain match)
    const { data: rootOrg } = await supabaseAdmin
      .from('organizations')
      .select('*')
      .eq('name', ROOT_ORG_NAME)
      .maybeSingle();
    currentOrg = rootOrg;
  }

  // Pass the server-resolved org to the client form component.
  // The client component can still enrich with the logged-in user's profile if needed (for permissions/role checks),
  // but the initial HTML render already has the correct company info (no waiting for client domain filter, no flash of parent/root).
  return <SettingsClient initialOrg={currentOrg} />;
}


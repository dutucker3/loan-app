import { headers } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase-admin';
import LoanApplicationClient from '../LoanApplicationClient';

// Rental form moved down per user answers (selector is now at /loan-application).
// This preserves the original rental behavior while making /loan-application the selector.
// Server-side tenant + console.log for Supabase data.

export default async function RentalApplicationPage() {
  const headersList = await headers();
  let host = headersList.get('host') || headersList.get('x-forwarded-host') || '';
  const hostname = (host || '').split(':')[0].toLowerCase().trim();

  let tenantName = 'Lending Platform';

  console.log('[rental] Loading Supabase tenant data for hostname:', hostname);

  try {
    if (hostname && hostname !== 'localhost' && !hostname.endsWith('.vercel.app') && !hostname.includes('.local')) {
      const { data: org } = await supabaseAdmin
        .from('organizations')
        .select('name')
        .eq('domain', hostname)
        .maybeSingle();

      if (org?.name) {
        tenantName = org.name;
        console.log('[rental] Supabase tenant loaded successfully:', tenantName);
      } else {
        console.log('[rental] No org match in Supabase - using default tenantName');
      }
    } else {
      console.log('[rental] Skipping Supabase lookup (localhost/preview)');
    }
  } catch (err) {
    console.error('[rental] Supabase tenant lookup failed:', err);
  }

  return <LoanApplicationClient tenantName={tenantName} />;
}

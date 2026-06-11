import { headers } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase-admin';
import SignInClient from './SignInClient';

// Server component for sign-in page.
// Resolves tenant (organization) via hostname for white-label branding (name, logo, primary color).
// Tenant name is shown inside the sign-in card (above the form title).
// Follows the exact server-side tenant pattern + console logging used on /loan-application and /bridge-application.

export default async function SignInPage() {
  const headersList = await headers();
  let host = headersList.get('host') || headersList.get('x-forwarded-host') || '';
  const hostname = (host || '').split(':')[0].toLowerCase().trim();

  let tenant = {
    name: 'Lending Platform',
    logo_url: null as string | null,
    primary_color: '#111827',
  };

  console.log('[sign-in] Loading Supabase tenant data for hostname:', hostname);

  try {
    if (hostname && hostname !== 'localhost' && !hostname.endsWith('.vercel.app') && !hostname.includes('.local')) {
      const { data: org } = await supabaseAdmin
        .from('organizations')
        .select('name, logo_url, primary_color')
        .eq('domain', hostname)
        .maybeSingle();

      if (org) {
        tenant = {
          name: org.name || tenant.name,
          logo_url: org.logo_url || tenant.logo_url,
          primary_color: org.primary_color || tenant.primary_color,
        };
        console.log('[sign-in] Supabase tenant loaded:', { 
          name: tenant.name, 
          hasLogo: !!tenant.logo_url, 
          color: tenant.primary_color 
        });
      } else {
        console.log('[sign-in] No Supabase org match - default tenant');
      }
    } else {
      console.log('[sign-in] Local/preview - default tenant (no Supabase call)');
    }
  } catch (err) {
    console.error('[sign-in] Supabase tenant error:', err);
  }

  return (
    <SignInClient 
      tenantName={tenant.name} 
      tenantLogo={tenant.logo_url} 
      tenantColor={tenant.primary_color} 
    />
  );
}

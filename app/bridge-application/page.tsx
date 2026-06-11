import { headers } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase-admin';
import BridgeApplicationClient from './BridgeApplicationClient';

// New server-side page for combined Bridge/Fix & Flip form (per finalized plan + user answers).
// Uses server-side tenant resolution (logo_url, primary_color, name).
// Adds console.log for Supabase data loading verification.

export default async function BridgeApplicationPage() {
  const headersList = await headers();
  let host = headersList.get('host') || headersList.get('x-forwarded-host') || '';
  const hostname = (host || '').split(':')[0].toLowerCase().trim();

  let tenant = {
    name: 'Lending Platform',
    logo_url: null as string | null,
    primary_color: '#111827',
  };

  console.log('[bridge-application] Loading Supabase tenant data for hostname:', hostname);

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
        console.log('[bridge-application] Supabase tenant loaded:', { 
          name: tenant.name, 
          hasLogo: !!tenant.logo_url, 
          color: tenant.primary_color 
        });
      } else {
        console.log('[bridge-application] No Supabase org match - default tenant');
      }
    } else {
      console.log('[bridge-application] Local/preview - default tenant (no Supabase call)');
    }
  } catch (err) {
    console.error('[bridge-application] Supabase tenant error:', err);
  }

  return (
    <BridgeApplicationClient 
      tenantName={tenant.name} 
      tenantLogo={tenant.logo_url} 
      tenantColor={tenant.primary_color} 
    />
  );
}

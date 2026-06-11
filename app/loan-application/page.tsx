import { headers } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase-admin';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

// Brand new selector page at /loan-application (per user answers).
// Existing rental moved down. "Apply Now" / "Begin Application" CTAs now point here.
// Server-side tenant branding (logo_url, primary_color, name).

export default async function LoanApplicationSelectorPage() {
  const headersList = await headers();
  let host = headersList.get('host') || headersList.get('x-forwarded-host') || '';
  const hostname = (host || '').split(':')[0].toLowerCase().trim();

  let tenant = { name: 'Lending Platform', logo_url: null as string | null, primary_color: '#111827' };

  console.log('[selector] Loading Supabase tenant data for hostname:', hostname);

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
        console.log('[selector] Supabase tenant loaded:', { name: tenant.name, hasLogo: !!tenant.logo_url, color: tenant.primary_color });
      } else {
        console.log('[selector] No matching org in Supabase for domain, using default');
      }
    } else {
      console.log('[selector] Localhost/preview - using default tenant (no Supabase lookup)');
    }
  } catch (err) {
    console.error('[selector] Supabase tenant lookup error:', err);
  }

  const primaryColor = tenant.primary_color || '#111827';

  return (
    <div className="min-h-screen bg-white">
      {/* Server-side tenant header */}
      <div className="border-b">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center gap-4">
          {tenant.logo_url && (
            <img src={tenant.logo_url} alt={tenant.name} className="h-8 w-auto" />
          )}
          <div>
            <div className="font-semibold text-lg" style={{ color: primaryColor }}>{tenant.name}</div>
            <div className="text-xs text-gray-500">Loan Application Selector</div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-16">
        <h1 className="text-4xl font-semibold tracking-tight mb-4">Choose Your Loan Type</h1>
        <p className="text-xl text-gray-600 mb-10">Select the application that fits your deal. All submissions use server-side tenant branding.</p>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Rental (moved down) */}
          <Link href="/loan-application/rental" className="group block border-2 rounded-3xl p-8 hover:border-black transition">
            <div className="text-2xl font-semibold mb-2" style={{ color: primaryColor }}>Long Term Rental (DSCR / RTL)</div>
            <p className="text-gray-600 mb-4">DSCR loans for long-term, short-term, and mixed-use rentals. Portfolio growth based on property cash flow.</p>
            <div className="inline-flex items-center gap-2 text-sm font-semibold" style={{ color: primaryColor }}>
              Begin Rental Application <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition" />
            </div>
            <div className="mt-2 text-[10px] text-gray-400">Server-side tenant data loaded: {tenant.name}</div>
          </Link>

          {/* Bridge / Fix & Flip */}
          <Link href="/bridge-application" className="group block border-2 rounded-3xl p-8 hover:border-black transition">
            <div className="text-2xl font-semibold mb-2" style={{ color: primaryColor }}>Bridge / Fix &amp; Flip</div>
            <p className="text-gray-600 mb-4">Combined application for purchase + renovation bridge and fix &amp; flip loans. Rehab funding conditional. Product-driven calcs.</p>
            <div className="inline-flex items-center gap-2 text-sm font-semibold" style={{ color: primaryColor }}>
              Begin Bridge Application <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition" />
            </div>
            <div className="mt-2 text-[10px] text-gray-400">Server-side tenant data loaded: {tenant.name} (logo, color)</div>
          </Link>
        </div>

        <p className="mt-8 text-sm text-gray-500">Company users (non-borrowers) can submit on behalf of borrowers — no signature required from you here; borrower signs term sheet / closing.</p>
      </div>
    </div>
  );
}

import { headers } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase-admin';
import BridgeLoanReviewClient from './BridgeLoanReviewClient';

// Server page for bridge loan review / term sheet approval flow.
// - Loads the submitted bridge application (loan_applications row) by id
// - Loads tenant branding (name/logo/color) server-side
// - Loads available bridge/fix-flip products for the application's organization (with bridge_config + mortgagee_clause)
// - Passes everything to the client for interactive tabs + editable term sheet + approve flow + Zillow link + full app review
// Console logs for Supabase data loading (per project requirements).

export default async function BridgeLoanReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const headersList = await headers();
  let host = headersList.get('host') || headersList.get('x-forwarded-host') || '';
  const hostname = (host || '').split(':')[0].toLowerCase().trim();

  let tenant = {
    name: 'Lending Platform',
    logo_url: null as string | null,
    primary_color: '#111827',
  };

  console.log('[bridge-loans] Loading Supabase tenant data for hostname:', hostname, 'appId:', id);

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
        console.log('[bridge-loans] Supabase tenant loaded:', { name: tenant.name, hasLogo: !!tenant.logo_url, color: tenant.primary_color });
      } else {
        console.log('[bridge-loans] No Supabase org match - default tenant');
      }
    } else {
      console.log('[bridge-loans] Local/preview - default tenant (no Supabase call)');
    }
  } catch (err) {
    console.error('[bridge-loans] Supabase tenant error:', err);
  }

  // Load the bridge application (submitted form data + borrowers)
  let application: any = null;
  try {
    const { data } = await supabaseAdmin
      .from('loan_applications')
      .select('*')
      .eq('id', id)
      .single();
    application = data;
    console.log('[bridge-loans] Loaded application:', { id, hasFormData: !!application?.form_data, borrowers: application?.borrowers?.length || 0, orgId: application?.organization_id });
  } catch (e) {
    console.error('[bridge-loans] Failed to load application', id, e);
  }

  // Determine org for products (from app, or fallback lookup submitter)
  let orgIdForProducts = application?.organization_id;
  if (!orgIdForProducts && application?.user_id) {
    try {
      const { data: prof } = await supabaseAdmin.from('profiles').select('organization_id').eq('id', application.user_id).maybeSingle();
      orgIdForProducts = prof?.organization_id || null;
    } catch {}
  }

  // Load products that are relevant for bridge (have bridge_config or look like bridge/fix-flip)
  let products: any[] = [];
  try {
    let q = supabaseAdmin.from('loan_products').select('*').eq('active', true);
    if (orgIdForProducts) {
      q = q.eq('organization_id', orgIdForProducts);
    }
    const { data: prods } = await q.order('created_at', { ascending: false });
    products = (prods || []).filter((p: any) => p.bridge_config || (p.name || '').toLowerCase().includes('bridge') || (p.name || '').toLowerCase().includes('fix'));
    if (products.length === 0 && prods) {
      // Fallback: take first few that have pricing or any
      products = (prods || []).slice(0, 3);
    }
    console.log('[bridge-loans] Loaded products for review:', products.length, 'for org', orgIdForProducts);
  } catch (e) {
    console.error('[bridge-loans] Product load error', e);
  }

  if (!application) {
    return (
      <div className="max-w-4xl mx-auto p-8">
        <p className="text-red-600">Application not found. It may have been deleted or you do not have access.</p>
        <a href="/dashboard" className="text-blue-600 underline">Return to Dashboard</a>
      </div>
    );
  }

  return (
    <BridgeLoanReviewClient
      application={application}
      products={products}
      tenantName={tenant.name}
      tenantLogo={tenant.logo_url}
      tenantColor={tenant.primary_color}
    />
  );
}

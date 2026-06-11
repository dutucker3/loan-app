'use server';

import { supabaseAdmin } from '@/lib/supabase-admin';
import { headers } from 'next/headers';

// Central audit logging helper.
// Call from server actions, API routes, or client components (as it is a Server Action).
// Never throws; failures are logged to console only so main operations are not disrupted.
// Captures IP and User-Agent from request headers when available (works for Server Actions and direct calls).
export async function logAudit(params: {
  userId?: string | null;
  organizationId?: string | null;
  action: string; // e.g. 'user_deleted', 'loan_status_changed', 'document_uploaded', 'product_base_rates_rebased'
  resourceType: string; // e.g. 'user', 'loan', 'document', 'product', 'organization', 'page'
  resourceId?: string | number | null;
  details?: Record<string, any> | null;
}) {
  const { userId = null, organizationId = null, action, resourceType, resourceId = null, details = {} } = params;

  try {
    const h = await headers();
    // Common proxy headers for IP in Supabase/Next/Vercel/etc.
    const ip =
      h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      h.get('x-real-ip') ||
      h.get('cf-connecting-ip') ||
      h.get('x-client-ip') ||
      null;
    const ua = h.get('user-agent') || null;

    const payload: any = {
      user_id: userId,
      organization_id: organizationId,
      action: String(action),
      resource_type: String(resourceType),
      resource_id: resourceId != null ? String(resourceId) : null,
      details: details || {},
      ip_address: ip,
      user_agent: ua,
      created_at: new Date().toISOString(),
    };

    // Use admin client to bypass any RLS for audit inserts (service role).
    const { error } = await supabaseAdmin.from('audit_logs').insert(payload);
    if (error) {
      console.error('Audit log insert error (non-fatal):', error.message);
    }
  } catch (err: any) {
    // Audit must never break user flows.
    console.error('logAudit failed (non-fatal):', err?.message || err);
  }
}

// Convenience for page visits (lightweight).
export async function logPageVisit(pagePath: string, userId?: string | null, organizationId?: string | null) {
  await logAudit({
    userId,
    organizationId,
    action: 'page_visit',
    resourceType: 'page',
    resourceId: pagePath,
    details: { path: pagePath },
  });
}

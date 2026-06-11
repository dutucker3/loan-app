'use server';

import { approveAndCreateOrganization, ensureUserInOrganization, findUserIdByEmail, ensureRootOrganization, getOrganizationParentId } from '@/lib/create-organization';
import { ROOT_ORG_NAME } from '@/lib/constants'; // ROOT_ORG_NAME lives here (not re-exported from create-organization)
import { supabaseAdmin } from '@/lib/supabase-admin';
import { canManageOrg, filterVisibleProductsForUser } from '@/lib/permissions'; // for server-side visibility helpers if needed by actions
import { Resend } from 'resend';
import { logAudit } from '@/lib/audit';

const resend = new Resend(process.env.RESEND_API_KEY || '');
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const RESEND_FROM = process.env.RESEND_FROM || 'Lending Platform <support@247sparkplug.com>';

export async function uploadOrganizationLogo(formData: FormData) {
  const file = formData.get('file') as File;
  const orgId = formData.get('orgId') as string;

  if (!file || !orgId) {
    throw new Error('Missing file or organization ID');
  }

  const ext = file.name.split('.').pop() || 'png';
  const fileName = `${orgId}-logo-${Date.now()}.${ext}`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from('organization-documents')
    .upload(fileName, file, { upsert: true });

  if (uploadError) {
    console.error('Storage upload error:', uploadError);
    throw new Error(uploadError.message || 'Storage upload failed');
  }

  const { data: urlData } = supabaseAdmin.storage
    .from('organization-documents')
    .getPublicUrl(fileName);

  return { publicUrl: urlData.publicUrl, fileName };
}

export async function approveOrganization(appId: string) {
  try {
    // The heavy lifting (parent resolution from pending.parent_organization_id, root ensure, role=ORG_ADMIN for L1) lives in approveAndCreateOrganization
    const result = await approveAndCreateOrganization(appId);
    // Log key mutation: org approval (and resulting org creation)
    await logAudit({
      userId: null,
      organizationId: (result as any)?.organizationId || null,
      action: 'organization_approved',
      resourceType: 'organization',
      resourceId: (result as any)?.organizationId || appId,
      details: { via: 'approveOrganization action', pending_app_id: appId },
    });
    const r = (result || {}) as any;
    return { ...r, success: true };
  } catch (error: any) {
    console.error("Approve error:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Server action to ensure the platform root exists (callable from admin UI or seed).
 */
export async function ensurePlatformRootOrg() {
  const id = await ensureRootOrganization();
  return { success: true, rootOrgId: id, name: ROOT_ORG_NAME };
}

/**
 * List potential Level 1 sponsors (approved orgs whose parent is the root).
 * Used by apply/organization form for Level 2 applicants to choose sponsorship.
 * Hidden root itself is excluded.
 */
export async function listLevelOneSponsors() {
  if (!supabaseAdmin) return { sponsors: [] };
  const rootId = await ensureRootOrganization();
  const { data } = await supabaseAdmin
    .from('organizations')
    .select('id, name, slug, logo_url, primary_color')
    .eq('approved', true)
    .eq('parent_organization_id', rootId)
    .order('name', { ascending: true });
  return { sponsors: data || [] };
}

/**
 * For a given user + their org, return visible product org ids (own + for L2: parent's; never upward child's).
 * Uses the permissions filter logic.
 */
export async function getVisibleProductOrgIdsForUser(userId: string, userOrgId: string | null, userRole: string) {
  if (!supabaseAdmin || !userOrgId) return [userOrgId].filter(Boolean);
  // preload a small parent map for the user's relevant tree (L1 + direct children)
  const { data: relatedOrgs } = await supabaseAdmin
    .from('organizations')
    .select('id, parent_organization_id')
    .or(`id.eq.${userOrgId},parent_organization_id.eq.${userOrgId}`);
  const parentMap: Record<string, string | null> = {};
  (relatedOrgs || []).forEach((o: any) => { parentMap[o.id] = o.parent_organization_id ?? null; });

  // For L2 user, also include the parent's siblings? No, only direct parent + own.
  const userParent = parentMap[userOrgId] ?? null;
  if (userParent) {
    parentMap[userParent] = parentMap[userParent] ?? (await getOrganizationParentId(userParent)); // ensure
  }

  const { data: prods } = await supabaseAdmin
    .from('loan_products')
    .select('organization_id')
    .not('organization_id', 'is', null);

  const uniqueProdOrgs = Array.from(new Set((prods || []).map((p: any) => p.organization_id).filter(Boolean)));

  // Build fake user for filter
  const fakeUser = { id: userId, role: userRole, organization_id: userOrgId };
  const visible = filterVisibleProductsForUser(fakeUser as any, uniqueProdOrgs.map(o => ({ organization_id: o })), (oid: string) => parentMap[oid] ?? null, { parentMap });

  return Array.from(new Set(visible.map((v: any) => v.organization_id).filter(Boolean)));
}

export async function rejectOrganization(appId: string) {
  try {
    const { supabase } = await import('@/lib/supabase');

    const { error } = await supabase
      .from('pending_organizations')
      .update({ 
        status: 'rejected',
        reviewed_at: new Date().toISOString()
      })
      .eq('id', appId);

    if (error) throw error;

    await logAudit({
      userId: null,
      organizationId: null,
      action: 'organization_rejected',
      resourceType: 'pending_organization',
      resourceId: appId,
      details: { via: 'rejectOrganization action' },
    });

    return { success: true };
  } catch (error: any) {
    console.error("Reject error:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Properly add a user to an organization.
 * Creates a real Supabase Auth user (using admin), then ensures profile + sets org_id.
 * Follows the same pattern as additional_users creation in approve flow.
 * Returns temp password so admin can communicate it to the new user.
 */
export async function addUserToOrganization(
  email: string,
  fullName: string,
  role: string,
  organizationId: string
) {
  if (!supabaseAdmin) {
    throw new Error('SUPABASE_SECRET_KEY not configured for admin operations');
  }

  const tempPassword = 'TempPass123!'; // In production, generate random + force reset or use invite link

  try {
    // Robust lookup first: handle "user created before org" (pre-existing auth user from OTP signup or prior manual create, missing/wrong org_id or role=BROKER_AE)
    let targetId = await findUserIdByEmail(email);
    if (targetId) {
      // Existing auth user (common when user signed up via Get Started / apply before org approved, or added via other means)
      await ensureUserInOrganization(targetId, organizationId, role, fullName, email);
      console.log('✅ addUserToOrganization: linked pre-existing user', email, 'as', role, 'to', organizationId);
      return { success: true, userId: targetId, tempPassword: null, message: 'Linked existing user (no new password; they can use prior credentials or reset).' };
    }

    // Truly new: create auth user
    const { data: authUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { full_name: fullName, role },
    });

    if (createErr || !authUser?.user) {
      throw new Error(createErr?.message || 'Failed to create auth user');
    }

    const newUserId = authUser.user.id;

    // Use the shared ensure (handles profiles + users table + metadata, with created_at safety)
    await ensureUserInOrganization(newUserId, organizationId, role, fullName, email);

    await logAudit({
      userId: newUserId,
      organizationId,
      action: 'user_added_to_org',
      resourceType: 'user',
      resourceId: newUserId,
      details: { role, email, full_name: fullName, via: 'addUserToOrganization' },
    });

    return { success: true, userId: newUserId, tempPassword };
  } catch (error: any) {
    console.error('addUserToOrganization error:', error);
    throw error;
  }
}

/**
 * Fully delete a user: removes from profiles, legacy users table, and Supabase Auth.
 * Use for complete cleanup (e.g. test users or admin full-delete).
 */
export async function fullDeleteUser(userId: string, currentUserId?: string | null) {
  if (!supabaseAdmin) throw new Error('SUPABASE_SECRET_KEY not configured');

  // Capture details for audit before destructive ops
  const { data: prof } = await supabaseAdmin.from('profiles').select('email, organization_id, role, full_name').eq('id', userId).maybeSingle();
  const { data: legacy } = await supabaseAdmin.from('profiles').select('email, organization_id').eq('id', userId).maybeSingle();

  try {
    // 1. Public schema tables (profiles is source of truth; legacy users table fully removed)
    await supabaseAdmin.from('profiles').delete().eq('id', userId);

    // 2. Auth user (this is what actually removes login ability)
    const { error: authErr } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (authErr) {
      // Non-fatal if already gone (e.g. previous partial delete)
      console.warn('Auth user delete warning (may already be absent):', authErr.message);
    }

    // 3. Audit
    await logAudit({
      userId: currentUserId || null,
      organizationId: prof?.organization_id || legacy?.organization_id || null,
      action: 'user_fully_deleted',
      resourceType: 'user',
      resourceId: userId,
      details: {
        email: prof?.email || legacy?.email || null,
        full_name: prof?.full_name || null,
        previous_org_id: prof?.organization_id || null,
        previous_role: prof?.role || null,
        via: 'fullDeleteUser',
      },
    });

    return { success: true };
  } catch (error: any) {
    console.error('fullDeleteUser error:', error);
    throw error;
  }
}

/**
 * Remove a user from the organization (clear organization_id on their profile/users row).
 * Does NOT delete the auth user or profile.
 */
export async function removeUserFromOrganization(userId: string) {
  if (!supabaseAdmin) {
    throw new Error('SUPABASE_SECRET_KEY not configured');
  }

  try {
    // Fetch org before clearing for audit details (best effort)
    const { data: prof } = await supabaseAdmin.from('profiles').select('organization_id, role').eq('id', userId).maybeSingle();
    const orgId = prof?.organization_id || null;

    await supabaseAdmin.from('profiles').update({ organization_id: null }).eq('id', userId);
    // legacy users removed - only profiles
    // await supabaseAdmin.from('users').update({ organization_id: null }).eq('id', userId); // removed

    await logAudit({
      userId,
      organizationId: orgId,
      action: 'user_removed_from_org',
      resourceType: 'user',
      resourceId: userId,
      details: { cleared_org: orgId, previous_role: prof?.role },
    });

    return { success: true };
  } catch (error: any) {
    console.error('removeUserFromOrganization error:', error);
    throw error;
  }
}

/**
 * Update a user's details within an organization (full_name and/or role).
 * Updates profiles (source of truth) and syncs auth user_metadata.
 * Does not change organization membership.
 */
export async function updateUserInOrganization(
  userId: string,
  fullName?: string,
  role?: string
) {
  if (!supabaseAdmin) {
    throw new Error('SUPABASE_SECRET_KEY not configured');
  }

  try {
    const { data: prof } = await supabaseAdmin
      .from('profiles')
      .select('organization_id, email, full_name, role')
      .eq('id', userId)
      .maybeSingle();

    const orgId = prof?.organization_id || null;

    const update: any = { updated_at: new Date().toISOString() };
    if (fullName !== undefined) update.full_name = fullName || null;
    if (role !== undefined) update.role = role;

    if (Object.keys(update).length > 1) { // more than just updated_at
      await supabaseAdmin.from('profiles').update(update).eq('id', userId);
    }

    // Sync to auth metadata (for any code that reads from user_metadata.role etc.)
    const metaUpdate: any = {};
    if (fullName !== undefined) metaUpdate.full_name = fullName || null;
    if (role !== undefined) metaUpdate.role = role;
    if (Object.keys(metaUpdate).length > 0) {
      await supabaseAdmin.auth.admin.updateUserById(userId, {
        user_metadata: metaUpdate,
      });
    }

    await logAudit({
      userId,
      organizationId: orgId,
      action: 'user_updated',
      resourceType: 'user',
      resourceId: userId,
      details: { 
        full_name: fullName !== undefined ? fullName : undefined, 
        role: role !== undefined ? role : undefined,
        previous_full_name: prof?.full_name,
        previous_role: prof?.role,
        via: 'updateUserInOrganization' 
      },
    });

    return { success: true };
  } catch (error: any) {
    console.error('updateUserInOrganization error:', error);
    throw error;
  }
}

const TREASURY_SERIES: Record<string, string> = {
  'DGS2': 'DGS2',
  'DGS5': 'DGS5',
  'DGS10': 'DGS10',
  'DGS30': 'DGS30',
};

export async function fetchTreasuryRate(seriesId: string) {
  const apiKey = process.env.FRED_API_KEY || '9bb15072962d5692449f678f336499a0';
  const url = `https://fred.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=1`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      const txt = await res.text();
      return { error: `FRED error: ${res.status} ${txt}` };
    }
    const data = await res.json();
    const obs = data.observations?.[0];
    const rate = parseFloat(obs?.value);
    if (isNaN(rate)) return { error: 'No valid rate from FRED' };
    return { rate, date: obs.date, seriesId };
  } catch (e: any) {
    console.error('fetchTreasuryRate error', e);
    return { error: e.message || 'Failed to fetch from FRED' };
  }
}

export async function setOrgBenchmark(organizationId: string, benchmark: string | null) {
  if (!supabaseAdmin) throw new Error('SUPABASE_SECRET_KEY not configured');
  const { error } = await supabaseAdmin
    .from('organizations')
    .update({ benchmark_treasury: benchmark })
    .eq('id', organizationId);
  if (error) throw error;

  await logAudit({
    userId: null,
    organizationId,
    action: 'org_benchmark_updated',
    resourceType: 'organization',
    resourceId: organizationId,
    details: { benchmark_treasury: benchmark },
  });
  return { success: true };
}

export async function rebaseProductBaseRates(productId: string, organizationId: string) {
  if (!supabaseAdmin) throw new Error('SUPABASE_SECRET_KEY not configured');
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('benchmark_treasury')
    .eq('id', organizationId)
    .single();
  const benchmark = org?.benchmark_treasury;
  if (!benchmark) return { error: 'No benchmark set for organization' };

  const current = await fetchTreasuryRate(benchmark);
  if (current.error) return current;

  const { data: prod } = await supabaseAdmin
    .from('loan_products')
    .select('pricing_matrix')
    .eq('id', productId)
    .single();

  let matrix: any = prod?.pricing_matrix || {};
  if (typeof matrix === 'string') {
    try { matrix = JSON.parse(matrix); } catch { matrix = {}; }
  }

  const baseRates = matrix.baseRates || matrix['Base Rate'] || {};
  if (Object.keys(baseRates).length === 0) return { error: 'No baseRates in this product' };

  let anchor = matrix.benchmark_anchor_rate;
  if (anchor == null || isNaN(parseFloat(anchor))) {
    // First time, set anchor without shift
    matrix.benchmark_anchor_rate = current.rate;
    matrix.benchmark = benchmark;
    await supabaseAdmin.from('loan_products').update({ pricing_matrix: matrix }).eq('id', productId);

    await logAudit({
      userId: null,
      organizationId,
      action: 'product_base_rates_rebased',
      resourceType: 'product',
      resourceId: productId,
      details: { delta: 0, newAnchor: current.rate, benchmark, message: 'anchor set' },
    });
    return { success: true, delta: 0, message: 'Anchor set to current rate, no shift applied yet.' };
  }

  const delta = (current.rate || 0) - parseFloat(anchor);
  const newBaseRates: Record<string, any> = {};
  for (const [rateStr, price] of Object.entries(baseRates)) {
    const newRate = (parseFloat(rateStr) + delta).toFixed(3);
    newBaseRates[newRate] = price;
  }

  matrix.baseRates = newBaseRates;
  matrix.benchmark_anchor_rate = current.rate;
  matrix.benchmark = benchmark;

  await supabaseAdmin.from('loan_products').update({ pricing_matrix: matrix }).eq('id', productId);

  await logAudit({
    userId: null,
    organizationId,
    action: 'product_base_rates_rebased',
    resourceType: 'product',
    resourceId: productId,
    details: { delta, newAnchor: current.rate, benchmark },
  });
  return { success: true, delta, newAnchor: current.rate };
}

export async function globalRebaseBaseRates(organizationId: string) {
  if (!supabaseAdmin) throw new Error('SUPABASE_SECRET_KEY not configured');
  const { data: prods } = await supabaseAdmin
    .from('loan_products')
    .select('id')
    .eq('organization_id', organizationId);
  const results: any[] = [];
  for (const p of prods || []) {
    const r = await rebaseProductBaseRates(p.id, organizationId);
    results.push({ productId: p.id, ...r });
  }
  return { success: true, results };
}

/**
 * Server action to fetch users for an org using admin client (bypasses RLS).
 * Used by the client-side /admin/organizations/[id]/users page so SUPER_ADMIN and org admins
 * can see the full list even if RLS policies are strict on the regular supabase client.
 */
export async function getOrganizationUsers(organizationId: string) {
  if (!supabaseAdmin) throw new Error('SUPABASE_SECRET_KEY not configured');
  const [{ data: profData }, { data: org }] = await Promise.all([
    supabaseAdmin
      .from('profiles')
      .select('id, email, full_name, role, created_at')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('organizations')
      .select('name')
      .eq('id', organizationId)
      .maybeSingle(),
  ]);

  // Only profiles (legacy 'users' table fully removed)
  const merged = (profData || []).map((p: any) => ({
    id: p.id,
    email: p.email,
    full_name: p.full_name,
    role: p.role,
    created_at: p.created_at,
  }));

  return { 
    users: merged,
    orgName: org?.name || ''
  };
}

/**
 * Thin wrapper so client components (e.g. dashboard) can call the ensure for the current logged-in user.
 * Guarantees a row exists in both profiles and users tables with organization_id + role (used by user lists + admin views).
 */
export async function ensureUserInOrg(userId: string, organizationId: string, role: string, fullName?: string, email?: string) {
  const { ensureUserInOrganization } = await import('@/lib/create-organization');
  await ensureUserInOrganization(userId, organizationId, role, fullName, email);
}

// ====================== BULK BASE RATE UPDATE (FRED-driven page) ======================
// Dedicated for /admin/products/update-all (and linked from products "Update All Products Rates").
// - Supports FRED API (via existing fetchTreasuryRate), frequency choice (UI only for now; stored), margin between treasury and base.
// - Blended: single series (DGS2/5/10/30) OR custom weighted (inputs 2/5/10/30 %).
// - "Only if user chooses FRED Driven updates": caller passes useFred=true for live; else falls back to stored benchmark rebase (existing globalRebase preserved).
// - Subset support: productIds; per-product before/after shown in UI (computed here too for preview).
// - Apply: updates org master baseRates (new column + raw fallback) + copies (rebased or direct) to selected/all products' pricing_matrix.baseRates.
// - Uses existing rebase logic (refactored compute) + direct for FRED anchor snapshot.
// - Snapshot anchor always on FRED path. Preserves per-product rebase buttons in /admin/products/[id].
// - Permissions: caller (UI) gates to ORG_ADMIN + L1-level (via isOrgAdmin/canManageOrg/hasPermission in products + dashboard).

function parseMatrix(raw: any): any {
  if (!raw) return {};
  if (typeof raw === 'string') { try { return JSON.parse(raw); } catch { return {}; } }
  return raw || {};
}

export async function computeFredEffectiveRate(params: {
  series?: string | null;
  weights?: Record<string, number> | null; // e.g. { DGS2: 0.3, DGS5: 0.3, DGS10: 0.2, DGS30: 0.2 }
  margin?: number;
}): Promise<{ effective: number; details: any; error?: string }> {
  const margin = params.margin || 0;
  const weights = params.weights || null;
  const series = params.series || null;

  try {
    if (weights && Object.keys(weights).length > 0) {
      // Blended weighted from provided % (assume keys DGS2 etc or 2/5/10/30 map inside)
      const seriesMap: Record<string, string> = { '2': 'DGS2', '5': 'DGS5', '10': 'DGS10', '30': 'DGS30', DGS2: 'DGS2', DGS5: 'DGS5', DGS10: 'DGS10', DGS30: 'DGS30' };
      let totalW = 0;
      let weightedSum = 0;
      const fetched: Record<string, any> = {};
      for (const [k, w] of Object.entries(weights)) {
        const s = seriesMap[k] || k;
        const r = await fetchTreasuryRate(s);
        if (r.error) return { effective: 0, details: {}, error: r.error };
        const ww = Number(w) || 0;
        totalW += ww;
        weightedSum += (r.rate || 0) * ww;
        fetched[s] = r;
      }
      const blended = totalW > 0 ? (weightedSum / totalW) : 0;
      const effective = parseFloat((blended + margin).toFixed(3));
      return { effective, details: { mode: 'blended', weights, fetched, margin, blendedTreasury: parseFloat(blended.toFixed(3)) } };
    }

    // Single series or default
    const s = series || 'DGS10';
    const r = await fetchTreasuryRate(s);
    if (r.error) return { effective: 0, details: {}, error: r.error };
    const effective = parseFloat(((r.rate || 0) + margin).toFixed(3));
    return { effective, details: { mode: 'single', series: s, rate: r.rate, date: r.date, margin, effective } };
  } catch (e: any) {
    return { effective: 0, details: {}, error: e.message || 'compute failed' };
  }
}

// Internal: shared compute for rebase/direct using explicit currentRate (for FRED override) vs stored.
function applyRateShiftToBaseRates(baseRates: Record<string, any>, oldAnchor: number | null, newCurrent: number, benchmarkLabel: string) {
  const newBase: Record<string, any> = {};
  if (!baseRates || Object.keys(baseRates).length === 0) {
    // seed a simple table around the new current if empty
    const base = newCurrent;
    newBase[base.toFixed(3)] = 100;
    newBase[(base + 0.125).toFixed(3)] = 99.5;
    newBase[(base - 0.125).toFixed(3)] = 100.5;
    return { newBaseRates: newBase, delta: 0, newAnchor: newCurrent };
  }
  let delta = 0;
  if (oldAnchor != null && !isNaN(parseFloat(String(oldAnchor)))) {
    delta = newCurrent - parseFloat(String(oldAnchor));
  } else {
    // first time: anchor only, no shift yet (matches prior rebase behavior)
    delta = 0;
  }
  for (const [rateStr, price] of Object.entries(baseRates)) {
    const newRate = (parseFloat(rateStr) + delta).toFixed(3);
    newBase[ newRate ] = price;
  }
  return { newBaseRates: newBase, delta, newAnchor: newCurrent };
}

export async function bulkFredBaseRateUpdate(
  organizationId: string,
  options: {
    useFred?: boolean;
    series?: string | null;
    weights?: Record<string, number> | null;
    margin?: number;
    frequency?: 'daily' | 'intraday-9am' | 'intraday-1pm' | string;
    productIds?: string[]; // subset; empty/undefined = all for org (visible ones resolved server-side)
    // If not useFred, falls back to stored benchmark + existing global logic (but per selected)
  }
) {
  if (!supabaseAdmin) throw new Error('SUPABASE_SECRET_KEY not configured');
  const { useFred = true, series, weights, margin = 0, frequency = 'daily', productIds } = options || {};

  let effectiveRate: number | null = null;
  let fredDetails: any = {};
  let benchmarkToStore = series || 'BLENDED';

  if (useFred) {
    const comp = await computeFredEffectiveRate({ series, weights, margin });
    if (comp.error) return { success: false, error: comp.error };
    effectiveRate = comp.effective;
    fredDetails = comp.details;
    // store blended or series
    if (weights && Object.keys(weights).length) benchmarkToStore = 'BLENDED';
  } else {
    // Fallback: use org's stored benchmark (existing path)
    const { data: org } = await supabaseAdmin.from('organizations').select('benchmark_treasury').eq('id', organizationId).maybeSingle();
    benchmarkToStore = org?.benchmark_treasury || 'DGS10';
    const cur = await fetchTreasuryRate(benchmarkToStore);
    if (cur.error) return { success: false, error: cur.error };
    effectiveRate = (cur.rate || 0) + (margin || 0);
    fredDetails = { mode: 'stored-benchmark-fallback', benchmark: benchmarkToStore, rate: cur.rate };
  }

  // Update org master baseRates (requires column; see SQL in final writeup). Fallback to raw_attrs for safety.
  const masterPayload = {
    effective: effectiveRate,
    margin,
    frequency,
    series: benchmarkToStore,
    weights: weights || null,
    last_fred: fredDetails,
    updated_at: new Date().toISOString(),
    // store a simple template (single effective as representative "base" for master; full tables live on products)
    base: effectiveRate,
  };
  try {
    await supabaseAdmin.from('organizations').update({
      benchmark_treasury: benchmarkToStore,
      base_rates: masterPayload,
      // also merge into raw for compat if column missing in some envs
      raw_attrs: { ...( (await supabaseAdmin.from('organizations').select('raw_attrs').eq('id', organizationId).maybeSingle()).data?.raw_attrs || {} ), master_base_rates: masterPayload, last_bulk_fred: fredDetails },
    }).eq('id', organizationId);
  } catch (e) {
    // column may not exist yet; still proceed with products + raw
    await supabaseAdmin.from('organizations').update({
      benchmark_treasury: benchmarkToStore,
      raw_attrs: { ...( (await supabaseAdmin.from('organizations').select('raw_attrs').eq('id', organizationId).maybeSingle()).data?.raw_attrs || {} ), base_rates: masterPayload, master_base_rates: masterPayload, last_bulk_fred: fredDetails },
    }).eq('id', organizationId);
  }

  // Resolve target products: if productIds provided use them (caller filtered), else all for this org (server does not do full visibility here; UI responsible + perms gate)
  let targetIds = productIds && productIds.length ? productIds : [];
  if (!targetIds.length) {
    const { data: prods } = await supabaseAdmin.from('loan_products').select('id').eq('organization_id', organizationId);
    targetIds = (prods || []).map((p: any) => p.id);
  }

  const results: any[] = [];
  for (const pid of targetIds) {
    try {
      const { data: prod } = await supabaseAdmin.from('loan_products').select('pricing_matrix, name').eq('id', pid).maybeSingle();
      let matrix: any = parseMatrix(prod?.pricing_matrix);
      const baseRates = matrix.baseRates || matrix['Base Rate'] || matrix['baseRates'] || {};
      const oldAnchor = matrix.benchmark_anchor_rate != null ? parseFloat(matrix.benchmark_anchor_rate) : null;

      // Use FRED effective as the new "current" for anchor/shift. Snapshot it.
      const shiftRes = applyRateShiftToBaseRates(baseRates, oldAnchor, effectiveRate!, benchmarkToStore);

      matrix.baseRates = shiftRes.newBaseRates;
      matrix.benchmark_anchor_rate = shiftRes.newAnchor;
      matrix.benchmark = benchmarkToStore;
      matrix.last_fred_bulk = { at: new Date().toISOString(), effective: effectiveRate, margin, frequency, details: fredDetails };
      // If org master, optionally reference
      matrix.org_master_base_rates_ref = masterPayload;

      await supabaseAdmin.from('loan_products').update({ pricing_matrix: matrix }).eq('id', pid);

      await logAudit({
        userId: null,
        organizationId,
        action: 'product_base_rates_rebased',
        resourceType: 'product',
        resourceId: pid,
        details: { via: 'bulkFredBaseRateUpdate', delta: shiftRes.delta, newAnchor: shiftRes.newAnchor, benchmark: benchmarkToStore, fred: fredDetails, margin, useFred },
      });

      results.push({ productId: pid, name: prod?.name, success: true, delta: shiftRes.delta, newAnchor: shiftRes.newAnchor, beforeKeys: Object.keys(baseRates).length, afterKeys: Object.keys(shiftRes.newBaseRates).length });
    } catch (pe: any) {
      results.push({ productId: pid, success: false, error: pe.message });
    }
  }

  await logAudit({
    userId: null,
    organizationId,
    action: 'org_base_rates_bulk_updated',
    resourceType: 'organization',
    resourceId: organizationId,
    details: { useFred, effective: effectiveRate, margin, frequency, series: benchmarkToStore, weights, numProducts: results.length, fredDetails },
  });

  return { success: true, effectiveRate, fredDetails, master: masterPayload, results, benchmark: benchmarkToStore };
}

// ====================== MATRIX AUTO-USE FOR CREDIT/APPRAISAL ORDERS ======================
// Snapshots the loan's *current* product pricing_matrix (full, incl baseRates/grids/Other Adjustments + org benchmark/anchor + live FRED if set)
// into loan.notes using marker e.g. [PRICING-MATRIX-SNAPSHOT:credit 2026-06-...]\n{json}
// Used by credit report button and Reggora appraisal orders (both loans/[id] and dashboard).
// Light matrix consumption: scans 'Other Adjustments' (and variants) for credit/appraisal keys to derive/adjust fees/costs (graceful to defaults).
// No schema change: uses existing `notes` (string) + `documents` table for optional credit row.
// All via supabaseAdmin. Callers must be non-borrower (enforced in UI pages).

function parsePricingMatrix(raw: any): any {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return raw || {};
}

function getOtherAdjustments(matrix: any): Record<string, any> {
  const m = parsePricingMatrix(matrix);
  return m['Other Adjustments'] || m['otherAdjustments'] || m['Other Adjustment'] || {};
}

/**
 * Light auto-use of product's matrix for credit cost.
 * If Other Adjustments has key ~ /credit|report|bureau/i , parse numeric (or from LTV subobj) and use as cost.
 * Fallback to org default (or 29.99).
 */
function deriveCreditCostFromMatrix(matrix: any, orgDefaultCost: number): number {
  const other = getOtherAdjustments(matrix);
  for (const [key, val] of Object.entries(other)) {
    if (/credit|report|bureau/i.test(String(key))) {
      let numVal = val;
      if (numVal && typeof numVal === 'object' && !Array.isArray(numVal)) {
        const vals = Object.values(numVal as any).filter((v: any) => !isNaN(parseFloat(v)));
        numVal = vals.length > 0 ? vals[0] : 0;
      }
      const n = parseFloat(String(numVal));
      if (!isNaN(n) && n > 0) {
        return n; // matrix-driven override for this order
      }
    }
  }
  return orgDefaultCost;
}

/**
 * Light auto-use of product's matrix for suggested appraisal additional fee.
 * Scans Other Adjustments for /apprais|valuation|inspection/i key -> numeric (or subobj).
 * Alt: derive from avg baseRates price (100 - avg as proxy, scaled to fee range 200-950).
 * Fallback baseFee.
 */
function deriveAppraisalFeeFromMatrix(matrix: any, baseFee: number = 650): number {
  const other = getOtherAdjustments(matrix);
  for (const [key, val] of Object.entries(other)) {
    if (/apprais|valuation|inspection/i.test(String(key))) {
      let numVal = val;
      if (numVal && typeof numVal === 'object' && !Array.isArray(numVal)) {
        const vals = Object.values(numVal as any).filter((v: any) => !isNaN(parseFloat(v)));
        numVal = vals.length > 0 ? vals[0] : 0;
      }
      const n = parseFloat(String(numVal));
      if (!isNaN(n)) {
        return n !== 0 ? n : baseFee;
      }
    }
  }
  // derive from baseRates (standard-dscr etc)
  const m = parsePricingMatrix(matrix);
  const br = m.baseRates || m['Base Rate'] || m['baseRates'] || {};
  const priceVals: number[] = Object.values(br)
    .map((v: any) => parseFloat(String(v)))
    .filter((n) => !isNaN(n));
  if (priceVals.length > 0) {
    const avgPrice = priceVals.reduce((a, b) => a + b, 0) / priceVals.length;
    const proxy = Math.abs(100 - avgPrice);
    const scaled = Math.round(Math.max(200, Math.min(950, proxy * 350)));
    return scaled;
  }
  return baseFee;
}

export async function snapshotPricingMatrixForLoan(
  loanId: number,
  snapshotType: 'credit' | 'appraisal'
): Promise<{ success?: boolean; snapshot?: any; error?: string }> {
  if (!supabaseAdmin) {
    return { error: 'SUPABASE_SECRET_KEY not configured for admin operations' };
  }
  try {
    const { data: loan } = await supabaseAdmin
      .from('loans')
      .select('*')
      .eq('id', loanId)
      .single();
    if (!loan) return { error: 'Loan not found' };

    let prod: any = null;
    let matrix: any = {};
    if (loan.product_id) {
      const { data: p } = await supabaseAdmin
        .from('loan_products')
        .select('*')
        .eq('id', loan.product_id)
        .single();
      prod = p;
      matrix = parsePricingMatrix(p?.pricing_matrix);
    }

    let org: any = null;
    let liveRate: any = null;
    if (loan.organization_id) {
      const { data: o } = await supabaseAdmin
        .from('organizations')
        .select('id, name, benchmark_treasury')
        .eq('id', loan.organization_id)
        .single();
      org = o;
      if (org?.benchmark_treasury) {
        const treasRes = await fetchTreasuryRate(org.benchmark_treasury);
        if (!treasRes.error) liveRate = treasRes;
      }
    }

    const snapshot = {
      snapshotType,
      productId: loan.product_id || null,
      productName: prod?.name || null,
      matrix,
      orgBenchmark: org?.benchmark_treasury || null,
      anchor: matrix?.benchmark_anchor_rate ?? matrix?.benchmark ?? null,
      liveRate: liveRate ? { rate: liveRate.rate, date: liveRate.date, seriesId: liveRate.seriesId } : null,
      at: new Date().toISOString(),
    };

    const marker = `\n[PRICING-MATRIX-SNAPSHOT:${snapshotType} ${snapshot.at}]\n${JSON.stringify(snapshot)}`;
    const currentNotes = (loan.notes || '') as string;
    const newNotes = currentNotes + marker;

    await supabaseAdmin
      .from('loans')
      .update({ notes: newNotes, updated_at: new Date().toISOString() })
      .eq('id', loanId);

    return { success: true, snapshot };
  } catch (e: any) {
    console.error('snapshotPricingMatrixForLoan error', e);
    return { error: e.message || 'Failed to snapshot matrix' };
  }
}

export async function orderCreditReportForLoan(loanId: number): Promise<{
  success: boolean;
  cost?: number;
  passedToBorrower?: boolean;
  matrixUsed?: string;
  summary?: string;
  snapshot?: any;
  error?: string;
}> {
  if (!supabaseAdmin) {
    return { success: false, error: 'SUPABASE_SECRET_KEY not configured' };
  }
  try {
    const { data: loan } = await supabaseAdmin
      .from('loans')
      .select('*')
      .eq('id', loanId)
      .single();
    if (!loan) return { success: false, error: 'Loan not found' };

    const prodRes = loan.product_id
      ? await supabaseAdmin.from('loan_products').select('*').eq('id', loan.product_id).single()
      : { data: null };
    const prod = prodRes.data;

    const orgRes = loan.organization_id
      ? await supabaseAdmin
          .from('organizations')
          .select('id, name, pass_credit_report_costs_to_borrower, credit_report_cost_amount, benchmark_treasury')
          .eq('id', loan.organization_id)
          .single()
      : { data: null };
    const org = orgRes.data;

    const defaultCost = 29.99;
    const orgCost = org?.credit_report_cost_amount != null ? Number(org.credit_report_cost_amount) : defaultCost;

    let effectiveCost = orgCost;
    if (prod?.pricing_matrix) {
      effectiveCost = deriveCreditCostFromMatrix(prod.pricing_matrix, orgCost);
    }

    const passedToBorrower = !!org?.pass_credit_report_costs_to_borrower;

    // Always snapshot (graceful if no product: empty matrix + note)
    const snap = await snapshotPricingMatrixForLoan(loanId, 'credit');

    // Optional: add "Credit Report" documents row (NEEDED) so it appears in conditions list
    try {
      await supabaseAdmin.from('documents').insert({
        loan_id: loanId,
        doc_type: 'credit_report',
        file_name: 'Credit Report',
        status: 'NEEDED',
        description: `Auto-ordered using product matrix context @ ${new Date().toISOString().slice(0,10)}. Cost $${effectiveCost.toFixed(2)}. ${passedToBorrower ? 'Passed to borrower per org' : 'Org absorbs'}.`,
      });
    } catch (docErr: any) {
      console.warn('Non-fatal: credit_report document insert skipped', docErr?.message);
    }

    return {
      success: true,
      cost: effectiveCost,
      passedToBorrower,
      matrixUsed: prod?.name || (loan.product_id ? String(loan.product_id) : 'no-product'),
      summary: `Credit report order recorded for Loan #${loanId}. Effective cost $${effectiveCost.toFixed(2)}. ${passedToBorrower ? 'Passed to borrower per org settings.' : 'Organization absorbs the cost.'} ${snap.success ? 'Pricing matrix snapshot saved to loan notes for audit (full rates/adjustments at order time).' : '(no matrix snapshot)'}`,
      snapshot: snap.success ? snap.snapshot : null,
    };
  } catch (e: any) {
    console.error('orderCreditReportForLoan error', e);
    return { success: false, error: e.message || 'Failed to order credit report' };
  }
}

/**
 * Generate a fresh signed URL for a stored document URL (public or old signed).
 * Used in admin to view uploaded org docs reliably, even if bucket is private
 * or old public URLs were stored before policies/bucket were set up.
 * Extracts the object path and signs it server-side with admin client (1 week expiry).
 */
export async function getSignedDocumentUrl(storedUrl: string): Promise<string> {
  if (!supabaseAdmin) {
    console.warn('No supabaseAdmin, falling back to stored URL');
    return storedUrl;
  }
  if (!storedUrl || !storedUrl.startsWith('http')) {
    return storedUrl;
  }
  try {
    const url = new URL(storedUrl);
    // pathname like /storage/v1/object/public/organization-documents/org-xxx/...
    // or /storage/v1/object/sign/organization-documents/...
    const parts = url.pathname.split('/');
    const bucketIdx = parts.indexOf('organization-documents');
    if (bucketIdx === -1) {
      return storedUrl;
    }
    const objectPath = parts.slice(bucketIdx + 1).join('/');
    if (!objectPath) {
      return storedUrl;
    }
    const { data, error } = await supabaseAdmin.storage
      .from('organization-documents')
      .createSignedUrl(objectPath, 60 * 60 * 24 * 7); // 7 days
    if (error || !data?.signedUrl) {
      console.error('createSignedUrl failed for', objectPath, error);
      return storedUrl; // fallback
    }
    return data.signedUrl;
  } catch (e: any) {
    console.error('getSignedDocumentUrl error', e);
    return storedUrl;
  }
}

/**
 * AE Referral Invite: send email with apply link ONLY (name/email provided by AE on dashboard).
 * Does NOT create user or temp password here — prospect completes 6-digit OTP sign-up flow
 * (see /sign-up + /apply/organization), then applies; uses standard password/reset flow later.
 * referred_by on the pending_organization (and later organization) will be set to referrerUserId.
 * Called from Senior/Junior AE sections of dashboard.
 */
export async function sendAEProspectInvite(referrerUserId: string, prospectName: string, prospectEmail: string) {
  if (!referrerUserId || !prospectEmail?.trim()) {
    throw new Error('Referrer and prospect email are required for AE invite');
  }
  const applyLink = `${APP_URL}/apply/organization?referred_by=${encodeURIComponent(referrerUserId)}`;
  const safeName = (prospectName || prospectEmail.split('@')[0] || 'there').trim();

  try {
    const { data: sendData, error: sendErr } = await resend.emails.send({
      from: RESEND_FROM,
      to: prospectEmail.trim(),
      subject: `You've been referred to apply on the Lending Platform`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; line-height: 1.5;">
          <h2>Hello ${safeName},</h2>
          <p>An Account Executive has referred you to the Lending Platform.</p>
          <p>Please start your organization application here:</p>
          <p><a href="${applyLink}" style="background:#2563eb;color:white;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block;">Start Organization Application</a></p>
          <p><strong>Important:</strong> Clicking the link takes you to sign-up (6-digit OTP / email code only — no temporary password is created or sent). After verifying with the code and completing the application form, you can use the normal sign-in / password reset flows. Your referrer will be recorded for dashboards and hierarchy.</p>
          <p style="color:#666;font-size:12px;margin-top:24px;">Referred by AE user: ${referrerUserId}<br/>If the link does not preserve the referral, use this param on the apply page: ?referred_by=${referrerUserId}</p>
        </div>
      `,
    });
    if (sendErr) {
      console.error('AE invite send error:', sendErr);
      throw new Error(sendErr.message || 'Failed to send AE referral email');
    }
    console.log('AE prospect invite sent to', prospectEmail, 'resend:', sendData?.id);
    return { success: true };
  } catch (e: any) {
    console.error('sendAEProspectInvite error', e);
    throw e;
  }
}

// ====================== ADJUSTMENT KEYS (Standard Keys / "Manage Standard Keys") ======================
// These power the canonical keys used for Property Type, Prepayment, etc. in pricing (see loans/new dropdowns
// and the matrix lookups). Keys are org-scoped. Writes use supabaseAdmin to bypass RLS (common pattern for
// org config data like this, similar to user management, logo upload, etc.).
// Client page (admin/products/keys) calls these via server actions so that ORG_ADMIN / admins can save
// without hitting restrictive table policies on the regular anon/authenticated client.

export async function createAdjustmentKeyGroup(params: {
  organizationId: string;
  adjustmentType: string;
  canonicalKey: string;
  aliases?: string[];
}) {
  if (!supabaseAdmin) throw new Error('SUPABASE_SECRET_KEY not configured');
  const { organizationId, adjustmentType, canonicalKey, aliases = [] } = params || ({} as any);

  if (!organizationId || !adjustmentType || !canonicalKey?.trim()) {
    throw new Error('organizationId, adjustmentType and canonicalKey are required');
  }

  const { error } = await supabaseAdmin
    .from('adjustment_keys')
    .insert({
      organization_id: organizationId,
      adjustment_type: adjustmentType,
      canonical_key: canonicalKey.trim(),
      display_name: canonicalKey.trim(),
      aliases: Array.isArray(aliases) ? aliases : [],
      // active defaults to true in schema
    });

  if (error) {
    console.error('[createAdjustmentKeyGroup] insert error:', error);
    // Return rich info so the UI can show something useful instead of "undefined"
    const msg = error.message || error.hint || error.details || error.code || 'Unknown database error';
    throw new Error(msg);
  }

  await logAudit({
    userId: null,
    organizationId,
    action: 'adjustment_key_created',
    resourceType: 'adjustment_key',
    resourceId: canonicalKey.trim(),
    details: { adjustmentType, aliases },
  });

  return { success: true };
}

export async function addAliasesToAdjustmentKey(groupId: string | number, additionalAliases: string[]) {
  if (!supabaseAdmin) throw new Error('SUPABASE_SECRET_KEY not configured');
  if (!groupId || !Array.isArray(additionalAliases) || additionalAliases.length === 0) {
    throw new Error('groupId and at least one alias are required');
  }

  // Fetch current to merge (and we could verify org here if needed)
  const { data: group, error: fetchErr } = await supabaseAdmin
    .from('adjustment_keys')
    .select('id, aliases, organization_id, adjustment_type, canonical_key')
    .eq('id', groupId)
    .maybeSingle();

  if (fetchErr || !group) {
    console.error('[addAliasesToAdjustmentKey] fetch error or not found:', fetchErr);
    throw new Error(fetchErr?.message || 'Group not found');
  }

  const currentAliases: string[] = Array.isArray(group.aliases) ? group.aliases : [];
  const merged = Array.from(new Set([...currentAliases, ...additionalAliases]));

  const { error: updateErr } = await supabaseAdmin
    .from('adjustment_keys')
    .update({ aliases: merged })
    .eq('id', groupId);

  if (updateErr) {
    console.error('[addAliasesToAdjustmentKey] update error:', updateErr);
    throw new Error(updateErr.message || 'Failed to update aliases');
  }

  await logAudit({
    userId: null,
    organizationId: group.organization_id || null,
    action: 'adjustment_key_aliases_updated',
    resourceType: 'adjustment_key',
    resourceId: String(groupId),
    details: { canonicalKey: group.canonical_key, added: additionalAliases },
  });

  return { success: true };
}

export async function deleteAdjustmentKey(groupId: string | number, organizationId?: string | null) {
  if (!supabaseAdmin) throw new Error('SUPABASE_SECRET_KEY not configured');
  if (!groupId) throw new Error('groupId is required');

  // Optional: we could fetch first to get org for audit, but delete is simple
  const { error } = await supabaseAdmin
    .from('adjustment_keys')
    .delete()
    .eq('id', groupId);

  if (error) {
    console.error('[deleteAdjustmentKey] error:', error);
    throw new Error(error.message || 'Failed to delete key group');
  }

  await logAudit({
    userId: null,
    organizationId: organizationId || null,
    action: 'adjustment_key_deleted',
    resourceType: 'adjustment_key',
    resourceId: String(groupId),
    details: { via: 'admin/products/keys' },
  });

  return { success: true };
}
// app/api/pending-organizations/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, supabaseAdmin } from '@/lib/supabase';
import { approveAndCreateOrganization, ensureRootOrganization } from '@/lib/create-organization';
import { canApproveOrgs } from '@/lib/permissions'; // TECH_SUPPORT explicitly excluded from approve

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient(request);

    // Get the authenticated user (from email code verification)
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json();

    // Note: parent_organization_id column is uuid typed in some migrations but org IDs are custom 'org_...' strings.
    // To avoid "invalid input syntax for type uuid", we insert null here and stash the desired parent in documents._intended_parent_organization_id.
    // The approve flow (lib/create-organization) will pick it up for the created org's parent_organization_id.
    const intendedParent = body.parent_organization_id || body.sponsor_organization_id || null;
    let docsForInsert = body.documents || null;
    if (intendedParent && typeof docsForInsert === 'object') {
      docsForInsert = { ...docsForInsert, _intended_parent_organization_id: intendedParent };
    } else if (intendedParent) {
      docsForInsert = { _intended_parent_organization_id: intendedParent };
    }

    const { error } = await supabase
      .from('pending_organizations')
      .insert({
        id: crypto.randomUUID(),
        company_name: body.company_name,
        contact_name: body.contact_name || body.full_name,
        email: body.email || user.email,
        phone: body.phone,
        address: body.address,
        city: body.city,
        state: body.state,
        zip: body.zip,
        website: body.website,
        owners: body.owners,
        managers: body.managers,
        additional_users: body.additionalUsers,
        products_offered: body.products,
        notes: body.notes,
        status: 'pending',
        agreement_accepted: !!body.agreement_accepted,
        documents: docsForInsert,
        parent_organization_id: intendedParent || null,
        // Link to the authenticated user who submitted the application.
        // Use both for compatibility (some flows use reviewed_by, the join uses reviewed_by currently).
        submitted_by: user.id,
        reviewed_by: user.id,
        referred_by: body.referred_by || null,
      });

    if (error) {
      console.error("Supabase insert error:", error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // Set PENDING role for the applicant (so they don't get full dashboard access until org approved).
    // Only set if they don't already have a privileged role.
    if (user.id) {
      try {
        const { data: cur } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).maybeSingle();
        const curRole = cur?.role;
        if (!curRole || !['SUPER_ADMIN', 'ADMIN', 'TECH_SUPPORT', 'LENDING_SUPERVISOR'].includes(curRole)) {
          const now = new Date().toISOString();
          await supabaseAdmin.from('profiles').upsert({
            id: user.id,
            email: user.email || body.email,
            full_name: body.contact_name || body.full_name || user.user_metadata?.full_name || null,
            role: 'PENDING',
            created_at: now,
            updated_at: now,
          }, { onConflict: 'id' });
          // Legacy 'users' table removed per requirements - only profiles is used now
        }
      } catch (roleErr) {
        console.warn('Failed to set PENDING role on apply submit:', roleErr);
      }
    }

    return NextResponse.json({ success: true, message: "Application submitted" });
  } catch (err: any) {
    console.error("Server error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createServerClient(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Admin check with service role preference (same as GET). Now supports ORG_ADMIN (scoped).
    // NO legacy 'users' table - removed per requirements. Only profiles + auth meta fallback.
    let role: string | null = null;
    let userOrgId: string | null = null;
    const lookupClient = supabaseAdmin || supabase;
    console.log('[pending-orgs PATCH] starting lookup for user id=', user.id);
    let { data: prof } = await lookupClient.from('profiles').select('role, organization_id').eq('id', user.id).maybeSingle();
    console.log('[pending-orgs PATCH] profiles lookup result:', prof);
    if (prof?.role) {
      role = prof.role;
      userOrgId = prof.organization_id || null;
    }

    // Additional fallback using auth metadata (same as GET) so L1 ORG_ADMINs without full profiles rows can still approve their sponsored apps.
    if (!role) {
      const meta = (user as any).user_metadata || (user as any).raw_user_meta_data || {};
      if (meta.role) role = meta.role;
      console.log('[pending-orgs PATCH] role from auth meta:', role);
    }
    if (!userOrgId && role === 'ORG_ADMIN') {
      const meta = (user as any).user_metadata || (user as any).raw_user_meta_data || {};
      const company = meta.company_name || meta.company || null;
      if (company) {
        const { data: orgByName } = await lookupClient
          .from('organizations')
          .select('id, name')
          .ilike('name', `%${company}%`)
          .maybeSingle();
        if (orgByName?.id) {
          userOrgId = orgByName.id;
          console.log('[pending-orgs PATCH] resolved userOrgId via company_name meta lookup:', company, '->', userOrgId);
        }
      }
    }

    const fakeUserForCheck = { id: user.id, role: role || '', organization_id: userOrgId || null };
    const isApprover = canApproveOrgs(fakeUserForCheck);
    console.log('[pending-orgs PATCH] user=', user?.email || user?.id, 'resolved role=', role, 'userOrgId=', userOrgId, 'isApprover=', isApprover);
    if (!isApprover) {
      return NextResponse.json({ error: "Forbidden - only SUPER_ADMIN/ADMIN/ORG_ADMIN (for their sponsored orgs) may approve organizations" }, { status: 403 });
    }

    const body = await request.json();
    const { id, status } = body;
    if (!id || !['approved', 'rejected'].includes(status)) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    // For ORG_ADMIN, enforce that the specific pending app is one they sponsor (via parent or _intended in documents).
    // Prevents cross-org approval by guessing IDs even if they only see scoped list in GET.
    if (role === 'ORG_ADMIN' && userOrgId) {
      const { data: target } = await (supabaseAdmin || supabase)
        .from('pending_organizations')
        .select('parent_organization_id, documents')
        .eq('id', id)
        .maybeSingle();
      const docs = (target?.documents || {}) as any;
      const intended = docs._intended_parent_organization_id || target?.parent_organization_id || null;
      if (intended !== userOrgId) {
        return NextResponse.json({ error: 'Forbidden - you may only approve or reject applications sponsored by your organization' }, { status: 403 });
      }
    }

    // Delegate approve to the shared lib (handles org create idempotent + links + additionalUsers creation from form + welcome email + pending update)
    // Pass approver (Lender side) signature if the admin drew one on this page — it will be embedded with the applicant's signature in the final PDFs.
    if (status === 'approved') {
      try {
        const approverSig = (body as any).approver_signature || null;
        const result = await approveAndCreateOrganization(id, user.id, approverSig);
        return NextResponse.json({ success: true, orgCreated: true, orgId: result.orgId });
      } catch (approveErr: any) {
        console.error('Approve via lib/create-organization failed:', approveErr);
        return NextResponse.json({ error: 'Failed to approve and create organization: ' + (approveErr.message || approveErr) }, { status: 500 });
      }
    }

    // Reject path (simple status update, no org create)
    const update: any = { status, reviewed_at: new Date().toISOString(), reviewed_by: user.id };

    const { error } = await supabase
      .from('pending_organizations')
      .update(update)
      .eq('id', id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, orgCreated: false });
  } catch (err: any) {
    console.error('PATCH pending orgs error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerClient(request);

    // Get the authenticated user (via Bearer token forwarded from client getSession, or cookies)
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Check if admin (now includes ORG_ADMIN for scoped child-org approvals / white-label L2s).
    // Prefer service role (supabaseAdmin) so RLS on profiles doesn't interfere.
    // NO legacy 'users' table calls - all removed per requirements. Use profiles + auth meta + company name lookup.
    let role: string | null = null;
    let userOrgId: string | null = null;
    const lookupClient = supabaseAdmin || supabase;
    console.log('[pending-orgs GET] starting profile lookup for auth user id=', user.id, 'email=', user.email);
    let { data: prof } = await lookupClient
      .from('profiles')
      .select('role, organization_id')
      .eq('id', user.id)
      .maybeSingle();
    console.log('[pending-orgs GET] profiles lookup result for', user.id, ':', prof);
    if (prof?.role) {
      role = prof.role;
      userOrgId = prof.organization_id || null;
    }

    // Additional fallback using the Supabase Auth user metadata (raw_user_meta_data / user_metadata from the JWT).
    // This covers cases where the user was created via OTP / sign-up flows (or bulk before full profile ensure) and the profiles app tables have no row (or incomplete org_id/role) for this auth id.
    if (!role) {
      const meta = (user as any).user_metadata || (user as any).raw_user_meta_data || {};
      if (meta.role) role = meta.role;
      console.log('[pending-orgs GET] fell back to role from auth meta:', role);
    }
    if (!userOrgId && role === 'ORG_ADMIN') {
      const meta = (user as any).user_metadata || (user as any).raw_user_meta_data || {};
      const company = meta.company_name || meta.company || null;
      if (company) {
        const { data: orgByName } = await lookupClient
          .from('organizations')
          .select('id, name')
          .ilike('name', `%${company}%`)
          .maybeSingle();
        if (orgByName?.id) {
          userOrgId = orgByName.id;
          console.log('[pending-orgs GET] resolved userOrgId via company_name meta lookup for ORG_ADMIN:', company, '->', userOrgId);
        }
      }
    }

    // DEBUG (temporary to diagnose L1 ORG_ADMIN access to /admin/applications): visible in pm2 logs / server console
    console.log('[pending-orgs GET] user=', user?.email || user?.id, 'resolved role=', role, 'userOrgId=', userOrgId, 'allowed=', ['SUPER_ADMIN', 'ADMIN', 'ORG_ADMIN', 'TECH_SUPPORT'].includes(role || ''));

    const allowedViewRoles = ['SUPER_ADMIN', 'ADMIN', 'ORG_ADMIN', 'TECH_SUPPORT'];
    const isAdmin = allowedViewRoles.includes(role || '');
    if (!isAdmin) {
      return NextResponse.json({ error: "Forbidden - admin access required" }, { status: 403 });
    }

    // Fetch applications (service role bypasses RLS).
    // For ORG_ADMIN (L1 tenant admins): scope strictly to applications they sponsor,
    // i.e. where parent_organization_id or documents._intended_parent_organization_id matches their org.
    // (L2 apps created via tenant /apply/organization store the sponsor in _intended... and set parent=null on the pending row.)
    console.log('[pending-orgs GET] building query, role=', role, 'userOrgId=', userOrgId, 'using admin?', !!supabaseAdmin);
    let query = (supabaseAdmin || supabase)
      .from('pending_organizations')
      .select('*')
      .order('created_at', { ascending: false });

    const { data: pending, error } = await query;
    console.log('[pending-orgs GET] query complete, error=', error ? error.message : null, 'rowCount=', (pending || []).length);

    if (error) {
      console.error("Supabase fetch error:", error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // Safe client-side scope for ORG_ADMIN to avoid PostgREST 400 errors from complex jsonb `or()` filter syntax
    // (documents->>'_intended...') seen in previous runs. Matches the safe pattern used in admin/page.tsx stats.
    let applications = pending || [];
    if (role === 'ORG_ADMIN' && userOrgId) {
      applications = applications.filter((r: any) => {
        const docs = (r.documents || {}) as Record<string, any>;
        const intended = docs['_intended_parent_organization_id'] || r.parent_organization_id || null;
        return intended === userOrgId;
      });
      console.log('[pending-orgs GET] applied client-side ORG_ADMIN scope filter for userOrgId=', userOrgId, 'kept', applications.length);
    }

    // Attach submitter + reviewer info via separate profiles query (avoids needing DB FK for embed/relationship)
    // Note: after approval, reviewed_by is the admin, submitted_by remains the original applicant.
    const ids = Array.from(
      new Set(
        (applications || []).flatMap((r: any) => [r.reviewed_by, r.submitted_by, r.referred_by]).filter(Boolean)
      )
    );

    let profilesMap: Record<string, any> = {};
    if (ids.length > 0) {
      const profClient = supabaseAdmin || supabase;
      const { data: profs } = await profClient
        .from('profiles')
        .select('id, full_name, email')
        .in('id', ids);
      profilesMap = Object.fromEntries((profs || []).map((p: any) => [p.id, p]));
    }

    const enriched = (applications || []).map((row: any) => {
      const submitter = profilesMap[row.submitted_by] || profilesMap[row.reviewed_by] || null;
      const reviewer = profilesMap[row.reviewed_by] || null;
      const referredBy = row.referred_by ? (profilesMap[row.referred_by] || null) : null;
      return {
        ...row,
        submitter,
        reviewer: (row.reviewed_by && reviewer && row.reviewed_by !== row.submitted_by) ? reviewer : null,
        referredBy,
      };
    });

    console.log('[pending-orgs GET] returning', (applications || []).length, 'rows (after scope for ORG_ADMIN if applicable)');
    return NextResponse.json({ data: enriched });
  } catch (err: any) {
    console.error("Server error in GET pending-organizations (all statuses):", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

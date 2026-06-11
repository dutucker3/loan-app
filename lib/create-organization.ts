'use server';

import { supabaseAdmin } from './supabase-admin';
import { Resend } from 'resend';
import { pdf, Document, Page, Text, Image } from '@react-pdf/renderer';
import React from 'react';

const resend = new Resend(process.env.RESEND_API_KEY);

const RESEND_FROM = process.env.RESEND_FROM || 'Lending Platform <support@247sparkplug.com>';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

import { ROOT_ORG_NAME, ROOT_ORG_SLUG } from './constants';

/**
 * Ensures the canonical root "Loan-App Platform" organization (Level 0) exists.
 * Creates it (parent=null, approved=true, hidden by convention in UI queries) if missing.
 * Returns its id. Safe to call repeatedly (idempotent by name/slug).
 */
export async function ensureRootOrganization(): Promise<string> {
  if (!supabaseAdmin) throw new Error('SUPABASE_SECRET_KEY not configured');

  // Try by name first (stable), then slug.
  let { data: root } = await supabaseAdmin
    .from('organizations')
    .select('id, name, parent_organization_id')
    .eq('name', ROOT_ORG_NAME)
    .maybeSingle();

  if (!root) {
    const { data: bySlug } = await supabaseAdmin
      .from('organizations')
      .select('id')
      .eq('slug', ROOT_ORG_SLUG)
      .maybeSingle();
    root = bySlug as any;
  }

  if (root?.id) {
    // Ensure it has parent=null (root) and is approved (in case manually edited)
    await supabaseAdmin
      .from('organizations')
      .update({
        parent_organization_id: null,
        approved: true,
        active: true,
        updated_at: new Date().toISOString(),
        is_root: true,
      })
      .eq('id', root.id);
    return root.id;
  }

  // Create it
  const { data: created, error: cerr } = await supabaseAdmin
    .from('organizations')
    .insert({
      name: ROOT_ORG_NAME,
      slug: ROOT_ORG_SLUG,
      primary_color: '#111827',
      approved: true,
      approved_at: new Date().toISOString(),
      approved_by: null,
      active: true,
      parent_organization_id: null,
      raw_attrs: { is_platform_root: true, hidden_from_normal_lists: true },
      is_root: true,
      // base_rates left null; populated via bulk FRED update page for platform master if needed
    })
    .select('id')
    .single();

  if (cerr || !created?.id) {
    console.error('Failed to create root org:', cerr);
    throw new Error('Could not ensure root Loan-App Platform organization: ' + (cerr?.message || 'unknown'));
  }
  console.log('✅ Ensured root Loan-App Platform org:', created.id);
  return created.id;
}

/**
 * Given an org id, return its parent id (or null). Helper for hierarchy walks in permissions etc.
 */
export async function getOrganizationParentId(orgId: string): Promise<string | null> {
  if (!supabaseAdmin || !orgId) return null;
  const { data } = await supabaseAdmin
    .from('organizations')
    .select('parent_organization_id')
    .eq('id', orgId)
    .maybeSingle();
  return data?.parent_organization_id ?? null;
}

/**
 * Helpers to robustly handle "user created before org" scenarios, missing profiles after OTP signup,
 * pre-existing auth users by email, and ensuring the main contact gets ORG_ADMIN role (not BROKER_AE)
 * on organization approval. Also used by add-user flows.
 */
export async function findUserIdByEmail(email: string): Promise<string | null> {
  if (!supabaseAdmin || !email) return null;
  const lowerEmail = email.toLowerCase().trim();

  // Prioritize real auth users (via listUsers) to avoid stale profile rows left after user deletes.
  try {
    const { data: listed } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000, page: 1 });
    const match = listed?.users?.find((au: any) => au.email && au.email.toLowerCase() === lowerEmail);
    if (match?.id) return match.id;
  } catch (e: any) {
    console.warn('listUsers lookup failed for', email, e?.message);
  }

  // Only fall back to profiles/legacy if they have a corresponding live auth user.
  // This prevents using a deleted auth user's profile id for OTP metadata updates.
  const { data: p } = await supabaseAdmin.from('profiles').select('id').eq('email', email).maybeSingle();
  if (p?.id) {
    try {
      const { data: check } = await supabaseAdmin.auth.admin.getUserById(p.id);
      if (check?.user) return p.id;
    } catch {}
  }

  const { data: u } = await supabaseAdmin.from('profiles').select('id').eq('email', email).maybeSingle();
  if (u?.id) {
    try {
      const { data: check } = await supabaseAdmin.auth.admin.getUserById(u.id);
      if (check?.user) return u.id;
    } catch {}
  }

  return null;
}

export async function ensureUserInOrganization(
  userId: string,
  organizationId: string,
  role: string = 'ORG_ADMIN',
  fullName?: string,
  email?: string
) {
  if (!supabaseAdmin || !userId || !organizationId) return;
  const now = new Date().toISOString();
  const baseUpdate = {
    email: email || undefined,
    full_name: fullName || undefined,
    role,
    organization_id: organizationId,
    updated_at: now,
  };

  // Profiles (update then insert fallback to preserve created_at)
  try {
    const { data: up } = await supabaseAdmin
      .from('profiles')
      .update(baseUpdate)
      .eq('id', userId)
      .select('id');
    if (!up || up.length === 0) {
      await supabaseAdmin.from('profiles').insert({
        id: userId,
        ...baseUpdate,
        created_at: now,
      });
    }
  } catch (e: any) {
    console.warn('ensure profile update/insert warn', e?.message);
    try {
      await supabaseAdmin.from('profiles').insert({ id: userId, ...baseUpdate, created_at: now });
    } catch (ie: any) {
      console.warn('profile insert fallback failed', ie?.message);
    }
  }

  // Legacy 'users' table fully removed - only profiles is used for membership/role/org_id.
  // Keep auth user_metadata in sync (some code reads role from there)
  try {
    await supabaseAdmin.auth.admin.updateUserById(userId, {
      user_metadata: { full_name: fullName, role },
    });
  } catch (e: any) {
    console.warn('updateUserById metadata warn (non-fatal)', e?.message);
  }
}

/**
 * Public server action: given an org (already approved), find its main contact email (from raw_attrs or from_email),
 * locate the corresponding auth user (by email in profiles/users/auth list), ensure a profile row exists,
 * set role='ORG_ADMIN' (scoped admin for the org) and organization_id.
 * Safe to call multiple times; idempotent. Use from admin UI to repair cases like "user created before org".
 * Callers (approve flow) use ORG_ADMIN for tenant org contacts.
 */
export async function ensureMainContactForOrganization(organizationId: string, contactEmail?: string, preferredRole: string = 'ORG_ADMIN') {
  if (!supabaseAdmin) throw new Error('SUPABASE_SECRET_KEY not configured');
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('raw_attrs, from_email, name, parent_organization_id')
    .eq('id', organizationId)
    .maybeSingle();
  const email = (contactEmail || org?.raw_attrs?.contact_email || org?.from_email || org?.raw_attrs?.from_email || '').toString().trim();
  if (!email) throw new Error('No contact email known for organization ' + organizationId);
  const name = (org?.raw_attrs?.contact_name || email.split('@')[0] || 'Contact').toString();

  // We standardize on ORG_ADMIN for all tenant organization main contacts (L1 + L2).
  // preferredRole is accepted for flexibility but defaults to ORG_ADMIN.
  const roleToUse = preferredRole;

  let userId = await findUserIdByEmail(email);
  if (!userId) {
    // Rare: create the auth user now (temp pw returned so admin can tell the user)
    const tempPassword = 'TempPass123!';
    const { data: created, error: cerr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { full_name: name, role: roleToUse },
    });
    if (cerr || !created?.user) {
      throw new Error('Could not find or create auth user for contact ' + email + ': ' + (cerr?.message || ''));
    }
    userId = created.user.id;
    await ensureUserInOrganization(userId, organizationId, roleToUse, name, email);
    return { success: true, userId, tempPassword, message: `Created new auth user for ${email} and linked as ${roleToUse} to org.` };
  }

  await ensureUserInOrganization(userId, organizationId, roleToUse, name, email);
  return { success: true, userId, message: `Main contact ${email} linked/updated as ${roleToUse} role for org ${organizationId}.` };
}

/**
 * Approves a pending organization application.
 * - Creates the real organization record
 * - Links the submitting user (submitted_by) to the new organization (as ORG_ADMIN)
 * - Ensures main contact (by email) is ORG_ADMIN of the org (handles pre-created users, missing profiles after OTP signup, etc.)
 * - Optionally creates additional team members (as BROKER_AE)
 */
export async function approveAndCreateOrganization(appId: string, reviewedBy?: string, approverSignature?: string | null) {
  console.log("🚀 Starting approval for appId:", appId);

  // 1. Fetch the pending application (now includes submitted_by)
  const { data: app, error: fetchError } = await supabaseAdmin
    .from('pending_organizations')
    .select('*')
    .eq('id', appId)
    .single();

  if (fetchError || !app) {
    throw new Error('Application not found');
  }

  console.log("📋 Creating organization for:", app.company_name);

  // 2. Ensure root exists first (Level 0). All L1 will parent to it; L2 will parent to their sponsor L1.
  const rootOrgId = await ensureRootOrganization();

  // 2.1 Determine parent for the new org.
  // Support the stashed _intended_parent_organization_id in documents (workaround for uuid column type on pending.parent_organization_id).
  // Also fall back to app.parent_organization_id if present (for future when column is fixed to text).
  const docs = (app.documents || {}) as any;
  const intendedParent = docs._intended_parent_organization_id || app.parent_organization_id || null;

  let parentOrgId: string | null = null;
  if (intendedParent) {
    const { data: sponsor } = await supabaseAdmin
      .from('organizations')
      .select('id, approved, parent_organization_id')
      .eq('id', intendedParent)
      .maybeSingle();
    if (sponsor && sponsor.approved !== false) {
      parentOrgId = sponsor.id;
      console.log("📎 Level 2 applicant: using sponsor/intended parent", parentOrgId);
    } else {
      console.warn("⚠️ Invalid/ unapproved sponsor/intended parent in pending app; falling back to root for", appId);
      parentOrgId = rootOrgId;
    }
  } else {
    parentOrgId = rootOrgId; // Level 1 orgs are direct children of root
  }

  // 2.2 Create the real organization in Supabase (idempotent: reuse existing by name)
  const baseSlug = (app.company_name || 'org')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const slug = baseSlug || `org-${appId.slice(0,8)}`;

  const { data: existingOrg } = await supabaseAdmin
    .from('organizations')
    .select('id, name, raw_attrs, from_email, parent_organization_id, referred_by')
    .eq('name', app.company_name)
    .limit(1)
    .single();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let orgRecord: any = existingOrg;
  if (!existingOrg) {
    const { data: newOrg, error: orgError } = await supabaseAdmin
      .from('organizations')
      .insert({
        name: app.company_name,
        slug,
        primary_color: '#3b82f6',
        approved: true,
        approved_at: new Date().toISOString(),
        approved_by: reviewedBy || null,
        from_email: app.email,
        parent_organization_id: parentOrgId,
        raw_attrs: {
          source: 'pending_application',
          original_pending_id: appId,
          contact_name: app.contact_name || null,
          contact_email: app.email,
          from_email: app.email,
          sponsor_parent_id: parentOrgId, // for audit
          referred_by: app.referred_by || null,
        },
        referred_by: app.referred_by || null,
      })
      .select()
      .single();

    if (orgError) {
      console.error("Failed to create organization:", orgError);
      throw new Error(`Failed to create organization: ${orgError.message}`);
    }

    orgRecord = newOrg;
    console.log("✅ Organization created:", newOrg.id, "with parent:", parentOrgId);
  } else {
    console.log("ℹ️ Reusing existing org (idempotent):", existingOrg.id);
    // Ensure reuse also marks as approved + populates from_email + contact/raw_attrs properly (sync fix) + parent
    const updatedRaw = {
      ...(existingOrg.raw_attrs || {}),
      source: 'pending_application',
      original_pending_id: appId,
      contact_name: app.contact_name || (existingOrg.raw_attrs?.contact_name || null),
      contact_email: app.email,
      from_email: app.email,
      referred_by: app.referred_by || (existingOrg.raw_attrs?.referred_by || null),
    };
    const { data: updatedOrg } = await supabaseAdmin
      .from('organizations')
      .update({
        approved: true,
        approved_at: new Date().toISOString(),
        approved_by: reviewedBy || null,
        from_email: app.email,
        parent_organization_id: parentOrgId ?? existingOrg.parent_organization_id ?? rootOrgId,
        referred_by: app.referred_by || existingOrg.referred_by || null,
        raw_attrs: updatedRaw,
      })
      .eq('id', existingOrg.id)
      .select()
      .single();
    if (updatedOrg) orgRecord = updatedOrg;
  }

  const orgId = orgRecord.id;

  // === DEFERRED PDF GENERATION (on approve) ===
  // Generate the signed application summary + the full Lender Licensing Agreement (with applicant signature from pending + approverSignature if provided by admin on approve page).
  // Upload both to organization-documents, store long-lived signed URLs in the org's raw_attrs, and include links in the welcome email below.
  // This satisfies: save only signature on apply; create+store+email PDFs only when approved.
  try {
    const applicantSig = (app as any).signature || null;
    const approverSig = approverSignature || null;
    const now = new Date();
    const brokerNm = app.company_name || 'Broker';
    const brokerAddr = [app.address, app.city, app.state, app.zip].filter(Boolean).join(', ') || 'Address on file';
    const brokerContact = app.contact_name || 'Authorized Signer';
    const lenderNm = 'Loan-App';
    const lenderAddr = 'Address on file with platform';

    // Use React.createElement instead of JSX to avoid SWC parser issues inside 'use server' module
    // (react-pdf JSX is not standard React JSX and confuses the server-side SWC loader).

    // 1. Application summary PDF
    const appPdfElement = React.createElement(
      Document,
      {},
      React.createElement(
        Page,
        { size: 'A4', style: { padding: 40, fontSize: 10, fontFamily: 'Helvetica' } },
        React.createElement(Text, { style: { fontSize: 18, fontWeight: 'bold', marginBottom: 12 } }, `Organization Application — ${brokerNm}`),
        React.createElement(Text, { style: { marginBottom: 6 } }, `Approved: ${now.toLocaleString()}`),
        React.createElement(Text, { style: { marginBottom: 6 } }, `Contact: ${brokerContact} (${app.email})`),
        React.createElement(Text, { style: { marginBottom: 6 } }, `Address: ${brokerAddr}`),
        React.createElement(Text, { style: { marginBottom: 12 } }, `Products: ${(app.products_offered || []).join(', ') || '—'}`),
        React.createElement(Text, { style: { fontSize: 12, fontWeight: 'bold', marginTop: 12, marginBottom: 6 } }, 'Owners / Additional Users'),
        React.createElement(Text, { style: { fontSize: 9 } }, '(See pending application record for full details)'),
        React.createElement(Text, { style: { marginTop: 12 } }, 'Applicant Signature:'),
        applicantSig
          ? React.createElement(Image, { src: applicantSig, style: { width: 200, height: 50, objectFit: 'contain' } })
          : React.createElement(Text, {}, '(none)'),
        React.createElement(Text, { style: { marginTop: 8, fontSize: 8, color: '#666' } }, 'Signed PDFs generated on approval and stored on organization profile.')
      )
    );
    const appPdfBlob = await pdf(appPdfElement).toBlob();

    const appPdfPath = `org-${orgId}/signed/Approved-Application-${Date.now()}.pdf`;
    await supabaseAdmin.storage.from('organization-documents').upload(appPdfPath, appPdfBlob, { upsert: true, contentType: 'application/pdf' });
    const { data: appSigned } = await supabaseAdmin.storage.from('organization-documents').createSignedUrl(appPdfPath, 60 * 60 * 24 * 365 * 5);
    const appPdfUrl = appSigned?.signedUrl || null;

    // 2. Lender Licensing Agreement PDF (with both signatures)
    const agrPdfElement = React.createElement(
      Document,
      {},
      React.createElement(
        Page,
        { size: 'A4', style: { padding: 36, fontSize: 9, fontFamily: 'Helvetica', lineHeight: 1.3 } },
        React.createElement(Text, { style: { fontSize: 14, fontWeight: 'bold', textAlign: 'center' } }, 'LENDER LICENSING AGREEMENT (Signed on Approval)'),
        React.createElement(Text, { style: { textAlign: 'center', fontSize: 8, color: '#555', marginBottom: 8 } }, 'Last Updated: 03/2026'),
        React.createElement(Text, { style: { marginBottom: 6 } }, `Effective: ${now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`),
        React.createElement(Text, { style: { marginBottom: 6 } }, `Lender: ${lenderNm} — ${lenderAddr}`),
        React.createElement(Text, { style: { marginBottom: 6 } }, `Broker: ${brokerNm} — ${brokerAddr} (Contact: ${brokerContact})`),
        React.createElement(Text, { style: { marginTop: 8, fontSize: 8, fontWeight: 'bold' } }, 'Key Terms (full text as reviewed by applicant on apply/organization):'),
        React.createElement(Text, { style: { fontSize: 8 } }, 'Broker reps & warranties, QC, privacy (GLBA), audits, indemnification, mandatory AAA arbitration (CA), early payoff/EPD fee ($1,500 or comp), repurchase, termination survival, notices, misc (CA law, no agency, IP, etc.). Compensation Addendum (BPC ≤2.25% inclusive), Zero Tolerance Fraud Certification, AML/BSA Compliance Certification.'),
        React.createElement(Text, { style: { marginTop: 10 } }, 'Applicant (Broker) Signature:'),
        applicantSig
          ? React.createElement(Image, { src: applicantSig, style: { width: 180, height: 45, objectFit: 'contain', border: '1 solid #111' } })
          : React.createElement(Text, {}, '(none captured at apply)'),
        React.createElement(Text, { style: { marginTop: 8 } }, 'Approver / Lender Authorized Signature (added on approval):'),
        approverSig
          ? React.createElement(Image, { src: approverSig, style: { width: 180, height: 45, objectFit: 'contain', border: '1 solid #111' } })
          : React.createElement(Text, {}, '(pending — to be applied by approver)'),
        React.createElement(Text, { style: { marginTop: 10, fontSize: 7, color: '#666' } }, 'This signed copy + the application summary were generated on approval and stored in the organization profile (raw_attrs). Full terms were presented to the applicant during the 2-step apply flow.')
      )
    );
    const agrPdfBlob = await pdf(agrPdfElement).toBlob();

    const agrPdfPath = `org-${orgId}/signed/Approved-Lender-Licensing-Agreement-${Date.now()}.pdf`;
    await supabaseAdmin.storage.from('organization-documents').upload(agrPdfPath, agrPdfBlob, { upsert: true, contentType: 'application/pdf' });
    const { data: agrSigned } = await supabaseAdmin.storage.from('organization-documents').createSignedUrl(agrPdfPath, 60 * 60 * 24 * 365 * 5);
    const agrPdfUrl = agrSigned?.signedUrl || null;

    // Persist on the organization
    const existingRaw = (orgRecord.raw_attrs || {}) as any;
    await supabaseAdmin.from('organizations').update({
      raw_attrs: {
        ...existingRaw,
        signed_application_pdf_url: appPdfUrl,
        signed_licensing_agreement_pdf_url: agrPdfUrl,
        agreement_approved_at: now.toISOString(),
        agreement_approved_by: reviewedBy || null,
      },
    }).eq('id', orgId);

    console.log('✅ Signed PDFs generated on approval and attached to org:', orgId, { appPdfUrl, agrPdfUrl });
  } catch (pdfGenErr: any) {
    console.warn('Non-fatal: PDF generation on approve failed (org created anyway):', pdfGenErr?.message || pdfGenErr);
  }

  // 3. Robustly ensure main submitter (submitted_by) + contact email are linked with appropriate scoped role.
  // All tenant orgs (L1 and L2 children) get ORG_ADMIN (the proper scoped admin role for their org + subtree if applicable).
  // This fixes cases where L2 contacts like dustin@ctffunding were getting legacy 'ADMIN' (treated as more global in permissions) instead of ORG_ADMIN.
  const contactRole = 'ORG_ADMIN';

  if (app.submitted_by) {
    const sName = app.contact_name || (app.email ? app.email.split('@')[0] : undefined);
    await ensureUserInOrganization(app.submitted_by, orgId, contactRole, sName, app.email);
    console.log(`✅ Ensured submitted_by as ${contactRole} for org`);
  }
  if (app.email) {
    try {
      const res = await ensureMainContactForOrganization(orgId, app.email);
      console.log("✅ ensureMainContactForOrganization:", res.message);
      // Re-ensure with ORG_ADMIN (idempotent) for the contact email (in case it differed from submitted_by)
      const sName = app.contact_name || (app.email ? app.email.split('@')[0] : undefined);
      const contactId = await findUserIdByEmail(app.email);
      if (contactId) {
        await ensureUserInOrganization(contactId, orgId, 'ORG_ADMIN', sName, app.email);
      }
    } catch (mcErr: any) {
      console.warn("ensureMainContactForOrganization during approve (non-fatal):", mcErr?.message);
    }
  }

  // 3.5 Create additional team members from the application (additional_users) - full support for form data
  if (Array.isArray(app.additional_users)) {
    for (const u of app.additional_users) {
      if (!u?.email) continue;
      const e = String(u.email).trim();
      const n = String(u.name || e.split('@')[0]).trim();
      const role = (u.role && typeof u.role === 'string') ? u.role : 'BROKER_AE';
      try {
        // Use maybeSingle + find helper (robust if no profile row yet for this addl email)
        let exId: string | null = null;
        const { data: exProf } = await supabaseAdmin.from('profiles').select('id, organization_id').eq('email', e).maybeSingle();
        if (exProf?.id) {
          exId = exProf.id;
        } else {
          exId = await findUserIdByEmail(e);
        }
        if (exId) {
          if (!exProf?.organization_id) {
            await ensureUserInOrganization(exId, orgId, role, n, e);
          }
          continue;
        }
        const { data: au, error: aerr } = await supabaseAdmin.auth.admin.createUser({
          email: e,
          password: 'TempPass123!',
          email_confirm: true,
          user_metadata: { full_name: n, role }
        });
        if (aerr || !au?.user) { console.warn('addl user auth create fail', e, aerr?.message); continue; }
        const newUserId = au.user.id;
        await ensureUserInOrganization(newUserId, orgId, role, n, e);
        console.log('✅ auto-created additional user on org approve:', e, 'with role', role);

        // Send welcome email to this additional user (with recovery link to set password, like main contact)
        try {
          const { data: linkData } = await supabaseAdmin.auth.admin.generateLink({
            type: 'recovery',
            email: e,
            options: { redirectTo: `${APP_URL}/sign-in` },
          });
          const userLink = linkData?.properties?.action_link || `${APP_URL}/sign-in`;
          await resend.emails.send({
            from: RESEND_FROM,
            to: e,
            subject: `You've been added to ${app.company_name} on the Lending Platform`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2>Welcome to the team, ${n}!</h2>
                <p>You have been added to <strong>${app.company_name}</strong> as <strong>${role}</strong>.</p>
                <p>Your organization has been approved on the Lending Platform.</p>
                <a href="${userLink}" style="background:#3b82f6;color:white;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block;margin:16px 0;">
                  Set your password and log in
                </a>
                <p style="color:#666;font-size:12px;">If you have questions, contact your team admin or reply to this email.</p>
              </div>
            `,
          });
          console.log('📧 Welcome email sent to additional user:', e);
        } catch (mailErr) {
          console.warn('Failed to send welcome to additional user', e, mailErr);
        }
      } catch (ee: any) { console.warn('addl user err', e, ee?.message); } // eslint-disable-line @typescript-eslint/no-explicit-any -- matches project style in error handlers
    }
  }

  // 4. Update pending application status (include reviewer if provided)
  await supabaseAdmin
    .from('pending_organizations')
    .update({
      status: 'approved',
      reviewed_at: new Date().toISOString(),
      ...(reviewedBy ? { reviewed_by: reviewedBy } : {}),
    })
    .eq('id', appId);

  console.log("✅ Pending application marked as approved");

  // 5. Send Welcome Email
  // Use verified Resend sender (set RESEND_FROM in env to override, e.g. "Lending Platform <support@247sparkplug.com>")
  // Reply-to can point to the org's contact/from_email for follow-ups.
  const replyTo = orgRecord?.from_email || app.email || undefined;

  // Generate a password recovery link so the new org contact can set a password (OTP sign-up is passwordless)
  let loginLink = `${APP_URL}/sign-in`;
  try {
    const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email: app.email,
      options: { redirectTo: `${APP_URL}/sign-in` },
    });
    if (!linkErr && linkData?.properties?.action_link) {
      loginLink = linkData.properties.action_link;
    }
  } catch (glErr) {
    console.warn('generateLink recovery for new org contact failed, using plain sign-in link', glErr);
  }

  try {
    const { data: sendData, error: sendErr } = await resend.emails.send({
      from: RESEND_FROM,
      to: app.email,
      replyTo,
      subject: `Welcome to the Lending Platform, ${app.company_name}!`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #3b82f6;">Welcome aboard, ${app.company_name}!</h1>
          <p>Your organization has been successfully approved.</p>
          
          <p>You can now log in and start managing your loan products. (Additional team members from application were created if listed.)</p>
          
          <a href="${loginLink}" 
             style="background-color: #3b82f6; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; display: inline-block; margin: 20px 0;">
            Login to Your Dashboard (set your password)
          </a>
          
          <p style="color: #666; margin-top: 30px;">
            If you have any questions, reply to this email or contact our support team.
          </p>
          
          <p style="color: #999; font-size: 12px;">Your Organization ID: ${orgId}</p>
        </div>
      `,
    });

    if (sendErr) {
      console.error("⚠️ Failed to send welcome email:", sendErr);
    } else {
      console.log("📧 Welcome email sent to:", app.email, "Resend id:", sendData?.id);
    }
  } catch (emailError) {
    console.error("⚠️ Failed to send welcome email:", emailError);
  }

  console.log("🎉 Full approval process completed successfully!");

  return { success: true, orgId, name: app.company_name };
}

/**
 * Custom white-label friendly 6-digit OTP for initial sign-up / create organization flow.
 * We control the email via Resend (using org or default from_email) so branding is consistent.
 * Stores pending code in user_metadata.
 */
export async function sendCustomOtp(email: string, fullName?: string, companyName?: string, fromAddress?: string) {
  if (!supabaseAdmin) throw new Error('SUPABASE_SECRET_KEY not configured');
  const trimmedEmail = email.trim().toLowerCase();

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 minutes

  const baseMeta = {
    full_name: fullName || null,
    company_name: companyName || null,
    pending_otp_code: code,
    pending_otp_expires: expiresAt,
  };

  // Find or create the auth user. findUserIdByEmail now only returns ids for live auth users.
  let userId = await findUserIdByEmail(trimmedEmail);
  if (!userId) {
    const tempPassword = 'TempPass123!'; // only used internally if needed later; not sent to user
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: trimmedEmail,
      password: tempPassword,
      email_confirm: true,
      user_metadata: baseMeta,
    });
    if (createErr || !created?.user) {
      throw new Error('Failed to create user for custom OTP: ' + (createErr?.message || 'unknown'));
    }
    userId = created.user.id;
  } else {
    // Update existing user's metadata with fresh OTP + the signup names (so apply page can prefill)
    await supabaseAdmin.auth.admin.updateUserById(userId, {
      user_metadata: baseMeta,
    });
  }

  if (!userId) {
    // Re-create path for stale cases (rare, but prevents metadata from being lost on deleted auth users)
    const tempPassword = 'TempPass123!';
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: trimmedEmail,
      password: tempPassword,
      email_confirm: true,
      user_metadata: baseMeta,
    });
    if (createErr || !created?.user) {
      throw new Error('Failed to create user for custom OTP: ' + (createErr?.message || 'unknown'));
    }
    userId = created.user.id;
  }

  // Send via Resend with white-label support (fall back to platform default)
  // Use the passed companyName from signup form if available (more reliable than pending_organizations at this stage).
  let emailSubject = 'Your 6-digit code to continue';
  const displayCompany = companyName || '';
  if (displayCompany) {
    emailSubject = `Your code to apply for ${displayCompany}`;
  } else {
    // Fallback: try pending if the form was submitted before
    try {
      const { data: pending } = await supabaseAdmin
        .from('pending_organizations')
        .select('company_name')
        .eq('email', trimmedEmail)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (pending?.company_name) {
        emailSubject = `Your code to apply for ${pending.company_name}`;
      }
    } catch {}
  }

  try {
    // White-label: use the tenant's from_email (passed from sign-up page via useTenant when on custom domain)
    // Falls back to the platform RESEND_FROM only if no tenant fromAddress provided.
    const from = fromAddress || RESEND_FROM;
    await resend.emails.send({
      from,
      to: trimmedEmail,
      subject: emailSubject,
      html: `
        <div style="font-family: system-ui, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px;">
          <h2 style="margin-bottom: 8px;">Your verification code</h2>
          <p style="font-size: 32px; letter-spacing: 8px; font-weight: 700; margin: 16px 0;">${code}</p>
          <p style="color: #555;">This code expires in 15 minutes.${displayCompany ? ` for ${displayCompany}` : ''}</p>
          <p style="color: #888; font-size: 12px; margin-top: 24px;">If you didn't request this, you can ignore this email.</p>
        </div>
      `,
    });
  } catch (emailErr) {
    console.error('Failed to send custom OTP email via Resend:', emailErr);
    // Still succeed for the flow; user can request again
  }

  return { success: true };
}

export async function verifyCustomOtp(email: string, code: string, redirectTo?: string) {
  if (!supabaseAdmin) throw new Error('SUPABASE_SECRET_KEY not configured');
  const trimmedEmail = email.trim().toLowerCase();
  const trimmedCode = code.trim();

  const userId = await findUserIdByEmail(trimmedEmail);
  if (!userId) {
    throw new Error('No account found for this email. Please request a new code.');
  }

  const { data: userData } = await supabaseAdmin.auth.admin.getUserById(userId);
  const meta = (userData?.user?.user_metadata || {}) as any;

  const storedCode = meta.pending_otp_code;
  const expires = meta.pending_otp_expires;

  if (!storedCode || storedCode !== trimmedCode) {
    throw new Error('Invalid code. Please request a new one.');
  }
  if (expires && new Date(expires) < new Date()) {
    throw new Error('Code has expired. Please request a new one.');
  }

  // Clear the pending OTP
  const updatedMeta = { ...meta };
  delete updatedMeta.pending_otp_code;
  delete updatedMeta.pending_otp_expires;
  await supabaseAdmin.auth.admin.updateUserById(userId, { user_metadata: updatedMeta });

  // Establish a session for the user without sending another Supabase email.
  // Generate a magic link (returns the link; does not send email) and return it so the client can navigate.
  // Strongly prefer any absolute redirectTo passed from the client (built with window.location.origin on the tenant domain).
  // This fixes landing on localhost/# when visiting via ngrok or custom white-label domain.
  const cleanRedirect = (redirectTo || '').split('#')[0];
  let target = cleanRedirect || `${APP_URL}/apply/organization`;
  if (!target.startsWith('http')) {
    target = `${APP_URL}${target.startsWith('/') ? '' : '/'}${target}`;
  }

  const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email: trimmedEmail,
    options: { redirectTo: target },
  });

  if (linkErr || !linkData?.properties?.action_link) {
    // Fallback: client will redirect; session may establish via other means or user can sign in.
    return { success: true };
  }

  return { success: true, actionLink: linkData.properties.action_link };
}

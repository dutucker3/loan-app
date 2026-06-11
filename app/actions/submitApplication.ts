'use server';

import { supabaseAdmin } from '@/lib/supabase';
import { revalidatePath } from 'next/cache';
import { Resend } from 'resend';
import { categorizeSupportTicket, summarizeSupportTicket } from '@/lib/xai-client';

const resend = new Resend(process.env.RESEND_API_KEY);

const RESEND_FROM = process.env.RESEND_FROM || 'Support <support@247sparkplug.com>';

export async function submitLoanApplication(userId: string, formData: any, borrowers: any[]) {
  if (!supabaseAdmin) {
    throw new Error('SUPABASE_SECRET_KEY is not configured');
  }

  // Lookup the submitter's organization_id so bridge/rental apps are visible to org users on dashboard
  let organizationId: string | null = null;
  try {
    const { data: prof } = await supabaseAdmin
      .from('profiles')
      .select('organization_id')
      .eq('id', userId)
      .maybeSingle();
    organizationId = prof?.organization_id || null;
  } catch (e) {
    console.warn('Could not lookup organization_id for loan_application submit', e);
  }

  const { data, error } = await supabaseAdmin
    .from('loan_applications')
    .insert({
      user_id: userId,
      organization_id: organizationId,
      form_data: formData,
      borrowers: borrowers,
      status: 'submitted',
    })
    .select()
    .single();

  if (error) throw error;

  revalidatePath('/dashboard');
  return data;
}

// === SUPPORT TICKET SERVER ACTIONS ===

export async function submitSupportTicket(input: {
  userId: string;
  userName: string;
  userEmail: string;
  orgId: string | null;
  orgName?: string;
  pageUrl: string;
  description: string;
  screenshotUrls: string[];
}) {
  if (!supabaseAdmin) {
    throw new Error('SUPABASE_SECRET_KEY is not configured');
  }

  // Auto-categorize + summarize with xAI on submit (integrate xAI)
  let category = 'other';
  let summary = input.description.substring(0, 280);
  try {
    const cat = await categorizeSupportTicket(input.description, input.pageUrl);
    category = cat.category || 'other';
    const sum = await summarizeSupportTicket(input.description, input.pageUrl, `${input.userName} <${input.userEmail}>`);
    summary = sum.summary || summary;
  } catch (aiErr) {
    console.warn('xAI on ticket submit non-fatal:', aiErr);
  }

  // Find assignee: prefer TECH_SUPPORT, fallback SUPER_ADMIN. Pick first.
  let assignedTo: string | null = null;
  let assigneeEmail: string | null = null;
  let assigneeName = 'Support Team';

  try {
    // Try TECH_SUPPORT first
    let { data: techs } = await supabaseAdmin
      .from('profiles')
      .select('id, email, full_name')
      .eq('role', 'TECH_SUPPORT')
      .limit(1);
    if (!techs || techs.length === 0) {
      ({ data: techs } = await supabaseAdmin
        .from('profiles')
        .select('id, email, full_name')
        .eq('role', 'SUPER_ADMIN')
        .limit(1));
    }
    if (techs && techs[0]) {
      assignedTo = techs[0].id;
      assigneeEmail = techs[0].email;
      assigneeName = techs[0].full_name || assigneeEmail || 'Support';
    }
  } catch (e) {
    console.warn('assignee lookup failed', e);
  }

  // Insert ticket (direct via admin to bypass any client RLS)
  const now = new Date().toISOString();
  const { data: ticket, error: insErr } = await supabaseAdmin
    .from('support_tickets')
    .insert({
      user_id: input.userId,
      organization_id: input.orgId,
      page_url: input.pageUrl,
      description: input.description,
      screenshot_urls: input.screenshotUrls || [],
      status: 'open',
      assigned_to: assignedTo,
      responses: [],
      category,
      summary,
      created_at: now,
      updated_at: now,
    })
    .select()
    .single();

  if (insErr) {
    console.error('support_tickets insert error:', insErr);
    throw new Error('Failed to create support ticket: ' + insErr.message);
  }

  const ticketId = ticket.id;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const ticketLink = `${appUrl}/admin/support/${ticketId}`;

  // Send email via Resend to assigned TECH_SUPPORT (or fallback SUPER_ADMIN)
  if (assigneeEmail) {
    try {
      await resend.emails.send({
        from: RESEND_FROM,
        to: assigneeEmail,
        subject: `New Support Ticket #${ticketId.slice(0,8)}: ${category} from ${input.userName}`,
        html: `
          <div style="font-family: system-ui, Arial, sans-serif; max-width: 640px; margin: 0 auto; padding: 20px;">
            <h2 style="color:#1e40af;">New Support Request</h2>
            <p><strong>From:</strong> ${input.userName} &lt;${input.userEmail}&gt;</p>
            <p><strong>Organization:</strong> ${input.orgName || input.orgId || 'N/A'}</p>
            <p><strong>Page:</strong> <a href="${input.pageUrl}">${input.pageUrl}</a></p>
            <p><strong>Category (AI):</strong> ${category}</p>
            <p><strong>AI Summary:</strong> ${summary}</p>
            
            <hr style="margin:16px 0;" />
            <p><strong>Description:</strong></p>
            <p style="white-space:pre-wrap; background:#f8fafc; padding:12px; border-radius:8px;">${input.description}</p>
            
            ${input.screenshotUrls.length ? `<p><strong>Screenshots:</strong> ${input.screenshotUrls.length} attached (see admin for links)</p>` : ''}
            
            <p style="margin-top:24px;">
              <a href="${ticketLink}" style="background:#2563eb; color:white; padding:12px 24px; border-radius:9999px; text-decoration:none; display:inline-block;">
                View &amp; Respond in Admin →
              </a>
            </p>
            
            <p style="font-size:12px; color:#64748b; margin-top:32px;">
              Assigned to: ${assigneeName}. Ticket ID: ${ticketId}
            </p>
          </div>
        `,
      });
      console.log('📧 Support ticket email sent via Resend to', assigneeEmail);
    } catch (mailErr) {
      console.error('Resend support email failed (non fatal):', mailErr);
    }
  } else {
    console.warn('No TECH_SUPPORT or SUPER_ADMIN email found to notify for ticket', ticketId);
  }

  // Optionally notify the submitter (simple ack)
  if (input.userEmail) {
    try {
      await resend.emails.send({
        from: RESEND_FROM,
        to: input.userEmail,
        subject: `Support Ticket Received #${ticketId.slice(0,8)}`,
        html: `<p>Thank you, ${input.userName}. Your ticket has been received and assigned to our support team. We'll follow up at <a href="${ticketLink}">${ticketLink}</a></p>`,
      });
    } catch {}
  }

  revalidatePath('/admin/support');
  return { success: true, ticketId, assignedTo };
}

// Fetch tickets (for /admin/support list). Uses admin to bypass RLS.
export async function fetchSupportTickets(filters?: { status?: string; search?: string; assignedTo?: string }) {
  if (!supabaseAdmin) throw new Error('SUPABASE_SECRET_KEY is not configured');
  let q = supabaseAdmin.from('support_tickets').select('*').order('created_at', { ascending: false });

  if (filters?.status && filters.status !== 'all') {
    q = q.eq('status', filters.status);
  }
  if (filters?.assignedTo) {
    q = q.eq('assigned_to', filters.assignedTo);
  }
  const { data, error } = await q;
  if (error) throw error;

  let results = data || [];
  if (filters?.search) {
    const s = filters.search.toLowerCase();
    results = results.filter((t: any) =>
      (t.description || '').toLowerCase().includes(s) ||
      (t.page_url || '').toLowerCase().includes(s) ||
      (t.user_id || '').toLowerCase().includes(s)
    );
  }
  return results;
}

// Fetch single for detail
export async function fetchSupportTicket(id: string) {
  if (!supabaseAdmin) throw new Error('SUPABASE_SECRET_KEY is not configured');
  const { data, error } = await supabaseAdmin.from('support_tickets').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

// Update ticket (respond, assign, status, use xAI suggestion etc)
export async function updateSupportTicket(id: string, updates: {
  status?: string;
  assigned_to?: string | null;
  responses?: any[]; // append new response object
  summary?: string;
  category?: string;
}) {
  if (!supabaseAdmin) throw new Error('SUPABASE_SECRET_KEY is not configured');
  const { data, error } = await supabaseAdmin
    .from('support_tickets')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  revalidatePath('/admin/support');
  revalidatePath(`/admin/support/${id}`);
  return data;
}

// Helper to get possible assignees (TECH_SUPPORT + SUPER_ADMIN + ADMIN)
export async function fetchSupportAssignees() {
  if (!supabaseAdmin) return [];
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, email, role')
    .in('role', ['TECH_SUPPORT', 'SUPER_ADMIN', 'ADMIN'])
    .order('full_name', { ascending: true });
  return data || [];
}

// xAI wrappers as server actions (secrets safe server-side, use lib/xai-client)
export async function aiSummarizeTicket(description: string, pageUrl: string, userInfo?: string) {
  const { summarizeSupportTicket } = await import('@/lib/xai-client');
  return summarizeSupportTicket(description, pageUrl, userInfo);
}

export async function aiSuggestResponse(description: string, pageUrl: string, existingResponses?: any[]) {
  const { suggestResponseForTicket } = await import('@/lib/xai-client');
  return suggestResponseForTicket(description, pageUrl, existingResponses);
}

export async function aiCategorizeTicket(description: string, pageUrl: string) {
  const { categorizeSupportTicket } = await import('@/lib/xai-client');
  return categorizeSupportTicket(description, pageUrl);
}

// Bridge loan term sheet approval + email notification to borrower(s) + submitter (broker/AE)
// Updates the loan_application with selected product + term sheet details + approved flag.
// Sends professional email via Resend.
export async function approveBridgeTermSheet(
  applicationId: string,
  productId: string,
  termSheet: any,
  approverUserId: string
) {
  if (!supabaseAdmin) {
    throw new Error('SUPABASE_SECRET_KEY is not configured');
  }

  // Load the application (for emails + form context)
  const { data: app, error: loadErr } = await supabaseAdmin
    .from('loan_applications')
    .select('id, user_id, form_data, borrowers, organization_id, pricing_result')
    .eq('id', applicationId)
    .single();

  if (loadErr || !app) throw new Error('Application not found');

  // Update record
  const { error: updErr } = await supabaseAdmin
    .from('loan_applications')
    .update({
      selected_product_id: productId,
      pricing_result: {
        ...(app.pricing_result || {}),
        termSheet: termSheet || {},
        approved: true,
        approvedAt: new Date().toISOString(),
        approvedBy: approverUserId,
      },
      status: 'priced',
    })
    .eq('id', applicationId);

  if (updErr) throw updErr;

  // Collect recipient emails: primary borrower + other borrowers + the submitter (broker/AE)
  const borrowerEmails: string[] = (app.borrowers || [])
    .map((b: any) => (b.email || '').trim())
    .filter((e: string) => !!e);

  const { data: submitter } = await supabaseAdmin
    .from('profiles')
    .select('email, full_name')
    .eq('id', app.user_id)
    .maybeSingle();

  const allRecipients = Array.from(new Set([...borrowerEmails, submitter?.email].filter(Boolean)));

  // Determine nice from address (prefer org from_email)
  let fromAddress = RESEND_FROM;
  let orgName = 'Lending Platform';
  if (app.organization_id) {
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('name, from_email')
      .eq('id', app.organization_id)
      .maybeSingle();
    if (org) {
      orgName = org.name || orgName;
      if (org.from_email) fromAddress = `${orgName} <${org.from_email}>`;
    }
  }

  const property = app.form_data?.subjectPropertyAddress || app.form_data?.propertyAddress || 'the subject property';
  const loanAmt = app.form_data?.loanAmountRequest || 'TBD';
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const reviewLink = `${appUrl}/bridge-loans/${applicationId}`;

  if (allRecipients.length > 0) {
    try {
      await resend.emails.send({
        from: fromAddress,
        to: allRecipients,
        subject: `Action Required: Term Sheet Ready for Signature – ${property}`,
        html: `
          <div style="font-family: system-ui, -apple-system, Arial, sans-serif; max-width: 620px; margin: 0 auto; padding: 24px; color: #111;">
            <h2 style="margin-bottom: 8px;">Term Sheet &amp; Application Ready for Signature</h2>
            <p style="margin: 0 0 16px; color:#444;">A term sheet has been approved for the bridge / fix &amp; flip loan on <strong>${property}</strong> (requested amount: ${loanAmt}).</p>

            <p style="margin: 16px 0;"><strong>Next Step:</strong> Please log in and review/sign the term sheet and application.</p>

            <p style="margin: 24px 0;">
              <a href="${reviewLink}" style="background:#111827;color:#fff;padding:12px 28px;border-radius:9999px;text-decoration:none;display:inline-block;font-weight:600;">
                Review &amp; Sign Term Sheet →
              </a>
            </p>

            <hr style="margin:24px 0;border:none;border-top:1px solid #eee;" />

            <p style="font-size:13px;color:#666;">This email was sent to the borrower(s) and the submitting broker/AE. If you have already signed or have questions, please contact your loan team.</p>
            <p style="font-size:12px;color:#999;margin-top:32px;">${orgName} • Bridge Loan Application #${applicationId.slice(0,8)}</p>
          </div>
        `,
      });
      console.log('[bridge] Term sheet approval email sent to', allRecipients);
    } catch (mailErr) {
      console.error('Resend term sheet email failed (non-fatal):', mailErr);
    }
  }

  revalidatePath('/dashboard');
  revalidatePath(`/bridge-loans/${applicationId}`);
  return { success: true, applicationId, recipients: allRecipients.length };
}

// Helper for the review page: after signatures "received", create the actual loan record
// and return the new loan id so the UI can link to /loans/[id] for document uploads.
export async function createLoanFromBridgeApplication(applicationId: string, productId: string, termSheet: any, creatorUserId: string) {
  if (!supabaseAdmin) throw new Error('SUPABASE_SECRET_KEY is not configured');

  const { data: app, error: appErr } = await supabaseAdmin
    .from('loan_applications')
    .select('*')
    .eq('id', applicationId)
    .single();
  if (appErr || !app) throw new Error('Application not found for loan creation');

  const fd = app.form_data || {};
  const firstBorrower = (app.borrowers || [])[0] || {};

  const borrowerName = firstBorrower.fullLegalName || fd.borrowerEntityName || 'Bridge Borrower';
  const propAddress = fd.subjectPropertyAddress || fd.propertyAddress || 'Unknown Property';
  const loanAmt = parseFloat(termSheet?.approvedLoanAmount) || parseFloat(fd.loanAmountRequest) || 0;

  const { data: newLoan, error: loanErr } = await supabaseAdmin
    .from('loans')
    .insert({
      product_id: productId,
      originator_id: app.user_id || creatorUserId,
      borrower_name: borrowerName,
      property_address: propAddress,
      loan_amount: loanAmt || null,
      loan_type: 'bridge',
      status: 'PENDING',
      loan_status: 'Processing',
      purpose: fd.purposes ? Object.keys(fd.purposes).filter(k => fd.purposes[k]).join(', ') : 'Bridge / Fix & Flip',
      property_type: fd.propertyTypes ? Object.keys(fd.propertyTypes).filter(k => fd.propertyTypes[k]).join(', ') : null,
      organization_id: app.organization_id,
      notes: `Created from bridge application ${applicationId}. Term sheet approved.`,
      // You can snapshot more from termSheet / fd here as needed
    })
    .select()
    .single();

  if (loanErr) throw loanErr;

  // Optional: update the application to reference the created loan
  await supabaseAdmin
    .from('loan_applications')
    .update({ status: 'approved', /* could add loan_id if column exists */ })
    .eq('id', applicationId);

  revalidatePath('/dashboard');
  revalidatePath(`/loans/${newLoan.id}`);
  return { loanId: newLoan.id };
}
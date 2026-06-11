import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { supabaseAdmin } from '@/lib/supabase-admin';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: NextRequest) {
  try {
    const { loanId, titleCompany, insuranceCompany } = await req.json();

    if (!loanId) {
      return NextResponse.json({ success: false, error: 'loanId required' }, { status: 400 });
    }

    // Load full loan + product + org for white-label + data
    const { data: loan } = await supabaseAdmin
      .from('loans')
      .select('id, loan_amount, property_address, borrower_name, loan_type, organization_id, product_id, title_company, insurance_company, mortgagee_clause')
      .eq('id', loanId)
      .single();

    if (!loan) {
      return NextResponse.json({ success: false, error: 'Loan not found' }, { status: 404 });
    }

    const { data: product } = await supabaseAdmin
      .from('loan_products')
      .select('name, insurance_requirements, organization_id')
      .eq('id', loan.product_id)
      .maybeSingle();

    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('id, name, from_email, reply_to_email, domain, logo_url')
      .eq('id', loan.organization_id || product?.organization_id)
      .maybeSingle();

    const appBase = org?.domain ? `https://${org.domain}` : (process.env.NEXT_PUBLIC_APP_URL || 'https://localhost:3000');
    const fromEmail = org?.from_email ? `${org.name || 'Lending'} <${org.from_email}>` : (process.env.RESEND_FROM || 'Lending <support@247sparkplug.com>');
    const replyTo = org?.reply_to_email || undefined;

    const loanNumber = String(loan.id);
    const loanAmount = loan.loan_amount ? Number(loan.loan_amount).toLocaleString() : 'N/A';
    const mortgagee = loan.mortgagee_clause || (org as any)?.mortgagee_clause || 'See your closing instructions';

    let sentTitle = false;
    let sentInsurance = false;

    // === TITLE COMPANY ===
    const t = titleCompany || loan.title_company;
    if (t?.email) {
      // Generate + persist secure token inside the JSON (no extra column)
      const token = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const updatedTitle = { ...(t || {}), token };

      await supabaseAdmin
        .from('loans')
        .update({ title_company: updatedTitle })
        .eq('id', loanId);

      const link = `${appBase}/providers/title/${loanId}?token=${encodeURIComponent(token)}`;

      const html = `
        <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; max-width: 620px; margin: 0 auto; padding: 24px; color:#111;">
          ${org?.logo_url ? `<img src="${org.logo_url}" style="max-height:60px;margin-bottom:16px" alt="${org?.name || ''}"/>` : ''}
          <h2 style="margin:0 0 8px;">Title Document Request — ${org?.name || 'Your Lender'}</h2>
          <p style="margin:0 0 16px;color:#444;">Hello${t.name ? ` ${t.name}` : ''},</p>

          <p style="margin:0 0 12px;">We are processing a new loan and require the following documents from your office. Please use the secure link below to upload (no account needed).</p>

          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin:16px 0;">
            <div><strong>Loan #:</strong> ${loanNumber}</div>
            <div><strong>Loan Amount:</strong> $${loanAmount}</div>
            <div style="margin-top:8px;"><strong>Mortgagee Clause:</strong><br/><span style="font-family:monospace;white-space:pre-wrap;">${mortgagee}</span></div>
          </div>

          <p style="margin:12px 0 8px;font-weight:600;">Required Uploads (4 items):</p>
          <ol style="margin:0 0 16px 20px;padding:0;">
            <li>Title Commitment</li>
            <li>Closing Protection Letter</li>
            <li>Prelim Combined Closing Statement</li>
            <li>E &amp; O Insurance</li>
          </ol>

          <a href="${link}" style="display:inline-block;background:#1e40af;color:white;padding:14px 28px;border-radius:9999px;text-decoration:none;font-weight:600;">Upload Title Documents Securely →</a>

          <p style="margin:24px 0 0;font-size:12px;color:#64748b;">This link is unique to this loan and expires after use. If you have questions, reply to this email.</p>
          <p style="margin:8px 0 0;font-size:12px;color:#64748b;">Thank you,<br/>${org?.name || 'Loan Processing Team'}</p>
        </div>
      `;

      await resend.emails.send({
        from: fromEmail,
        to: t.email,
        replyTo,
        subject: `Title Document Request — Loan #${loanNumber} | ${org?.name || 'Lending'}`,
        html,
      });
      sentTitle = true;
    }

    // === INSURANCE COMPANY ===
    const i = insuranceCompany || loan.insurance_company;
    if (i?.email) {
      const token = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const updatedIns = { ...(i || {}), token };

      await supabaseAdmin
        .from('loans')
        .update({ insurance_company: updatedIns })
        .eq('id', loanId);

      const link = `${appBase}/providers/insurance/${loanId}?token=${encodeURIComponent(token)}`;
      const insReq = product?.insurance_requirements || 'Please provide coverage meeting lender requirements (minimum dwelling = loan amount or replacement cost; lender\'s loss payable with 30-day notice).';

      const html = `
        <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; max-width: 620px; margin: 0 auto; padding: 24px; color:#111;">
          ${org?.logo_url ? `<img src="${org.logo_url}" style="max-height:60px;margin-bottom:16px" alt="${org?.name || ''}"/>` : ''}
          <h2 style="margin:0 0 8px;">Insurance Document Request — ${org?.name || 'Your Lender'}</h2>
          <p style="margin:0 0 16px;color:#444;">Hello${i.name ? ` ${i.name}` : ''},</p>

          <p style="margin:0 0 12px;">We are processing a new loan and require the following documents from your office. Please use the secure link below to upload (no account needed).</p>

          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin:16px 0;">
            <div><strong>Loan #:</strong> ${loanNumber}</div>
            <div><strong>Loan Amount:</strong> $${loanAmount}</div>
            <div style="margin-top:8px;"><strong>Mortgagee Clause:</strong><br/><span style="font-family:monospace;white-space:pre-wrap;">${mortgagee}</span></div>
            <div style="margin-top:8px;"><strong>Insurance Requirements:</strong><br/><span style="white-space:pre-wrap;">${insReq}</span></div>
          </div>

          <p style="margin:12px 0 8px;font-weight:600;">Required Uploads (3 items):</p>
          <ol style="margin:0 0 16px 20px;padding:0;">
            <li>Invoice</li>
            <li>Certificate of Insurance</li>
            <li>Declarations</li>
          </ol>

          <a href="${link}" style="display:inline-block;background:#166534;color:white;padding:14px 28px;border-radius:9999px;text-decoration:none;font-weight:600;">Upload Insurance Documents Securely →</a>

          <p style="margin:24px 0 0;font-size:12px;color:#64748b;">This link is unique to this loan. Upload the exact three items listed. Questions? Reply to this email.</p>
          <p style="margin:8px 0 0;font-size:12px;color:#64748b;">Thank you,<br/>${org?.name || 'Loan Processing Team'}</p>
        </div>
      `;

      await resend.emails.send({
        from: fromEmail,
        to: i.email,
        replyTo,
        subject: `Insurance Document Request — Loan #${loanNumber} | ${org?.name || 'Lending'}`,
        html,
      });
      sentInsurance = true;
    }

    return NextResponse.json({ success: true, sentTitle, sentInsurance });
  } catch (err: any) {
    console.error('send-provider-requests error', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

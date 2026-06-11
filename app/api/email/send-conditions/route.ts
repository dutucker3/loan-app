import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { supabase } from '@/lib/supabase';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: NextRequest) {
  try {
    const { 
      loanId, 
      borrowerName, 
      borrowerEmail,
      brokerEmail,
      propertyAddress, 
      outstandingDocs,
      organizationId 
    } = await req.json();

    if (!borrowerEmail) {
      return NextResponse.json({ success: false, error: 'Borrower email is required' }, { status: 400 });
    }

    // Get organization context for white-label (use passed organizationId when available)
    let orgName = "Your Lending Company";
    let orgLogo = "";
    let fromEmail = process.env.RESEND_FROM || "Lending <support@247sparkplug.com>";
    let replyTo: string | undefined;
    let appBaseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://yourdomain.com";

    const orgQueryId = organizationId;
    if (orgQueryId) {
      const { data: org } = await supabase
        .from('organizations')
        .select('name, logo_url, domain, from_email, reply_to_email, raw_attrs')
        .eq('id', orgQueryId)
        .maybeSingle();

      if (org) {
        orgName = org.name || orgName;
        orgLogo = org.logo_url || "";
        const rawFrom = (org as any).raw_attrs?.from_email;
        const rawReply = (org as any).raw_attrs?.reply_to_email;
        fromEmail = (org.from_email?.trim() || rawFrom?.trim() || fromEmail);
        replyTo = org.reply_to_email?.trim() || rawReply?.trim() || replyTo;
        if (org.domain) appBaseUrl = `https://${org.domain}`;
      }
    } else {
      // Fallback: try to infer a recent org (defensive, prefer passing organizationId from caller)
      const { data: org } = await supabase
        .from('organizations')
        .select('name, logo_url, domain, from_email, reply_to_email, raw_attrs')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (org) {
        orgName = org.name || orgName;
        orgLogo = org.logo_url || "";
        const rawFrom = (org as any).raw_attrs?.from_email;
        const rawReply = (org as any).raw_attrs?.reply_to_email;
        fromEmail = (org.from_email?.trim() || rawFrom?.trim() || fromEmail);
        replyTo = org.reply_to_email?.trim() || rawReply?.trim() || replyTo;
        if (org.domain) appBaseUrl = `https://${org.domain}`;
      }
    }

    const conditionsList = outstandingDocs
      .map((doc: any, index: number) => `${index + 1}. ${doc.label || doc.doc_type}`)
      .join('\n');

    const emailHtml = `
      <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; max-width: 620px; margin: 0 auto; padding: 24px; color:#111;">
        ${orgLogo ? `<img src="${orgLogo}" style="max-height: 60px; margin-bottom: 16px;" alt="${orgName}" />` : ''}
        
        <h2 style="margin:0 0 8px;">Outstanding Loan Conditions — ${orgName}</h2>
        
        <p style="margin:0 0 12px;">Hi ${borrowerName},</p>
        <p style="margin:0 0 12px;">The following documents are required to move your loan forward for property: <strong>${propertyAddress || 'N/A'}</strong></p>
        
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin:16px 0;">
          <strong>Required Documents:</strong>
          <pre style="background:#fff;padding:12px;border-radius:8px;white-space:pre-wrap;margin:8px 0 0;">${conditionsList}</pre>
        </div>
        
        <p style="margin: 20px 0;">
          <a href="${appBaseUrl}/loans/${loanId}" 
             style="background:#1e40af;color:white;padding:14px 28px;border-radius:9999px;text-decoration:none;font-weight:600;display:inline-block;">
            📤 Upload Documents Now
          </a>
        </p>

        <p style="color:#64748b;font-size:14px;margin:0;">
          You can also forward this email to your broker if needed.
        </p>
        
        <p style="color:#64748b;font-size:14px;margin-top:16px;">
          Thank you,<br>
          ${orgName} Loan Team
        </p>
      </div>
    `;

    // Send to Borrower via Resend (white-label)
    await resend.emails.send({
      from: fromEmail,
      to: borrowerEmail,
      replyTo,
      subject: `Outstanding Conditions - Loan #${loanId} | ${orgName}`,
      html: emailHtml,
    });

    // Send to Broker (if exists)
    if (brokerEmail && brokerEmail !== borrowerEmail) {
      await resend.emails.send({
        from: fromEmail,
        to: brokerEmail,
        replyTo,
        subject: `Outstanding Conditions - Loan #${loanId} for ${borrowerName} | ${orgName}`,
        html: emailHtml.replace(`Hi ${borrowerName},`, `Hi Broker,`),
      });
    }

    console.log(`✅ Conditions email sent (Resend) to borrower${brokerEmail ? ' + broker' : ''}`);

    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error('Resend conditions email error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
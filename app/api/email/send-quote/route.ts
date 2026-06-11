import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { supabase } from '@/lib/supabase';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: NextRequest) {
  try {
    const {
      borrowerEmail,
      borrowerName,
      propertyAddress,
      quotes,
      organizationId,
    } = await req.json();

    if (!borrowerEmail || !quotes?.length) {
      return NextResponse.json({ success: false, error: 'Missing fields' }, { status: 400 });
    }

    let orgName = "Your Lending Company";
    let orgLogo = "";
    let fromEmail = process.env.RESEND_FROM || "Lending <support@247sparkplug.com>";
    let replyTo: string | undefined;
    let appBaseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://yourdomain.com";

    if (organizationId) {
      const { data: org } = await supabase
        .from('organizations')
        .select('name, logo_url, domain, from_email, reply_to_email, raw_attrs')
        .eq('id', organizationId)
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

    const quotesHtml = quotes.map((q: any, i: number) => `
      <div style="background:#f8fafc; padding:18px; border-radius:12px; margin-bottom:16px;">
        <strong>Quote ${i+1}: ${q.productName}</strong><br>
        <strong>Rate:</strong> ${q.rate}% @ ${q.ltv}% LTV<br>
        <strong>Origination Fee:</strong> ${q.displayPrice || q.price}<br>
        <strong>Amortization:</strong> ${q.amortization || 'Amortized'}<br>
        <strong>Est. Monthly Payment:</strong> ${q.monthlyPayment || 'N/A'}
      </div>
    `).join('');

    const emailHtml = `
      <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; max-width: 620px; margin: 0 auto; padding: 24px; color:#111;">
        ${orgLogo ? `<img src="${orgLogo}" style="max-height:60px;margin-bottom:16px;" alt="${orgName}"/>` : ''}
        <h2 style="margin:0 0 8px;">Your Loan Quotes — ${orgName}</h2>
        <p style="margin:0 0 12px;">Hi ${borrowerName},</p>
        <p style="margin:0 0 12px;">Here are your personalized quotes for <strong>${propertyAddress || 'the property'}</strong>:</p>
        ${quotesHtml}
        <p style="margin: 20px 0;">
          <a href="${appBaseUrl}/loan-application" style="background:#1e40af;color:white;padding:14px 28px;border-radius:9999px;text-decoration:none;font-weight:600;display:inline-block;">
            Continue Application &amp; Lock Your Rate →
          </a>
        </p>
        <p style="color:#64748b;font-size:14px;margin:0;">These quotes are valid for a limited time.</p>
      </div>
    `;

    await resend.emails.send({
      from: fromEmail,
      to: borrowerEmail,
      replyTo,
      subject: `Your Loan Quotes - ${orgName}`,
      html: emailHtml,
    });

    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error('Resend quote email error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
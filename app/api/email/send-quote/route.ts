import { NextRequest, NextResponse } from 'next/server';
import * as postmark from 'postmark';
import { supabase } from '@/lib/supabase';

const client = new postmark.ServerClient(process.env.POSTMARK_SERVER_API_TOKEN!);

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
    let fromEmail = "processing@247sparkplug.com";
    let appBaseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://yourdomain.com";

    if (organizationId) {
      const { data: org } = await supabase
        .from('organizations')
        .select('name, logo_url, domain, from_email')
        .eq('id', organizationId)
        .single();

      if (org) {
        orgName = org.name || orgName;
        orgLogo = org.logo_url || "";
        fromEmail = org.from_email?.trim() || fromEmail;
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
      <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;padding:20px;">
        ${orgLogo ? `<img src="${orgLogo}" style="max-height:80px;margin-bottom:20px;" alt="${orgName}"/>` : ''}
        <h2>Your Loan Quotes – ${orgName}</h2>
        <p>Hi ${borrowerName},</p>
        <p>Here are your personalized quotes for <strong>${propertyAddress || 'the property'}</strong>:</p>
        ${quotesHtml}
        <p style="margin:35px 0;">
          <a href="${appBaseUrl}/loan-application" style="background:#3b82f6;color:white;padding:16px 32px;border-radius:9999px;text-decoration:none;font-weight:600;display:inline-block;">
            Continue Application & Lock Your Rate →
          </a>
        </p>
        <p style="color:#64748b;font-size:14px;">These quotes are valid for a limited time.</p>
      </div>
    `;

    await client.sendEmail({
      From: fromEmail,
      To: borrowerEmail,
      Subject: `Your Loan Quotes - ${orgName}`,
      HtmlBody: emailHtml,
      MessageStream: "outbound",
    });

    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
import { NextRequest, NextResponse } from 'next/server';
import * as postmark from 'postmark';
import { supabase } from '@/lib/supabase';

const client = new postmark.ServerClient(process.env.POSTMARK_SERVER_API_TOKEN!);

export async function POST(req: NextRequest) {
  try {
    const { 
      loanId, 
      borrowerName, 
      borrowerEmail,
      brokerEmail,
      propertyAddress, 
      outstandingDocs 
    } = await req.json();

    if (!borrowerEmail) {
      return NextResponse.json({ success: false, error: 'Borrower email is required' }, { status: 400 });
    }

    // Get organization context for white-label
    let orgName = "Your Lending Company";
    let orgLogo = "";
    let fromEmail = "processing@247sparkplug.com";
    let appBaseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://yourdomain.com";

    const { data: org } = await supabase
      .from('organizations')
      .select('name, logo_url, domain, from_email')
      .eq('id', /* add organization_id if passed, or fetch from loan */)
      .single();

    if (org) {
      orgName = org.name || orgName;
      orgLogo = org.logo_url || "";
      fromEmail = org.from_email?.trim() || fromEmail;
      if (org.domain) appBaseUrl = `https://${org.domain}`;
    }

    const conditionsList = outstandingDocs
      .map((doc: any, index: number) => `${index + 1}. ${doc.label || doc.doc_type}`)
      .join('\n');

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        ${orgLogo ? `<img src="${orgLogo}" style="max-height: 80px; margin-bottom: 20px;" alt="${orgName}" />` : ''}
        
        <h2>Outstanding Loan Conditions - ${orgName}</h2>
        
        <p>Hi ${borrowerName},</p>
        <p>The following documents are required to move your loan forward for property: <strong>${propertyAddress || 'N/A'}</strong></p>
        
        <h3 style="color: #ef4444;">Required Documents:</h3>
        <pre style="background: #f8fafc; padding: 16px; border-radius: 8px; white-space: pre-wrap;">${conditionsList}</pre>
        
        <p style="margin: 30px 0;">
          <a href="${appBaseUrl}/loans/${loanId}" 
             style="background: #3b82f6; color: white; padding: 14px 28px; border-radius: 9999px; text-decoration: none; font-weight: 600; display: inline-block;">
            📤 Upload Documents Now
          </a>
        </p>

        <p style="color: #64748b; font-size: 14px;">
          You can also forward this email to your broker if needed.
        </p>
        
        <p style="color: #64748b; font-size: 14px;">
          Thank you,<br>
          ${orgName} Loan Team
        </p>
      </div>
    `;

    // Send to Borrower
    await client.sendEmail({
      From: fromEmail,
      To: borrowerEmail,
      Subject: `Outstanding Conditions - Loan #${loanId} | ${orgName}`,
      HtmlBody: emailHtml,
      MessageStream: "outbound",
    });

    // Send to Broker (if exists)
    if (brokerEmail && brokerEmail !== borrowerEmail) {
      await client.sendEmail({
        From: fromEmail,
        To: brokerEmail,
        Subject: `Outstanding Conditions - Loan #${loanId} for ${borrowerName} | ${orgName}`,
        HtmlBody: emailHtml.replace(`Hi ${borrowerName},`, `Hi Broker,`), // Slight personalization
        MessageStream: "outbound",
      });
    }

    console.log(`✅ Conditions email sent to borrower${brokerEmail ? ' + broker' : ''}`);

    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error('Postmark error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
import { NextRequest } from 'next/server';
import { processIncomingEmail } from '@/lib/email-processor';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Basic security check
    if (body.Secret !== process.env.POSTMARK_INBOUND_WEBHOOK_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }

    console.log(`📧 New inbound email from: ${body.From}`);

    const result = await processIncomingEmail({
      from: body.From,
      to: body.To,
      subject: body.Subject,
      textBody: body.TextBody,
      htmlBody: body.HtmlBody,
      attachments: body.Attachments || [],
      messageId: body.MessageID,
    });

    return new Response(JSON.stringify(result), { status: 200 });

  } catch (error) {
    console.error("Email processing error:", error);
    return new Response("Error processing email", { status: 500 });
  }
}
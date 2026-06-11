import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
const RESEND_FROM = process.env.RESEND_FROM || 'Lending Platform <support@247sparkplug.com>';

/**
 * Reggora Webhook Handler (white-label / no client emails from Reggora)
 *
 * Reggora will POST here when events occur (order.created, order.scheduled, order.completed, etc.).
 * We:
 *   1. Verify (placeholder - add HMAC signature check once you have the Reggora webhook secret).
 *   2. Update local loan reggora_status + reggora_order_id if present.
 *   3. Send our own white-label emails via Resend (using the org's from_email/reply_to if available).
 *   4. Optionally create/update documents or conditions.
 *
 * Configure this URL in your Reggora Lender integration settings (sandbox first).
 * Do NOT let Reggora send the default client emails - we control everything here.
 */
export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const event = payload.event || payload.type || 'unknown';
    const data = payload.data || payload;

    console.log('[Reggora Webhook]', event, JSON.stringify(data).slice(0, 500));

    // TODO (when you have the key): verify signature
    // const signature = request.headers.get('x-reggora-signature');
    // if (!verifySignature(payload, signature, process.env.REGGORA_WEBHOOK_SECRET)) {
    //   return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    // }

    const reggoraLoanId = data.loan?.id || data.loan_id || data.loan;
    const reggoraOrderId = data.id || data.order?.id || data.order_id;

    if (reggoraLoanId && supabaseAdmin) {
      // Find our local loan by reggora_loan_id
      const { data: localLoans } = await supabaseAdmin
        .from('loans')
        .select('id, organization_id, borrower_name, property_address, notes')
        .eq('reggora_loan_id', reggoraLoanId)
        .limit(1);

      const localLoan = localLoans?.[0];
      if (localLoan) {
        const updates: any = { reggora_status: event };

        if (reggoraOrderId) {
          updates.reggora_order_id = reggoraOrderId;
        }

        // If completed, you can pull actual fee from data if present
        if (event.includes('completed') && data.fee) {
          updates.reggora_fee_actual = parseFloat(data.fee) || null;
        }

        await supabaseAdmin
          .from('loans')
          .update(updates)
          .eq('id', localLoan.id);

        // White-label email (instead of Reggora sending directly to borrower)
        // Fetch org from_email / reply_to for branding
        let from = RESEND_FROM;
        let replyTo: string | undefined;
        if (localLoan.organization_id) {
          const { data: org } = await supabaseAdmin
            .from('organizations')
            .select('from_email, reply_to_email, name')
            .eq('id', localLoan.organization_id)
            .maybeSingle();
          if (org?.from_email) from = `${org.name || 'Lending'} <${org.from_email}>`;
          replyTo = org?.reply_to_email;
        }

        // Send a clean white-label notification
        try {
          await resend.emails.send({
            from,
            to: 'borrower@example.com', // TODO: pull real borrower email from loan or application
            replyTo,
            subject: `Appraisal Update - ${event} (Order ${reggoraOrderId || 'N/A'})`,
            html: `
              <p>Your appraisal order has been updated.</p>
              <p>Status: <strong>${event}</strong></p>
              <p>Property: ${localLoan.property_address}</p>
              <p>Reggora Order: ${reggoraOrderId || 'N/A'}</p>
              <p>We will notify you of next steps. This email comes from our platform (not Reggora directly).</p>
            `,
          });
        } catch (emailErr) {
          console.warn('White-label Reggora email failed (non-fatal)', emailErr);
        }
      }
    }

    // Always acknowledge quickly
    return NextResponse.json({ received: true, event });
  } catch (err: any) {
    console.error('Reggora webhook error', err);
    // Still return 200 so Reggora doesn't retry forever
    return NextResponse.json({ received: true, error: 'logged' });
  }
}

// Optional GET for health / manual test
export async function GET() {
  return NextResponse.json({ status: 'Reggora webhook endpoint ready (POST only for events)' });
}

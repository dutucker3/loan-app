import { Webhook } from 'svix';
import { headers } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase-admin'; // we'll create this

export async function POST(req: Request) {
  const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;

  if (!WEBHOOK_SECRET) {
    throw new Error('Please add CLERK_WEBHOOK_SECRET from Clerk Dashboard');
  }

  const headerPayload = headers();
  const svix_id = headerPayload.get("svix-id");
  const svix_timestamp = headerPayload.get("svix-timestamp");
  const svix_signature = headerPayload.get("svix-signature");

  const body = await req.text();
  const wh = new Webhook(WEBHOOK_SECRET);

  let evt: any;
  try {
    evt = wh.verify(body, {
      "svix-id": svix_id!,
      "svix-timestamp": svix_timestamp!,
      "svix-signature": svix_signature!,
    });
  } catch (err) {
    console.error('Webhook verification failed:', err);
    return new Response('Error', { status: 400 });
  }

  const eventType = evt.type;

  if (eventType === 'organization.created' || eventType === 'organization.updated') {
    const { id, name, slug } = evt.data;

    await supabaseAdmin
      .from('organizations')
      .upsert({
        clerk_org_id: id,
        name: name || 'Unnamed Org',
        slug: slug,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'clerk_org_id' });
  }

  return new Response('OK', { status: 200 });
}
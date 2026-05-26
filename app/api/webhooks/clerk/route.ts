// app/api/webhooks/clerk/route.ts
import { Webhook } from 'svix';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

export async function POST(req: Request) {
  console.log("🔴 Webhook received at", new Date().toISOString());

  const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;
  if (!WEBHOOK_SECRET) {
    console.error("❌ Missing CLERK_WEBHOOK_SECRET");
    return NextResponse.json({ error: 'Config error' }, { status: 500 });
  }

  const headerPayload = await headers();
  const svix_id = headerPayload.get("svix-id");
  const svix_timestamp = headerPayload.get("svix-timestamp");
  const svix_signature = headerPayload.get("svix-signature");

  const body = await req.text();

  let evt: any;
  try {
    const svix = new Webhook(WEBHOOK_SECRET);
    evt = svix.verify(body, {
      "svix-id": svix_id!,
      "svix-timestamp": svix_timestamp!,
      "svix-signature": svix_signature!,
    });
  } catch (err: any) {
    console.error("Signature failed:", err.message);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  // Use publishable key (your current setup)
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    if (evt.type === 'user.created' || evt.type === 'user.updated') {
      const { id, email_addresses, first_name, last_name } = evt.data;

      const { error } = await supabase.from('users').upsert({
        id,
        email: email_addresses?.[0]?.email_address,
        full_name: `${first_name || ''} ${last_name || ''}`.trim() || 'Unnamed User',
        role: 'PENDING_ORG_ADMIN',
        organization_id: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });

      if (error) console.error("User sync error:", error);
      else console.log(`✅ Synced user: ${id}`);
    }

    if (evt.type === 'organization.created' || evt.type === 'organization.updated') {
      const { id, name } = evt.data;

      await supabase.from('organizations').upsert({
        id,
        name,
        clerk_org_id: id,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'clerk_org_id' });
      console.log(`✅ Synced organization: ${id}`);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Processing error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
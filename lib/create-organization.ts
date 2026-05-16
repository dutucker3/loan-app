'use server';

import { supabaseAdmin } from './supabase-admin';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function approveAndCreateOrganization(appId: string) {
  console.log("🚀 Starting approval for appId:", appId);

  // 1. Fetch application
  const { data: app, error: fetchError } = await supabaseAdmin
    .from('pending_organizations')
    .select('*')
    .eq('id', appId)
    .single();

  if (fetchError || !app) {
    throw new Error('Application not found');
  }

  console.log("📋 Creating organization for:", app.company_name);

  // 2. Create Organization in Clerk
  const response = await fetch('https://api.clerk.com/v1/organizations', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.CLERK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: app.company_name,
      slug: app.company_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-'),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Clerk API failed: ${response.status} - ${errorText}`);
  }

  const newOrg = await response.json();
  console.log("✅ Clerk org created:", newOrg.id);

  // 3. Save to Supabase organizations table
  const { error: orgError } = await supabaseAdmin
    .from('organizations')
    .insert({
      clerk_org_id: newOrg.id,
      name: app.company_name,
      slug: newOrg.slug || app.company_name.toLowerCase().replace(/\s+/g, '-'),
      primary_color: '#3b82f6',
    });

  if (orgError) throw orgError;

  // 4. Update pending application status
  await supabaseAdmin
    .from('pending_organizations')
    .update({
      status: 'approved',
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', appId);

  console.log("✅ Organization record saved in Supabase");

  // 5. Send Welcome Email
  try {
    await resend.emails.send({
      from: 'Lending Platform <dustin@247sparkplug.com>', // Change to your verified domain
      to: app.email,
      subject: `Welcome to the Lending Platform, ${app.company_name}!`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #3b82f6;">Welcome aboard, ${app.company_name}!</h1>
          <p>Your organization has been successfully approved.</p>
          
          <p>You can now log in and start managing your loan products.</p>
          
          <a href="https://yourapp.com" 
             style="background-color: #3b82f6; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; display: inline-block; margin: 20px 0;">
            Login to Your Dashboard
          </a>
          
          <p style="color: #666; margin-top: 30px;">
            If you have any questions, reply to this email or contact our support team.
          </p>
          
          <p style="color: #999; font-size: 12px;">Your Organization ID: ${newOrg.id}</p>
        </div>
      `,
    });

    console.log("📧 Welcome email sent to:", app.email);
  } catch (emailError) {
    console.error("⚠️ Failed to send welcome email:", emailError);
    // Don't throw — we still want the organization created even if email fails
  }

  console.log("🎉 Full approval process completed successfully!");

  return { success: true, orgId: newOrg.id, name: app.company_name };
}
// app/api/create-clerk-user/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { clerkClient } from '@clerk/nextjs/server';
import { createClientComponentClient } from '@/lib/supabase';

const validRoles = [
  'SUPER_ADMIN', 'ADMIN', 'TECH_SUPPORT', 'ORG_ADMIN',
  'LOAN_UNDERWRITER', 'LOAN_PROCESSOR',
  'SENIOR_ACCOUNT_EXECUTIVE', 'ACCOUNT_EXECUTIVE',
  'SENIOR_BROKER', 'JUNIOR_BROKER', 'LENDING_SUPERVISOR',
  'BROKER', 'BROKER_AE', 'BORROWER'
] as const;

export async function POST(request: NextRequest) {
  try {
    const { email, role = 'BROKER_AE', full_name } = await request.json();

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    if (!validRoles.includes(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
    }

    // Create user in Clerk
    const newClerkUser = await clerkClient.users.createUser({
      emailAddress: [email],
      firstName: full_name ? full_name.split(' ')[0] : undefined,
      lastName: full_name ? full_name.split(' ').slice(1).join(' ') : undefined,
      publicMetadata: {
        role: role,                    // ← Store role here
      },
    });

    // Sync to Supabase
    const supabase = createClientComponentClient();

    await supabase.from('users').upsert({
      id: newClerkUser.id,
      email: email,
      full_name: full_name || `${newClerkUser.firstName || ''} ${newClerkUser.lastName || ''}`.trim(),
      role: role,
      organization_id: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' });

    return NextResponse.json({
      success: true,
      userId: newClerkUser.id,
      role: role,
      message: `User created with role: ${role}`
    });

  } catch (error: any) {
    console.error("Create user error:", error);
    return NextResponse.json({
      error: error.message || 'Failed to create user'
    }, { status: 500 });
  }
}
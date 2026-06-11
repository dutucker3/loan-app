import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  try {
    const { borrowerName, borrowerEmail, propertyAddress, loanType, purchasePrice, selectedQuotes, organizationId } = await req.json();

    const supabase = await createServerClient(req);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }
    const userId = user.id;

    const { data, error } = await supabase
      .from('loan_applications')
      .insert({
        user_id: userId,
        organization_id: organizationId,
        status: 'draft',
        form_data: {
          borrowerName,
          borrowerEmail,
          propertyAddress,
          loanType,
          purchasePrice,
          selectedQuotes,
        },
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ 
      success: true, 
      applicationId: data.id 
    });

  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
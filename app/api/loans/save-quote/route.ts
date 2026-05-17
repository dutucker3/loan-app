import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { auth } from '@clerk/nextjs/server';

export async function POST(req: NextRequest) {
  try {
    const { borrowerName, borrowerEmail, propertyAddress, loanType, purchasePrice, selectedQuotes, organizationId } = await req.json();

    const { userId } = auth();

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
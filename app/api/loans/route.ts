import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const { productId, borrowerName = '', propertyAddress } = await request.json();

    if (!propertyAddress) {
      return NextResponse.json({ success: false, error: 'Property address is required' }, { status: 400 });
    }

    const { data: loan, error } = await supabase
      .from('loans')
      .insert({
        product_id: productId || 'default-product',
        originator_id: 'temp-user',           // Replace with Clerk user.id later
        borrower_name: borrowerName,
        property_address: propertyAddress,
        status: 'PENDING',
      })
      .select()
      .single();

    if (error) {
      console.error('Supabase error:', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ 
      success: true, 
      loanId: loan.id 
    });

  } catch (error: any) {
    console.error('Loan creation error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
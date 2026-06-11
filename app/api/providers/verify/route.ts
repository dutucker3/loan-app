import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const loanId = searchParams.get('loanId');
  const type = (searchParams.get('type') || '').toLowerCase(); // 'title' | 'insurance'
  const token = searchParams.get('token');

  if (!loanId || !type || !token) {
    return NextResponse.json({ ok: false, error: 'Missing parameters' }, { status: 400 });
  }

  try {
    const { data: loan } = await supabaseAdmin
      .from('loans')
      .select('id, loan_amount, borrower_name, property_address, title_company, insurance_company, mortgagee_clause, product_id, organization_id')
      .eq('id', parseInt(loanId))
      .single();

    if (!loan) return NextResponse.json({ ok: false, error: 'Loan not found' }, { status: 404 });

    const contact = type === 'title' ? loan.title_company : loan.insurance_company;
    if (!contact || contact.token !== token) {
      return NextResponse.json({ ok: false, error: 'Invalid or expired link' }, { status: 403 });
    }

    // Load product for insurance requirements + name
    let product: any = null;
    if (loan.product_id) {
      const { data: p } = await supabaseAdmin.from('loan_products').select('name, insurance_requirements').eq('id', loan.product_id).maybeSingle();
      product = p;
    }

    const required = type === 'title'
      ? ['Title Commitment', 'Closing Protection Letter', 'Prelim Combined Closing Statement', 'E & O Insurance']
      : ['Invoice', 'Certificate of Insurance', 'Declarations'];

    // Check existing uploads for this provider type (best effort via documents table)
    const { data: existing } = await supabaseAdmin
      .from('documents')
      .select('id, doc_type, file_name, file_url, status')
      .eq('loan_id', parseInt(loanId));

    const prefix = type === 'title' ? 'title_' : 'insurance_';
    const already = (existing || []).filter((d: any) => (d.doc_type || '').startsWith(prefix) || (d.file_name || '').toLowerCase().includes(type));

    return NextResponse.json({
      ok: true,
      loan: {
        id: loan.id,
        loan_amount: loan.loan_amount,
        property_address: loan.property_address,
        borrower_name: loan.borrower_name,
        mortgagee_clause: loan.mortgagee_clause,
      },
      contact: { name: contact.name, email: contact.email },
      product: product ? { name: product.name, insurance_requirements: product.insurance_requirements } : null,
      type,
      required,
      alreadyUploaded: already.map((d: any) => ({ file_name: d.file_name, status: d.status, url: d.file_url })),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const loanId = form.get('loanId') as string;
    const type = (form.get('type') as string || '').toLowerCase(); // title | insurance
    const token = form.get('token') as string;
    const file = form.get('file') as File | null;
    const docLabel = (form.get('docLabel') as string) || 'Document';

    if (!loanId || !type || !token || !file) {
      return NextResponse.json({ ok: false, error: 'Missing fields or file' }, { status: 400 });
    }

    // Verify token again server-side (authoritative)
    const { data: loan } = await supabaseAdmin
      .from('loans')
      .select('id, title_company, insurance_company')
      .eq('id', parseInt(loanId))
      .single();

    if (!loan) return NextResponse.json({ ok: false, error: 'Loan not found' }, { status: 404 });

    const contact = type === 'title' ? loan.title_company : loan.insurance_company;
    if (!contact || contact.token !== token) {
      return NextResponse.json({ ok: false, error: 'Invalid token' }, { status: 403 });
    }

    // Upload to storage using admin (bucket: prefer 'loan-documents', fallback behavior)
    const safeName = file.name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_.-]/g, '');
    const path = `loans/${loanId}/${type}/${Date.now()}-${safeName}`;

    let bucket = 'loan-documents';
    // Try upload; if bucket missing the caller can use documents table only with a data url fallback, but we assume bucket exists (created via run-migrations or dashboard)
    const { error: upErr } = await supabaseAdmin.storage.from(bucket).upload(path, file, { upsert: true, contentType: file.type });
    if (upErr) {
      // Fallback: still record the document but note no storage path (or try another bucket name used elsewhere)
      console.warn('Storage upload issue (will still record document):', upErr.message);
    }

    // Create a signed URL for later retrieval (long lived)
    let fileUrl = path;
    try {
      const { data: signed } = await supabaseAdmin.storage.from(bucket).createSignedUrl(path, 60 * 60 * 24 * 365 * 5); // 5 years
      if (signed?.signedUrl) fileUrl = signed.signedUrl;
    } catch {}

    // Insert into documents table (the one used by loans/[id] conditions)
    const docType = `${type}_${docLabel.toLowerCase().replace(/\s+/g, '_')}`;
    const { data: docRow, error: insErr } = await supabaseAdmin
      .from('documents')
      .insert({
        loan_id: parseInt(loanId),
        doc_type: docType,
        file_name: docLabel + ' — ' + file.name,
        file_url: fileUrl,
        status: 'RECEIVED',
      })
      .select()
      .single();

    if (insErr) {
      return NextResponse.json({ ok: false, error: 'DB insert failed: ' + insErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, document: docRow, path });
  } catch (e: any) {
    console.error('provider upload error', e);
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

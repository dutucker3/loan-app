// app/api/upload-guidelines/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const productId = formData.get('productId') as string;

    if (!file || !productId) {
      return NextResponse.json({ success: false, error: 'Missing file or productId' }, { status: 400 });
    }

    const filePath = `guidelines/${productId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
   // Upload original PDF (with null guard)
    if (!supabaseAdmin) {
      return NextResponse.json({ success: false, error: 'Supabase Admin client not initialized' }, { status: 500 });
    }
    // Upload to storage
    const { error: uploadError } = await supabaseAdmin.storage
      .from('loan-documents')
      .upload(filePath, file, { upsert: true });

    if (uploadError) throw uploadError;

    // Create a signed URL (long-lived)
    const { data: signedData } = await supabaseAdmin.storage
      .from('loan-documents')
      .createSignedUrl(filePath, 60 * 60 * 24 * 365); // 1 year

    if (!signedData?.signedUrl) throw new Error('Failed to generate signed URL');

    // Update the product with the signed URL
    const { error: updateError } = await supabaseAdmin
      .from('loan_products')
      .update({ guidelines_url: signedData.signedUrl })
      .eq('id', productId);

    if (updateError) throw updateError;

    return NextResponse.json({
      success: true,
      guidelinesUrl: signedData.signedUrl,
    });

  } catch (error: any) {
    console.error('Guidelines upload error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
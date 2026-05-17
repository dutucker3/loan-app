// app/api/upload-document/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const docType = formData.get('docType') as string;
    const loanId = formData.get('loanId') as string;

    if (!file || !loanId) {
      return NextResponse.json({ success: false, error: 'Missing file or loanId' }, { status: 400 });
    }

    // Upload to Supabase Storage
    const fileExt = file.name.split('.').pop();
    const fileName = `${loanId}/${docType}-${Date.now()}.${fileExt}`;

    const { data, error } = await supabase.storage
      .from('loan-documents')
      .upload(fileName, file, { upsert: true });

    if (error) throw error;

    const { data: { publicUrl } } = supabase.storage
      .from('loan-documents')
      .getPublicUrl(fileName);

    return NextResponse.json({
      success: true,
      fileUrl: publicUrl,
      fileName: file.name,
    });

  } catch (error: any) {
    console.error('Upload error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
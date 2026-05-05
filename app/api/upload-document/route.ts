import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import path from 'path';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const loanId = formData.get('loanId') as string || 'temp';

    if (!file) {
      return NextResponse.json({ success: false, error: 'No file uploaded' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const fileName = `${Date.now()}-${file.name}`;
    const filePath = `loans/${loanId}/${fileName}`;

    if (!supabaseAdmin) {
      return NextResponse.json({ success: false, error: 'Supabase Admin client not initialized' }, { status: 500 });
    }

    await supabaseAdmin.storage.from('loan-documents').upload(filePath, buffer, { upsert: true });

    console.log('📄 Extracting text from PDF using pdfjs-dist...');

    const workerPath = `file://${path.join(process.cwd(), 'public', 'pdfjs', 'pdf.worker.min.mjs').replace(/\\/g, '/')}`;
    const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerPath;

    const uint8Array = new Uint8Array(buffer);
    const loadingTask = pdfjsLib.getDocument({ data: uint8Array });
    const pdfDocument = await loadingTask.promise;

    let fullText = '';

    for (let i = 1; i <= pdfDocument.numPages; i++) {
      console.log(`🔍 Processing page ${i}/${pdfDocument.numPages}...`);

      const page = await pdfDocument.getPage(i);
      const viewport = page.getViewport({ scale: 4.0 });   // Higher scale for better form reading

      const textContent = await page.getTextContent();
      textContent.items.forEach((item: any) => {
        fullText += item.str + ' ';
      });
      fullText += '\n\n';
    }

    console.log('📄 Text extraction completed. Total length:', fullText.length);
    console.log('📝 First 3000 characters:', fullText.substring(0, 3000));

    if (fullText.trim().length < 100) {
      return NextResponse.json({ success: false, error: 'Very little text extracted from PDF' }, { status: 400 });
    }

    // Extremely specific prompt that matches your exact PDF layout
    const xaiResponse = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.XAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "grok-4-1-fast-reasoning",
        messages: [
          {
            role: "system",
            content: `You are an expert mortgage underwriter. Look ONLY for these exact labels in the text:

- "Estimated Value:" or "Estimated Value" → use for estimated_value
- "Estimated Net Worth:" → ignore this field completely
- "Rental Income (Annual):" or "Monthly Rent" → convert monthly to annual if needed
- "Property Taxes (Annual):"
- "Property Insurance (Annual):"
- "Estimated FICO:" or "FICO:"
- "Loan Amount Request:" or "Loan Amount"
- Borrower name / Entity name
- Property Street Address

Return ONLY valid JSON with these exact keys:

{
  "fico": number,
  "estimated_value": number,
  "loan_amount": number,
  "annual_rental_income": number,
  "annual_taxes": number,
  "annual_insurance": number,
  "annual_hoa": number,
  "borrower_name": string,
  "property_address": string
}`
          },
          { role: "user", content: fullText }
        ],
        temperature: 0,
        max_tokens: 800
      })
    });

    const xaiData = await xaiResponse.json();
    const content = xaiData.choices?.[0]?.message?.content || '';

    console.log('🔍 Grok raw response:', content);

    let extractedData: any = {};
    try {
      extractedData = JSON.parse(content);
    } catch {
      return NextResponse.json({ success: false, error: 'Grok did not return valid JSON' }, { status: 500 });
    }

    const noi = (extractedData.annual_rental_income || 0) - (extractedData.annual_taxes || 0) - (extractedData.annual_insurance || 0) - (extractedData.annual_hoa || 0);
    const ltv = extractedData.estimated_value > 0 ? Math.round((extractedData.loan_amount / extractedData.estimated_value) * 100) : 0;

    console.log('✅ FINAL EXTRACTED DATA:', { ...extractedData, noi: Math.round(noi), ltv });

    return NextResponse.json({
      success: true,
      extractedData: { ...extractedData, noi: Math.round(noi), ltv }
    });

  } catch (error: any) {
    console.error('Upload error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { fileUrl, fileName, aiPrompt, documentType } = await req.json();

    if (!fileUrl || !aiPrompt) {
      return NextResponse.json({ success: false, error: 'Missing file or prompt' }, { status: 400 });
    }

    const xaiResponse = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.XAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "grok-3",
        messages: [
          {
            role: "system",
            content: "You are an expert mortgage underwriter. Review the document and provide clear, professional feedback."
          },
          {
            role: "user",
            content: `${aiPrompt}\n\nDocument: ${documentType}\nFile: ${fileName}\n\nPlease analyze and respond with:\n1. Summary\n2. Issues Found (if any)\n3. Recommendation (Approved / Needs More Info / Rejected)`
          }
        ],
        temperature: 0.3,
        max_tokens: 800,
      }),
    });

    const data = await xaiResponse.json();
    const feedback = data.choices?.[0]?.message?.content || "No response from xAI";

    // Simple status inference
    let status = 'REVIEWING';
    if (feedback.toLowerCase().includes('approved')) status = 'APPROVED';
    if (feedback.toLowerCase().includes('rejected')) status = 'REJECTED';

    return NextResponse.json({
      success: true,
      feedback: feedback,
      status: status,
    });

  } catch (error: any) {
    console.error('xAI Review Error:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}
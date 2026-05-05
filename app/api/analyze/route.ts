import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { documentText, guidelines } = await request.json();

    if (!documentText) {
      return NextResponse.json({ error: 'No document text provided' }, { status: 400 });
    }

    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.XAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'grok-4-1-fast-reasoning',   // or grok-beta if you prefer
        messages: [
          {
            role: 'system',
            content: `You are an experienced mortgage underwriter. 
Analyze the uploaded document against the loan guidelines.
Return a clear, structured JSON response with:
{
  "compliant": boolean,
  "issues": string[],
  "recommendation": string,
  "summary": string
}`
          },
          {
            role: 'user',
            content: `Guidelines: ${guidelines || 'Standard mortgage guidelines.'}\n\nDocument content:\n${documentText}`
          }
        ],
        temperature: 0.2,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || 'xAI API error');
    }

    const aiMessage = data.choices?.[0]?.message?.content || '{}';
    let parsed;

    try {
      parsed = JSON.parse(aiMessage);
    } catch {
      parsed = { compliant: true, issues: [], recommendation: 'Manual review recommended', summary: aiMessage };
    }

    return NextResponse.json(parsed);

  } catch (error: any) {
    console.error('xAI error:', error);
    return NextResponse.json({
      compliant: false,
      issues: ['Failed to reach xAI'],
      recommendation: 'Try again or review manually',
      summary: error.message
    }, { status: 200 }); // Return 200 so frontend doesn't break
  }
}
// xAI client using direct fetch (matches pattern in app/api/analyze/route.ts).
// No external SDK dependency needed. Uses XAI_API_KEY.

const XAI_API_URL = 'https://api.x.ai/v1/chat/completions';
const XAI_MODEL = 'grok-4-1-fast-reasoning'; // or 'grok-3' / 'grok-beta'

async function callXai(prompt: string, temperature = 0.2) {
  const res = await fetch(XAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.XAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: XAI_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature,
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`xAI API error: ${res.status} ${err}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '{}';
  return JSON.parse(content);
}

export async function analyzeEmail(input: {
  subject: string;
  body: string;
  attachments: Array<{ filename: string; contentType: string }>;
}) {
  const prompt = `You are an expert mortgage loan processor.

Analyze this email and extract structured information.

Subject: ${input.subject}
Body: ${input.body}

Attachments: ${input.attachments.map(a => a.filename).join(', ') || 'None'}

Return ONLY valid JSON with this structure:
{
  "loanNumber": "string or null",
  "borrowerLastName": "string or null",
  "propertyAddress": "string or null",
  "documentType": "string or 'unlabeled'",
  "summary": "brief summary of the email",
  "matchConfidence": number (0-100)
}`;

  try {
    return await callXai(prompt, 0.1);
  } catch (error) {
    console.error("xAI Analysis failed:", error);
    return {
      loanNumber: null,
      borrowerLastName: null,
      propertyAddress: null,
      documentType: "unlabeled",
      summary: "Analysis failed",
      matchConfidence: 20
    };
  }
}

/**
 * xAI helpers for Support Tickets (per task requirements).
 * Uses the existing grok client setup.
 */
export async function summarizeSupportTicket(description: string, pageUrl: string, userInfo?: string) {
  const prompt = `You are a helpful support AI for a loan/lending SaaS platform.
Summarize the following support ticket concisely (2-3 sentences max). Identify the core issue.
Ticket description: ${description}
Page URL: ${pageUrl}
${userInfo ? `User: ${userInfo}` : ''}

Return ONLY JSON: { "summary": "string", "key_points": string[] }`;

  try {
    return await callXai(prompt, 0.2);
  } catch (error) {
    console.error("xAI summarize ticket failed:", error);
    return { summary: description.substring(0, 200), key_points: [] };
  }
}

export async function suggestResponseForTicket(description: string, pageUrl: string, existingResponses?: any[]) {
  const prev = existingResponses && existingResponses.length ? `Previous responses: ${JSON.stringify(existingResponses.slice(-2))}` : '';
  const prompt = `You are an expert customer support agent for a mortgage lending platform.
Given the support ticket, suggest a professional, helpful, empathetic response (keep under 150 words).
Suggest next steps or questions if needed.
Ticket: ${description}
On page: ${pageUrl}
${prev}

Return ONLY JSON: { "suggested_response": "string", "tone": "string", "category_guess": "string" }`;

  try {
    return await callXai(prompt, 0.3);
  } catch (error) {
    console.error("xAI suggest response failed:", error);
    return { suggested_response: "Thank you for your report. Our team will review and get back to you shortly.", tone: "professional", category_guess: "general" };
  }
}

export async function categorizeSupportTicket(description: string, pageUrl: string) {
  const prompt = `Categorize this support ticket into one of: bug, feature_request, billing, account_access, technical_issue, loan_pricing, document_upload, other.
Also give a short reason.
Ticket desc: ${description}
URL: ${pageUrl}

Return ONLY JSON: { "category": "bug|feature_request|billing|account_access|technical_issue|loan_pricing|document_upload|other", "confidence": 0-100, "reason": "string" }`;

  try {
    return await callXai(prompt, 0.1);
  } catch (error) {
    console.error("xAI categorize failed:", error);
    return { category: "other", confidence: 30, reason: "auto fallback" };
  }
}
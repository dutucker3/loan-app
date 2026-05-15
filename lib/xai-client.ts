import Grok from '@xai/grok-sdk';   // npm install @xai/grok-sdk if not installed

const grok = new Grok({
  apiKey: process.env.XAI_API_KEY!,
});

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
    const response = await grok.chat.completions.create({
      model: "grok-3",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      max_tokens: 800,
      response_format: { type: "json_object" }
    });

    const content = response.choices[0].message.content;
    return JSON.parse(content);
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
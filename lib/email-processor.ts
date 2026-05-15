'use server';

import { analyzeEmail } from './xai-client';
import { supabaseAdmin } from './supabase-admin';

type EmailData = {
  from: string;
  to: string;
  subject: string;
  textBody: string;
  htmlBody?: string;
  attachments: Array<{
    Name: string;
    Content: string;        // base64
    ContentType: string;
  }>;
  messageId: string;
};

export async function processIncomingEmail(email: EmailData) {
  console.log("📧 Processing email:", email.subject);

  // 1. AI Analysis
  const analysis = await analyzeEmail({
    subject: email.subject,
    body: email.textBody || email.htmlBody || '',
    attachments: email.attachments.map(a => ({
      filename: a.Name,
      contentType: a.ContentType,
    })),
  });

  console.log("🧠 xAI Analysis:", analysis);

  // 2. Find or create loan
  let loan = await findMatchingLoan(analysis);

  if (!loan) {
    console.log("⚠️ No matching loan found → creating new one");
    loan = await createNewLoanFromEmail(analysis, email.from);
  }

  // 3. Process attachments
  const results = await processAttachments(email.attachments, loan.id, analysis);

  // 4. Log activity
  await logEmailActivity(loan.id, email, analysis);

  return {
    success: true,
    loanId: loan.id,
    matchedBy: analysis.matchConfidence || 50,
    documentsProcessed: results.length,
  };
}

// ====================== Helpers ======================

async function findMatchingLoan(analysis: any) {
  if (!analysis.loanNumber) return null;

  const { data } = await supabaseAdmin
    .from('loans')
    .select('*')
    .eq('id', analysis.loanNumber)        // bigint comparison
    .single();

  return data;
}

async function createNewLoanFromEmail(analysis: any, fromEmail: string) {
  const { data, error } = await supabaseAdmin
    .from('loans')
    .insert({
      borrower_name: analysis.borrowerLastName || 'Unknown Borrower',
      property_address: analysis.propertyAddress || '',
      loan_status: 'New',
      source: 'email',
      source_email: fromEmail,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function processAttachments(attachments: any[], loanId: number, analysis: any) {
  const results = [];

  for (const att of attachments) {
    try {
      const buffer = Buffer.from(att.Content, 'base64');
      const fileName = `loans/${loanId}/${Date.now()}-${att.Name}`;

      const { error: uploadError } = await supabaseAdmin.storage
        .from('loan-documents')
        .upload(fileName, buffer, {
          contentType: att.ContentType,
          upsert: true,
        });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabaseAdmin.storage
        .from('loan-documents')
        .getPublicUrl(fileName);

      await supabaseAdmin
        .from('loan_documents')
        .insert({
          loan_id: loanId,
          file_name: att.Name,
          file_url: urlData.publicUrl,
          document_type: analysis.documentType || 'unlabeled',
          uploaded_via: 'email',
        });

      results.push({ success: true, filename: att.Name });
    } catch (err) {
      console.error("Attachment failed:", att.Name, err);
      results.push({ success: false, filename: att.Name });
    }
  }

  return results;
}

async function logEmailActivity(loanId: number, email: EmailData, analysis: any) {
  await supabaseAdmin
    .from('loan_email_logs')
    .insert({
      loan_id: loanId,
      from_email: email.from,
      subject: email.subject,
      analysis_summary: analysis.summary || 'Processed via xAI',
    });
}
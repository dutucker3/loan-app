'use client';

import { useState, useRef, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import { supabase } from '@/lib/supabase';
import dynamic from 'next/dynamic';
import { PDFDownloadLink } from '@react-pdf/renderer';
import { TermSheetPDF } from '@/components/TermSheetPDF';

const SignatureCanvas = dynamic(() => import('react-signature-canvas'), { ssr: false }) as any;

export default function TermSheetPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useUser();
  const loanId = params.id as string;

  const [loan, setLoan] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isSigned, setIsSigned] = useState(false);
  const sigPad = useRef<any>(null);

  useEffect(() => {
    async function fetchLoan() {
      const { data } = await supabase
        .from('loans')
        .select('*')
        .eq('id', loanId)
        .single();
      setLoan(data);
      setLoading(false);
    }
    fetchLoan();
  }, [loanId]);

  const isDSCR = loan?.product_id?.toLowerCase().includes('dscr') || false;

  const handleSaveAndRedirect = async () => {
    if (!sigPad.current) return;

    const signatureDataUrl = sigPad.current.toDataURL();

    // 1. Generate and save Term Sheet PDF
    // (We simulate the PDF data here - in production you'd use a server action)
    await supabase.from('documents').insert({
      loan_id: loanId,
      doc_type: 'signed_term_sheet',
      file_name: `Term-Sheet-${loan.property_address || 'Property'}.pdf`,
      file_url: '#', // In real app this would be the uploaded PDF URL
      status: 'APPROVED',
      xai_feedback: 'Signed Term Sheet',
    });

    // 2. Save Loan Application PDF (if exists)
    await supabase.from('documents').insert({
      loan_id: loanId,
      doc_type: 'loan_application',
      file_name: `Loan-Application-${loan.property_address || 'Property'}.pdf`,
      file_url: '#',
      status: 'APPROVED',
      xai_feedback: 'Signed Loan Application',
    });

    alert('✅ Term Sheet signed and saved!');
    router.push(`/loans/${loanId}`); // Redirect to loan detail (documents section)
  };

  const sendTermSheetEmail = async () => {
    const borrowerEmail = loan.borrower_email || prompt('Enter borrower email:');
    if (!borrowerEmail) return;

    const termSheetLink = `https://yourdomain.com/loans/${loanId}/term-sheet`;

    const res = await fetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: borrowerEmail,
        subject: `Your Term Sheet for ${loan.property_address}`,
        html: `
          <h2>Term Sheet Ready</h2>
          <p>Please review and sign your term sheet here:</p>
          <a href="${termSheetLink}" style="background:#000;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;">
            Review & Sign Term Sheet
          </a>
        `,
      }),
    });

    if (res.ok) alert('✅ Term Sheet link emailed to borrower!');
    else alert('Failed to send email');
  };

  if (loading) return <div className="p-12 text-center">Loading Term Sheet...</div>;
  if (!loan) return <div className="p-12 text-center">Loan not found</div>;

  return (
    <div className="max-w-4xl mx-auto p-8">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Term Sheet — {loan.property_address}</h1>
        <button onClick={sendTermSheetEmail} className="px-6 py-3 bg-blue-600 text-white rounded-2xl">
          📧 Email Link to Borrower
        </button>
      </div>

      <div className="border rounded-3xl p-10 bg-white shadow">
        {/* Term Sheet Content */}
        <TermSheetPDF form={loan} isDSCR={isDSCR} />

        {/* Signature Section */}
        <div className="mt-16 border-t pt-12">
          <h3 className="font-semibold mb-6 text-xl">Borrower Signature</h3>
          <div className="border-2 border-dashed border-gray-400 rounded-3xl p-6 bg-gray-50">
            <SignatureCanvas
              ref={sigPad}
              penColor="black"
              canvasProps={{ className: 'w-full h-64 border rounded-2xl bg-white' }}
              onEnd={() => setIsSigned(true)}
            />
          </div>

          <div className="flex gap-4 mt-8">
            <button
              onClick={() => { sigPad.current?.clear(); setIsSigned(false); }}
              className="px-8 py-4 border border-red-600 text-red-600 rounded-2xl hover:bg-red-50"
            >
              Clear
            </button>
            <button
              onClick={handleSaveAndRedirect}
              disabled={!isSigned}
              className="px-10 py-4 bg-black text-white rounded-2xl font-medium disabled:opacity-50"
            >
              Sign & Save Term Sheet
            </button>
          </div>

          {isSigned && (
            <PDFDownloadLink
              document={<TermSheetPDF form={loan} isDSCR={isDSCR} signatureDataUrl={sigPad.current?.toDataURL()} />}
              fileName={`Signed-Term-Sheet-${loan.property_address}.pdf`}
              className="mt-8 block text-center py-4 bg-green-600 text-white rounded-3xl font-semibold"
            >
              Download Signed PDF
            </PDFDownloadLink>
          )}
        </div>
      </div>
    </div>
  );
}
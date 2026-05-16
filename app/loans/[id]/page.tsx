'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import { supabase } from '@/lib/supabase';
import { isBorrower } from '@/lib/permissions';

const documentTypes = [
  { id: 'drivers_license', label: "Borrower's Driver's License", needsOCR: true },
  { id: 'credit_report', label: "Borrower's Credit Report" },
  { id: 'background_check', label: "Borrower's Background Check" },
  { id: 'bank_statements', label: '2 Months of Bank Statements' },
  { id: 'purchase_contract', label: 'Purchase Contract (for Purchases)', needsOCR: true },
  { id: 'previous_closing', label: 'Previous Closing Statement (for Refinances)', needsOCR: true },
  { id: 'property_insurance', label: 'Property Insurance' },
  { id: 'title_commitment', label: 'Title Commitment' },
  { id: 'credit_application', label: 'Borrower Credit Application' },
  { id: 'appraisal', label: 'Appraisal' },
  { id: 'signed_term_sheet', label: 'Signed Term Sheet' },
  { id: 'title_company_info', label: 'Title Company Information' },
  { id: 'credit_authorization', label: 'Credit Authorization Form' },
  { id: 'ach_verification', label: 'ACH Verification' },
  { id: 'articles_of_incorporation', label: 'Articles of Incorporation' },
  { id: 'operating_agreement', label: 'Company Operating Agreement' },
  { id: 'ein_letter', label: 'Company EIN Letter' },
  { id: 'certificate_of_good_standing', label: 'Company Certificate of Good Standing' },
];

const loanStatuses = [
  'Processing', 'Underwriting', 'Clear to Close',
  'Closed and Funded', 'On Hold', 'Rejected'
];

type DocStatus = 'NEEDED' | 'REVIEWING' | 'APPROVED' | 'REJECTED';

interface Document {
  id?: number;
  loan_id: number;
  doc_type: string;
  file_name?: string;
  file_url?: string;
  status: DocStatus;
  xai_feedback?: string;
  underwriter_notes?: string;
  ae_comments: any[];
}

export default function LoanDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useUser();
  const loanId = parseInt(params.id as string);

  const [loan, setLoan] = useState<any>(null);
  const [product, setProduct] = useState<any>(null);
  const [documents, setDocuments] = useState<Record<string, Document>>({});
  const [loading, setLoading] = useState(true);
  const [uploadingDoc, setUploadingDoc] = useState<string | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState<string>('BROKER_AE');

  const borrowerUser = isBorrower({ id: user?.id || '', role: currentUserRole });

  useEffect(() => {
    async function fetchData() {
      // Load user role
      if (user) {
        const { data: userData } = await supabase
          .from('users')
          .select('role')
          .eq('id', user.id)
          .single();
        if (userData) setCurrentUserRole(userData.role || 'BROKER_AE');
      }

      // Load loan
      const { data: loanData } = await supabase
        .from('loans')
        .select('*')
        .eq('id', loanId)
        .single();

      if (loanData) {
        setLoan(loanData);

        if (loanData.product_id) {
          const { data: productData } = await supabase
            .from('loan_products')
            .select('id, name, description, guidelines_url')
            .eq('id', loanData.product_id)
            .single();
          setProduct(productData);
        }
      }

      // Load documents
      const { data: docsData } = await supabase
        .from('documents')
        .select('*')
        .eq('loan_id', loanId);

      const docMap: Record<string, Document> = {};
      documentTypes.forEach((type) => {
        const existing = docsData?.find((d: any) => d.doc_type === type.id);
        docMap[type.id] = existing || {
          loan_id: loanId,
          doc_type: type.id,
          status: 'NEEDED' as DocStatus,
          ae_comments: [],
        };
      });

      setDocuments(docMap);
      setLoading(false);
    }

    fetchData();
  }, [loanId, user]);

  const updateLoanStatus = async (newStatus: string) => {
    if (borrowerUser) return; // Borrowers cannot change status

    const { error } = await supabase
      .from('loans')
      .update({ loan_status: newStatus })
      .eq('id', loanId);

    if (error) alert('Failed to update status');
    else {
      setLoan((prev: any) => ({ ...prev, loan_status: newStatus }));
      alert(`Status updated to ${newStatus}`);
    }
  };

  const updateDocument = async (docType: string, updates: Partial<Document>) => {
    if (!user) return;

    const current = documents[docType] || {
      loan_id: loanId,
      doc_type: docType,
      status: 'NEEDED' as DocStatus,
      ae_comments: [],
    };

    const payload = {
      ...current,
      ...updates,
      loan_id: loanId,
      doc_type: docType,
    };

    if (!payload.id || payload.id === 0) {
      delete payload.id;
    }

    const { error } = await supabase
      .from('documents')
      .upsert(payload)
      .select()
      .single();

    if (error) {
      console.error('Error updating document:', error);
      return;
    }

    setDocuments((prev: any) => ({
      ...prev,
      [docType]: { ...payload, id: payload.id || prev[docType]?.id },
    }));
  };

  const handleFileUpload = async (docType: string, file: File) => {
    setUploadingDoc(docType);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('docType', docType);
      formData.append('loanId', loanId.toString());

      const res = await fetch('/api/upload-document', {
        method: 'POST',
        body: formData,
      });

      const result = await res.json();

      if (!result.success) throw new Error(result.error || 'Upload failed');

      await updateDocument(docType, {
        file_name: file.name,
        file_url: result.fileUrl,
        status: result.status || 'REVIEWING',
        xai_feedback: result.xaiFeedback,
        underwriter_notes: result.notes || '',
      });

      alert(`✅ Uploaded successfully: ${file.name}`);

    } catch (err: any) {
      console.error(err);
      alert(`Upload failed: ${err.message}`);
    } finally {
      setUploadingDoc(null);
    }
  };

  const changeStatus = async (docType: string, newStatus: DocStatus) => {
    if (borrowerUser) return; // Borrowers cannot change status

    const notes = newStatus === 'REJECTED' 
      ? prompt("Enter rejection reason (visible to AE):") || "" 
      : "";

    await updateDocument(docType, {
      status: newStatus,
      underwriter_notes: notes,
    });
  };

  const addComment = async (docType: string, commentText: string) => {
    if (!commentText.trim() || !user) return;

    const currentComments = documents[docType].ae_comments || [];
    const newComment = {
      user: user.fullName || user.emailAddresses?.[0]?.emailAddress || 'User',
      comment: commentText,
      timestamp: new Date().toISOString(),
    };

    await updateDocument(docType, {
      ae_comments: [...currentComments, newComment],
    });
  };

  // Email integration note (for future)
  // TODO: Add inbound email webhook in /api/email/inbound/route.ts to process replies and attach documents

  if (loading) return <div className="p-12 text-center">Loading loan details...</div>;
  if (!loan) return <div className="p-12 text-center">Loan not found</div>;

  return (
    <div className="max-w-6xl mx-auto p-8">
      <div className="flex justify-between items-start mb-10">
        <div>
          <h1 className="text-4xl font-bold">Loan #{loan.id}</h1>
          <p className="text-2xl text-gray-700 mt-2">{loan.property_address}</p>
          {loan.borrower_name && <p className="text-gray-600 mt-1">Borrower: {loan.borrower_name}</p>}
        </div>
        <button 
          onClick={() => router.push('/dashboard')}
          className="px-6 py-3 bg-gray-200 hover:bg-gray-300 rounded-xl font-medium"
        >
          ← Back to Dashboard
        </button>
      </div>

      {/* Team Contacts Section */}
      <div className="bg-white border rounded-3xl p-8 mb-10">
        <h2 className="text-xl font-semibold mb-6 flex items-center gap-2">👥 Team Contacts</h2>
        <div className="grid grid-cols-2 gap-8">
          <div>
            <p className="text-sm text-gray-500">Broker</p>
            <p className="font-medium text-lg">{loan.originator_id ? 'Broker Name' : 'Not Assigned'}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Processor</p>
            <p className="font-medium text-lg">{loan.processor_id ? 'Processor Name' : 'Not Assigned'}</p>
          </div>
        </div>
      </div>

      {/* Loan Status */}
      {!borrowerUser && (
        <div className="mb-12">
          <label className="block text-sm font-medium mb-3">Loan Status</label>
          <select
            value={loan.loan_status || 'Processing'}
            onChange={(e) => updateLoanStatus(e.target.value)}
            className="bg-white border border-gray-300 rounded-2xl px-6 py-4 text-lg w-full max-w-md focus:outline-none focus:border-blue-500"
          >
            {loanStatuses.map((status) => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
        </div>
      )}

      {/* Document Cards */}
      <div className="grid gap-8">
        {documentTypes.map((doc) => {
          const currentDoc = documents[doc.id];
          return (
            <div key={doc.id} className="border rounded-3xl p-8 bg-white shadow-sm">
              <h3 className="text-2xl font-semibold mb-6">{doc.label}</h3>

              <div className="flex flex-wrap gap-3 mb-8">
                {(['NEEDED', 'REVIEWING', 'APPROVED', 'REJECTED'] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => !borrowerUser && changeStatus(doc.id, s)}
                    className={`px-6 py-2.5 rounded-2xl text-sm font-medium transition-all ${
                      currentDoc.status === s ? 'bg-blue-600 text-white shadow' : 'bg-gray-100 hover:bg-gray-200'
                    } ${borrowerUser ? 'cursor-default opacity-60' : ''}`}
                  >
                    {s}
                  </button>
                ))}
              </div>

              <label className="block cursor-pointer">
                <div className={`border-2 border-dashed rounded-3xl p-12 text-center transition-all hover:border-blue-500 ${uploadingDoc === doc.id ? 'border-blue-500 bg-blue-50' : 'border-gray-300'}`}>
                  <div className="text-5xl mb-4">📤</div>
                  <p className="font-semibold text-lg">
                    {uploadingDoc === doc.id ? 'Uploading & reviewing with xAI...' : 'Click to upload document'}
                  </p>
                  <p className="text-gray-500 mt-1">PDF, JPG, PNG supported</p>
                </div>
                <input
                  type="file"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleFileUpload(doc.id, e.target.files[0])}
                />
              </label>

              {currentDoc.xai_feedback && (
                <div className="mt-6 p-5 bg-amber-50 border border-amber-200 rounded-2xl">
                  <strong className="text-amber-700">xAI Review:</strong> {currentDoc.xai_feedback}
                </div>
              )}

              {currentDoc.file_url && (
                <div className="mt-6">
                  <a
                    href={currentDoc.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-3 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-medium transition-colors"
                  >
                    👁️ View Uploaded Document
                  </a>
                </div>
              )}

              {currentDoc.underwriter_notes && !borrowerUser && (
                <div className="mt-6 p-5 bg-blue-50 border border-blue-200 rounded-2xl">
                  <strong>Underwriter Notes:</strong> {currentDoc.underwriter_notes}
                </div>
              )}

              <div className="mt-10">
                <h4 className="font-medium mb-4">Comments</h4>
                <div className="max-h-80 overflow-y-auto space-y-4 mb-6">
                  {(currentDoc.ae_comments || []).length === 0 ? (
                    <p className="text-gray-500 italic">No comments yet.</p>
                  ) : (
                    (currentDoc.ae_comments || []).map((c: any, i: number) => (
                      <div key={i} className="bg-gray-50 p-5 rounded-2xl text-sm">
                        <div className="flex justify-between text-xs text-gray-500 mb-1">
                          <strong>{c.user}</strong>
                          <span>{new Date(c.timestamp).toLocaleString()}</span>
                        </div>
                        <p>{c.comment}</p>
                      </div>
                    ))
                  )}
                </div>

                <div className="flex gap-3">
                  <input
                    type="text"
                    id={`comment-${doc.id}`}
                    placeholder="Add a comment or note..."
                    className="flex-1 px-5 py-3 border border-gray-300 rounded-2xl focus:outline-none focus:border-blue-500"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                        addComment(doc.id, e.currentTarget.value);
                        e.currentTarget.value = '';
                      }
                    }}
                  />
                  <button
                    onClick={() => {
                      const input = document.getElementById(`comment-${doc.id}`) as HTMLInputElement;
                      if (input?.value.trim()) {
                        addComment(doc.id, input.value);
                        input.value = '';
                      }
                    }}
                    className="px-8 py-3 bg-green-600 hover:bg-green-700 text-white rounded-2xl font-medium"
                  >
                    Send
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
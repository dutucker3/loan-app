'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import { supabase } from '@/lib/supabase';
import TenantHeader from '@/components/TenantHeader';

const loanStatuses = [
  'Processing', 'Underwriting', 'Clear to Close',
  'Closed and Funded', 'On Hold', 'Rejected'
];

const documentTypes = [
  { id: 'drivers_license', label: "Borrower's Driver's License" },
  { id: 'credit_report', label: "Borrower's Credit Report" },
  { id: 'bank_statements', label: '2 Months of Bank Statements' },
  { id: 'appraisal', label: 'Appraisal' },
  { id: 'property_insurance', label: 'Property Insurance COI' },
];

type Document = {
  id?: number;
  loan_id: number;
  doc_type: string;
  file_name?: string;
  file_url?: string;
  status: 'NEEDED' | 'REVIEWING' | 'APPROVED' | 'REJECTED';
  xai_feedback?: string;
  underwriter_notes?: string;
  ae_comments: any[];
};

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
  const [activeTab, setActiveTab] = useState<'overview' | 'documents' | 'timeline' | 'notes'>('documents');

  const isUnderwriterOrHigher = user?.emailAddresses?.[0]?.emailAddress?.toLowerCase().includes('underwriter') ||
                                user?.emailAddresses?.[0]?.emailAddress?.toLowerCase().includes('superadmin');

    useEffect(() => {
    fetchLoanData();
  }, [loanId]);

  async function fetchLoanData() {
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
          .select('*')
          .eq('id', loanData.product_id)
          .single();
        setProduct(productData);
      }
    }

    const requiredDocs = getRequiredDocuments(loanData);

    const { data: docsData } = await supabase
      .from('documents')
      .select('*')
      .eq('loan_id', loanId);

    const docMap: Record<string, Document> = {};

    requiredDocs.forEach((type) => {
      const existing = docsData?.find((d: any) => d.doc_type === type.id);
      docMap[type.id] = existing || {
        loan_id: loanId,
        doc_type: type.id,
        status: 'NEEDED',
        ae_comments: [],
      };
    });

    setDocuments(docMap);
    setLoading(false);
  }

  function getRequiredDocuments(loan: any) {
    const base = [...documentTypes];

    if (loan?.loan_purpose?.toLowerCase().includes('purchase')) {
      return [
        ...base,
        { id: 'purchase_contract', label: 'Purchase Contract' },
      ];
    } else {
      return [
        ...base,
        { id: 'previous_closing', label: 'Previous Closing HUD' },
        { id: 'lease_agreements', label: 'Lease Agreements' },
      ];
    }
  }

  const updateLoanStatus = async (newStatus: string) => {
    if (!isUnderwriterOrHigher && !['On Hold', 'Rejected'].includes(newStatus)) {
      alert("Only Underwriter or higher can change to this status.");
      return;
    }

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
      status: 'NEEDED' as const,
      ae_comments: [],
    };

    const payload = {
      ...current,
      ...updates,
      loan_id: loanId,
      doc_type: docType,
    };

    // Remove id if it's not a real record yet (for upsert)
    if (!payload.id) delete payload.id;

    const { error } = await supabase
      .from('documents')
      .upsert(payload)
      .select()
      .single();

    if (error) {
      console.error('Update document error:', error);
      alert('Failed to save document info: ' + error.message);
      return;
    }

    // Update local state
    setDocuments((prev) => ({
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

      // Update with xAI feedback if available
      await updateDocument(docType, {
        file_name: file.name,
        file_url: result.fileUrl,
        status: result.status || 'REVIEWING',
        xai_feedback: result.xaiFeedback || '',
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

  const changeStatus = async (docType: string, newStatus: any) => {
    if ((newStatus === 'APPROVED' || newStatus === 'REJECTED') && !isUnderwriterOrHigher) {
      alert("Only Underwriter or higher can approve or reject documents.");
      return;
    }

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
      user: user.fullName || user.emailAddresses[0]?.emailAddress || 'AE',
      comment: commentText,
      timestamp: new Date().toISOString(),
    };

    await updateDocument(docType, {
      ae_comments: [...currentComments, newComment],
    });
  };

   if (loading) return <div className="p-12 text-center">Loading loan details...</div>;
  if (!loan) return <div className="p-12 text-center">Loan not found</div>;

  return (
    <div className="max-w-6xl mx-auto p-8">
      <TenantHeader />

      <div className="flex justify-between items-start mb-8">
        <div>
          <h1 className="text-4xl font-bold">Loan #{loan.id}</h1>
          <p className="text-2xl text-gray-700 mt-1">{loan.property_address}</p>
          {loan.borrower_name && <p className="text-gray-600 mt-1">Borrower: {loan.borrower_name}</p>}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b mb-8 gap-8 text-lg">
        {['overview', 'documents', 'timeline', 'notes'].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab as any)}
            className={`pb-4 font-medium capitalize border-b-4 transition-all ${
              activeTab === tab ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

       {/* Documents Tab - Compact Table Style */}
      {activeTab === 'documents' && (
        <div className="bg-white rounded-3xl border overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-8 py-5 font-medium text-gray-600">Document Name</th>
                <th className="text-left px-8 py-5 font-medium text-gray-600">Type</th>
                <th className="text-left px-8 py-5 font-medium text-gray-600 w-96">Feedback</th>
                <th className="px-8 py-5 font-medium text-gray-600">Status</th>
                <th className="px-8 py-5 font-medium text-gray-600 text-center">File</th>
                <th className="px-8 py-5 font-medium text-gray-600 text-center">Comments</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {documentTypes.map((doc) => {
                const currentDoc = documents[doc.id] || { 
                  status: 'NEEDED', 
                  file_url: null, 
                  ae_comments: [],
                  xai_feedback: '',
                  underwriter_notes: ''
                };

                const feedback = currentDoc.xai_feedback || currentDoc.underwriter_notes || "No feedback yet.";

                return (
                  <tr key={doc.id} className="hover:bg-gray-50 transition">
                    <td className="px-8 py-6 font-medium">{doc.label}</td>
                    <td className="px-8 py-6 text-gray-500">Document</td>
                    
                    {/* Feedback Column */}
                    <td className="px-8 py-6 text-sm text-gray-600">
                      {feedback}
                      {isUnderwriterOrHigher && (
                        <button 
                          onClick={() => {
                            const note = prompt("Add feedback / notes for this document:");
                            if (note?.trim()) {
                              updateDocument(doc.id, { underwriter_notes: note });
                            }
                          }}
                          className="ml-3 text-xs text-blue-600 hover:text-blue-700 underline"
                        >
                          + Add Feedback
                        </button>
                      )}
                    </td>

                    <td className="px-8 py-6">
                      <span className={`inline-block px-4 py-1.5 text-xs font-medium rounded-full ${
                        currentDoc.status === 'APPROVED' ? 'bg-green-100 text-green-700' :
                        currentDoc.status === 'REJECTED' ? 'bg-red-100 text-red-700' :
                        currentDoc.status === 'REVIEWING' ? 'bg-amber-100 text-amber-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {currentDoc.status}
                      </span>
                    </td>

                    <td className="px-8 py-6 text-center">
                      {currentDoc.file_url ? (
                        <a 
                          href={currentDoc.file_url} 
                          target="_blank" 
                          className="text-blue-600 hover:underline font-medium"
                        >
                          📄 View
                        </a>
                      ) : (
                        <label className="cursor-pointer text-blue-600 hover:text-blue-700 font-medium">
                          Upload
                          <input
                            type="file"
                            className="hidden"
                            onChange={(e) => e.target.files?.[0] && handleFileUpload(doc.id, e.target.files[0])}
                          />
                        </label>
                      )}
                    </td>

                    <td className="px-8 py-6 text-center">
                      <button 
                        onClick={() => {
                          const comment = prompt("Add comment:");
                          if (comment?.trim()) addComment(doc.id, comment);
                        }}
                        className="text-gray-400 hover:text-gray-600 transition"
                      >
                        💬 {currentDoc.ae_comments?.length || 0}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="bg-white border rounded-3xl p-8">
            <h3 className="font-semibold mb-6">Team Contacts</h3>
            <div className="space-y-6">
              <div>
                <p className="text-sm text-gray-500">Broker</p>
                <p className="font-medium">John Smith</p>
                <p className="text-sm text-blue-600">(555) 123-4567</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Processor</p>
                <p className="font-medium">Sarah Chen</p>
                <p className="text-sm text-blue-600">sarah@247sparkplug.com</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
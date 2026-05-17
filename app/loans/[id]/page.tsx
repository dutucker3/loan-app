'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import { supabase } from '@/lib/supabase';
import { isBorrower } from '@/lib/permissions';
import { hasPermission } from '@/lib/permissions';

type DocStatus = 'NEEDED' | 'REVIEWING' | 'APPROVED' | 'REJECTED';

interface Document {
  id?: number;
  loan_id: number;
  doc_type: string;
  file_name: string;
  description?: string;
  ai_prompt?: string;
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
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadingDocId, setUploadingDocId] = useState<number | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState<string>('BROKER_AE');

  // Add Custom Condition Modal
  const [showAddConditionModal, setShowAddConditionModal] = useState(false);
  const [newCondition, setNewCondition] = useState({
    file_name: '',
    description: '',
    ai_prompt: '',
  });

  const borrowerUser = isBorrower({ id: user?.id || '', role: currentUserRole });

  // Progress Bar Stages
  const progressStages = [
    "Signed Term Sheet",
    "Appraisal Ordered",
    "Appraisal Review",
    "Final Underwriting",
    "Clear to Close",
    "Docs Out",
    "Closed and Funded"
  ];

  useEffect(() => {
  async function fetchData() {
    if (user) {
      const { data: userData } = await supabase
        .from('users')
        .select('role')
        .eq('id', user.id)
        .single();
      if (userData) setCurrentUserRole(userData.role || 'BROKER_AE');
    }

    // Load Loan
    const { data: loanData } = await supabase
      .from('loans')
      .select('*')
      .eq('id', loanId)
      .single();

    if (!loanData) {
      setLoading(false);
      return;
    }

    setLoan(loanData);

    // Load Product
    let productData = null;
    if (loanData.product_id) {
      const { data: prod } = await supabase
        .from('loan_products')
        .select('*')
        .eq('id', loanData.product_id)
        .single();
      productData = prod;
      setProduct(prod);
    }

    // Load ALL existing documents for this loan (custom + any previously saved)
    const { data: existingDocs } = await supabase
      .from('documents')
      .select('*')
      .eq('loan_id', loanId);

    let finalDocuments: Document[] = [];

    // 1. Add Standard Conditions from Product
    if (productData?.standard_conditions) {
      const loanType = (loanData.loan_type || 'purchase').toLowerCase();
      const standards = productData.standard_conditions?.[loanType] || [];

      const standardDocs: Document[] = standards.map((cond: any, index: number) => ({
        id: index + 10000,
        loan_id: loanId,
        doc_type: `standard_${index}`,
        file_name: cond.file_name,
        description: cond.description || '',
        ai_prompt: cond.ai_prompt || '',
        status: 'NEEDED' as DocStatus,
        ae_comments: [],
      }));

      finalDocuments = [...standardDocs];
    }

    // 2. Add / Merge Custom + Previously Saved Documents
    if (existingDocs && existingDocs.length > 0) {
      const customDocs: Document[] = existingDocs.map((d: any) => ({
        id: d.id,
        loan_id: d.loan_id,
        doc_type: d.doc_type,
        file_name: d.file_name,
        description: d.description,
        ai_prompt: d.ai_prompt,
        file_url: d.file_url,
        status: d.status || 'NEEDED',
        xai_feedback: d.xai_feedback,
        underwriter_notes: d.underwriter_notes,
        ae_comments: d.ae_comments || [],
      }));

      // Merge: Keep standard conditions and add/replace custom ones
      finalDocuments = [...finalDocuments, ...customDocs];
    }

    setDocuments(finalDocuments);
    setLoading(false);
  }

    fetchData();
  }, [loanId, user]);

  const loadProductConditions = async (loanData: any, productData: any) => {
    const loanType = (loanData.loan_type || 'purchase').toLowerCase();
    const standards = productData.standard_conditions?.[loanType] || [];

    const loadedDocs: Document[] = standards.map((cond: any, index: number) => ({
      id: index + 10000,
      loan_id: loanId,
      doc_type: `standard_${index}`,
      file_name: cond.file_name,
      description: cond.description || '',
      ai_prompt: cond.ai_prompt || '',
      status: 'NEEDED' as DocStatus,
      ae_comments: [],
    }));

    setDocuments(loadedDocs);
  };

  const getProgressPercentage = () => {
    if (!loan?.loan_status) return '12%';
    const currentIndex = progressStages.indexOf(loan.loan_status);
    if (currentIndex === -1) return '12%';
    return `${Math.round(((currentIndex + 1) / progressStages.length) * 100)}%`;
  };

  const updateLoanStatus = async (newStatus: string) => {
    if (borrowerUser) return;
    if (!window.confirm(`Change loan status to "${newStatus}"?`)) return;

    const { error } = await supabase
      .from('loans')
      .update({ 
        loan_status: newStatus,
        updated_at: new Date().toISOString() 
      })
      .eq('id', loanId);

    if (error) {
      alert('Failed to update status');
    } else {
      setLoan((prev: any) => ({ ...prev, loan_status: newStatus }));
      alert(`✅ Status updated to "${newStatus}"`);
    }
  };

  const addNewCondition = async () => {
    if (!newCondition.file_name.trim()) {
      return alert("File name is required");
    }

    try {
      const { data, error } = await supabase
        .from('documents')
        .insert({
          loan_id: loanId,
          doc_type: 'custom_' + Date.now(),
          file_name: newCondition.file_name,
          description: newCondition.description || '',
          ai_prompt: newCondition.ai_prompt || '',
          status: 'NEEDED',
        })
        .select()
        .single();

      if (error) throw error;

      const newDoc: Document = {
        ...data,
        ae_comments: [],
      };

      setDocuments(prev => [...prev, newDoc]);
      setShowAddConditionModal(false);
      setNewCondition({ file_name: '', description: '', ai_prompt: '' });

      alert("✅ Custom condition saved successfully");
    } catch (err: any) {
      console.error(err);
      alert("Failed to save custom condition: " + err.message);
    }
  };

  const sendOutstandingConditionsEmail = async () => {
    const outstanding = documents.filter(d => d.status === 'NEEDED' || d.status === 'REJECTED');
    if (outstanding.length === 0) return alert('No outstanding conditions to send.');

    try {
      const res = await fetch('/api/email/send-conditions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          loanId: loan.id,
          borrowerName: loan.borrower_name,
          borrowerEmail: loan.borrower_email,
          brokerEmail: loan.originator_email || loan.broker_email,
          propertyAddress: loan.property_address,
          outstandingDocs: outstanding.map(d => ({
            label: d.file_name,
            docType: d.doc_type,
          })),
          organizationId: loan.organization_id,
        }),
      });

      const result = await res.json();
      if (result.success) {
        alert('✅ Outstanding conditions email sent to borrower and broker!');
      } else {
        alert('Failed to send email: ' + (result.error || 'Unknown error'));
      }
    } catch (err: any) {
      alert('Error sending email: ' + err.message);
    }
  };

  const handleFileUpload = async (index: number, file: File) => {
    const doc = documents[index];
    if (doc.status === 'APPROVED') {
      return alert("This document is approved and locked. You cannot replace it.");
    }

    setUploadingDocId(index);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('docType', doc.doc_type);
      formData.append('loanId', loanId.toString());

      const uploadRes = await fetch('/api/upload-document', {
        method: 'POST',
        body: formData,
      });

      const uploadResult = await uploadRes.json();
      if (!uploadResult.success) throw new Error(uploadResult.error);

      // Update document
      const updatedDocs = [...documents];
      updatedDocs[index] = {
        ...updatedDocs[index],
        file_name: file.name,
        file_url: uploadResult.fileUrl,
        status: 'REVIEWING',
      };
      setDocuments(updatedDocs);

      alert(`✅ Uploaded: ${file.name}`);
    } catch (err: any) {
      alert('Upload failed: ' + err.message);
    } finally {
      setUploadingDocId(null);
    }
  };

  const approveDocument = async (index: number) => {
    const doc = documents[index];
    if (!doc) return;

    const confirmed = window.confirm(`Approve "${doc.file_name}"? This will lock the document from further changes.`);
    if (!confirmed) return;

    try {
      const { error } = await supabase
        .from('documents')
        .update({ 
          status: 'APPROVED',
          underwriter_notes: 'Approved by processor'
        })
        .eq('id', doc.id);

      if (error) throw error;

      const updatedDocs = [...documents];
      updatedDocs[index].status = 'APPROVED';
      setDocuments(updatedDocs);

      alert(`✅ Document "${doc.file_name}" has been approved and locked.`);
    } catch (err: any) {
      alert('Failed to approve document: ' + err.message);
    }
  };

  if (loading) return <div className="p-12 text-center">Loading loan details...</div>;
  if (!loan) return <div className="p-12 text-center">Loan not found</div>;

  return (
    <div className="max-w-6xl mx-auto p-8">
      {/* Header */}
      <div className="flex justify-between items-start mb-10">
        <div>
          <h1 className="text-4xl font-bold">Loan #{loan.id}</h1>
          <p className="text-2xl text-gray-700 mt-2">{loan.property_address}</p>
          {loan.borrower_name && <p className="text-gray-600 mt-1">Borrower: {loan.borrower_name}</p>}
          {product && <p className="text-blue-600 font-medium mt-1">Product: {product.name}</p>}
        </div>
        <button 
          onClick={() => router.push('/dashboard')}
          className="px-6 py-3 bg-gray-200 hover:bg-gray-300 rounded-xl font-medium"
        >
          ← Back to Dashboard
        </button>
      </div>

      {/* Loan Summary Bar */}
      <div className="bg-white border rounded-3xl p-8 mb-8 grid grid-cols-2 md:grid-cols-4 gap-6">
        <div>
          <div className="text-sm text-gray-500">Purchase Price</div>
          <div className="text-2xl font-semibold">${loan.purchase_price?.toLocaleString() || '—'}</div>
        </div>
        <div>
          <div className="text-sm text-gray-500">Loan Amount</div>
          <div className="text-2xl font-semibold">${loan.loan_amount?.toLocaleString() || '—'}</div>
        </div>
        <div>
          <div className="text-sm text-gray-500">Appraised Value</div>
          <div className="text-2xl font-semibold">${loan.appraised_value?.toLocaleString() || '—'}</div>
        </div>
        <div>
          <div className="text-sm text-gray-500">Interest Rate</div>
          <div className="text-2xl font-semibold">{loan.interest_rate ? loan.interest_rate + '%' : '—'}</div>
        </div>
        <div className="md:col-span-2">
          <div className="text-sm text-gray-500">Borrower(s)</div>
          <div className="font-medium">{loan.borrower_name || '—'}</div>
        </div>
        <div>
          <div className="text-sm text-gray-500">DSCR</div>
          <div className="text-2xl font-semibold">{loan.dscr ? loan.dscr.toFixed(2) + 'x' : '—'}</div>
        </div>
      </div>

      {/* Dynamic Progress Bar */}
      <div className="bg-white border rounded-3xl p-8 mb-8">
        <h3 className="text-lg font-semibold mb-6 text-center">Loan Progress</h3>
        
        <div className="relative">
          <div className="absolute top-5 left-0 right-0 h-1 bg-gray-200 rounded-full"></div>
          <div 
            className="absolute top-5 left-0 h-1 bg-blue-600 rounded-full transition-all duration-700"
            style={{ width: getProgressPercentage() }}
          ></div>

          <div className="flex justify-between relative z-10">
            {progressStages.map((stage, i) => {
              const currentIndex = progressStages.indexOf(loan?.loan_status || '');
              const isCompleted = i < currentIndex;
              const isCurrent = i === currentIndex;

              return (
                <div key={i} className="flex flex-col items-center w-1/7">
                  <div className={`w-10 h-10 rounded-full border-4 flex items-center justify-center transition-all ${
                    isCompleted ? 'bg-green-500 border-green-500 text-white' :
                    isCurrent ? 'bg-blue-600 border-blue-600 text-white ring-4 ring-blue-100' : 'bg-white border-gray-300'
                  }`}>
                    {isCompleted ? '✓' : i + 1}
                  </div>
                  <div className={`text-center mt-3 text-xs font-medium leading-tight max-w-[85px] ${
                    isCurrent ? 'text-blue-600 font-semibold' : isCompleted ? 'text-green-600' : 'text-gray-500'
                  }`}>
                    {stage}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Loan Status Selector */}
      {!borrowerUser && (
        <div className="mb-8">
          <label className="block text-sm font-medium mb-3">Loan Status</label>
          <select
            value={loan.loan_status || 'Processing'}
            onChange={(e) => updateLoanStatus(e.target.value)}
            className="bg-white border border-gray-300 rounded-2xl px-6 py-4 text-lg w-full max-w-md focus:outline-none focus:border-blue-500"
          >
            {progressStages.map((status) => (
              <option key={status} value={status}>{status}</option>
            ))}
            <option value="On Hold">On Hold</option>
            <option value="Rejected">Declined / Rejected</option>
          </select>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-4 mb-10 justify-end">
        {hasPermission({ id: user?.id || '', role: currentUserRole }, ['LOAN_UNDERWRITER', 'SENIOR_ACCOUNT_EXECUTIVE', 'ACCOUNT_EXECUTIVE', 'LENDING_SUPERVISOR', 'SUPER_ADMIN']) && (
          <>
            <button
              onClick={() => setShowAddConditionModal(true)}
              className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-semibold flex items-center gap-2"
            >
              ➕ Add Custom Condition
            </button>
            <button
              onClick={sendOutstandingConditionsEmail}
              className="px-8 py-4 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-3xl flex items-center gap-3"
            >
              📧 Send Outstanding Conditions Email
            </button>
          </>
        )}
      </div>

      {/* Conditions List */}
      <div className="space-y-6">
        {documents.length === 0 ? (
          <div className="bg-yellow-50 border border-yellow-200 p-12 rounded-3xl text-center">
            <p className="text-yellow-700">No conditions loaded from the selected product yet.</p>
          </div>
        ) : (
          documents.map((doc, index) => (
            <div key={index} className="bg-white border rounded-3xl p-8 flex items-center justify-between hover:shadow-md transition-all">
              <div className="flex-1">
                <h3 className="text-xl font-semibold">{doc.file_name}</h3>
                {doc.description && <p className="text-gray-600 mt-1">{doc.description}</p>}
                {doc.xai_feedback && (
                  <div className="mt-3 p-4 bg-amber-50 border border-amber-200 rounded-2xl text-sm">
                    <strong>xAI Review:</strong> {doc.xai_feedback}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-6">
                <div className={`px-5 py-2 rounded-full text-sm font-medium ${
                  doc.status === 'APPROVED' ? 'bg-green-100 text-green-700' :
                  doc.status === 'REVIEWING' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'
                }`}>
                  {doc.status}
                </div>

                {doc.file_url && (
                  <a
                    href={doc.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-6 py-3 bg-gray-800 hover:bg-gray-900 text-white rounded-2xl text-sm font-medium"
                  >
                    👁️ View Document
                  </a>
                )}

                {doc.status !== 'APPROVED' && (
                  <label className="cursor-pointer">
                    <div className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl text-sm font-medium">
                      📤 Upload / Replace
                    </div>
                    <input
                      type="file"
                      className="hidden"
                      onChange={(e) => e.target.files?.[0] && handleFileUpload(index, e.target.files[0])}
                    />
                  </label>
                )}

                {(doc.status === 'REVIEWING' || doc.status === 'NEEDED') && 
                  hasPermission({ id: user?.id || '', role: currentUserRole }, ['LOAN_PROCESSOR', 'LOAN_UNDERWRITER', 'SENIOR_ACCOUNT_EXECUTIVE', 'LENDING_SUPERVISOR', 'SUPER_ADMIN']) && (
                  <button
                    onClick={() => approveDocument(index)}
                    className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-2xl text-sm font-medium"
                  >
                    ✅ Approve
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add Custom Condition Modal */}
      {showAddConditionModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-white rounded-3xl p-8 max-w-lg w-full mx-4">
            <h3 className="text-2xl font-semibold mb-6">Add Custom Condition</h3>
            
            <input
              type="text"
              placeholder="Document Name *"
              value={newCondition.file_name}
              onChange={(e) => setNewCondition({ ...newCondition, file_name: e.target.value })}
              className="w-full px-5 py-4 border rounded-2xl mb-4"
            />
            <textarea
              placeholder="Description / Instructions"
              value={newCondition.description}
              onChange={(e) => setNewCondition({ ...newCondition, description: e.target.value })}
              className="w-full px-5 py-4 border rounded-2xl h-24 mb-4"
            />
            <textarea
              placeholder="AI Prompt for xAI review (optional)"
              value={newCondition.ai_prompt}
              onChange={(e) => setNewCondition({ ...newCondition, ai_prompt: e.target.value })}
              className="w-full px-5 py-4 border rounded-2xl h-32"
            />

            <div className="flex gap-4 mt-8">
              <button onClick={() => setShowAddConditionModal(false)} className="flex-1 py-4 bg-gray-200 rounded-2xl font-semibold hover:bg-gray-300">Cancel</button>
              <button onClick={addNewCondition} className="flex-1 py-4 bg-indigo-600 text-white rounded-2xl font-semibold hover:bg-indigo-700">Add Condition</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
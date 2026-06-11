'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { isBorrower } from '@/lib/permissions';
import { hasPermission } from '@/lib/permissions';
import { createReggoraLoan, createReggoraOrder, fetchReggoraProducts } from '@/app/actions/reggora';
import { orderCreditReportForLoan, snapshotPricingMatrixForLoan } from '@/app/actions/organization-actions';
import { logPageVisit, logAudit } from '@/lib/audit';

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
  const loanId = parseInt(params.id as string);

  const [loan, setLoan] = useState<any>(null);
  const [product, setProduct] = useState<any>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadingDocId, setUploadingDocId] = useState<number | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState<string>('BROKER_AE');
  const [sbUser, setSbUser] = useState<any>(null);

  // Add Custom Condition Modal
  const [showAddConditionModal, setShowAddConditionModal] = useState(false);
  const [newCondition, setNewCondition] = useState({
    file_name: '',
    description: '',
    ai_prompt: '',
  });

  // Reggora Appraisal Order
  const [reggoraProducts, setReggoraProducts] = useState<any[]>([]);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [orderingAppraisal, setOrderingAppraisal] = useState(false);
  const [appraisalOrderId, setAppraisalOrderId] = useState<string | null>(null);

  // Title / Insurance provider contacts (new) - now editable here as standard conditions for the loan
  const [resendingProviders, setResendingProviders] = useState(false);
  const [titleCompany, setTitleCompany] = useState({ name: '', phone: '', email: '' });
  const [insuranceCompany, setInsuranceCompany] = useState({ name: '', phone: '', email: '' });
  const [savingContacts, setSavingContacts] = useState(false);

  // Org + Credit report matrix context (loaded for !borrower credit/appraisal auto matrix use)
  const [organization, setOrganization] = useState<any>(null);
  const [creditOrderResult, setCreditOrderResult] = useState<any>(null);
  const [orderingCredit, setOrderingCredit] = useState(false);

  const borrowerUser = isBorrower({ id: sbUser?.id || '', role: currentUserRole });

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
    // Load Supabase user (post Clerk removal)
    const { data: { user: u } } = await supabase.auth.getUser();
    setSbUser(u);
    if (u) {
      let userData = null;
      try {
        let res = await supabase.from('profiles').select('role').eq('id', u.id).maybeSingle();
        userData = res.data;
        if (!userData) {
          res = await supabase.from('profiles').select('role').eq('id', u.id).maybeSingle();
          userData = res.data;
        }
      } catch {}
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

    // Load provider contacts if present (for editing as standard conditions)
    if (loanData.title_company) setTitleCompany(loanData.title_company);
    if (loanData.insurance_company) setInsuranceCompany(loanData.insurance_company);

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

    // Load Org (for credit settings + benchmark context in credit/appraisal sections; matrix auto-use)
    if (loanData.organization_id) {
      const { data: orgData } = await supabase
        .from('organizations')
        .select('id, name, pass_credit_report_costs_to_borrower, credit_report_cost_amount, benchmark_treasury')
        .eq('id', loanData.organization_id)
        .single();
      setOrganization(orgData || null);
    } else {
      setOrganization(null);
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
  }, [loanId, sbUser]);

  // Light page visit logging for critical /loans/[id] page (fire-and-forget, zero perf impact on main load).
  useEffect(() => {
    if (sbUser?.id) {
      logPageVisit(`/loans/${loanId}`, sbUser.id, loan?.organization_id || null).catch(() => {});
    }
  }, [sbUser?.id, loanId, loan?.organization_id]);

  // Preload Reggora products (for ordering appraisals on this loan)
  useEffect(() => {
    loadReggoraProducts();
  }, []);

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

    await logAudit({
      userId: sbUser?.id,
      organizationId: loan?.organization_id,
      action: 'loan_status_changed',
      resourceType: 'loan',
      resourceId: loanId,
      details: { old_status: loan?.loan_status, new_status: newStatus, by: sbUser?.id },
    });

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

      await logAudit({
        userId: sbUser?.id,
        organizationId: loan?.organization_id,
        action: 'condition_added',
        resourceType: 'condition',
        resourceId: data?.id,
        details: { loan_id: loanId, file_name: newCondition.file_name, doc_type: data?.doc_type },
      });

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

  // Resend (or initial send) the provider magic link emails for title/insurance
  const resendProviderRequests = async () => {
    if (!loan) return;
    setResendingProviders(true);
    try {
      const res = await fetch('/api/email/send-provider-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          loanId: loan.id,
          titleCompany: loan.title_company,
          insuranceCompany: loan.insurance_company,
        }),
      });
      const j = await res.json();
      if (j.success) {
        alert(`✅ Provider requests sent. Title: ${j.sentTitle ? 'yes' : 'no'}. Insurance: ${j.sentInsurance ? 'yes' : 'no'}.`);
        // Refresh loan to pick up any new tokens in the JSON
        const { data: refreshed } = await supabase.from('loans').select('*').eq('id', loanId).single();
        if (refreshed) setLoan(refreshed);
      } else {
        alert('Send failed: ' + (j.error || 'unknown'));
      }
    } catch (e: any) {
      alert('Error: ' + e.message);
    } finally {
      setResendingProviders(false);
    }
  };

  // Save / update title and insurance contacts directly on the loan (moved from creation flow; treated as standard conditions for provider automation)
  const saveProviderContacts = async () => {
    if (!loan) return;
    setSavingContacts(true);
    try {
      const titleCo = (titleCompany.name || titleCompany.email) ? { ...titleCompany } : null;
      const insCo = (insuranceCompany.name || insuranceCompany.email) ? { ...insuranceCompany } : null;

      const { error } = await supabase
        .from('loans')
        .update({
          title_company: titleCo,
          insurance_company: insCo,
        })
        .eq('id', loanId);

      if (error) throw error;

      setLoan({ ...loan, title_company: titleCo, insurance_company: insCo });
      alert('Provider contacts saved. Use the Resend button above to trigger (or re-trigger) the automated emails with secure upload links.');
    } catch (e: any) {
      alert('Failed to save contacts: ' + (e.message || e));
    } finally {
      setSavingContacts(false);
    }
  };

  const loadReggoraProducts = async () => {
    const res = await fetchReggoraProducts();
    if (res.error) {
      alert('Reggora error: ' + res.error);
      return [];
    }
    setReggoraProducts(res.products || []);
    return res.products || [];
  };

  const orderAppraisalViaReggora = async () => {
    if (!loan) return alert('Loan not loaded');
    if (!selectedProductId) return alert('Select a Reggora product first');

    setOrderingAppraisal(true);
    try {
      // 1. Ensure Reggora loan exists (uses our loan data)
      const loanRes = await createReggoraLoan(loan);
      if (loanRes.error) throw new Error(loanRes.error);
      const reggoraLoanId = loanRes.reggoraLoanId!;
      console.log('Reggora loan ID:', reggoraLoanId);

      // 2. Auto-use this loan's product pricing matrix for suggested additional fee (light scan of Other Adjustments or baseRates proxy) - inline client version to avoid 'use server' import issues for pure helpers
      let additionalFees: Array<{ description: string; amount: string }> | undefined = undefined;
      if (product?.pricing_matrix) {
        const mRaw = product.pricing_matrix;
        const matrix = (typeof mRaw === 'string') ? (() => { try { return JSON.parse(mRaw); } catch { return {}; } })() : (mRaw || {});
        const other = matrix['Other Adjustments'] || matrix['otherAdjustments'] || matrix['Other Adjustment'] || {};
        let suggested = 650;
        for (const [key, val] of Object.entries(other)) {
          if (/apprais|valuation|inspection/i.test(String(key))) {
            let nv = val;
            if (nv && typeof nv === 'object' && !Array.isArray(nv)) {
              const vs = Object.values(nv as any).filter((v: any) => !isNaN(parseFloat(v)));
              nv = vs.length ? vs[0] : 0;
            }
            const n = parseFloat(String(nv));
            if (!isNaN(n)) { suggested = n !== 0 ? n : 650; break; }
          }
        }
        if (suggested === 650) {
          // baseRates proxy
          const br = matrix.baseRates || matrix['Base Rate'] || matrix['baseRates'] || {};
          const pvs: number[] = Object.values(br).map((v: any) => parseFloat(String(v))).filter(n => !isNaN(n));
          if (pvs.length) {
            const avg = pvs.reduce((a,b)=>a+b,0) / pvs.length;
            const prx = Math.abs(100 - avg);
            suggested = Math.round(Math.max(200, Math.min(950, prx * 350)));
          }
        }
        const prodName = product?.name || 'this product';
        additionalFees = [{
          description: `Appraisal fee (auto from loan product ${prodName} matrix context)`,
          amount: Number(suggested).toFixed(2),
        }];
      }

      // 3. Create order (pass matrix-derived additional fee if computed; Reggora product select stays as primary)
      const dueDate = new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0]; // +14 days
      const orderRes = await createReggoraOrder({
        loan: reggoraLoanId,
        products: [selectedProductId],
        due_date: `${dueDate}T17:00:00Z`,
        priority: 'Normal',
        allocation_type: 'automatically',
        ...(additionalFees ? { additional_fees: additionalFees } : {}),
      });
      if (orderRes.error) throw new Error(orderRes.error);

      const orderId = orderRes.orderId!;
      setAppraisalOrderId(orderId);

      // Persist order ID + status locally (new column)
      await supabase.from('loans').update({ reggora_order_id: orderId, reggora_status: 'created', loan_status: 'Appraisal Ordered' }).eq('id', loanId);

      // 4. Snapshot the *current* loan product matrix (with org benchmark + live FRED if applicable) into notes for this order time
      try {
        await snapshotPricingMatrixForLoan(loanId, 'appraisal');
      } catch (snapErr) {
        console.warn('Matrix snapshot for appraisal non-fatal:', snapErr);
      }

      alert(`✅ Appraisal ordered via Reggora! Order ID: ${orderId}${additionalFees ? ' (matrix fee context included)' : ''}`);

      // Refresh loan to pick up status + any note updates from snapshot
      const { data: refreshed } = await supabase.from('loans').select('*').eq('id', loanId).single();
      if (refreshed) setLoan(refreshed);

    } catch (err: any) {
      console.error(err);
      alert('Failed to order appraisal: ' + err.message);
    } finally {
      setOrderingAppraisal(false);
    }
  };

  // Real credit report order action (replaces placeholder alert). Uses loan's org for cost/pass, product's matrix for light 'Other Adjustments' credit* lookup + snapshot.
  const orderCreditReport = async () => {
    if (borrowerUser) return;
    if (!loan) return alert('Loan not loaded');

    setOrderingCredit(true);
    setCreditOrderResult(null);
    try {
      const res = await orderCreditReportForLoan(loanId);
      if (!res.success) {
        throw new Error(res.error || 'Failed');
      }
      setCreditOrderResult(res);

      // Merge the credit_report doc into local documents list (so it shows as NEEDED condition)
      const newCreditDoc = {
        id: Date.now(),
        loan_id: loanId,
        doc_type: 'credit_report',
        file_name: 'Credit Report',
        status: 'NEEDED' as DocStatus,
        ae_comments: [],
        description: res.summary || '',
      };
      setDocuments((prev: Document[]) => {
        // avoid dup if already present
        const withoutDup = prev.filter(d => d.doc_type !== 'credit_report' || d.file_name !== 'Credit Report');
        return [...withoutDup, newCreditDoc];
      });

      // Refresh loan (notes may have snapshot appended)
      const { data: refreshed } = await supabase.from('loans').select('*').eq('id', loanId).single();
      if (refreshed) setLoan(refreshed);

    } catch (err: any) {
      console.error(err);
      alert('Failed to order credit report: ' + (err.message || err));
    } finally {
      setOrderingCredit(false);
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

      await logAudit({
        userId: sbUser?.id,
        organizationId: loan?.organization_id,
        action: 'document_uploaded',
        resourceType: 'document',
        resourceId: doc.doc_type,
        details: { loan_id: loanId, file_name: file.name, doc_type: doc.doc_type, file_url: uploadResult.fileUrl },
      });

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

      await logAudit({
        userId: sbUser?.id,
        organizationId: loan?.organization_id,
        action: 'document_approved',
        resourceType: 'document',
        resourceId: String(doc.id),
        details: { loan_id: loanId, file_name: doc.file_name, doc_type: doc.doc_type },
      });

      alert(`✅ Document "${doc.file_name}" has been approved and locked.`);
    } catch (err: any) {
      alert('Failed to approve document: ' + err.message);
    }
  };

  const deleteDocument = async (index: number) => {
    const doc = documents[index];
    if (!doc || doc.status === 'APPROVED') return alert('Cannot delete approved document.');
    // Only real DB docs (standard conditions use fake high ids)
    if (!doc.id || doc.id >= 10000) return alert('Standard product conditions cannot be deleted here; edit the product.');

    if (!confirm(`Delete condition/document "${doc.file_name}"?`)) return;

    try {
      await logAudit({
        userId: sbUser?.id,
        organizationId: loan?.organization_id,
        action: 'document_deleted',
        resourceType: 'document',
        resourceId: String(doc.id),
        details: { loan_id: loanId, file_name: doc.file_name, doc_type: doc.doc_type, previous_status: doc.status },
      });

      const { error } = await supabase.from('documents').delete().eq('id', doc.id);
      if (error) throw error;

      const updated = documents.filter((_, i) => i !== index);
      setDocuments(updated);
      alert('✅ Deleted.');
    } catch (err: any) {
      alert('Delete failed: ' + (err.message || err));
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

      {/* Credit Report Ordering - now auto-uses this loan's product pricing_matrix (snapshot + light Other Adjustments credit lookup for cost) */}
      {!borrowerUser && (
        <div className="mb-8 p-6 bg-purple-50 border border-purple-200 rounded-3xl">
          <h3 className="font-semibold mb-3">Order Credit Report</h3>

          {/* Org + Product Matrix context (auto-use) */}
          <div className="mb-4 p-3 bg-white/70 rounded-2xl text-sm">
            {organization ? (
              <div>
                <div className="font-medium">Org credit settings: Pass to borrower? {organization.pass_credit_report_costs_to_borrower ? 'Yes' : 'No'} | Amount: {organization.credit_report_cost_amount != null ? `$${Number(organization.credit_report_cost_amount).toFixed(2)}` : 'default $29.99'}</div>
              </div>
            ) : (
              <div className="text-gray-500">No organization linked to this loan (using defaults).</div>
            )}
            {product ? (
              <div className="mt-1 text-blue-700">
                Auto-using pricing matrix from this loan&apos;s product: <strong>{product.name}</strong> (baseRates: {(() => { const m = product.pricing_matrix || {}; const br = m.baseRates || m['Base Rate'] || m['baseRates'] || {}; return Object.keys(br).length; })()} entries
                {product.pricing_matrix?.benchmark ? `, benchmark: ${product.pricing_matrix.benchmark}` : ''}
                {product.pricing_matrix?.benchmark_anchor_rate != null ? ` anchored @ ${product.pricing_matrix.benchmark_anchor_rate}%` : ''}
                {organization?.benchmark_treasury ? ` (org benchmark ${organization.benchmark_treasury})` : ''})
                . On order: full matrix + live FRED (if benchmarked) will be snapshotted to loan.notes.
              </div>
            ) : (
              <div className="mt-1 text-amber-600 text-xs">No product matrix on this loan — order will proceed without matrix snapshot (using org/default cost).</div>
            )}
          </div>

          {creditOrderResult && (
            <div className="mb-4 p-4 bg-green-100 border border-green-300 rounded-2xl text-sm text-green-800">
              ✅ {creditOrderResult.summary || 'Credit report ordered.'}
              <div className="mt-1">Cost: ${creditOrderResult.cost?.toFixed?.(2) || creditOrderResult.cost} | Passed to borrower: {creditOrderResult.passedToBorrower ? 'Yes' : 'No'} | Matrix used: {creditOrderResult.matrixUsed}</div>
              <div className="text-[10px] mt-1">Matrix snapshot saved (see loan notes for full pricing context at order time).</div>
            </div>
          )}

          <div className="flex flex-wrap gap-4 items-end">
            <button
              onClick={orderCreditReport}
              disabled={orderingCredit}
              className="px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-2xl font-semibold disabled:opacity-50"
            >
              {orderingCredit ? 'Ordering...' : '📋 Order Credit Report'}
            </button>
            <span className="text-xs text-purple-600">
              {(() => {
                const orgCost = organization?.credit_report_cost_amount != null ? Number(organization.credit_report_cost_amount) : 29.99;
                // Preview uses org/default; light matrix 'credit|report' lookup + adjust happens server-side in orderCreditReportForLoan (see result for final)
                return `Effective cost (preview): $${orgCost.toFixed(2)} (org pass-through: ${organization?.pass_credit_report_costs_to_borrower ? 'to borrower' : 'absorbed by org'}; matrix may adjust)`;
              })()}
            </span>
          </div>
          <p className="text-[10px] text-gray-500 mt-2">Real DB action + matrix snapshot (placeholder for bureau API). Respects org pass_credit_report_costs_to_borrower + credit_report_cost_amount. Light matrix use for credit keys in Other Adjustments if present.</p>
        </div>
      )}

      {/* Reggora Appraisal Ordering (for this loan) - auto-uses loaded product matrix for fee suggestion + snapshot */}
      {!borrowerUser && reggoraProducts.length > 0 && (
        <div className="mb-8 p-6 bg-blue-50 border border-blue-200 rounded-3xl">
          <h3 className="font-semibold mb-3">Order Appraisal via Reggora</h3>

          {/* Matrix context from *this loan's* product (if loaded via product_id) */}
          {product ? (
            <div className="mb-3 p-3 bg-white/70 rounded-2xl text-sm">
              <span className="text-blue-700">Auto-using pricing matrix from this loan&apos;s product: <strong>{product.name}</strong> (baseRates: {(() => { const m = product.pricing_matrix || {}; const br = m.baseRates || m['Base Rate'] || m['baseRates'] || {}; return Object.keys(br).length; })()} entries
              {product.pricing_matrix?.benchmark ? `, benchmark: ${product.pricing_matrix.benchmark}` : ''}
              {product.pricing_matrix?.benchmark_anchor_rate != null ? ` anchored @ ${product.pricing_matrix.benchmark_anchor_rate}%` : ''}).
              Suggested additional fee will derive from matrix Other Adjustments (appraisal keys) or baseRates proxy. Full matrix snapshotted to loan notes on order (see [PRICING-MATRIX-SNAPSHOT:appraisal ...]).</span>
            </div>
          ) : (
            <div className="mb-3 p-2 bg-amber-100 text-amber-700 rounded text-xs">No product matrix on this loan — order will proceed without matrix snapshot / fee suggestion (using defaults + your Reggora product amounts).</div>
          )}

          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <label className="block text-xs mb-1">Product</label>
              <select
                value={selectedProductId}
                onChange={(e) => setSelectedProductId(e.target.value)}
                className="border rounded-2xl px-4 py-2 text-sm"
              >
                <option value="">Select product...</option>
                {reggoraProducts.map((p: any) => (
                  <option key={p.id} value={p.id}>{p.product_name} (${p.amount})</option>
                ))}
              </select>
            </div>
            <button
              onClick={() => router.push(`/loans/${loanId}/appraisal`)}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-semibold"
            >
              🚀 Order Appraisal (Reggora) →
            </button>
            <p className="text-[10px] text-gray-500 mt-2">Opens dedicated page with full application data mapping, preset fees ($900 default with refund), multi-AMC support, and white-label webhook readiness.</p>
          </div>
          <p className="text-[10px] text-gray-500 mt-2">This will create a loan record + order in Reggora sandbox using this loan&apos;s data (auto-using this loan&apos;s product pricing matrix for fee suggestion + snapshot of rates/adjustments at order time).</p>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-4 mb-10 justify-end">
        {hasPermission({ id: sbUser?.id || '', role: currentUserRole }, ['LOAN_UNDERWRITER', 'SENIOR_ACCOUNT_EXECUTIVE', 'ACCOUNT_EXECUTIVE', 'LENDING_SUPERVISOR', 'SUPER_ADMIN']) && (
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

      {/* === TITLE & INSURANCE PROVIDER REQUESTS (standard conditions for the loan) === */}
      <div className="bg-white border rounded-3xl p-6 mb-8">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-semibold">Title &amp; Insurance Provider Requests (Standard Conditions)</h3>
          <div className="flex gap-2">
            <button
              onClick={saveProviderContacts}
              disabled={savingContacts}
              className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-2xl disabled:opacity-60"
            >
              {savingContacts ? 'Saving...' : '💾 Save Contacts'}
            </button>
            <button
              onClick={resendProviderRequests}
              disabled={resendingProviders}
              className="px-5 py-2 bg-violet-600 text-white rounded-2xl text-sm disabled:opacity-60"
            >
              {resendingProviders ? 'Sending...' : '📧 Resend / Send Provider Emails'}
            </button>
          </div>
        </div>

        {/* Descriptive info moved here as standard condition details (was only in creation form) */}
        <div className="mb-4 space-y-3">
          <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-4">
            <h4 className="font-semibold text-indigo-900 mb-1">Title Company Contact</h4>
            <p className="text-xs text-indigo-700 mb-2">Required for automated document request. The email will contain: loan number, loan amount, and the mortgagee clause. They must upload 4 files via the secure link: Title Commitment, Closing Protection letter, Prelim Combined Closing Statement, and E &amp; O Insurance.</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input type="text" placeholder="Company / Contact Name" value={titleCompany.name} onChange={e => setTitleCompany({ ...titleCompany, name: e.target.value })} className="px-3 py-2 border rounded-xl text-sm" />
              <input type="tel" placeholder="Phone Number" value={titleCompany.phone} onChange={e => setTitleCompany({ ...titleCompany, phone: e.target.value })} className="px-3 py-2 border rounded-xl text-sm" />
              <input type="email" placeholder="Email for secure upload link" value={titleCompany.email} onChange={e => setTitleCompany({ ...titleCompany, email: e.target.value })} className="px-3 py-2 border rounded-xl text-sm" />
            </div>
          </div>

          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4">
            <h4 className="font-semibold text-emerald-900 mb-1">Insurance Company / Agent Contact</h4>
            <p className="text-xs text-emerald-700 mb-2">Required for automated request. Email will include loan #, amount, mortgagee clause + the Insurance Requirements from the selected product. They upload exactly 3 files: Invoice, Certificate of Insurance, Declarations.</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input type="text" placeholder="Company / Agent Name" value={insuranceCompany.name} onChange={e => setInsuranceCompany({ ...insuranceCompany, name: e.target.value })} className="px-3 py-2 border rounded-xl text-sm" />
              <input type="tel" placeholder="Phone Number" value={insuranceCompany.phone} onChange={e => setInsuranceCompany({ ...insuranceCompany, phone: e.target.value })} className="px-3 py-2 border rounded-xl text-sm" />
              <input type="email" placeholder="Email for secure upload link" value={insuranceCompany.email} onChange={e => setInsuranceCompany({ ...insuranceCompany, email: e.target.value })} className="px-3 py-2 border rounded-xl text-sm" />
            </div>
          </div>
          <p className="text-[10px] text-gray-500">These contacts + emails are stored on the loan and used to generate one-time secure provider portals. You can also add or resend from here.</p>
        </div>

        <div className="text-sm grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
          <div>
            <div className="font-medium text-gray-500">Mortgagee Clause (included in emails)</div>
            <div className="mt-1 p-3 bg-gray-50 rounded-2xl text-xs whitespace-pre-wrap font-mono border">{loan?.mortgagee_clause || '— not captured on this loan'}</div>
          </div>

          <div className="space-y-4">
            <div>
              <div className="font-medium">Title Company</div>
              {loan?.title_company ? (
                <div className="text-sm mt-1">
                  <div>{loan.title_company.name || '—'}</div>
                  <div className="text-gray-600">{loan.title_company.phone || ''} {loan.title_company.email ? `• ${loan.title_company.email}` : ''}</div>
                  {loan.title_company.email && (
                    <a className="text-violet-700 underline text-xs" href={`/providers/title/${loan.id}?token=${loan.title_company.token || ''}`} target="_blank">Open provider upload link ↗</a>
                  )}
                </div>
              ) : <div className="text-xs text-gray-500">Not provided yet — use the fields above.</div>}
            </div>

            <div>
              <div className="font-medium">Insurance Company</div>
              {loan?.insurance_company ? (
                <div className="text-sm mt-1">
                  <div>{loan.insurance_company.name || '—'}</div>
                  <div className="text-gray-600">{loan.insurance_company.phone || ''} {loan.insurance_company.email ? `• ${loan.insurance_company.email}` : ''}</div>
                  {loan.insurance_company.email && (
                    <a className="text-violet-700 underline text-xs" href={`/providers/insurance/${loan.id}?token=${loan.insurance_company.token || ''}`} target="_blank">Open provider upload link ↗</a>
                  )}
                </div>
              ) : <div className="text-xs text-gray-500">Not provided yet.</div>}
            </div>
          </div>
        </div>

        <div className="mt-4 text-[11px] text-gray-500">The two standard conditions (Title Company Documents + Insurance Documents) are pulled from the product and appear in the list below. Uploads from the providers will create matching document records with RECEIVED status.</div>
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
                  hasPermission({ id: sbUser?.id || '', role: currentUserRole }, ['LOAN_PROCESSOR', 'LOAN_UNDERWRITER', 'SENIOR_ACCOUNT_EXECUTIVE', 'LENDING_SUPERVISOR', 'SUPER_ADMIN']) && (
                  <button
                    onClick={() => approveDocument(index)}
                    className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-2xl text-sm font-medium"
                  >
                    ✅ Approve
                  </button>
                )}

                {doc.status !== 'APPROVED' && doc.id && doc.id < 10000 && hasPermission({ id: sbUser?.id || '', role: currentUserRole }, ['LOAN_PROCESSOR', 'LOAN_UNDERWRITER', 'SENIOR_ACCOUNT_EXECUTIVE', 'LENDING_SUPERVISOR', 'SUPER_ADMIN']) && (
                  <button
                    onClick={() => deleteDocument(index)}
                    className="px-4 py-3 text-red-600 hover:text-red-700 border border-red-200 rounded-2xl text-sm font-medium"
                    title="Delete this condition/document (audited)"
                  >
                    🗑️ Delete
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
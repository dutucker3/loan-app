'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { approveBridgeTermSheet, createLoanFromBridgeApplication } from '@/app/actions/submitApplication';

interface Props {
  application: any;
  products: any[];
  tenantName: string;
  tenantLogo?: string | null;
  tenantColor?: string;
}

export default function BridgeLoanReviewClient({
  application,
  products: initialProducts,
  tenantName,
  tenantLogo,
  tenantColor = '#111827',
}: Props) {
  const router = useRouter();
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [activeTab, setActiveTab] = useState(0);
  const [termSheet, setTermSheet] = useState<any>({});
  const [approving, setApproving] = useState(false);
  const [approved, setApproved] = useState(false);
  const [emailSentTo, setEmailSentTo] = useState<string[]>([]);
  const [signaturesSimulated, setSignaturesSimulated] = useState(false);
  const [creatingLoan, setCreatingLoan] = useState(false);
  const [newLoanId, setNewLoanId] = useState<string | null>(null);

  const app = application;
  const fd = app?.form_data || {};
  const borrowers = app?.borrowers || [];
  const products = initialProducts || [];

  const activeProduct = products[activeTab] || products[0] || null;

  // Load current user (for approve attribution)
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) setCurrentUserId(user.id);
    })();
  }, []);

  // Prefill / reset term sheet when tab or data changes
  useEffect(() => {
    if (!activeProduct) return;

    const purchase = parseFloat(fd.purchasePrice) || 0;
    const rehab = parseFloat(fd.rehabFundingAmount) || parseFloat(fd.renovationCosts) || 0;
    const arv = parseFloat(fd.anticipatedArv) || 0;
    const requested = parseFloat(fd.loanAmountRequest) || 0;

    const cfg = activeProduct.bridge_config || {};
    const initialPct = cfg.initialLoanPct ?? 0.70;
    const rehabPct = cfg.rehabFundedPct ?? 0.90;
    const arvLtv = cfg.arvLtvPct ?? 0.75;
    const ltc = cfg.ltcPct ?? 0.80;

    const suggestedInitial = Math.round(purchase * initialPct);
    const suggestedRehab = Math.round(rehab * rehabPct);
    const maxByArv = Math.round(arv * arvLtv);
    const maxByLtc = Math.round((purchase + rehab) * ltc);
    const recommended = Math.min(requested || maxByArv || 0, maxByArv, maxByLtc) || suggestedInitial + suggestedRehab;

    const prefilled = {
      // Product driven (editable)
      initialLoanPct: (initialPct * 100).toFixed(1),
      rehabFundedPct: (rehabPct * 100).toFixed(1),
      arvLtvPct: (arvLtv * 100).toFixed(1),
      ltcPct: (ltc * 100).toFixed(1),
      mortgageeClause: activeProduct.mortgagee_clause || 'Lender Name, its successors and/or assigns, ISAOA/ATIMA',

      // From application (base numbers)
      purchasePrice: purchase,
      rehabFundingAmount: rehab,
      anticipatedArv: arv,
      requestedLoanAmount: requested,

      // Computed / suggested (live editable)
      suggestedInitialAdvance: suggestedInitial,
      suggestedRehabFunded: suggestedRehab,
      maxArvBasedLoan: maxByArv,
      maxLtcBasedLoan: maxByLtc,
      approvedLoanAmount: recommended,

      // Other typical term sheet fields (editable template)
      interestRate: '9.50',
      loanTermMonths: '12',
      originationPoints: '1.5',
      prepaymentPenalty: '3-2-1',
      brokerFee: '0.5',
      otherConditions: 'Standard bridge conditions. See attached guidelines.',
    };

    setTermSheet(prefilled);
  }, [activeTab, activeProduct?.id, fd]);

  const updateTermField = (key: string, value: any) => {
    setTermSheet((prev: any) => ({ ...prev, [key]: value }));
  };

  // Simple live recalc when % change (optional enhancement)
  const recalculate = () => {
    const purchase = Number(termSheet.purchasePrice) || 0;
    const rehab = Number(termSheet.rehabFundingAmount) || 0;
    const arv = Number(termSheet.anticipatedArv) || 0;

    const i = (parseFloat(termSheet.initialLoanPct) || 70) / 100;
    const r = (parseFloat(termSheet.rehabFundedPct) || 90) / 100;
    const a = (parseFloat(termSheet.arvLtvPct) || 75) / 100;
    const l = (parseFloat(termSheet.ltcPct) || 80) / 100;

    setTermSheet((prev: any) => ({
      ...prev,
      suggestedInitialAdvance: Math.round(purchase * i),
      suggestedRehabFunded: Math.round(rehab * r),
      maxArvBasedLoan: Math.round(arv * a),
      maxLtcBasedLoan: Math.round((purchase + rehab) * l),
    }));
  };

  const handleApprove = async () => {
    if (!activeProduct || !currentUserId) {
      alert('Product or user not ready.');
      return;
    }
    setApproving(true);
    try {
      const result = await approveBridgeTermSheet(
        app.id,
        activeProduct.id,
        termSheet,
        currentUserId
      );
      setApproved(true);
      setEmailSentTo(result.recipients ? ['borrower(s) and submitter'] : []);
      console.log('[bridge-loans] Term sheet approved and email triggered', result);
    } catch (e: any) {
      console.error(e);
      alert('Failed to approve: ' + (e?.message || e));
    } finally {
      setApproving(false);
    }
  };

  const handleDecline = () => {
    // For now just local + console. Could call an update action.
    alert('Term sheet declined for this product (demo). In production this would update status and notify.');
    console.log('[bridge-loans] Term sheet declined for', activeProduct?.id);
  };

  const simulateSignatures = async () => {
    setSignaturesSimulated(true);
    // In real flow the borrower would sign via a separate link / e-sign.
    console.log('[bridge-loans] Signatures simulated as received');
  };

  const createLoanAndGoToDocs = async () => {
    if (!activeProduct || !currentUserId) return;
    setCreatingLoan(true);
    try {
      const res = await createLoanFromBridgeApplication(
        app.id,
        activeProduct.id,
        termSheet,
        currentUserId
      );
      setNewLoanId(res.loanId);
      // Navigate to the real loans page for document uploads
      router.push(`/loans/${res.loanId}`);
    } catch (e: any) {
      console.error(e);
      alert('Failed to create loan: ' + (e?.message || e));
    } finally {
      setCreatingLoan(false);
    }
  };

  // Zillow link (best effort)
  const zillowUrl = fd.subjectPropertyAddress
    ? `https://www.zillow.com/homes/${encodeURIComponent(fd.subjectPropertyAddress)}_rb/`
    : `https://www.zillow.com/`;

  return (
    <div className="max-w-6xl mx-auto p-8" style={{ color: tenantColor }}>
      {/* Navigation */}
      <div className="mb-6 flex items-center gap-4">
        <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm font-medium text-blue-600 hover:underline">
          ← Return to Dashboard
        </Link>
        <span className="text-gray-400">•</span>
        <span className="text-sm text-gray-500">Bridge / Fix &amp; Flip Review</span>
      </div>

      {/* Tenant header */}
      <div className="flex items-center gap-4 mb-6 border-b pb-4">
        {tenantLogo && <img src={tenantLogo} alt={tenantName} className="h-10 w-auto" />}
        <div>
          <div className="text-2xl font-semibold">{tenantName}</div>
          <div className="text-sm opacity-70">Bridge Loan Review &amp; Term Sheet Approval</div>
        </div>
      </div>

      <h1 className="text-3xl font-semibold mb-1">Review Application — {app.id.slice(0, 8)}</h1>
      <p className="text-gray-600 mb-6">Underwriter / processor review. Scroll the full application, then use product tabs to prepare and approve the term sheet.</p>

      {/* Zillow link */}
      <div className="mb-6">
        <a
          href={zillowUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block px-4 py-2 border border-gray-300 rounded-2xl text-sm hover:bg-gray-50"
        >
          View Property on Zillow ↗
        </a>
        <span className="ml-3 text-xs text-gray-500">{fd.subjectPropertyAddress}</span>
      </div>

      {/* Full Application Review (scrollable) */}
      <div className="mb-10 border rounded-3xl p-6 bg-white">
        <h2 className="text-xl font-semibold mb-4 border-b pb-2">Full Application Details (scroll to review)</h2>

        <div className="max-h-[420px] overflow-auto pr-2 space-y-6 text-sm">
          {/* Property & Proposal */}
          <div>
            <div className="font-semibold mb-1">I. Property &amp; Loan Proposal</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1 text-gray-700">
              <div><span className="text-gray-500">Borrower Entity:</span> {fd.borrowerEntityName}</div>
              <div><span className="text-gray-500">Subject Property:</span> {fd.subjectPropertyAddress}</div>
              <div><span className="text-gray-500">Purchase Price:</span> {fd.purchasePrice}</div>
              <div><span className="text-gray-500">Renovation / Rehab Costs:</span> {fd.renovationCosts || fd.rehabFundingAmount}</div>
              <div><span className="text-gray-500">Rehab Funding Needed:</span> {fd.rehabFundingNeeded ? `Yes — ${fd.rehabFundingAmount}` : 'No'}</div>
              <div><span className="text-gray-500">Anticipated ARV:</span> {fd.anticipatedArv}</div>
              <div><span className="text-gray-500">Loan Amount Requested:</span> {fd.loanAmountRequest}</div>
              <div><span className="text-gray-500">Loan Term:</span> {fd.loanTerm}</div>
            </div>
          </div>

          {/* Borrowers + Per-Borrower Declarations */}
          <div>
            <div className="font-semibold mb-2">II. Borrowers ({borrowers.length})</div>
            {borrowers.length === 0 && <div className="text-gray-500">No borrower details captured.</div>}
            {borrowers.map((b: any, idx: number) => (
              <div key={idx} className="mb-4 p-3 border rounded bg-gray-50">
                <div className="font-medium">{b.fullLegalName} (Borrower {idx + 1})</div>
                <div className="text-xs grid grid-cols-2 md:grid-cols-4 gap-x-3 mt-1">
                  <div>Credit: {b.creditScoreRange}</div>
                  <div>DOB: {b.dob}</div>
                  <div>Cell: {b.cellPhone}</div>
                  <div>Email: {b.email}</div>
                  <div className="col-span-2">Employer: {b.employer}</div>
                </div>

                <div className="mt-2 text-xs">
                  <div className="font-medium">Declarations:</div>
                  <ul className="list-disc pl-5">
                    {b.declarations && Object.entries(b.declarations).map(([k, v]) => (
                      <li key={k}>{k}: <span className={v ? 'text-green-600' : 'text-red-600'}>{v ? 'Yes' : 'No'}</span></li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>

          {/* REO */}
          <div>
            <div className="font-semibold mb-1">IV. Real Estate Owned</div>
            {(fd.reoProperties || []).filter((p: any) => p.address).map((p: any, i: number) => (
              <div key={i} className="text-xs mb-1">• {p.address} — Value: {p.marketValue} — Owed: {p.mortgageOwed}</div>
            ))}
            {(!fd.reoProperties || fd.reoProperties.every((p: any) => !p.address)) && <span className="text-gray-500 text-xs">None listed</span>}
          </div>

          {/* Other notes */}
          {fd.complexFundingExplanation && (
            <div>
              <div className="font-semibold">Complex / Creative Funding Note</div>
              <p className="text-xs whitespace-pre-wrap bg-gray-50 p-2 rounded">{fd.complexFundingExplanation}</p>
            </div>
          )}
        </div>
      </div>

      {/* Product Tabs + Editable Term Sheet */}
      <div className="mb-8">
        <h2 className="text-xl font-semibold mb-3">Available Loan Products &amp; Term Sheet</h2>

        {products.length === 0 && (
          <p className="text-amber-600">No bridge-configured products found for this organization. Using demo products.</p>
        )}

        <div className="flex border-b mb-4 overflow-x-auto">
          {products.map((p, i) => (
            <button
              key={i}
              onClick={() => setActiveTab(i)}
              className={`px-5 py-2 text-sm font-medium whitespace-nowrap border-b-2 ${i === activeTab ? 'border-black text-black' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            >
              {p.name || `Product ${i + 1}`}
            </button>
          ))}
        </div>

        {activeProduct && (
          <div className="border rounded-3xl p-6 bg-white">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-semibold text-lg">Term Sheet — {activeProduct.name}</h3>
              <div className="text-xs text-gray-500">Prefilled from application + product bridge_config. Edit as needed.</div>
            </div>

            {/* Key % controls (the 4 from history) */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              {[
                ['initialLoanPct', 'Initial Loan %'],
                ['rehabFundedPct', '% of Rehab Funded'],
                ['arvLtvPct', 'ARV LTV %'],
                ['ltcPct', 'Loan to Cost %'],
              ].map(([key, label]) => (
                <div key={key}>
                  <label className="block text-xs text-gray-500 mb-1">{label}</label>
                  <input
                    type="text"
                    value={termSheet[key] || ''}
                    onChange={(e) => { updateTermField(key, e.target.value); setTimeout(recalculate, 50); }}
                    className="w-full border rounded-xl px-3 py-2 text-sm"
                  />
                </div>
              ))}
            </div>

            {/* Mortgagee + computed + other editable fields */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6 text-sm">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Mortgagee Clause (from product)</label>
                <input
                  type="text"
                  value={termSheet.mortgageeClause || ''}
                  onChange={(e) => updateTermField('mortgageeClause', e.target.value)}
                  className="w-full border rounded-xl px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Approved / Recommended Loan Amount</label>
                <input
                  type="text"
                  value={termSheet.approvedLoanAmount || ''}
                  onChange={(e) => updateTermField('approvedLoanAmount', e.target.value)}
                  className="w-full border rounded-xl px-3 py-2 font-semibold"
                />
              </div>

              <div className="text-xs text-gray-600 space-y-1">
                <div>Suggested Initial Advance: ${termSheet.suggestedInitialAdvance || 0}</div>
                <div>Suggested Rehab Funded: ${termSheet.suggestedRehabFunded || 0}</div>
                <div>Max by ARV LTV: ${termSheet.maxArvBasedLoan || 0}</div>
                <div>Max by LTC: ${termSheet.maxLtcBasedLoan || 0}</div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Interest Rate %</label>
                  <input type="text" value={termSheet.interestRate || ''} onChange={e => updateTermField('interestRate', e.target.value)} className="w-full border rounded-xl px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Term (months)</label>
                  <input type="text" value={termSheet.loanTermMonths || ''} onChange={e => updateTermField('loanTermMonths', e.target.value)} className="w-full border rounded-xl px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Origination Points</label>
                  <input type="text" value={termSheet.originationPoints || ''} onChange={e => updateTermField('originationPoints', e.target.value)} className="w-full border rounded-xl px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Other Conditions</label>
                  <input type="text" value={termSheet.otherConditions || ''} onChange={e => updateTermField('otherConditions', e.target.value)} className="w-full border rounded-xl px-3 py-2 text-sm" />
                </div>
              </div>
            </div>

            {/* Approve / Decline */}
            {!approved ? (
              <div className="flex gap-3">
                <button
                  onClick={handleApprove}
                  disabled={approving || !currentUserId}
                  className="px-8 py-3 bg-black text-white rounded-3xl disabled:opacity-50"
                >
                  {approving ? 'Approving & Sending...' : 'Approve Term Sheet'}
                </button>
                <button onClick={handleDecline} className="px-8 py-3 border rounded-3xl">Decline Term Sheet</button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="text-green-600 font-medium">✓ Term sheet approved for {activeProduct.name}. Email sent to: {emailSentTo.join(', ') || 'borrower & broker'}.</div>

                {!signaturesSimulated ? (
                  <button onClick={simulateSignatures} className="px-6 py-2 border rounded-2xl text-sm">Simulate Borrower + Broker Signatures Received</button>
                ) : !newLoanId ? (
                  <button
                    onClick={createLoanAndGoToDocs}
                    disabled={creatingLoan}
                    className="px-8 py-3 bg-emerald-600 text-white rounded-3xl"
                  >
                    {creatingLoan ? 'Creating Loan Record...' : 'Create Loan Record & Go to Document Uploads →'}
                  </button>
                ) : (
                  <div className="text-emerald-600">Loan created. Redirecting to document upload page...</div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <p className="text-xs text-gray-500">After borrower signs the term sheet + application, the loan moves to the standard /loans/[id] flow for conditions, documents, and closing.</p>
    </div>
  );
}

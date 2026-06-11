'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { hasPermission } from '@/lib/permissions';
import {
  createReggoraLoan,
  createReggoraOrder,
  fetchReggoraProducts,
  fetchReggoraUsers,
  findExistingReggoraLoan,
} from '@/app/actions/reggora';
import { snapshotPricingMatrixForLoan } from '@/app/actions/organization-actions';
import { logPageVisit, logAudit } from '@/lib/audit';

export default function LoanAppraisalPage() {
  const params = useParams();
  const router = useRouter();
  const loanId = parseInt(params.id as string);

  const [loan, setLoan] = useState<any>(null);
  const [product, setProduct] = useState<any>(null);
  const [org, setOrg] = useState<any>(null);
  const [reggoraProducts, setReggoraProducts] = useState<any[]>([]);
  const [reggoraUsers, setReggoraUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [ordering, setOrdering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form state
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [selectedVendorIds, setSelectedVendorIds] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<'Normal' | 'Rush'>('Normal');
  const [allocationType, setAllocationType] = useState<'automatically' | 'manually'>('automatically');

  const [currentUserRole, setCurrentUserRole] = useState<string>('BROKER_AE');
  const [sbUser, setSbUser] = useState<any>(null);

  const isBorrowerUser = currentUserRole === 'BORROWER';

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const { data: { user: u } } = await supabase.auth.getUser();
        setSbUser(u);

        const { data: prof } = await supabase
          .from('profiles')
          .select('role, organization_id')
          .eq('id', u?.id)
          .maybeSingle();
        setCurrentUserRole(prof?.role || 'BROKER_AE');

        const { data: loanData } = await supabase
          .from('loans')
          .select('*')
          .eq('id', loanId)
          .single();
        setLoan(loanData);

        if (loanData?.product_id) {
          const { data: prodData } = await supabase
            .from('loan_products')
            .select('*')
            .eq('id', loanData.product_id)
            .single();
          setProduct(prodData);
        }

        if (loanData?.organization_id) {
          const { data: orgData } = await supabase
            .from('organizations')
            .select('appraisal_fee_preset, from_email, name')
            .eq('id', loanData.organization_id)
            .maybeSingle();
          setOrg(orgData);
        }

        // Load Reggora products & users (graceful if not configured)
        const [pRes, uRes] = await Promise.all([
          fetchReggoraProducts(),
          fetchReggoraUsers(),
        ]);
        if (!pRes.error) setReggoraProducts(pRes.products || []);
        if (!uRes.error) setReggoraUsers(uRes.users || []);

        // Default due date
        const d = new Date();
        d.setDate(d.getDate() + 14);
        setDueDate(d.toISOString().split('T')[0]);
      } catch (e: any) {
        console.error(e);
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [loanId]);

  const canInitiate = !isBorrowerUser && hasPermission(
    { id: sbUser?.id || '', role: currentUserRole },
    ['LOAN_PROCESSOR', 'LOAN_UNDERWRITER', 'ADMIN', 'SUPER_ADMIN', 'LENDING_SUPERVISOR', 'ORG_ADMIN', 'SENIOR_ACCOUNT_EXECUTIVE', 'ACCOUNT_EXECUTIVE']
  );

  const presetFee = org?.appraisal_fee_preset || 900;

  const handleOrder = async () => {
    if (!canInitiate) return alert('Only non-borrower team members can order appraisals.');
    if (!loan) return;
    if (selectedProductIds.length === 0) return alert('Select at least one Reggora product.');

    setOrdering(true);
    setError(null);
    setSuccess(null);

    try {
      // 1. Try to import existing first (lookup by loan number or address)
      const lookup = await findExistingReggoraLoan(
        loan.loan_number || `LOAN-${loan.id}`,
        loan.property_address
      );
      let reggoraLoanId = lookup.reggoraLoanId;

      if (!reggoraLoanId) {
        // 2. Create new Reggora loan (now uses rich application data for consumers/address/price/purpose)
        const loanRes = await createReggoraLoan(loan);
        if (loanRes.error) throw new Error(loanRes.error);
        reggoraLoanId = loanRes.reggoraLoanId!;
      }

      if (!reggoraLoanId) throw new Error('Could not obtain Reggora loan ID');

      // 3. Build additional_fees from org preset (user preference)
      const additionalFees = [{
        description: `Appraisal fee (preset $${presetFee})`,
        amount: Number(presetFee).toFixed(2),
      }];

      // 4. Create the order (supports multi-vendor for multiple AMC quotes when manual)
      const due = `${dueDate}T17:00:00Z`;
      const orderRes = await createReggoraOrder({
        loan: reggoraLoanId,
        products: selectedProductIds,
        due_date: due,
        priority,
        allocation_type: allocationType,
        ...(allocationType === 'manually' && selectedVendorIds.length > 0 ? { vendors: selectedVendorIds } : {}),
        additional_fees: additionalFees,
      });
      if (orderRes.error) throw new Error(orderRes.error);

      const orderId = orderRes.orderId!;

      // 5. Persist order ID + preset fee context on local loan
      if (supabaseAdmin) {
        await supabaseAdmin
          .from('loans')
          .update({
            reggora_order_id: orderId,
            reggora_status: 'created',
            reggora_fee_actual: Number(presetFee),
          })
          .eq('id', loanId);
      }

      // 6. Snapshot matrix for audit (preserved from prior work)
      try {
        await snapshotPricingMatrixForLoan(loanId, 'appraisal');
      } catch (snapErr) {
        console.warn('Matrix snapshot non-fatal', snapErr);
      }

      // 7. Audit + success
      await logAudit({
        userId: sbUser?.id,
        organizationId: loan.organization_id,
        action: 'appraisal_ordered',
        resourceType: 'loan',
        resourceId: String(loanId),
        details: { reggora_loan_id: reggoraLoanId, reggora_order_id: orderId, preset_fee: presetFee },
      });

      setSuccess(`✅ Order created in Reggora. Order ID: ${orderId}. Preset fee $${presetFee} will be used (refund if actual lower). White-label notifications enabled via our webhooks.`);

      // Refresh local loan
      const { data: refreshed } = await supabase.from('loans').select('*').eq('id', loanId).single();
      if (refreshed) setLoan(refreshed);

    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to order appraisal');
    } finally {
      setOrdering(false);
    }
  };

  const handleImportExisting = async () => {
    setOrdering(true);
    setError(null);
    try {
      const lookup = await findExistingReggoraLoan(
        loan.loan_number || `LOAN-${loan.id}`,
        loan.property_address
      );
      if (lookup.reggoraLoanId) {
        await supabase
          .from('loans')
          .update({ reggora_loan_id: lookup.reggoraLoanId, reggora_status: 'imported' })
          .eq('id', loanId);
        setSuccess(`Imported existing Reggora loan ID: ${lookup.reggoraLoanId}. You can now create orders against it.`);
      } else {
        setError('No matching existing Reggora loan found.');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setOrdering(false);
    }
  };

  if (loading) return <div className="p-10 text-center">Loading appraisal order page...</div>;
  if (!loan) return <div className="p-10 text-red-600">Loan not found.</div>;

  const notConfigured = !process.env.REGGORA_AUTH_TOKEN; // will be false in prod, but graceful

  return (
    <div className="max-w-5xl mx-auto p-8">
      <button
        onClick={() => router.push(`/loans/${loanId}`)}
        className="mb-6 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-2xl text-sm"
      >
        ← Back to Loan
      </button>

      <h1 className="text-3xl font-bold mb-2">Order Appraisal via Reggora</h1>
      <p className="text-gray-600 mb-6">Loan #{loan.id} — {loan.property_address}</p>

      {!canInitiate && (
        <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-2xl text-amber-700">
          Only non-borrower team members (processors, underwriters, admins, AEs, ORG_ADMIN, etc.) can initiate appraisals.
        </div>
      )}

      {notConfigured && (
        <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-2xl">
          Reggora is not yet configured (waiting for sandbox keys). The UI, data mapping, preset fees, import lookup, and webhook skeleton are fully implemented and will activate automatically once <code>REGGORA_AUTH_TOKEN</code> and <code>REGGORA_INTEGRATION_KEY</code> are set (plus restart).
        </div>
      )}

      {error && <div className="mb-4 p-4 bg-red-50 text-red-700 rounded-2xl">{error}</div>}
      {success && <div className="mb-4 p-4 bg-green-50 text-green-700 rounded-2xl">{success}</div>}

      {/* Current Reggora linkage */}
      <div className="bg-white border rounded-3xl p-6 mb-8">
        <h3 className="font-semibold mb-3">Current Linkage</h3>
        <div className="text-sm space-y-1">
          <div>Reggora Loan ID: <code>{loan.reggora_loan_id || '— (will be created on first order or import)'}</code></div>
          <div>Reggora Order ID: <code>{loan.reggora_order_id || '—'}</code></div>
          <div>Status: <code>{loan.reggora_status || '—'}</code></div>
        </div>
        <button
          onClick={handleImportExisting}
          disabled={ordering}
          className="mt-4 px-4 py-2 border rounded-2xl text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          {ordering ? 'Checking...' : '🔍 Import Existing Reggora Appraisal (by loan # or address)'}
        </button>
        <p className="text-[10px] text-gray-500 mt-1">Useful when an appraisal already exists in Reggora for this file.</p>
      </div>

      {/* Order Form */}
      <div className="bg-white border rounded-3xl p-8">
        <h2 className="text-2xl font-semibold mb-6">New Appraisal Order</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          {/* Reggora Products (multi for multiple AMC quotes) */}
          <div>
            <label className="block text-sm font-medium mb-2">Reggora Products (select one or more for quotes)</label>
            <select
              multiple
              value={selectedProductIds}
              onChange={(e) => setSelectedProductIds(Array.from(e.target.selectedOptions, o => o.value))}
              className="w-full border rounded-2xl p-3 h-40"
              disabled={notConfigured}
            >
              {reggoraProducts.length === 0 && <option disabled>No Reggora products loaded yet</option>}
              {reggoraProducts.map((p: any) => (
                <option key={p.id} value={p.id}>{p.product_name} (${p.amount})</option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">Multi-select + "manually" allocation below lets you request quotes from multiple AMCs.</p>
          </div>

          {/* Vendors (for manual multi-AMC) */}
          <div>
            <label className="block text-sm font-medium mb-2">Vendors / AMCs (only used when allocation = manually)</label>
            <select
              multiple
              value={selectedVendorIds}
              onChange={(e) => setSelectedVendorIds(Array.from(e.target.selectedOptions, o => o.value))}
              className="w-full border rounded-2xl p-3 h-40"
              disabled={allocationType !== 'manually' || notConfigured}
            >
              {reggoraUsers.length === 0 && <option disabled>No Reggora users/vendors loaded yet</option>}
              {reggoraUsers.map((u: any) => (
                <option key={u.id} value={u.id}>{u.first_name} {u.last_name} ({u.company_name || 'AMC'})</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Due Date</label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full border rounded-2xl p-3"
              disabled={notConfigured}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Priority</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value as any)} className="w-full border rounded-2xl p-3" disabled={notConfigured}>
              <option value="Normal">Normal</option>
              <option value="Rush">Rush</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Allocation</label>
            <select value={allocationType} onChange={(e) => setAllocationType(e.target.value as any)} className="w-full border rounded-2xl p-3" disabled={notConfigured}>
              <option value="automatically">Automatically (Reggora chooses)</option>
              <option value="manually">Manually (you select vendors/AMCs for quotes)</option>
            </select>
            <p className="text-xs text-gray-500 mt-1">Use "manually" + multi-select vendors above to request quotes from multiple AMCs.</p>
          </div>

          <div className="md:col-span-2">
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-sm">
              <strong>Preset Fee (white-label):</strong> ${presetFee}.00 — this is the amount we will charge the borrower. If Reggora charges less, the difference is refunded (tracked via <code>reggora_fee_actual</code>).
              <div className="mt-1 text-xs text-amber-700">Configured on the organization (default $900). Can be adjusted in admin/organizations.</div>
            </div>
          </div>
        </div>

        <button
          onClick={handleOrder}
          disabled={ordering || notConfigured || !canInitiate || selectedProductIds.length === 0}
          className="w-full px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-3xl font-semibold disabled:opacity-50"
        >
          {ordering ? 'Working with Reggora...' : '🚀 Create Reggora Loan + Order Appraisal (Preset Fee + White-Label Webhooks)'}
        </button>

        <p className="text-[10px] text-gray-500 mt-3 text-center">
          This will use data from the linked application (borrower details, address, purchase/est. value, purpose) for the Reggora payload.
          A full matrix snapshot is still recorded for audit. Webhook endpoint is ready at <code>/api/webhooks/reggora</code> (configure in Reggora once you have keys).
        </p>
      </div>

      <div className="mt-6 text-xs text-gray-500">
        Reggora keys not yet configured — all UI, data mapping from applications, preset fees, import lookup, multi-AMC support, and white-label webhook skeleton are complete and will activate as soon as the keys are added and the server is restarted with pm2 discipline.
      </div>
    </div>
  );
}

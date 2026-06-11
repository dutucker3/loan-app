'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Resend } from 'resend'; // Note: in real, call via API route for server key; here for illustration we use client-side note

const resend = new Resend(process.env.NEXT_PUBLIC_RESEND_API_KEY || ''); // Prefer server action in prod

export default function AdminBillingPage() {
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState('');
  const [events, setEvents] = useState<any[]>([]);
  const [aggregates, setAggregates] = useState<any[]>([]);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    async function load() {
      const { data: { user: sbUser } } = await supabase.auth.getUser();
      if (!sbUser) return;

      const { data: prof } = await supabase.from('profiles').select('role').eq('id', sbUser.id).maybeSingle();
      const role = prof?.role || '';
      setUserRole(role);

      if (!['SUPER_ADMIN', 'ADMIN'].includes(role)) {
        alert('Billing tab is for root-level admins only.');
        window.location.href = '/admin';
        return;
      }

      // Load unbilled + recent closed loan events
      const { data: evts } = await supabase
        .from('loan_billing_events')
        .select('*')
        .order('closed_at', { ascending: false })
        .limit(200);

      setEvents(evts || []);

      // Aggregate unbilled per tenant
      const unbilled = (evts || []).filter((e: any) => !e.billed);
      const byTenant: Record<string, { count: number; totalAmount: number; orgId: string }> = {};
      unbilled.forEach((e: any) => {
        const key = e.tenant_name || e.organization_id;
        if (!byTenant[key]) byTenant[key] = { count: 0, totalAmount: 0, orgId: e.organization_id };
        byTenant[key].count += 1;
        byTenant[key].totalAmount += Number(e.loan_amount || 0);
      });
      setAggregates(Object.entries(byTenant).map(([name, data]) => ({ name, ...data })));

      setLoading(false);
    }
    load();
  }, []);

  const runBillingCycle = async () => {
    if (!confirm('Run billing for unbilled closed loans? This will mark them billed and attempt to send invoices + simulate ACH.')) return;
    setRunning(true);

    try {
      const unbilled = events.filter((e: any) => !e.billed);

      // Group by tenant
      const groups: Record<string, any[]> = {};
      unbilled.forEach(e => {
        const k = e.tenant_name || e.organization_id;
        if (!groups[k]) groups[k] = [];
        groups[k].push(e);
      });

      for (const [tenantName, items] of Object.entries(groups)) {
        const count = items.length;
        const total = items.reduce((sum, i) => sum + Number(i.loan_amount || 0), 0);
        const orgId = items[0]?.organization_id;

        // 1. Mark as billed (in a real run we would set bill_run_date)
        await supabase
          .from('loan_billing_events')
          .update({ billed: true, bill_run_date: new Date().toISOString().split('T')[0] })
          .in('id', items.map(i => i.id));

        // 2. Simulate ACH initiation (in real: call Stripe/Plaid ACH or your processor API)
        console.log(`[BILLING] ACH request initiated for tenant ${tenantName} (${orgId}) — ${count} loans, $${total.toFixed(2)}`);
        alert(`ACH initiated for ${tenantName}: ${count} loans / $${total.toFixed(2)} (mock - integrate real ACH provider here)`);

        // 3. Send bill/invoice email to tenant AP (use org support_email or from_email as AP contact)
        const { data: org } = await supabase.from('organizations').select('name, support_email, from_email, raw_attrs').eq('id', orgId).maybeSingle();
        const apEmail = (org?.raw_attrs as any)?.ap_email || org?.support_email || org?.from_email || 'ap@example.com';

        if (apEmail) {
          // In production move to a server action/API route with service role
          await fetch('/api/email/send-quote', { method: 'POST', body: JSON.stringify({ /* reuse pattern or new */ }) }); // placeholder

          // Simple direct Resend call (demo only)
          try {
            await resend.emails.send({
              from: 'Billing <billing@yourplatform.com>',
              to: apEmail,
              subject: `Invoice - ${count} Closed Loans - ${tenantName}`,
              html: `
                <h2>Billing Invoice for ${tenantName}</h2>
                <p>Period: Recent closed loans</p>
                <p>Number of closed loans: <strong>${count}</strong></p>
                <p>Total volume: <strong>$${total.toFixed(2)}</strong></p>
                <p>ACH payment request has been initiated for the 1st/15th cycle.</p>
                <p>Loans: ${items.map(i => `#${i.loan_id} ($${i.loan_amount || 0})`).join(', ')}</p>
                <p>Please ensure funds are available. Contact support for questions.</p>
              `
            });
          } catch (emailErr) {
            console.warn('Bill email failed (demo)', emailErr);
          }
        }
      }

      alert('Billing cycle complete. Events marked billed. ACH simulated. Invoices sent (where AP email available).');
      window.location.reload();
    } catch (err: any) {
      alert('Billing run error: ' + err.message);
    } finally {
      setRunning(false);
    }
  };

  if (loading) return <div className="p-10">Loading billing data...</div>;

  if (!['SUPER_ADMIN', 'ADMIN'].includes(userRole)) {
    return <div className="p-10 text-red-600">Access restricted to root administrators.</div>;
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold">Billing (Root Admin)</h1>
          <p className="text-gray-500">Closed loan tracking • 1st &amp; 15th ACH cycles • Invoice emails</p>
        </div>
        <button
          onClick={runBillingCycle}
          disabled={running}
          className="px-8 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-3xl font-semibold"
        >
          {running ? 'Running Billing Cycle...' : '▶ Run Billing Cycle (1st/15th)'}
        </button>
      </div>

      <div className="bg-white border rounded-3xl p-6 mb-8">
        <h2 className="font-semibold mb-4">Unbilled Closed Loans by Tenant (ready for billing)</h2>
        {aggregates.length === 0 && <p className="text-gray-500">No unbilled closed loans.</p>}
        {aggregates.map((agg, idx) => (
          <div key={idx} className="p-4 border rounded-2xl mb-3 flex justify-between items-center">
            <div>
              <div className="font-medium">{agg.name}</div>
              <div className="text-sm text-gray-500">Org: {agg.orgId}</div>
            </div>
            <div className="text-right">
              <div className="font-semibold">{agg.count} loans</div>
              <div className="text-sm">${agg.totalAmount.toFixed(2)}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white border rounded-3xl p-6">
        <h2 className="font-semibold mb-4">Recent Loan Billing Events</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="text-left py-2">Loan</th>
              <th className="text-left">Tenant</th>
              <th className="text-left">Closed</th>
              <th className="text-right">Amount</th>
              <th className="text-center">Billed</th>
            </tr>
          </thead>
          <tbody>
            {events.slice(0, 50).map((ev: any) => (
              <tr key={ev.id} className="border-b">
                <td className="py-2">#{ev.loan_id}</td>
                <td>{ev.tenant_name || ev.organization_id}</td>
                <td>{new Date(ev.closed_at).toLocaleDateString()}</td>
                <td className="text-right">${Number(ev.loan_amount || 0).toFixed(2)}</td>
                <td className="text-center">{ev.billed ? '✅' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-gray-500 mt-4">
          Events are created automatically when a loan status is changed to "Closed and Funded" in the dashboard.
          Use "Run Billing Cycle" above to process 1st/15th batches, simulate ACH, and email invoices to tenant AP contacts.
        </p>
      </div>

      <div className="mt-8 text-xs text-gray-400">
        ACH integration note: Replace the console.log + alert in runBillingCycle with your ACH provider SDK (Stripe Treasury, Plaid + bank transfer, or dedicated ACH processor). 
        Invoices are sent via Resend to the tenant's support_email / raw_attrs.ap_email.
      </div>
    </div>
  );
}

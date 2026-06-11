'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useTenant } from '@/lib/tenant-context';   // ← Important: keep this
// TenantHeader removed — global AppHeader from root layout provides consistent nav + logout/profile on all app pages.
import { globalRebaseBaseRates, fetchTreasuryRate, bulkFredBaseRateUpdate } from '@/app/actions/organization-actions';
import { filterVisibleProductsForUser, hasPermission, isOrgAdmin, canManageOrg, canBulkUpdateBaseRates } from '@/lib/permissions'; // updated: org parent_organization_id hierarchy. L2 sees only parent's products + own; L2 own products never visible upward to parents. Bulk FRED only for ORG_ADMIN + L1 level (per task).
import { logPageVisit } from '@/lib/audit';

export default function ProductsPage() {
  const router = useRouter();
  const tenant = useTenant();   // ← This matches your white-label setup

  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserOrgId, setCurrentUserOrgId] = useState<string | null>(null);

  // User context (for role + org in visibility; parent now resolved via org parent_organization_id)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState<string>('BROKER_AE');

  // Bulk retail markup UI (standard retailMarkup field; was previously retail_borrower_margin)
  const [marginValue, setMarginValue] = useState<number>(0);
  const [selectedForMargin, setSelectedForMargin] = useState<string[]>([]);

  // Permission for bulk base rate FRED page (ORG_ADMIN + level1 / L1 scoped per task + preserve existing per-product)
  const currentUserForPerms = { id: currentUserId || '', role: currentUserRole as any, organization_id: currentUserOrgId };
  const canBulkRates = !!currentUserOrgId && canBulkUpdateBaseRates(currentUserForPerms, currentUserOrgId); // uses new helper (ORG_ADMIN + L1) added to permissions.ts

  useEffect(() => {
    async function loadUserOrg() {
      const { data: { user: u } } = await supabase.auth.getUser();
      if (u) {
        setCurrentUserId(u.id);
        try {
          // Prefer profiles for org/role, but parent_id lives on users table
          let orgId: string | null = null;
          let role = 'BROKER_AE';
          const { data: prof } = await supabase.from('profiles').select('organization_id, role').eq('id', u.id).maybeSingle();
          if (prof) {
            orgId = prof.organization_id || null;
            role = prof.role || 'BROKER_AE';
          }
          // Fallback
          const { data: urow } = await supabase.from('profiles').select('organization_id, role').eq('id', u.id).maybeSingle();
          if (urow) {
            if (!orgId) orgId = urow.organization_id || null;
            if (urow.role) role = urow.role;
          }
          if (orgId) setCurrentUserOrgId(orgId);
          setCurrentUserRole(role);
        } catch {}
      }
    }
    loadUserOrg();
  }, []);

  // Light page visit logging for critical /admin/products list page.
  useEffect(() => {
    if (currentUserOrgId) {
      logPageVisit('/admin/products', null, currentUserOrgId).catch(() => {});
    }
  }, [currentUserOrgId]);

  useEffect(() => {
    const orgId = tenant?.id || currentUserOrgId;
    if (orgId) {
      fetchProducts(orgId);
    } else {
      // No org context yet; could redirect to /select-org or dashboard in future
      setLoading(false);
    }
  }, [tenant?.id, currentUserOrgId, currentUserId, currentUserRole]);

  async function fetchProducts(orgId?: string) {
    const effectiveOrgId = orgId || tenant?.id || currentUserOrgId;
    if (!effectiveOrgId) {
      setLoading(false);
      return;
    }

    // Org-hierarchy visibility (updated model using parent_organization_id on organizations):
    // Load own + parent's (for L2), filter with new helper so child's products stay hidden from parents.
    let queryOrgs = [effectiveOrgId];
    const parentMap: Record<string, string | null> = {};
    try {
      const { data: myOrg } = await supabase.from('organizations').select('parent_organization_id, name').eq('id', effectiveOrgId).maybeSingle();
      if (myOrg?.parent_organization_id) queryOrgs.push(myOrg.parent_organization_id);
      const { data: orgRows } = await supabase.from('organizations').select('id, parent_organization_id').in('id', queryOrgs);
      (orgRows || []).forEach((o: any) => { parentMap[o.id] = o.parent_organization_id ?? null; });
      // Never include root in product queries for normal users (root hidden)
      if (myOrg?.name === 'Loan-App Platform') queryOrgs = [];
    } catch {}

    const { data, error } = await supabase
      .from('loan_products')
      .select('*')
      .in('organization_id', queryOrgs.length ? queryOrgs : ['__none__'])
      .order('created_at', { ascending: false });

    if (error) console.error("Fetch products error:", error);

    const visible = filterVisibleProductsForUser(
      { id: currentUserId || '', role: currentUserRole, organization_id: effectiveOrgId },
      data || [],
      (oid: string) => parentMap[oid] ?? null
    );
    setProducts(visible);
    setLoading(false);
  }

  const createProduct = async () => {
    // Use the dedicated new product page which has proper inputs for mortgagee_clause + insurance_requirements
    // and automatically seeds the two required provider condition types (Title + Insurance).
    router.push('/admin/products/new');
  };

  // Bulk update for retail markup (standard field). Changed from dedicated retail_borrower_margin per requirements.
  const applyMarginBulk = async (ids: string[]) => {
    if (!ids.length) return;
    const val = Number(marginValue) || 0;
    if (!confirm(`Apply retail markup of ${val} to ${ids.length} product(s)?\n\n- Uses product.pricing_matrix.markup.retailMarkup (standard retail markup field).\n- For Level 2 using own products this is applied in pricing calculations.\n- Confirmation required.`)) return;

    // Update each (to safely merge into existing pricing_matrix.markup)
    for (const id of ids) {
      const { data: p } = await supabase.from('loan_products').select('pricing_matrix').eq('id', id).single();
      const newPm = {
        ...(p?.pricing_matrix || {}),
        markup: {
          ...(p?.pricing_matrix?.markup || {}),
          retailMarkup: val,
        },
      };
      await supabase.from('loan_products').update({ pricing_matrix: newPm }).eq('id', id);
    }

    alert(`✅ Retail markup ${val} applied to ${ids.length} products (via pricing_matrix.markup.retailMarkup).`);
    const eff = tenant?.id || currentUserOrgId;
    if (eff) fetchProducts(eff);
    setSelectedForMargin([]);
  };

  const toggleSelectForMargin = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setSelectedForMargin(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  if (loading) return <div className="p-10 text-center text-xl">Loading products...</div>;

  return (
    <div className="max-w-6xl mx-auto p-8">
      {/* Global AppHeader from root layout */}

      {/* Row 1: Back to Admin */}
      <div className="mb-2">
        <button
          onClick={() => router.push('/admin')}
          className="px-6 py-3 bg-gray-200 rounded-3xl font-semibold hover:bg-gray-300"
        >
          ← Back to Admin
        </button>
      </div>

      {/* Title */}
      <h1 className="text-3xl font-bold mb-4">Loan Products</h1>

      {/* Row 2: Create New Product + Manage Standard Keys */}
      <div className="flex flex-wrap gap-4 mb-3">
        <button
          onClick={createProduct}
          className="px-8 py-4 bg-blue-600 text-white rounded-3xl font-semibold hover:bg-blue-700"
        >
          + Create New Product
        </button>
        <button
          onClick={() => router.push('/admin/products/new?type=bridge')}
          className="px-8 py-4 bg-indigo-600 text-white rounded-3xl font-semibold hover:bg-indigo-700"
        >
          + Create Bridge / Fix &amp; Flip Product
        </button>
        <button
          onClick={() => router.push('/admin/products/keys')}
          className="px-6 py-3 bg-amber-600 text-white rounded-2xl hover:bg-amber-700"
        >
          🔑 Manage Standard Keys
        </button>
      </div>

      {/* Row 3: FRED / Benchmark rate update buttons */}
      <div className="flex flex-wrap gap-4 mb-6">
        <button
          onClick={async () => {
            const effectiveOrgId = tenant?.id || currentUserOrgId;
            if (!effectiveOrgId) return;
            if (!confirm('Globally rebase base rates for ALL products using the org benchmark? This will shift rate keys by the delta in treasury yield.')) return;
            const res = await globalRebaseBaseRates(effectiveOrgId);
            if (res.error) alert('Error: ' + res.error);
            else {
              const deltas = res.results?.map((r: any) => `${r.productId}: ${r.delta?.toFixed(3) || '0'}`).join(', ') || '';
              alert('Global rebase complete. Deltas: ' + deltas);
            }
          }}
          className="px-6 py-3 bg-emerald-600 text-white rounded-2xl hover:bg-emerald-700"
        >
          🔄 Global Update Base Rates (using Org Benchmark)
        </button>

        {/* New dedicated bulk FRED + blended + margin + subset page. Linked as "Update All Products Rates". Gated to ORG_ADMIN + L1 per task. Existing per-product rebase in /admin/products/[id] preserved. */}
        {canBulkRates && (
          <button
            onClick={() => router.push('/admin/products/update-all')}
            className="px-6 py-3 bg-violet-600 text-white rounded-2xl hover:bg-violet-700"
            title="FRED API, frequency, margin, blended 2/5/10/30 or weighted, subset confirmation with before/after, updates org master + products pricing_matrix.baseRates (snapshots anchor)"
          >
            📈 Update All Products Rates (FRED + Blended)
          </button>
        )}
      </div>

      {/* === RETAIL BORROWER MARGIN BULK UI (products/page.tsx per task) ===
          Input + "Apply to all" OR multi-select specific products + confirmation + bulk update.
          Used by Level 2 BROKER_AE to set on their own hidden products or on inherited parent products.
          Parent (L1) sees margin read-only on inherited products (enforced in /admin/products/[id] + list label).
          Subtract applied in loans/new for L2 + own product. */}
      <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-2xl">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-sm font-medium mb-1 text-amber-800">Retail Markup (points, e.g. 0.25) — applied via pricing_matrix.markup.retailMarkup</label>
            <input
              type="number"
              step="0.01"
              value={marginValue}
              onChange={(e) => setMarginValue(parseFloat(e.target.value) || 0)}
              className="w-32 px-3 py-2 border rounded-xl text-sm"
              placeholder="0"
            />
          </div>
          <button
            onClick={() => applyMarginBulk(products.map((p: any) => p.id))}
            className="px-5 py-2 bg-amber-600 text-white rounded-2xl text-sm hover:bg-amber-700"
          >
            Apply to ALL visible ({products.length})
          </button>
          <button
            onClick={() => applyMarginBulk(selectedForMargin)}
            disabled={selectedForMargin.length === 0}
            className="px-5 py-2 bg-amber-700 text-white rounded-2xl text-sm hover:bg-amber-800 disabled:opacity-50"
          >
            Apply to SELECTED ({selectedForMargin.length})
          </button>
          <button
            onClick={() => setSelectedForMargin([])}
            className="px-4 py-2 text-sm border rounded-2xl hover:bg-white"
          >
            Clear selection
          </button>
          <p className="text-xs text-amber-700 ml-auto max-w-[420px]">
            Level 2: sets on inherited (parent/org) or your private products. Your own products hidden from parent. Margin subtracted in pricing when L2 uses own product.
          </p>
        </div>
      </div>

      <div className="bg-white rounded-3xl border">
        {products.length === 0 ? (
          <div className="p-20 text-center text-gray-500">
            No products yet. Click "Create New Product" to get started.
          </div>
        ) : (
          products.map((product: any) => (
            <div
              key={product.id}
              onClick={() => {
                const isBridge = !!product.bridge_config || (product.name || '').toLowerCase().includes('bridge') || (product.name || '').toLowerCase().includes('fix');
                router.push(isBridge ? `/admin/products/bridge/${product.id}` : `/admin/products/${product.id}`);
              }}
              className="p-8 border-b hover:bg-gray-50 cursor-pointer flex justify-between items-center group"
            >
              <div className="flex items-start gap-3">
                {/* Multi-select checkbox for bulk margin apply (only meaningful for L2 or admins setting on visible) */}
                <input
                  type="checkbox"
                  checked={selectedForMargin.includes(product.id)}
                  onClick={(e) => toggleSelectForMargin(product.id, e)}
                  onChange={() => {}} // controlled by click handler
                  className="mt-1.5 accent-amber-600"
                  title="Select for bulk margin apply"
                />
                <div>
                  <h3 className="text-xl font-semibold">{product.name}</h3>
                  <p className="text-gray-500 text-sm">{product.description || 'No description'}</p>
                  <div className="mt-1 text-xs text-amber-700">
                    Retail Markup: <span className="font-mono">{product.pricing_matrix?.markup?.retailMarkup ?? 0}</span>
                    <span className="ml-2 px-2 py-0.5 bg-gray-100 text-gray-600 rounded">Visibility by org parent (L2 own hidden from sponsor)</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className={`px-5 py-2 rounded-2xl text-sm font-medium ${product.active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                  {product.active ? '✅ Active' : '❌ Inactive'}
                </span>
                <button 
                  onClick={(e) => { 
                    e.stopPropagation(); 
                    const isBridge = !!product.bridge_config || (product.name || '').toLowerCase().includes('bridge') || (product.name || '').toLowerCase().includes('fix');
                    router.push(isBridge ? `/admin/products/bridge/${product.id}` : `/admin/products/${product.id}`); 
                  }}
                  className="px-6 py-3 text-blue-600 hover:bg-blue-50 rounded-2xl font-medium group-hover:opacity-100"
                >
                  View / Edit →
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
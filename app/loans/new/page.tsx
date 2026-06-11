'use client';

import { useState, useEffect } from 'react';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PDFDownloadLink } from '@react-pdf/renderer';
import { LoanApplicationPDF } from '@/components/LoanApplicationPDF';
import { isBorrower, filterVisibleProductsWithOwner, isLevel2BrokerAE } from '@/lib/permissions';
import { supabase as supabaseLib } from '@/lib/supabase'; // fallback import if needed

function NewLoanContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [sbUser, setSbUser] = useState<any>(null);
  const appId = searchParams.get('id');

  const [application, setApplication] = useState<any>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [selectedRate, setSelectedRate] = useState<string>('');
  const [selectedLTV, setSelectedLTV] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCellBreakdown, setSelectedCellBreakdown] = useState<any>(null);
  const [availablePrepaymentKeys, setAvailablePrepaymentKeys] = useState<string[]>(['None']);
  const [availablePropertyTypes, setAvailablePropertyTypes] = useState<string[]>([]);
 
  
  // Manual input form
  const [manualForm, setManualForm] = useState({
    loanType: 'Purchase' as 'Purchase' | 'RefinanceRateTerm' | 'RefinanceCashOut',
    purchasePrice: '',
    estimatedValue: '',
    propertyType: 'Single Family',
    borrowerFico: '',
    amortization: 'Amortized' as 'Amortized' | 'Interest Only',
    rural: false,
    citizenship: 'US Citizen' as 'US Citizen' | 'Green Card Holder' | 'Foreign National',
    borrowerName: '',
    borrowerEmail: '',
    propertyAddress: '',
    rentQualification: '',  
    monthlyRent: '',
    prepayCanonicalKey: 'None',        // ← Single canonical key
  });

  const [selectedQuotes, setSelectedQuotes] = useState<any[]>([]);

  // DSCR inputs
  const [taxes, setTaxes] = useState('');
  const [insurance, setInsurance] = useState('');
  const [hoa, setHoa] = useState('');

  // Title/insurance contacts capture moved to loans/[id] page (as standard conditions / provider requests)

  const [currentUserRole, setCurrentUserRole] = useState<string>('BROKER_AE');
  const [currentUserParentId, setCurrentUserParentId] = useState<string | null>(null);
  const [currentUserOrgId, setCurrentUserOrgId] = useState<string | null>(null);
  const [organization, setOrganization] = useState<any>(null);
  const [supabaseClient, setSupabaseClient] = useState<any>(null);
  const [adjustmentKeys, setAdjustmentKeys] = useState<any[]>([]);
  const isBorrowerUser = isBorrower({ id: sbUser?.id || '', role: currentUserRole });

  // Load Supabase client + current auth user (post Clerk)
  useEffect(() => {
    import('@/lib/supabase').then(async ({ supabase: client }) => {
      setSupabaseClient(client);
      const { data: { user: u } } = await client.auth.getUser();
      setSbUser(u);
    });
  }, []);

  // Allow the manual "Loan Details" input form (all adjustments) to become visible immediately
  // for both "price a loan" (direct /loans/new) and "from the application" (?id= route).
  // We no longer gate the entire page behind application data fetch or products.
  // Products auto-select and app prefill happen in the background; inputs stay controlled + editable.
  useEffect(() => {
    if (supabaseClient) {
      setLoading(false);
    }
  }, [supabaseClient]);

  // Load user role + organization from profiles/users (Supabase auth)
  useEffect(() => {
    if (!sbUser || !supabaseClient) return;
    const loadUserAndOrg = async () => {
      // Prefer profiles, fallback to users table
      let userData = null;
      const { data: prof } = await supabaseClient.from('profiles').select('role, organization_id').eq('id', sbUser.id).maybeSingle();
      if (prof) {
        userData = prof;
      } else {
        const { data: urow } = await supabaseClient.from('profiles').select('role, organization_id').eq('id', sbUser.id).maybeSingle();
        userData = urow;
      }
      setCurrentUserRole(userData?.role || 'BROKER_AE');
      const orgIdFromProfile = userData?.organization_id || null;
      setCurrentUserOrgId(orgIdFromProfile);

      // parent_id for L2 detection (AE hierarchy / wholesale). Column added to profiles model.
      // Wrapped + safe select so 400s don't appear if timing/cache lag after push.
      let pId: string | null = null;
      try {
        const { data: urow } = await supabaseClient.from('profiles').select('id, role, organization_id, parent_id').eq('id', sbUser.id).maybeSingle();
        pId = (urow as any)?.parent_id || null;
        if (!orgIdFromProfile && (urow as any)?.organization_id) setCurrentUserOrgId((urow as any).organization_id);
      } catch (e) {
        console.warn('[loans/new] parent_id load skipped (column may still be syncing):', (e as any)?.message);
      }
      setCurrentUserParentId(pId);
      if (userData?.organization_id) {
        const { data: org } = await supabaseClient.from('organizations').select('wholesale_markup, retail_markup, name').eq('id', userData.organization_id).single();
        setOrganization(org);
      }
    };
    loadUserAndOrg();
  }, [sbUser, supabaseClient]);

  // Load Products (filtered to user's organization if available)
  useEffect(() => {
    if (!supabaseClient || !sbUser) return;

    const loadProducts = async () => {
      console.log('[loans/new] loadProducts START - org:', organization?.id, 'role:', currentUserRole, 'parentId:', currentUserParentId);
      let query = supabaseClient.from('loan_products').select('*').order('created_at', { ascending: false });

      // Use the organization we loaded from profile + for Level 2 also include parent's products (multi-parent visibility)
      if (organization?.id) {
        // best effort: include parent if this org has one (L2 case)
        try {
          const { data: o } = await supabaseClient.from('organizations').select('parent_organization_id').eq('id', organization.id).maybeSingle();
          if (o?.parent_organization_id) {
            query = query.in('organization_id', [organization.id, o.parent_organization_id]);
          } else {
            query = query.eq('organization_id', organization.id);
          }
        } catch {
          query = query.eq('organization_id', organization.id);
        }
      } else {
        console.log('[loans/new] loadProducts: no organization.id yet, will query all then filter');
      }

      const { data: prodsRaw, error: qErr } = await query;
      if (qErr) console.error('[loans/new] loadProducts query error:', qErr);
      console.log('[loans/new] loadProducts raw count:', prodsRaw?.length || 0);

      // Layer the user-level owner filter for L2 BROKER_AE private products (hidden upward) + inherited
      const userForFilter = { id: sbUser?.id || '', role: currentUserRole, organization_id: organization?.id || null, parent_id: currentUserParentId };
      const visible = filterVisibleProductsWithOwner(userForFilter, prodsRaw || []);
      console.log('[loans/new] loadProducts visible after filter:', visible.length);
      setProducts(visible);
      if (visible?.length && !selectedProduct) {
        console.log('[loans/new] auto-selecting first product:', visible[0]?.name);
        const first = visible[0];
        // Extra debug: does the auto-selected product carry the dynamic fields (matrix sections) for the PT/prepay dropdowns?
        try {
          const m = typeof first?.pricing_matrix === 'string' ? JSON.parse(first.pricing_matrix) : (first?.pricing_matrix || {});
          const propKeysInMatrix = Object.keys(m['propertyTypeAcquisition'] || m['Property Type Adjustment'] || m['propertyTypeRefi'] || m['propertyTypeAdjustment'] || {});
          const prepKeysInMatrix = Object.keys(m['Prepayment Adjustment'] || m['prepaymentAdjustment'] || {});
          console.log('[loans/new] auto-selected product matrix snapshot — has pricing_matrix?', !!first?.pricing_matrix, 'propType keys in matrix:', propKeysInMatrix.length, propKeysInMatrix.slice(0,5), 'prepay keys in matrix:', prepKeysInMatrix.length, prepKeysInMatrix.slice(0,5));
        } catch (e) { console.warn('[loans/new] matrix inspect error on auto-select', e); }
        setSelectedProduct(first);
      } else if (!visible?.length) {
        console.warn('[loans/new] NO visible products for this user/org/role - pricing grid will not show. Check product creation org/owner settings. Also check filterVisibleProductsWithOwner + owner_user_id on products.');
      }
    };

    loadProducts();
  }, [supabaseClient, sbUser, organization, currentUserRole, currentUserParentId]);

   // Note: Application prefill (?id=) no longer blocks the page loading state.
  // The manual "Loan Details" form (with Purchase Price, FICO, Annual Rent/Taxes/Insurance/HOA etc.)
  // must be immediately visible for both direct "price a loan" and navigation from an application.
  // Prefill updates the controlled inputs live without hiding the form.

  // ====================== LOAD DYNAMIC FIELDS FOR DROPDOWNS (Property Type + Prepayment) ======================
  // These power the "prepayment penalty" and "property type" selects in the manual Loan Details form.
  // Sources (to load "dynamic fields from the products/id/adjustments page"):
  // 1. Org-level canonicals from adjustment_keys table (populated via 🔑 Manage Standard Keys at /admin/products/keys,
  //    which itself scans all org products' pricing_matrix for keys).
  // 2. Directly from the *selected product's* pricing_matrix (the tables/CSV you edit on /admin/products/[id]/adjustments
  //    under "Property Type Adjustment" and "Prepayment Adjustment" tabs). This is the per-product "dynamic fields".
  // We union both so newly added keys in a product's adjustments show immediately in the loan form,
  // and standardized org keys are always available.
  // Heavy logging for debug (visible in browser console when on /loans/new).

  // Helper: pull row keys (Standard Keys) from a product's pricing_matrix for the relevant sections.
  // Matches the storage keys used in adjustments page + keys page + the getBrokerPrice matrix lookups.
  const extractMatrixKeys = (product: any, possibleSectionNames: string[]): string[] => {
    if (!product?.pricing_matrix) return [];
    let matrix: any = product.pricing_matrix;
    if (typeof matrix === 'string') {
      try { matrix = JSON.parse(matrix); } catch { return []; }
    }
    const found = new Set<string>();
    for (const name of possibleSectionNames) {
      const section = matrix?.[name] || {};
      Object.keys(section || {}).forEach((k: string) => {
        if (k && typeof k === 'string' && k.trim()) found.add(k.trim());
      });
    }
    return Array.from(found);
  };

  // Load org-level keys from adjustment_keys (works even before a product is selected, using currentUserOrgId).
  // This covers the "Manage Standard Keys" flow.
  useEffect(() => {
    if (!supabaseClient) return;
    const orgId = currentUserOrgId || selectedProduct?.organization_id || organization?.id;
    if (!orgId) {
      console.log('[loans/new] loadOrgAdjustmentKeys: no orgId yet (currentUserOrgId/selected/organization all missing)');
      return;
    }

    const loadOrgKeys = async () => {
      console.log('[loans/new] loadOrgAdjustmentKeys START for org:', orgId);
      const { data, error } = await supabaseClient
        .from('adjustment_keys')
        .select('canonical_key, adjustment_type')
        .eq('organization_id', orgId)
        .in('adjustment_type', ['Property Type Adjustment', 'Prepayment Adjustment']);

      if (error) {
        console.error('[loans/new] loadOrgAdjustmentKeys error:', error);
        return;
      }

      const propKeys = (data || [])
        .filter((r: any) => r.adjustment_type === 'Property Type Adjustment')
        .map((r: any) => r.canonical_key)
        .filter(Boolean);
      const prepKeys = (data || [])
        .filter((r: any) => r.adjustment_type === 'Prepayment Adjustment')
        .map((r: any) => r.canonical_key)
        .filter(Boolean);

      console.log('[loans/new] loadOrgAdjustmentKeys: property_type keys from table:', propKeys.length, propKeys);
      console.log('[loans/new] loadOrgAdjustmentKeys: prepayment keys from table:', prepKeys.length, prepKeys);

      if (propKeys.length > 0) {
        setAvailablePropertyTypes((prev: string[]) => {
          const merged = Array.from(new Set([...(prev || []), ...propKeys])).sort((a, b) => a.localeCompare(b));
          console.log('[loans/new] setAvailablePropertyTypes (from org adjustment_keys) →', merged.length, 'total');
          return merged;
        });
      }
      if (prepKeys.length > 0) {
        setAvailablePrepaymentKeys((prev: string[]) => {
          const withoutNone = (prev || []).filter((k: string) => k !== 'None');
          const merged = ['None', ...Array.from(new Set([...withoutNone, ...prepKeys]))];
          console.log('[loans/new] setAvailablePrepaymentKeys (from org adjustment_keys) →', merged.length, 'total');
          return merged;
        });
      }
    };

    loadOrgKeys();
  }, [supabaseClient, currentUserOrgId, selectedProduct?.organization_id, organization?.id]);

  // When a product is selected (or changes), also pull its direct matrix keys (the live config from /admin/products/[id]/adjustments).
  // This ensures "dynamic fields from the products/id/page" appear in the dropdowns.
  // We union with whatever is already loaded from adjustment_keys.
  useEffect(() => {
    if (!selectedProduct) {
      console.log('[loans/new] selectedProduct is null/empty — dropdowns will use org adjustment_keys only (or defaults)');
      return;
    }
    console.log('[loans/new] selectedProduct changed — extracting dynamic keys from its pricing_matrix. id:', selectedProduct.id, 'name:', selectedProduct.name);

    const propFromMatrix = extractMatrixKeys(selectedProduct, [
      'Property Type Adjustment',
      'propertyTypeAdjustment',
      'propertyTypeRefi',
      'propertyTypeAcquisition',
      'Property Type'
    ]);
    const prepFromMatrix = extractMatrixKeys(selectedProduct, [
      'Prepayment Adjustment',
      'prepaymentAdjustment',
      'Prepayment',
      'Prepayment Penalty'
    ]);

    console.log('[loans/new] matrix keys for Property Type sections:', propFromMatrix.length, propFromMatrix);
    console.log('[loans/new] matrix keys for Prepayment sections:', prepFromMatrix.length, prepFromMatrix);

    if (propFromMatrix.length > 0) {
      setAvailablePropertyTypes((prev: string[]) => {
        const merged = Array.from(new Set([...(prev || []), ...propFromMatrix])).sort((a, b) => a.localeCompare(b));
        console.log('[loans/new] setAvailablePropertyTypes (union matrix from selectedProduct) →', merged.length, 'total');
        return merged;
      });
    }
    if (prepFromMatrix.length > 0) {
      setAvailablePrepaymentKeys((prev: string[]) => {
        const withoutNone = (prev || []).filter((k: string) => k !== 'None');
        const merged = ['None', ...Array.from(new Set([...withoutNone, ...prepFromMatrix]))];
        console.log('[loans/new] setAvailablePrepaymentKeys (union matrix from selectedProduct) →', merged.length, 'total');
        return merged;
      });
    }
  }, [selectedProduct?.id, selectedProduct]);  // id for stability + object for matrix content changes

  // Legacy raw load (kept for any other consumers of adjustmentKeys state; does not drive dropdowns directly).
  useEffect(() => {
    if (!supabaseClient) return;
    const orgId = currentUserOrgId || selectedProduct?.organization_id || organization?.id;
    if (!orgId) return;
    (async () => {
      const { data } = await supabaseClient
        .from('adjustment_keys')
        .select('*')
        .eq('organization_id', orgId)
        .or('adjustment_type.eq.Property Type Adjustment,adjustment_type.eq.Prepayment Adjustment,adjustment_type.eq.property_type,adjustment_type.eq.prepayment');
      setAdjustmentKeys(data || []);
    })();
  }, [supabaseClient, currentUserOrgId, selectedProduct?.organization_id, organization?.id]);

  // Load application if ?id= (from dashboard "View Pricing" or loan-application flows).
  // IMPORTANT: This prefill must NEVER hide or gate the manual input form.
  // The "Loan Details" section (purchase price / value, FICO, monthly rent, annual taxes/insurance/hoa + all other adjustments)
  // is always rendered and fully editable for BOTH direct pricing and application-sourced routes.
  // Values are mapped explicitly and the controlled inputs update live.
  useEffect(() => {
    if (!appId || !supabaseClient) return;
    const loadApplication = async () => {
      const { data: app } = await supabaseClient.from('loan_applications').select('*').eq('id', appId).single();
      if (app) {
        setApplication(app);
        if (app.form_data) {
          const fd = app.form_data;

          // Explicit mapping for the fields the user requires to be prefilled + editable:
          // Purchase Price, Fico Score, Annual Rent (→ monthly), Annual Taxes, Annual Insurance, Annual HOA.
          // Also carry loan type / other visible adjustment fields so selects are pre-populated where possible.
          const pp = fd.purchasePrice || fd.estimatedValue || '';
          const ev = fd.estimatedValue || fd.purchasePrice || '';

          setManualForm(prev => ({
            ...prev,
            loanType: fd.loanType || prev.loanType,
            purchasePrice: pp || prev.purchasePrice,
            estimatedValue: ev || prev.estimatedValue,
            borrowerFico: fd.fico || fd.borrowerFico || prev.borrowerFico || '',
            propertyType: fd.propertyType || prev.propertyType,
            amortization: fd.amortization || prev.amortization,
            rural: typeof fd.rural === 'boolean' ? fd.rural : prev.rural,
            citizenship: fd.citizenship || prev.citizenship,
            borrowerName: fd.borrowerName || prev.borrowerName,
            borrowerEmail: fd.borrowerEmail || prev.borrowerEmail,
            propertyAddress: fd.propertyAddress || prev.propertyAddress,
            rentQualification: fd.rentQualification || fd.rentType || prev.rentQualification,
            monthlyRent: fd.monthlyRent || fd.rentalIncome || (fd.annualRent ? String(parseFloat(String(fd.annualRent)) / 12) : prev.monthlyRent),
            prepayCanonicalKey: fd.prepayCanonicalKey || fd.prepayment || prev.prepayCanonicalKey || 'None',
          }));

          // Separate states for the annual expense adjustments (used in DSCR + matrix calcs)
          setTaxes(fd.annualTaxes || fd.taxes || '');
          setInsurance(fd.annualInsurance || fd.insurance || '');
          setHoa(fd.annualHoa || fd.hoa || '');
        }
      }
    };
    loadApplication();
  }, [appId, supabaseClient]);

  // If navigated from an application (?id=) that stored selected_product_id, auto-choose it
  // for the pricing grid (once products for the user's org are loaded). This does not affect
  // visibility or editability of the manual adjustment form above.
  useEffect(() => {
    if (!application?.selected_product_id || products.length === 0) return;
    const match = products.find((p: any) => String(p.id) === String(application.selected_product_id));
    if (match && (!selectedProduct || String(selectedProduct.id) !== String(match.id))) {
      setSelectedProduct(match);
      setSelectedRate('');
      setSelectedLTV(0);
    }
  }, [application, products]);

 
  // ====================== HANDLERS ======================
  const handleManualChange = (field: string, value: any) => {
    setManualForm(prev => ({ ...prev, [field]: value }));
  };

  const formData = manualForm;
  const purchasePrice = parseFloat((formData.purchasePrice || formData.estimatedValue || '0').replace(/,/g, '')) || 0;

  // ====================== MARKUP ======================
  const getMarkup = () => {
    if (selectedProduct?.pricing_matrix?.markup) {
      const m = selectedProduct.pricing_matrix.markup;
      return isBorrowerUser ? (m.retailMarkup || 0) : (m.wholesaleMarkup || 0);
    }
    if (!organization) return 0;
    return isBorrowerUser ? (organization.retail_markup || 0) : (organization.wholesale_markup || 0);
  };

  // Level 2 own product detection (for margin subtract + visibility already applied in selector)
  const isL2User = currentUserRole === 'BROKER_AE' && !!currentUserParentId;
  const isL2OwnProduct = isL2User && selectedProduct && (selectedProduct.owner_user_id === sbUser?.id);

  const getFinalPrice = (basePrice: number | null): number | null => {
    if (basePrice === null) return null;
    let final = basePrice + getMarkup();

    // Apply retail markup (from product.pricing_matrix.markup.retailMarkup) for L2 own-product adjustment.
    // Changed per requirements: use the standard "retail markup" field instead of dedicated retail_borrower_margin.
    if (isL2OwnProduct && selectedProduct?.pricing_matrix?.markup?.retailMarkup != null) {
      final = final - (parseFloat(selectedProduct.pricing_matrix.markup.retailMarkup) || 0);
    }

    if (selectedProduct?.pricing_matrix?.markup) {
      const m = selectedProduct.pricing_matrix.markup;
      if (!isBorrowerUser) {
        if (m.wholesalePriceFloor && final < m.wholesalePriceFloor) final = m.wholesalePriceFloor;
        if (m.wholesalePriceCeiling && final > m.wholesalePriceCeiling) final = m.wholesalePriceCeiling;
      } else {
        if (m.retailPriceFloor && final < m.retailPriceFloor) final = m.retailPriceFloor;
        if (m.retailPriceCeiling && final > m.retailPriceCeiling) final = m.retailPriceCeiling;
      }
    }

    if (final > 103) return null;
    if (final >= 102.01) final = 102;
    if (final < 96) return null;
    if (final >= 96 && final < 97) final = 97;

    return Math.floor(final * 100) / 100;
  };

  // ====================== HELPERS ======================
  const getPrepaymentCanonicalKey = (): string => {
    return manualForm.prepayCanonicalKey || 'None';
  };

  const getPropertyTypeMatrixKey = (displayValue: string): string => {
    return displayValue;   // Now directly uses canonical key from your table
  };

  const getLtvBucket = (ltv: number): string => {
    if (ltv <= 50) return '<=50';
    if (ltv <= 55) return '50.01-55';
    if (ltv <= 60) return '55.01-60';
    if (ltv <= 65) return '60.01-65';
    if (ltv <= 70) return '65.01-70';
    if (ltv <= 75) return '70.01-75';
    return '75.01-80';
  };
    // ====================== BUCKETS ======================
  const interestRates = Array.from({ length: 57 }, (_, i) => parseFloat((5.0 + i * 0.125).toFixed(3)));
  const ltvBuckets = [50, 55, 60, 65, 70, 75, 80];

  const getFicoBucket = (fico: number): string => {
    if (fico >= 780) return '780+';
    if (fico >= 760) return '760-779';
    if (fico >= 740) return '740-759';
    if (fico >= 720) return '720-739';
    if (fico >= 700) return '700-719';
    if (fico >= 680) return '680-699';
    if (fico >= 660) return '660-679';
    return '620-639';
  };

  const getDscrBucket = (dscr: number, fico: number, isPurchase: boolean = true): string => {
    if (dscr >= 1.25) return '>=1.25x';
    if (dscr >= 1.15) return '>=1.15x and <1.25x';
    if (dscr >= 1.00) return '>=1.00x and <1.15x';
    if (dscr >= 0.95 && fico >= 720) return isPurchase ? '0.95-0.99x (Purch, 720+ FICO)' : '0.95-0.99x (Refi, 720+ FICO)';
    if (dscr >= 0.85 && fico >= 720) return isPurchase ? '0.85-0.94x (Purch, 720+ FICO)' : '0.85-0.94x (Refi, 720+ FICO)';
    if (dscr >= 0.75 && fico >= 720) return isPurchase ? '0.75-0.84x (Purch, 720+ FICO)' : '0.75-0.84x (Refi, 720+ FICO)';
    return '<0.75x';
  };

  const getLoanSizeBucket = (amount: number): string => {
    if (amount <= 125000) return '100001-125000';
    if (amount <= 150000) return '125001-150000';
    if (amount <= 250000) return '150001-250000';
    if (amount <= 400000) return '250001-400000';
    if (amount <= 500000) return '400001-500000';
    if (amount <= 750000) return '500001-750000';
    if (amount <= 1000000) return '750001-1000000';
    if (amount <= 1500000) return '1000001-1500000';
    if (amount <= 2000000) return '1500001-2000000';
    if (amount <= 2500000) return '2000001-2500000';
    if (amount <= 3000000) return '2500001-3000000';
    if (amount <= 3500000) return '3000001-3500000';
    return '3500001+';
  };

  // ====================== NEW: DSCR Master maxLTV + strict NA/blank handling for grids (preserve prior buckets/getDscr etc) =====
  // dscrMaxLtv in matrix: { band: { ficoKey: { sizeKey: { "Acquisition": "80.0%" | "NA" | number, "Rate-Term Refinance":.., "Cash-Out Refinance":.. } } } }
  const getDscrMasterBand = (dscr: number): string => {
    if (dscr >= 1.25) return '>=1.25x';
    if (dscr >= 1.15) return '1.15x - 1.24x';
    if (dscr >= 1.00) return '1.00x - 1.14x';
    if (dscr >= 0.75) return '0.75x - 0.99x';
    return '<0.75x';
  };

  const isIneligibleValue = (v: any): boolean => {
    if (v == null) return true;
    const s = String(v).trim().toUpperCase();
    if (!s || s === 'NA' || s === 'N/A' || s === 'NULL') return true;
    const n = parseFloat(s.replace('%', '').replace(/[^0-9.-]/g, ''));
    return isNaN(n);
  };

  const getGridAdjOrNull = (grid: any, rowKey: any, colKey: string): number | null => {
    if (!grid || rowKey == null) return 0;
    const row = grid[rowKey] || grid[String(rowKey)];
    if (!row) return 0;
    const cell = row[colKey];
    if (isIneligibleValue(cell)) return null;
    const n = parseFloat(String(cell).replace('%', '').replace(/[^0-9.-]/g, ''));
    return isNaN(n) ? 0 : n;
  };

  const getMaxLtvForCombo = (dscr: number, fico: number, loanAmount: number, loanType: string, matrix: any): number | null => {
    const band = getDscrMasterBand(dscr);
    const ficoKey = getFicoBucket(fico);
    const sizeKey = getLoanSizeBucket(loanAmount);
    const purpose = loanType === 'Purchase' ? 'Acquisition'
      : loanType === 'RefinanceRateTerm' ? 'Rate-Term Refinance'
      : 'Cash-Out Refinance';
    const master = matrix.dscrMaxLtv || matrix['dscrMaxLtv'] || {};
    const bandData = master[band] || {};
    const ficoData = bandData[ficoKey] || {};
    let sizeData = ficoData[sizeKey] || {};
    // fallback normalize if keys differ slightly
    if (!sizeData || Object.keys(sizeData).length === 0) {
      const alt = Object.keys(ficoData).find(k => k.replace(/-/g,'') === sizeKey.replace(/-/g,''));
      if (alt) sizeData = ficoData[alt] || {};
    }
    const maxVal = sizeData[purpose] || sizeData[purpose.replace(' ', '')];
    if (isIneligibleValue(maxVal)) return null;
    const n = parseFloat(String(maxVal).replace('%', ''));
    return isNaN(n) ? null : n;
  };

  const calculateDSCR = (rate: number, ltv: number) => {
    const loanForCell = purchasePrice * (ltv / 100);
    if (!loanForCell) return 1.0;

    const monthlyRate = rate / 100 / 12;
    const numPayments = 360;
    const monthlyPayment = loanForCell * (monthlyRate * Math.pow(1 + monthlyRate, numPayments)) / (Math.pow(1 + monthlyRate, numPayments) - 1);

    const annualDebtService = monthlyPayment * 12;
    const monthlyRentNum = parseFloat(manualForm.monthlyRent) || 0;
    const annualGrossRent = monthlyRentNum * 12;

    const annualTaxes = parseFloat(taxes) || 0;
    const annualInsurance = parseFloat(insurance) || 0;
    const annualHoa = parseFloat(hoa) || 0;
    const annualExpenses = annualTaxes + annualInsurance + annualHoa;

    const annualNetIncome = annualGrossRent - annualExpenses;
    return annualNetIncome / annualDebtService || 1.0;
  };

  const calculateMonthlyPayment = (rate: number, ltv: number) => {
    if (!purchasePrice) return null;
    const loanForCell = purchasePrice * (ltv / 100);
    const monthlyRate = rate / 100 / 12;
    const numPayments = 360;
    const payment = loanForCell * (monthlyRate * Math.pow(1 + monthlyRate, numPayments)) / (Math.pow(1 + monthlyRate, numPayments) - 1);
    return Math.round(payment);
  };

  // ====================== UPDATED getBrokerPrice (extended for dscrMaxLtv master eligibility + NA/blank=Ineligible on grids; preserve prior getDscr/getFico/getLoanSize/breakdown/NA strings in matrix) =====
  const getBrokerPrice = (rate: number, ltv: number, debug: boolean = false): number | any => {
    if (!selectedProduct?.pricing_matrix) return null;

    let matrix: any = {};
    try {
      matrix = typeof selectedProduct.pricing_matrix === 'string'
        ? JSON.parse(selectedProduct.pricing_matrix)
        : selectedProduct.pricing_matrix || {};
    } catch (e) {
      console.error("Matrix parse error:", e);
      return null;
    }

    // Base Rate
    const baseMatrix = matrix['baseRates'] || matrix['Base Rate'] || {};
    const rateStr3 = rate.toFixed(3);
    const rateStr4 = rate.toFixed(4);
    let basePriceStr = baseMatrix[rateStr4] || baseMatrix[rateStr3] || baseMatrix[rate.toString()] || baseMatrix[rate];
    let price = parseFloat(basePriceStr || '0');

    if (!price || isNaN(price)) {
      if (debug) console.log(`❌ No Base Rate found for ${rate}%`);
      return null;
    }

    const ltvKey = getLtvBucket(ltv);
    const fico = parseFloat(manualForm.borrowerFico || '720');
    const dscr = calculateDSCR(rate, ltv);
    const isPurchase = manualForm.loanType === 'Purchase';
    const propertyType = manualForm.propertyType || 'Single Family';
    const rentType = manualForm.rentQualification || 'LTR: In-Place/Market Rent';

    const safeParse = (val: any): number => isNaN(parseFloat(val)) ? 0 : parseFloat(val);
    const cellLoanAmount = purchasePrice * (ltv / 100);

    // NEW: Master maxLTV eligibility (FICO/LoanSize/Purpose per DSCR band). NA or LTV>max => Ineligible
    const masterMax = getMaxLtvForCombo(dscr, fico, cellLoanAmount, manualForm.loanType, matrix);
    if (masterMax === null || ltv > masterMax) {
      if (debug) console.log(`❌ Ineligible by dscrMaxLtv: dscrBand=${getDscrMasterBand(dscr)} fico=${getFicoBucket(fico)} size=${getLoanSizeBucket(cellLoanAmount)} purpose=${manualForm.loanType} max=${masterMax} ltv=${ltv}`);
      return null;
    }

    let runningTotal = price;

    // NEW: for LTV grids, use getGridAdjOrNull which returns null on "NA"/blank/non-numeric (0 is valid)
    const ficoGrid = matrix['ficoLtvGrid'] || matrix['FICO Adjustment'] || {};
    const ficoAdj = getGridAdjOrNull(ficoGrid, getFicoBucket(fico), ltvKey);
    if (ficoAdj === null) {
      if (debug) console.log(`❌ Ineligible: FICO grid NA/blank for ${getFicoBucket(fico)} @ ${ltvKey}`);
      return null;
    }

    const dscrGrid = matrix['DSCR Adjustment'] || matrix['dscrLtvGrid'] || {};
    const dscrAdj = getGridAdjOrNull(dscrGrid, getDscrBucket(dscr, fico, isPurchase), ltvKey);
    if (dscrAdj === null) {
      if (debug) console.log(`❌ Ineligible: DSCR grid NA/blank for ${getDscrBucket(dscr, fico, isPurchase)} @ ${ltvKey}`);
      return null;
    }

    const loanGrid = matrix['loanBalanceLtvGrid'] || matrix['Loan Balance Adjustment'] || {};
    const loanBalanceAdj = getGridAdjOrNull(loanGrid, getLoanSizeBucket(cellLoanAmount), ltvKey);
    if (loanBalanceAdj === null) {
      if (debug) console.log(`❌ Ineligible: Loan Balance grid NA/blank for ${getLoanSizeBucket(cellLoanAmount)} @ ${ltvKey}`);
      return null;
    }

    const breakdown: any = {
      baseRate: price,
      ficoAdj,
      dscrAdj,
      loanBalanceAdj,
      propertyAdj: 0,
      amortizationAdj: safeParse((matrix['amortizationAdjustment'] || matrix['Amortization Adjustment'] || {})[manualForm.amortization] || 
                                (matrix['amortizationAdjustment'] || matrix['Amortization Adjustment'] || {})['Fully Amortizing']),
      prepaymentAdj: 0,
      rentAdj: 0,
      otherAdj: 0,
      markup: 0,
      subtotal: 0,
      finalPrice: 0
    };

    // Property Type (grid or scalar; check ltv cell if present)
    const matrixPropKey = getPropertyTypeMatrixKey(propertyType);
    const propMatrix = matrix['propertyTypeAdjustment'] || matrix['Property Type Adjustment'] || 
                       matrix['propertyTypeRefi'] || matrix['propertyTypeAcquisition'] || {};
    let propertyAdj = 0;
    const propRow = propMatrix[matrixPropKey];
    if (propRow && typeof propRow === 'object' && propRow[ltvKey] !== undefined) {
      const pcell = propRow[ltvKey];
      if (isIneligibleValue(pcell)) {
        if (debug) console.log(`❌ Ineligible: Property grid NA/blank for ${matrixPropKey} @ ${ltvKey}`);
        return null;
      }
      propertyAdj = parseFloat(String(pcell).replace('%','')) || 0;
    } else {
      propertyAdj = safeParse(propRow);
    }
    breakdown.propertyAdj = propertyAdj;
    runningTotal += propertyAdj;

    if (debug) {
      console.log("Property Type Adjustment".padEnd(45) + propertyAdj.toFixed(3) + `  (Mapped: "${propertyType}" → "${matrixPropKey}")`);
    }

    // Prepayment - NEW CANONICAL KEY (check if grid cell)
    let prepayAdj = 0;
    const prepayLabel = getPrepaymentCanonicalKey();

    if (prepayLabel !== 'None') {
      const prepayMatrix = matrix['Prepayment Adjustment'] || {};
      const pcell = prepayMatrix[prepayLabel]?.[ltvKey];
      if (pcell !== undefined) {
        if (isIneligibleValue(pcell)) {
          if (debug) console.log(`❌ Ineligible: Prepay grid NA/blank for ${prepayLabel} @ ${ltvKey}`);
          return null;
        }
        prepayAdj = parseFloat(String(pcell).replace('%','')) || 0;
      } else {
        prepayAdj = safeParse(prepayMatrix[prepayLabel]?.[ltvKey] || '0');
      }

      if (debug) {
        console.log("Prepayment Adjustment".padEnd(45) + prepayAdj.toFixed(3) + `  (Canonical: "${prepayLabel}")`);
      }
    } else if (debug) {
      console.log("Prepayment Adjustment".padEnd(45) + "0.000  (None)");
    }

    breakdown.prepaymentAdj = prepayAdj;
    runningTotal += prepayAdj;

    // Rent / Other (grids): check their LTV cell if present for the key
    const rentGrid = matrix['Rent Adjustments'] || {};
    const rcell = rentGrid[rentType]?.[ltvKey];
    if (rcell !== undefined) {
      if (isIneligibleValue(rcell)) {
        if (debug) console.log(`❌ Ineligible: Rent grid NA/blank for ${rentType} @ ${ltvKey}`);
        return null;
      }
      breakdown.rentAdj = parseFloat(String(rcell).replace('%','')) || 0;
    } else {
      breakdown.rentAdj = safeParse(rentGrid[rentType]?.[ltvKey]);
    }
    runningTotal += breakdown.rentAdj;

    const otherGrid = matrix['Other Adjustments'] || matrix['otherAdjustments'] || {};
    const ocell = otherGrid['Standard']?.[ltvKey];
    if (ocell !== undefined) {
      if (isIneligibleValue(ocell)) {
        if (debug) console.log(`❌ Ineligible: Other grid NA/blank for Standard @ ${ltvKey}`);
        return null;
      }
      breakdown.otherAdj = parseFloat(String(ocell).replace('%','')) || 0;
    } else {
      breakdown.otherAdj = safeParse(otherGrid['Standard']?.[ltvKey]);
    }
    runningTotal += breakdown.otherAdj;

    // Final Totals
    breakdown.subtotal = runningTotal =
      breakdown.baseRate + breakdown.ficoAdj + breakdown.dscrAdj + breakdown.loanBalanceAdj +
      breakdown.propertyAdj + breakdown.amortizationAdj + breakdown.prepaymentAdj +
      breakdown.rentAdj + breakdown.otherAdj;

    breakdown.markup = getMarkup();
    breakdown.retailMarkupL2 = (isL2OwnProduct && selectedProduct?.pricing_matrix?.markup?.retailMarkup != null) ? (parseFloat(selectedProduct.pricing_matrix.markup.retailMarkup) || 0) : 0;
    breakdown.finalPrice = getFinalPrice(breakdown.subtotal);

    if (debug) {
      console.log("─".repeat(65));
      console.log("SUBTOTAL (Base + All Adjustments)".padEnd(45) + breakdown.subtotal.toFixed(3));
      console.log("Markup / Margin".padEnd(45) + breakdown.markup.toFixed(3));
      if (breakdown.retailMarkupL2) {
        console.log("Retail Markup (L2 own subtract, from product retailMarkup)".padEnd(45) + `-${breakdown.retailMarkupL2.toFixed(3)}`);
      }
      console.log("FINAL BROKER PRICE".padEnd(45) + breakdown.finalPrice.toFixed(3));
      console.log("=======================================\n");
    }

    return debug ? breakdown : breakdown.subtotal;
  };

  const getPrice = (rate: number, ltv: number): number | null => {
    const base = getBrokerPrice(rate, ltv, false);
    return getFinalPrice(base);
  };

  const getDisplayValue = (rate: number, ltv: number) => {
    const price = getPrice(rate, ltv);
    if (price === null) return 'Ineligible';
    if (isBorrowerUser) {
      const feePercent = Math.max(0, 100 - price);
      return `${feePercent.toFixed(2)}% Orig Fee`;
    }
    return price.toFixed(2);
  };

  const handleCellClick = (rate: number, ltv: number) => {
    const breakdown = getBrokerPrice(rate, ltv, true);
    if (!breakdown || typeof breakdown === 'number') {
      setSelectedCellBreakdown(null);
      return;
    }

    const monthlyPayment = calculateMonthlyPayment(rate, ltv);
    const dscr = calculateDSCR(rate, ltv);

    breakdown.rate = rate.toFixed(3);
    breakdown.ltv = ltv;
    breakdown.monthlyPayment = monthlyPayment;
    breakdown.dscr = dscr.toFixed(2) + 'x';

    setSelectedCellBreakdown(breakdown);

    const finalPrice = breakdown.finalPrice || getPrice(rate, ltv);
    const newQuote = {
      productName: selectedProduct?.name || 'Custom',
      rate: rate.toFixed(3),
      ltv,
      price: finalPrice,
      displayPrice: isBorrowerUser 
        ? `${Math.max(0, 100 - finalPrice).toFixed(2)}% Origination Fee` 
        : finalPrice.toFixed(2),
      amortization: manualForm.amortization,
      monthlyPayment: monthlyPayment ? `$${monthlyPayment.toLocaleString()}` : 'N/A',
      dscr: dscr.toFixed(2) + 'x',
    };

    if (selectedQuotes.length < 5 && !selectedQuotes.some(q => q.rate === newQuote.rate && q.ltv === newQuote.ltv)) {
      setSelectedQuotes([...selectedQuotes, newQuote]);
    }
  };

  // ====================== CREATE LOAN + PROVIDER REQUESTS ======================
  const sendQuoteToBorrower = async () => { /* existing or keep as-is for quote PDF/email */ };

  async function createLoanRecordAndNotifyProviders() {
    if (!selectedProduct) {
      alert('Please select a loan product first.');
      return null;
    }
    if (!selectedRate || !selectedLTV) {
      alert('Please click a cell in the pricing grid to select rate + LTV before creating the loan.');
      return null;
    }

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
      alert('You must be logged in to create a loan.');
      return null;
    }

    // Compute key values
    const ltvNum = Number(selectedLTV);
    const purchasePriceNum = parseFloat((manualForm.purchasePrice || manualForm.estimatedValue || '0').replace(/,/g, '')) || 0;
    const loanAmountNum = Math.round(purchasePriceNum * (ltvNum / 100));

    if (!loanAmountNum) {
      alert('Unable to compute loan amount. Check Purchase Price / Estimated Value and selected LTV.');
      return null;
    }

    // Resolve org id (tenant or user profile)
    let orgId = currentUserOrgId || (organization?.id) || null;
    if (!orgId && user) {
      const { data: prof } = await supabaseClient.from('profiles').select('organization_id').eq('id', user.id).maybeSingle();
      orgId = prof?.organization_id || null;
    }

    // Snapshot mortgagee clause from org (preferred) or product context
    let mortgageeClause = '';
    try {
      if (orgId) {
        const { data: orgRow } = await supabaseClient.from('organizations').select('mortgagee_clause').eq('id', orgId).maybeSingle();
        mortgageeClause = orgRow?.mortgagee_clause || '';
      }
      if (!mortgageeClause && selectedProduct?.organization_id) {
        const { data: pOrg } = await supabaseClient.from('organizations').select('mortgagee_clause').eq('id', selectedProduct.organization_id).maybeSingle();
        mortgageeClause = pOrg?.mortgagee_clause || '';
      }
    } catch {}

    const insertPayload: any = {
      product_id: selectedProduct.id,
      originator_id: user.id,
      borrower_name: manualForm.borrowerName || 'TBD',
      property_address: manualForm.propertyAddress || 'TBD',
      loan_amount: loanAmountNum,
      loan_type: manualForm.loanType || 'purchase',
      status: 'PENDING',
      loan_status: 'Processing',
      purpose: manualForm.loanType?.includes('Refinance') ? 'Refinance' : 'Purchase',
      property_type: manualForm.propertyType || 'Single Family',
      organization_id: orgId,
      mortgagee_clause: mortgageeClause || null,
      notes: `Created from pricing matrix @ ${selectedRate}% / ${selectedLTV}% LTV. Final price target: ${getFinalPrice(parseFloat(selectedRate)) || 'N/A'}.`,
    };

    const { data: newLoan, error } = await supabaseClient
      .from('loans')
      .insert(insertPayload)
      .select()
      .single();

    if (error) {
      console.error('Loan insert error', error);
      alert('Failed to create loan: ' + error.message);
      return null;
    }

    // Provider requests (title/insurance) are now triggered from the loan detail page (/loans/[id]) after contacts are added there as standard conditions.
    // Snapshot pricing matrix like other flows (credit/appraisal)
    try {
      // fire and forget; the action already exists
      // @ts-ignore - optional import
      import('@/app/actions/organization-actions').then(m => m.snapshotPricingMatrixForLoan?.(newLoan.id, selectedProduct.id));
    } catch {}

    return newLoan;
  }

  const saveQuoteAndStartApplication = async () => {
    const created = await createLoanRecordAndNotifyProviders();
    if (created) {
      alert(`✅ Loan #${created.id} created. Add title/insurance contacts on the loan detail page to trigger provider requests (standard conditions).`);
      router.push(`/loans/${created.id}`);
    }
  };

  // Direct "Create Loan" action from the grid (uses current selected quote + the provider contact fields)
  const createLoanDirect = async () => {
    const created = await createLoanRecordAndNotifyProviders();
    if (created) {
      alert(`✅ Loan created (#${created.id}). Add title/insurance contacts on the loan detail page (/loans/${created.id}) to trigger automated provider requests.`);
      router.push(`/loans/${created.id}`);
    }
  };

  if (error) return <div className="p-10 text-red-600 text-center text-xl">Error: {error}</div>;
  if (loading) return <div className="p-10 text-center text-xl">Loading pricing matrix...</div>;

  return (
    <div className="max-w-7xl mx-auto p-8">
      {/* HEADER */}
      <div className="flex items-center justify-between mb-8 border-b pb-6">
        <button
          onClick={() => router.push('/dashboard')}
          className="flex items-center gap-2 px-6 py-3 bg-gray-100 hover:bg-gray-200 rounded-2xl font-medium text-lg"
        >
          ← Back to Dashboard
        </button>

        <h1 className="text-4xl font-bold text-center flex-1">
          {isBorrowerUser ? 'Retail Pricing Matrix' : 'Wholesale Pricing Matrix'}
        </h1>

        <PDFDownloadLink
          document={<LoanApplicationPDF form={formData} />}
          fileName={`Quote-${formData.propertyAddress || 'NewLoan'}.pdf`}
        >
          {({ loading }) => (
            <button className="px-8 py-4 bg-blue-600 text-white rounded-3xl font-medium hover:bg-blue-700">
              {loading ? 'Generating PDF...' : '📄 Download PDF'}
            </button>
          )}
        </PDFDownloadLink>
      </div>

      {/* MANUAL INPUT FORM — ALWAYS VISIBLE + EDITABLE
          Shown for both direct "price a loan" navigation and when routed from an application (?id=).
          All adjustment fields (Purchase Price / Property Value, FICO, Monthly Rent, Annual Taxes/Insurance/HOA,
          Property Type, Amortization, Prepay, etc.) are rendered and bound here regardless of source.
          When coming from an application the values are prefilled but remain fully editable. */}
      <div className="bg-white border rounded-3xl p-8 mb-10">
          <h2 className="text-2xl font-semibold mb-6">
            Loan Details
            {appId && (
              <span className="ml-3 text-sm font-normal text-blue-600 align-middle">
                (prefilled from your application — edit any field as needed)
              </span>
            )}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label className="block text-sm font-medium mb-2">Loan Type</label>
              <select value={manualForm.loanType} onChange={(e) => handleManualChange('loanType', e.target.value)} className="w-full px-5 py-4 border rounded-2xl">
                <option value="Purchase">Purchase</option>
                <option value="RefinanceRateTerm">Refinance (Rate & Term)</option>
                <option value="RefinanceCashOut">Refinance (Cash Out)</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                {manualForm.loanType === 'Purchase' ? 'Purchase Price ($)' : 'Property Value ($)'}
              </label>
              <input 
                type="text" 
                value={manualForm.loanType === 'Purchase' ? manualForm.purchasePrice : manualForm.estimatedValue}
                onChange={(e) => {
                  const value = e.target.value;
                  if (manualForm.loanType === 'Purchase') handleManualChange('purchasePrice', value);
                  else handleManualChange('estimatedValue', value);
                }}
                className="w-full px-5 py-4 border rounded-2xl" 
                placeholder="550000" 
              />
            </div>

<div>
  <label className="block text-sm font-medium mb-2">Property Type</label>
  <select 
    value={manualForm.propertyType} 
    onChange={(e) => handleManualChange('propertyType', e.target.value)} 
    className="w-full px-5 py-4 border rounded-2xl"
  >
    <option value="">— Select Property Type —</option>
    {/* Ensure currently-selected / prefilled value is always an option even if not yet in loaded dynamic list (e.g. default 'Single Family' or app prefill) */}
    {manualForm.propertyType && !availablePropertyTypes.includes(manualForm.propertyType) && (
      <option value={manualForm.propertyType}>{manualForm.propertyType}</option>
    )}
    {availablePropertyTypes.map(type => (
      <option key={type} value={type}>
        {type}
      </option>
    ))}
  </select>
  {availablePropertyTypes.length === 0 && (
    <p className="text-[10px] text-gray-500 mt-1">No dynamic property types loaded yet — add keys in the product’s Property Type Adjustment table (or via 🔑 Manage Standard Keys) and refresh.</p>
  )}
</div>

            <div>
              <label className="block text-sm font-medium mb-2">Borrower FICO</label>
              <input type="text" value={manualForm.borrowerFico} onChange={(e) => handleManualChange('borrowerFico', e.target.value)} className="w-full px-5 py-4 border rounded-2xl" placeholder="720" />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Amortization</label>
              <select value={manualForm.amortization} onChange={(e) => handleManualChange('amortization', e.target.value)} className="w-full px-5 py-4 border rounded-2xl">
                <option value="Amortized">Amortized</option>
                <option value="Interest Only">Interest Only</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Rural Property</label>
              <select value={manualForm.rural ? 'Yes' : 'No'} onChange={(e) => handleManualChange('rural', e.target.value === 'Yes')} className="w-full px-5 py-4 border rounded-2xl">
                <option value="No">No</option>
                <option value="Yes">Yes</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Citizenship</label>
              <select value={manualForm.citizenship} onChange={(e) => handleManualChange('citizenship', e.target.value)} className="w-full px-5 py-4 border rounded-2xl">
                <option value="US Citizen">US Citizen</option>
                <option value="Green Card Holder">Green Card Holder</option>
                <option value="Foreign National">Foreign National</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Borrower Name</label>
              <input type="text" value={manualForm.borrowerName} onChange={(e) => handleManualChange('borrowerName', e.target.value)} className="w-full px-5 py-4 border rounded-2xl" placeholder="John Smith" />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Borrower Email</label>
              <input type="email" value={manualForm.borrowerEmail} onChange={(e) => handleManualChange('borrowerEmail', e.target.value)} className="w-full px-5 py-4 border rounded-2xl" placeholder="john@example.com" />
            </div>
{/* Dynamic Rent Type Dropdown - based on product's pricing_matrix */}
<div className="space-y-2">
  <label className="block text-sm font-medium text-gray-700">
    Rent Qualification / Type
  </label>
  <select
    value={manualForm.rentQualification || ''}
    onChange={(e) => handleManualChange('rentQualification', e.target.value)}
    className="w-full px-4 py-3 border border-gray-300 rounded-2xl focus:ring-2 focus:ring-blue-500"
  >
    <option value="">— Select Rent Type —</option>
    {selectedProduct?.pricing_matrix && 
      (() => {
        const matrix = typeof selectedProduct.pricing_matrix === 'string'
          ? JSON.parse(selectedProduct.pricing_matrix)
          : selectedProduct.pricing_matrix || {};
        
        const rentAdj = matrix['Rent Adjustments'] || 
                       matrix['rentAdjustment'] || 
                       matrix['Rent Qualification'] || 
                       matrix['Rent Type Adjustment'] || {};
        
        return Object.keys(rentAdj)
          .sort()
          .map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ));
      })()
    }
  </select>
</div>
            <div>
              <label className="block text-sm font-medium mb-2">Monthly Rent / Gross Rental Income ($)</label>
              <input type="text" value={manualForm.monthlyRent} onChange={(e) => handleManualChange('monthlyRent', e.target.value)} className="w-full px-5 py-4 border rounded-2xl" placeholder="4500" />
            </div>
            

            <div>
              <label className="block text-sm font-medium mb-2">Annual Taxes ($)</label>
              <input type="text" value={taxes} onChange={(e) => setTaxes(e.target.value)} className="w-full px-5 py-4 border rounded-2xl" placeholder="6500" />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Annual Insurance ($)</label>
              <input type="text" value={insurance} onChange={(e) => setInsurance(e.target.value)} className="w-full px-5 py-4 border rounded-2xl" placeholder="2400" />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Annual HOA ($)</label>
              <input type="text" value={hoa} onChange={(e) => setHoa(e.target.value)} className="w-full px-5 py-4 border rounded-2xl" placeholder="0" />
            </div>

            {/* Prepayment Penalty */}
{/* Single Prepayment Dropdown */}
<div>
  <label className="block text-sm font-medium mb-1">Prepayment Penalty</label>
  <select 
    value={manualForm.prepayCanonicalKey || 'None'} 
    onChange={e => handleManualChange('prepayCanonicalKey', e.target.value)}
    className="w-full p-3 border rounded-2xl"
  >
    {/* Always ensure 'None' is present (our setters force it first) */}
    {!availablePrepaymentKeys.includes('None') && (
      <option value="None">None</option>
    )}
    {availablePrepaymentKeys.map(key => (
      <option key={key} value={key}>
        {key}
      </option>
    ))}
  </select>
  {availablePrepaymentKeys.length <= 1 && (
    <p className="text-[10px] text-gray-500 mt-1">No dynamic prepayment keys loaded yet — add rows under "Prepayment Adjustment" in the product (products/[id]/adjustments) or use Manage Standard Keys, then pick the product above.</p>
  )}
</div>

            <div className="md:col-span-3">
              <label className="block text-sm font-medium mb-2">Property Address</label>
              <input 
                type="text" 
                value={manualForm.propertyAddress} 
                onChange={(e) => handleManualChange('propertyAddress', e.target.value)} 
                className="w-full px-5 py-4 border rounded-2xl" 
                placeholder="123 Main Street, Austin, TX 78701" 
              />
            </div>
          </div>
        </div>

      {/* Pricing Mode Banner */}
      <div className={`mb-8 p-4 rounded-2xl text-center font-medium ${isBorrowerUser ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}>
        {isBorrowerUser ? '📌 You are viewing RETAIL rates • Origination Fee shown' : '📌 You are viewing WHOLESALE rates'}
      </div>

   {/* Product Selector - Auto-select first product */}
<div className="mb-8 bg-white border rounded-3xl p-8">
  <label className="block text-sm font-medium mb-3 text-lg">Select Loan Product</label>
  <select 
    value={selectedProduct?.id || ''}
    onChange={(e) => {
      const value = e.target.value;
      if (!value) {
        setSelectedProduct(null);
        return;
      }
      const product = products.find(p => String(p.id) === value);
      console.log('[loans/new] manual product select →', product?.name, 'id:', product?.id);
      try {
        const m = typeof product?.pricing_matrix === 'string' ? JSON.parse(product.pricing_matrix) : (product?.pricing_matrix || {});
        const propK = Object.keys(m['propertyTypeAcquisition'] || m['Property Type Adjustment'] || m['propertyTypeRefi'] || {});
        const prepK = Object.keys(m['Prepayment Adjustment'] || {});
        console.log('[loans/new] manual select matrix keys — prop:', propK.length, propK.slice(0,3), 'prepay:', prepK.length, prepK.slice(0,3));
      } catch {}
      setSelectedProduct(product || null);
      setSelectedRate('');
      setSelectedLTV(0);
    }}
    className="w-full max-w-md border rounded-3xl p-5 text-lg focus:outline-none focus:ring-2 focus:ring-black"
  >
    {products.length === 0 ? (
      <option value="">No products available</option>
    ) : (
      <>
        {/* No empty placeholder - we auto-select */}
        {products.map(p => (
          <option key={p.id} value={p.id}>
            {p.name} {p.loan_type ? `(${p.loan_type})` : ''}
          </option>
        ))}
      </>
    )}
  </select>
</div>
{selectedProduct && (
  <div className="mb-6 p-6 bg-gray-900 text-white rounded-3xl text-sm font-mono">
    <strong>🔍 Debug Info</strong><br />
    Product: {selectedProduct.name}<br />
    FICO: {manualForm.borrowerFico || 'Not set'}<br />
    Purchase Price: ${purchasePrice.toLocaleString()}<br />

    {selectedCellBreakdown ? (
      <div className="mt-4 border-t border-gray-700 pt-4">
        <strong>📊 Selected Cell: {selectedCellBreakdown.rate}% @ {selectedCellBreakdown.ltv}% LTV</strong><br /><br />
        
        Base Rate: {selectedCellBreakdown.baseRate?.toFixed(3)}<br />
        FICO Adjustment: {selectedCellBreakdown.ficoAdj?.toFixed(3)}<br />
        DSCR Adjustment: {selectedCellBreakdown.dscrAdj?.toFixed(3)}<br />
        Loan Balance Adjustment: {selectedCellBreakdown.loanBalanceAdj?.toFixed(3)}<br />
        Property Type Adjustment: {selectedCellBreakdown.propertyAdj?.toFixed(3) || '0.000'}<br />
        Amortization Adjustment: {selectedCellBreakdown.amortizationAdj?.toFixed(3)}<br />
        Prepayment Adjustment: {selectedCellBreakdown.prepaymentAdj?.toFixed(3)}<br />
        Rent Adjustments: {selectedCellBreakdown.rentAdj?.toFixed(3)}<br />
        Other Adjustments: {selectedCellBreakdown.otherAdj?.toFixed(3)}<br />
        
        <strong>────────────────────────────</strong><br />
        Subtotal: {selectedCellBreakdown.subtotal?.toFixed(3)}<br />
        Markup: +{selectedCellBreakdown.markup?.toFixed(3)}<br />
        {selectedCellBreakdown.retailMarkupL2 ? <>Retail Markup (L2 own, from product): -{selectedCellBreakdown.retailMarkupL2?.toFixed(3)}<br /></> : null}
        <strong>Final Price: {selectedCellBreakdown.finalPrice?.toFixed(2)}</strong><br /><br />
        
        Monthly Payment: ${selectedCellBreakdown.monthlyPayment?.toLocaleString() || 'N/A'}<br />
        DSCR: {selectedCellBreakdown.dscr}
      </div>
    ) : (
      <span className="text-yellow-400">Click any eligible cell to see full breakdown here</span>
    )}
  </div>
)}

      {/* Helper Text */}
      {selectedProduct && (
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-2xl text-center">
          <p className="text-blue-700 font-medium">💡 Click on any eligible cell below to generate a Loan Quote for the Borrower</p>
        </div>
      )}

      {/* Pricing Grid */}
      {selectedProduct ? (
        <div className="bg-white border-2 border-black rounded-3xl p-8">
          {console.log('[loans/new] Rendering pricing grid for product:', selectedProduct?.name, 'has matrix?', !!selectedProduct?.pricing_matrix)}
          <h2 className="text-3xl font-bold text-center mb-8">{selectedProduct.name} Pricing Grid</h2>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-gray-100">
                <th className="border p-4 text-left font-semibold">Interest Rate</th>
                {ltvBuckets.map(ltv => {
                  const loanAmt = Math.round(purchasePrice * (ltv / 100));
                  return (
                    <th key={ltv} className="border p-4 text-center font-semibold">
                      {ltv}% LTV<br/>
                      <span className="text-xs font-normal text-gray-600">${loanAmt.toLocaleString()}</span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {interestRates
                .filter(rate => ltvBuckets.some(ltv => getPrice(rate, ltv) !== null))
                .map((rate) => (
                  <tr key={rate}>
                    <td className="border p-4 font-medium bg-gray-50">{rate.toFixed(3)}%</td>
                    {ltvBuckets.map((ltv) => {
                      const price = getPrice(rate, ltv);
                      const dscr = calculateDSCR(rate, ltv);
                      const isEligible = price !== null;
                      const isSelected = selectedRate === rate.toFixed(3) && selectedLTV === ltv;

                      return (
                        <td
                          key={ltv}
                          onClick={() => isEligible && handleCellClick(rate, ltv)}
                          className={`border p-4 text-center cursor-pointer hover:bg-blue-50 transition-colors ${isSelected ? 'bg-blue-100 ring-2 ring-blue-500' : ''} ${!isEligible ? 'bg-red-50' : ''}`}
                        >
                          {isEligible && price !== null ? (
                            <>
                              <div className="font-bold text-lg">{getDisplayValue(rate, ltv)}</div>
                              <div className="text-xs text-gray-600">{dscr.toFixed(2)}x DSCR</div>
                            </>
                          ) : (
                            <div className="text-red-600 text-xs font-medium">Ineligible</div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-white border rounded-3xl p-16 text-center text-xl text-gray-500">
          Select a loan product above to view the pricing grid
        </div>
      )}

      {/* Selected Quotes + Actions */}
      {selectedQuotes.length > 0 && (
        <div className="mt-8 bg-white border rounded-3xl p-6">
          <h3 className="font-semibold mb-4">Selected Quotes ({selectedQuotes.length}/5)</h3>
          <div className="flex flex-wrap gap-3 mb-6">
            {selectedQuotes.map((q, i) => (
              <div key={i} className="bg-gray-100 px-4 py-2 rounded-2xl text-sm">
                {q.productName} — {q.rate}% @ {q.ltv}% LTV → {q.displayPrice}
              </div>
            ))}
          </div>

          <div className="flex gap-4">
            <button onClick={sendQuoteToBorrower} className="flex-1 px-8 py-4 bg-green-600 hover:bg-green-700 text-white rounded-3xl font-semibold">
              📧 Send Quote to Borrower
            </button>
            <button onClick={saveQuoteAndStartApplication} className="flex-1 px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-3xl font-semibold">
              💾 Save Quote & Start Full Application →
            </button>
            <button onClick={createLoanDirect} className="flex-1 px-8 py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-3xl font-semibold">
              🏦 Create Loan + Request Title/Insurance Docs
            </button>
          </div>
        </div>
      )}

      {/* Prompt to create application */}
      {!application && selectedRate && (
        <div className="mt-8 p-6 bg-amber-50 border border-amber-300 rounded-3xl text-center">
          <p className="font-medium">Great choice! To lock this rate, please complete the full application.</p>
          <button onClick={() => router.push('/loan-application')} className="mt-4 px-8 py-4 bg-amber-600 text-white rounded-3xl font-semibold">
            Start Full Application →
          </button>
        </div>
      )}
    </div>
  );
}

export default function NewLoanPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-xl">Loading...</div>}>
      <NewLoanContent />
    </Suspense>
  );
}

export const dynamic = 'force-dynamic';
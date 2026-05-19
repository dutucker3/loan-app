'use client';

import { useState, useEffect } from 'react';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PDFDownloadLink } from '@react-pdf/renderer';
import { LoanApplicationPDF } from '@/components/LoanApplicationPDF';
import { useUser, useOrganization } from '@clerk/nextjs';
import { isBorrower } from '@/lib/permissions';
import { supabase as supabaseLib } from '@/lib/supabase'; // fallback import if needed

function NewLoanContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useUser();
  const { organization: clerkOrg } = useOrganization();
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

  const [currentUserRole, setCurrentUserRole] = useState<string>('BROKER_AE');
  const [organization, setOrganization] = useState<any>(null);
  const [supabaseClient, setSupabaseClient] = useState<any>(null);
 const [adjustmentKeys, setAdjustmentKeys] = useState<any[]>([]);
  const isBorrowerUser = isBorrower({ id: user?.id || '', role: currentUserRole });

  // Load Supabase client
  useEffect(() => {
    import('@/lib/supabase').then(({ supabase: client }) => setSupabaseClient(client));
  }, []);

  // Load user role + organization
  useEffect(() => {
    if (!user || !supabaseClient) return;
    const loadUserAndOrg = async () => {
      const { data: userData } = await supabaseClient.from('users').select('role, organization_id').eq('id', user.id).single();
      setCurrentUserRole(userData?.role || 'BROKER_AE');
      if (userData?.organization_id) {
        const { data: org } = await supabaseClient.from('organizations').select('wholesale_markup, retail_markup, name').eq('id', userData.organization_id).single();
        setOrganization(org);
      }
    };
    loadUserAndOrg();
  }, [user, supabaseClient]);

  // Load Products
  useEffect(() => {
    if (!supabaseClient || !user) return;

    const loadProducts = async () => {
      let query = supabaseClient.from('loan_products').select('*').order('created_at', { ascending: false });

      if (clerkOrg?.id) {
        const { data: orgData } = await supabaseClient.from('organizations').select('id').eq('clerk_org_id', clerkOrg.id).single();
        if (orgData?.id) query = query.eq('organization_id', orgData.id);
      }

      const { data: prods } = await query;
      setProducts(prods || []);
      if (prods?.length && !selectedProduct) {
        setSelectedProduct(prods[0]);
      }
    };

    loadProducts();
  }, [supabaseClient, user, clerkOrg]);

   // Fetch available standard prepayment keys from adjustment_keys table
  // Load application if ?id=  (existing effect)
  useEffect(() => {
    if (!appId || !supabaseClient) return;
    // ... existing code
  }, [appId, supabaseClient]);

  useEffect(() => {
    if (!appId) setLoading(false);
  }, [appId]);

  // ====================== NEW: LOAD ADJUSTMENT KEYS ======================
  // Load keys (after products load)
  useEffect(() => {
    if (!supabaseClient || !selectedProduct?.organization_id) return;

    const loadKeys = async () => {
      const { data, error } = await supabaseClient
        .from('adjustment_keys')
        .select('*')
        .eq('organization_id', selectedProduct.organization_id)
        .or('adjustment_type.eq.property_type,adjustment_type.eq.prepayment');

      if (error) {
        console.error('Failed to load adjustment keys:', error);
        return;
      }

      setAdjustmentKeys(data || []);
    };

    loadKeys();
  }, [supabaseClient, selectedProduct?.organization_id]);   // Note: use organization_id only

  // Fetch dynamic Property Type keys from adjustment_keys table
  useEffect(() => {
    const fetchPropertyTypes = async () => {
      if (!supabaseClient || !selectedProduct?.organization_id) return;

      const { data } = await supabaseClient
        .from('adjustment_keys')
        .select('canonical_key')
        .eq('adjustment_type', 'Property Type Adjustment')
        .eq('organization_id', selectedProduct.organization_id);

      const keys = data?.map((k: any) => k.canonical_key) || [];
      setAvailablePropertyTypes(keys.sort((a: string, b: string) => a.localeCompare(b)));
    };

    fetchPropertyTypes();
  }, [supabaseClient, selectedProduct]);

  // Load application if ?id=
  useEffect(() => {
    if (!appId || !supabaseClient) return;
    const loadApplication = async () => {
      setLoading(true);
      const { data: app } = await supabaseClient.from('loan_applications').select('*').eq('id', appId).single();
      if (app) {
        setApplication(app);
        if (app.form_data) {
          setManualForm(prev => ({
            ...prev,
            ...app.form_data,
            monthlyRent: app.form_data.monthlyRent || app.form_data.rentalIncome || prev.monthlyRent,
          }));
          setTaxes(app.form_data.annualTaxes || '');
          setInsurance(app.form_data.annualInsurance || '');
          setHoa(app.form_data.annualHoa || '');
        }
      }
      setLoading(false);
    };
    loadApplication();
  }, [appId, supabaseClient]);

  useEffect(() => {
    if (!appId) setLoading(false);
  }, [appId]);

 
  // ====================== HANDLERS ======================
  const handleManualChange = (field: string, value: any) => {
    setManualForm(prev => ({ ...prev, [field]: value }));
  };

  const formData = application ? (application.form_data || {}) : manualForm;
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

  const getFinalPrice = (basePrice: number | null): number | null => {
    if (basePrice === null) return null;
    let final = basePrice + getMarkup();

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

  // ====================== UPDATED getBrokerPrice ======================
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

    let runningTotal = price;

    const breakdown: any = {
      baseRate: price,
      ficoAdj: safeParse((matrix['ficoLtvGrid'] || matrix['FICO Adjustment'] || {})[getFicoBucket(fico)]?.[ltvKey]),
      dscrAdj: safeParse((matrix['DSCR Adjustment'] || matrix['dscrLtvGrid'] || {})[getDscrBucket(dscr, fico, isPurchase)]?.[ltvKey]),
      loanBalanceAdj: safeParse((matrix['loanBalanceLtvGrid'] || matrix['Loan Balance Adjustment'] || {})[getLoanSizeBucket(cellLoanAmount)]?.[ltvKey]),
      propertyAdj: 0,
      amortizationAdj: safeParse((matrix['amortizationAdjustment'] || matrix['Amortization Adjustment'] || {})[manualForm.amortization] || 
                                (matrix['amortizationAdjustment'] || matrix['Amortization Adjustment'] || {})['Fully Amortizing']),
      prepaymentAdj: 0,
      rentAdj: safeParse((matrix['Rent Adjustments'] || {})[rentType]?.[ltvKey]),
      otherAdj: safeParse((matrix['Other Adjustments'] || matrix['otherAdjustments'] || {})['Standard']?.[ltvKey]),
      markup: 0,
      subtotal: 0,
      finalPrice: 0
    };

    // Property Type
    const matrixPropKey = getPropertyTypeMatrixKey(propertyType);
    const propMatrix = matrix['propertyTypeAdjustment'] || matrix['Property Type Adjustment'] || 
                       matrix['propertyTypeRefi'] || matrix['propertyTypeAcquisition'] || {};
    const propertyAdj = safeParse(propMatrix[matrixPropKey]?.[ltvKey] || propMatrix[matrixPropKey]);
    breakdown.propertyAdj = propertyAdj;
    runningTotal += propertyAdj;

    if (debug) {
      console.log("Property Type Adjustment".padEnd(45) + propertyAdj.toFixed(3) + `  (Mapped: "${propertyType}" → "${matrixPropKey}")`);
    }

    // Prepayment - NEW CANONICAL KEY
    let prepayAdj = 0;
    const prepayLabel = getPrepaymentCanonicalKey();

    if (prepayLabel !== 'None') {
      const prepayMatrix = matrix['Prepayment Adjustment'] || {};
      prepayAdj = safeParse(prepayMatrix[prepayLabel]?.[ltvKey] || '0');

      if (debug) {
        console.log("Prepayment Adjustment".padEnd(45) + prepayAdj.toFixed(3) + `  (Canonical: "${prepayLabel}")`);
      }
    } else if (debug) {
      console.log("Prepayment Adjustment".padEnd(45) + "0.000  (None)");
    }

    breakdown.prepaymentAdj = prepayAdj;
    runningTotal += prepayAdj;

    // Final Totals
    breakdown.subtotal = runningTotal =
      breakdown.baseRate + breakdown.ficoAdj + breakdown.dscrAdj + breakdown.loanBalanceAdj +
      breakdown.propertyAdj + breakdown.amortizationAdj + breakdown.prepaymentAdj +
      breakdown.rentAdj + breakdown.otherAdj;

    breakdown.markup = getMarkup();
    breakdown.finalPrice = getFinalPrice(breakdown.subtotal);

    if (debug) {
      console.log("─".repeat(65));
      console.log("SUBTOTAL (Base + All Adjustments)".padEnd(45) + breakdown.subtotal.toFixed(3));
      console.log("Markup / Margin".padEnd(45) + breakdown.markup.toFixed(3));
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

  // ====================== REST OF YOUR CODE (unchanged) ======================
  const sendQuoteToBorrower = async () => { /* your existing code */ };
  const saveQuoteAndStartApplication = async () => { /* your existing code */ };

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

      {/* MANUAL INPUT FORM */}
      {!application && (
        <div className="bg-white border rounded-3xl p-8 mb-10">
          <h2 className="text-2xl font-semibold mb-6">Loan Details</h2>
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
    {availablePropertyTypes.map(type => (
      <option key={type} value={type}>
        {type}
      </option>
    ))}
  </select>
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
    {availablePrepaymentKeys.map(key => (
      <option key={key} value={key}>
        {key}
      </option>
    ))}
  </select>
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
      )}

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
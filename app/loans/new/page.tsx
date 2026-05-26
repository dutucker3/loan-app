'use client';

import { useState, useEffect, useMemo } from 'react';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PDFDownloadLink } from '@react-pdf/renderer';
import { LoanApplicationPDF } from '@/components/LoanApplicationPDF';
import { useUser } from '@clerk/nextjs';
import { supabase } from '@/lib/supabase';
import { isBorrower } from '@/lib/permissions';

function NewLoanContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useUser();
  const appId = searchParams.get('id');

  const [application, setApplication] = useState<any>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [selectedRate, setSelectedRate] = useState<string>('');
  const [selectedLTV, setSelectedLTV] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCellBreakdown, setSelectedCellBreakdown] = useState<any>(null);
  const [adjustmentKeys, setAdjustmentKeys] = useState<any[]>([]);

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
    prepayCanonicalKey: 'None',
  });

  const [selectedQuotes, setSelectedQuotes] = useState<any[]>([]);
  const [taxes, setTaxes] = useState('');
  const [insurance, setInsurance] = useState('');
  const [hoa, setHoa] = useState('');

  const [currentUserRole, setCurrentUserRole] = useState<string>('BROKER_AE');
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [orgMarkup, setOrgMarkup] = useState<{ wholesale: number; retail: number }>({ wholesale: 0, retail: 0 });
  const [brokerMarkup, setBrokerMarkup] = useState<number>(0);

  const isBorrowerUser = isBorrower({ id: user?.id || '', role: currentUserRole });

  // ====================== LOAD USER + MARKUPS ======================
  useEffect(() => {
    if (!user) return;

    const loadUserAndMarkups = async () => {
      const { data: userData } = await supabase
        .from('users')
        .select('role, organization_id')
        .eq('id', user.id)
        .single();

      if (userData) {
        setCurrentUserRole(userData.role || 'BROKER_AE');
        setOrganizationId(userData.organization_id);

        if (userData.organization_id) {
          // Load Organization Markups
          const { data: orgMarkups } = await supabase
            .from('pricing_markups')
            .select('markup_type, value')
            .eq('organization_id', userData.organization_id)
            .eq('broker_id', null);

          const orgData = { wholesale: 0, retail: 0 };
          (orgMarkups || []).forEach((m: any) => {
            if (m.markup_type === 'wholesale') orgData.wholesale = Number(m.value);
            if (m.markup_type === 'retail') orgData.retail = Number(m.value);
          });
          setOrgMarkup(orgData);

          // Load Broker-specific Retail Markup
          if (!isBorrowerUser && userData.role !== 'BORROWER') {
            const { data: brokerMarkupData } = await supabase
              .from('pricing_markups')
              .select('value')
              .eq('broker_id', user.id)
              .eq('markup_type', 'retail')
              .single();

            setBrokerMarkup(brokerMarkupData ? Number(brokerMarkupData.value) : 0);
          }
        }
      }
    };

    loadUserAndMarkups();
  }, [user, isBorrowerUser]);

  // ====================== LOAD PRODUCTS ======================
  useEffect(() => {
    if (!user) return;

    const loadProducts = async () => {
      setLoading(true);
      let query = supabase.from('loan_products').select('*').eq('active', true);

      const { data: userData } = await supabase
        .from('users')
        .select('organization_id')
        .eq('id', user.id)
        .single();

      if (userData?.organization_id && !['SUPER_ADMIN'].includes(userData.role)) {
        query = query.eq('organization_id', userData.organization_id);
      }

      const { data } = await query;
      setProducts(data || []);
      if (data?.length > 0) setSelectedProduct(data[0]);
      setLoading(false);
    };

    loadProducts();
  }, [user]);

  // Load Adjustment Keys
  useEffect(() => {
    if (!supabase || !selectedProduct?.organization_id) return;

    const loadKeys = async () => {
      const { data } = await supabase
        .from('adjustment_keys')
        .select('*')
        .eq('organization_id', selectedProduct.organization_id);
      setAdjustmentKeys(data || []);
    };

    loadKeys();
  }, [selectedProduct?.organization_id]);

  // Load existing application
  useEffect(() => {
    if (!appId) return;

    const loadApplication = async () => {
      const { data: app } = await supabase
        .from('loan_applications')
        .select('*')
        .eq('id', appId)
        .single();

      if (app) {
        setApplication(app);
        if (app.form_data) {
          setManualForm(prev => ({ ...prev, ...app.form_data }));
        }
      }
    };

    loadApplication();
  }, [appId]);

  // Form persistence
  useEffect(() => {
    const saved = localStorage.getItem('loanFormDraft');
    if (saved) {
      const parsed = JSON.parse(saved);
      setManualForm(parsed.manualForm || manualForm);
      setTaxes(parsed.taxes || '');
      setInsurance(parsed.insurance || '');
      setHoa(parsed.hoa || '');
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('loanFormDraft', JSON.stringify({
      manualForm,
      taxes,
      insurance,
      hoa
    }));
  }, [manualForm, taxes, insurance, hoa]);

  const handleManualChange = (field: string, value: any) => {
    setManualForm(prev => ({ ...prev, [field]: value }));
  };

  const formData = application ? (application.form_data || {}) : manualForm;
  const purchasePrice = parseFloat((formData.purchasePrice || formData.estimatedValue || '0').replace(/,/g, '')) || 0;

  // ====================== MARKUP LOGIC ======================
  const getTotalMarkup = (): number => {
    const baseOrgMarkup = isBorrowerUser ? orgMarkup.retail : orgMarkup.wholesale;
    const additionalBrokerMarkup = brokerMarkup; // only applies on top for brokers
    return baseOrgMarkup + additionalBrokerMarkup;
  };

  const getFinalPrice = (subtotal: number): number => {
    if (!subtotal || isNaN(subtotal)) return 0;

    let final = subtotal - getTotalMarkup();

    const matrix = selectedProduct?.pricing_matrix || {};
    const markupObj = matrix.markup || matrix.Markup?.markup || matrix.Markup?.Markup?.markup || {};

    const floor = isBorrowerUser 
      ? (markupObj.retailPriceFloor ?? 97) 
      : (markupObj.wholesalePriceFloor ?? 97);

    const ceiling = isBorrowerUser 
      ? (markupObj.retailPriceCeiling ?? 100) 
      : (markupObj.wholesalePriceCeiling ?? 102);

    final = Math.max(final, floor);
    final = Math.min(final, ceiling);

    if (final >= 103) return 0;
    if (final >= 102.01) final = 102;
    if (final < 96) final = 96;

    return Math.round(final * 100) / 100;
  };

  // ====================== EXISTING HELPERS (UNCHANGED) ======================
  const getPrepaymentCanonicalKey = (): string => manualForm.prepayCanonicalKey || 'None';

  const getAliasesForKey = (canonicalKey: string, adjustmentType: string): string[] => {
    if (!canonicalKey || !adjustmentKeys.length) return [canonicalKey];

    const keyRow = adjustmentKeys.find(k => 
      k.canonical_key?.trim() === canonicalKey?.trim() && 
      k.adjustment_type === adjustmentType
    );

    if (!keyRow) return [canonicalKey];

    let aliases: string[] = [canonicalKey];

    if (keyRow.aliases) {
      try {
        let parsed: any = keyRow.aliases;
        if (typeof parsed === 'string') parsed = JSON.parse(parsed);
        if (Array.isArray(parsed)) {
          aliases = [...new Set([canonicalKey, ...parsed.map((a: any) => String(a).trim())])];
        }
      } catch (e) {
        console.warn(`Failed to parse aliases for "${canonicalKey}"`);
      }
    }
    return aliases;
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
    if (dscr >= 1.15) return '1.15x - 1.24x';
    if (dscr >= 1.00) return '1.00x - 1.14x';
    if (dscr >= 0.75) return '0.75x - 0.99x';
    return '<0.75x';
  };

  const getLoanSizeBucket = (amount: number): string => {
    if (amount <= 125000) return '$100,001 - $125,000';
    if (amount <= 150000) return '$125,001 - $150,000';
    if (amount <= 250000) return '$150,001 - $250,000';
    if (amount <= 400000) return '$250,001 - $400,000';
    if (amount <= 500000) return '$400,001 - $500,000';
    if (amount <= 750000) return '$500,001 - $750,000';
    if (amount <= 1000000) return '$750,001 - $1,000,000';
    if (amount <= 1500000) return '$1,000,001 - $1,500,000';
    if (amount <= 2000000) return '$1,500,001 - $2,000,000';
    if (amount <= 2500000) return '$2,000,001 - $2,500,000';
    if (amount <= 3000000) return '$2,500,001 - $3,000,000';
    return '$3,000,001+';
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

  const interestRates = Array.from({ length: 57 }, (_, i) => parseFloat((5.0 + i * 0.125).toFixed(3)));

  const ltvBuckets = [50, 55, 60, 65, 70, 75, 80];

  // ====================== UPDATED PRICING LOGIC ======================
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

    const ltvKey = getLtvBucket(ltv);
    const fico = parseFloat(manualForm.borrowerFico || '720');
    const dscr = calculateDSCR(rate, ltv);
    const isPurchase = manualForm.loanType === 'Purchase';
    const cellLoanAmount = purchasePrice * (ltv / 100);

    const safeParse = (val: any): number => isNaN(parseFloat(val)) ? 0 : parseFloat(val);

    const baseRates = matrix['baseRates'] || matrix['Base Rate'] || {};
    const rateKey4 = rate.toFixed(4);
    const rateKey3 = rate.toFixed(3);
    
    let baseRate = parseFloat(
      baseRates[rateKey4] || baseRates[rateKey3] || baseRates[rate] || baseRates[rate.toString()] || '0'
    );

    let runningTotal = baseRate;

    const breakdown: any = {
      baseRate,
      ficoAdj: 0, dscrAdj: 0, loanBalanceAdj: 0,
      propertyAdj: 0, amortizationAdj: 0, prepaymentAdj: 0,
      rentAdj: 0, otherAdj: 0,
      markup: 0, subtotal: 0, finalPrice: 0
    };

    const dynamicAdjustments = [
      { key: 'ficoAdj', canonical: getFicoBucket(fico), matrixKey: 'FICO Adjustment' },
      { key: 'dscrAdj', canonical: getDscrBucket(dscr, fico, isPurchase), matrixKey: 'DSCR Adjustment' },
      { key: 'loanBalanceAdj', canonical: getLoanSizeBucket(cellLoanAmount), matrixKey: 'loanBalanceLtvGrid' },
      { key: 'propertyAdj', canonical: manualForm.propertyType || 'Single Family', matrixKey: 'propertyTypeRefi' },
      { key: 'amortizationAdj', canonical: manualForm.amortization || 'Fully Amortizing', matrixKey: 'Amortization Adjustment' },
      { key: 'prepaymentAdj', canonical: getPrepaymentCanonicalKey(), matrixKey: 'Prepayment Adjustment' },
      { key: 'rentAdj', canonical: manualForm.rentQualification || 'LTR: In-Place/Market Rent', matrixKey: 'Rent Adjustments' },
      { key: 'otherAdj', canonical: 'Rural', matrixKey: 'Other Adjustments' },
    ];

    dynamicAdjustments.forEach(({ key, canonical, matrixKey }) => {
      if (!canonical || canonical === 'None') return;

      let adjMatrix = matrix[matrixKey] || {};
      let adjValue = 0;

      const aliases = getAliasesForKey(canonical, matrixKey);
      for (const alias of aliases) {
        const value = adjMatrix[alias]?.[ltvKey] || adjMatrix[alias];
        adjValue = safeParse(value);
        if (adjValue !== 0) break;
      }

      breakdown[key] = adjValue;
      runningTotal += adjValue;
    });

    // NEW LAYERED MARKUP
    breakdown.markup = getTotalMarkup();
    runningTotal -= breakdown.markup;

    breakdown.subtotal = runningTotal;
    breakdown.finalPrice = getFinalPrice(runningTotal);

    if (debug) {
      console.log("=== PRICING BREAKDOWN ===");
      console.log("Base Rate:", baseRate.toFixed(3));
      Object.keys(breakdown).forEach(k => {
        if (k !== 'baseRate' && k !== 'subtotal' && k !== 'finalPrice') {
          console.log(k.padEnd(20), (breakdown[k] || 0).toFixed(3));
        }
      });
      console.log("Total Markup:", breakdown.markup.toFixed(3));
      console.log("Final Price:", breakdown.finalPrice.toFixed(3));
    }

    return debug ? breakdown : breakdown.finalPrice;
  };

  const getPrice = (rate: number, ltv: number): number | null => {
    const result = getBrokerPrice(rate, ltv, false);
    const finalPrice = typeof result === 'number' ? result : (result?.finalPrice || 0);

    if (finalPrice < 96 || finalPrice > 102) return null;
    return finalPrice;
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
    if (!breakdown || typeof breakdown === 'number') return;

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

  const isFicoEligible = () => {
    const fico = parseFloat(manualForm.borrowerFico || '720');
    return fico >= 620;
  };

  const isFicoLtvEligible = (rate: number, ltv: number): boolean => true; // placeholder - expand as needed
  const isDscrEligible = (rate: number, ltv: number): boolean => true;   // placeholder

  const availableRates = useMemo(() => {
    if (!selectedProduct?.pricing_matrix) return [];
    return interestRates.filter(rate => 
      ltvBuckets.some(ltv => getPrice(rate, ltv) !== null)
    );
  }, [selectedProduct, manualForm.borrowerFico]);

  const sendQuoteToBorrower = async () => {
    alert("Quote sent to borrower! (placeholder)");
  };

  const saveQuoteAndStartApplication = async () => {
    alert("Quote saved! (placeholder)");
  };

  if (error) return <div className="p-10 text-red-600 text-center text-xl">Error: {error}</div>;
  if (loading) return <div className="p-10 text-center text-xl">Loading products and pricing matrix...</div>;

  return (
    <div className="max-w-7xl mx-auto p-8">
      <div className="flex items-center justify-between mb-8 border-b pb-6">
        <button onClick={() => router.push('/dashboard')} className="flex items-center gap-2 px-6 py-3 bg-gray-100 hover:bg-gray-200 rounded-2xl font-medium text-lg">
          ← Back to Dashboard
        </button>

        <h1 className="text-4xl font-bold text-center flex-1">
          {isBorrowerUser ? 'Retail Pricing Matrix' : 'Wholesale Pricing Matrix'}
        </h1>

        <PDFDownloadLink document={<LoanApplicationPDF form={formData} />} fileName={`Quote-${formData.propertyAddress || 'NewLoan'}.pdf`}>
          {({ loading }) => (
            <button className="px-8 py-4 bg-blue-600 text-white rounded-3xl font-medium hover:bg-blue-700">
              {loading ? 'Generating PDF...' : '📄 Download PDF'}
            </button>
          )}
        </PDFDownloadLink>
      </div>

      <div className={`mb-8 p-4 rounded-2xl text-center font-medium ${isBorrowerUser ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}>
        {isBorrowerUser 
          ? '📌 You are viewing RETAIL rates' 
          : `📌 Wholesale View • Total Markup Applied: ${getTotalMarkup().toFixed(2)}%`}
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
                value={manualForm.propertyType || ''} 
                onChange={(e) => handleManualChange('propertyType', e.target.value)}
                className="w-full px-5 py-4 border rounded-2xl"
              >
                <option value="">— Select Property Type —</option>
                {adjustmentKeys
                  .filter(k => k.adjustment_type === 'Property Type Adjustment')
                  .map(key => (
                    <option key={key.canonical_key} value={key.canonical_key}>
                      {key.display_name}
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

            <div>
              <label className="block text-sm font-medium mb-2">Rent Qualification</label>
              <select 
                value={manualForm.rentQualification || ''} 
                onChange={(e) => handleManualChange('rentQualification', e.target.value)}
                className="w-full px-5 py-4 border rounded-2xl"
              >
                <option value="">— Select Rent Method —</option>
                {adjustmentKeys
                  .filter(k => k.adjustment_type === 'Rent Adjustments')
                  .map(key => (
                    <option key={key.canonical_key} value={key.canonical_key}>
                      {key.display_name}
                    </option>
                  ))}
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

            <div>
              <label className="block text-sm font-medium mb-2">Prepayment Penalty</label>
              <select 
                value={manualForm.prepayCanonicalKey || ''} 
                onChange={(e) => handleManualChange('prepayCanonicalKey', e.target.value)}
                className="w-full px-5 py-4 border rounded-2xl"
              >
                <option value="">— Select Prepayment —</option>
                {adjustmentKeys
                  .filter(k => k.adjustment_type === 'Prepayment Adjustment')
                  .map(key => (
                    <option key={key.canonical_key} value={key.canonical_key}>
                      {key.display_name}
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

      {/* Product Selector */}
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
            products.map(p => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))
          )}
        </select>
      </div>
{/* Pricing Breakdown */}
{selectedProduct && selectedCellBreakdown && (
  <div className="mb-8 bg-white border rounded-3xl p-8">
    <h3 className="text-2xl font-semibold mb-6">Pricing Breakdown</h3>
    <div className="space-y-3 text-sm">
      <div className="flex justify-between py-2 border-b">
        <span>Base Rate</span>
        <span className="font-medium">{selectedCellBreakdown.baseRate?.toFixed(3)}</span>
      </div>
      <div className="flex justify-between py-2 border-b">
        <span>FICO Adjustment</span>
        <span className="font-medium">{selectedCellBreakdown.ficoAdj?.toFixed(3)}</span>
      </div>
      <div className="flex justify-between py-2 border-b">
        <span>DSCR Adjustment</span>
        <span className="font-medium">{selectedCellBreakdown.dscrAdj?.toFixed(3)}</span>
      </div>
      <div className="flex justify-between py-2 border-b">
        <span>Loan Balance Adjustment</span>
        <span className="font-medium">{selectedCellBreakdown.loanBalanceAdj?.toFixed(3)}</span>
      </div>
      <div className="flex justify-between py-2 border-b">
        <span>Property Type Adjustment</span>
        <span className="font-medium">{selectedCellBreakdown.propertyAdj?.toFixed(3)}</span>
      </div>
      <div className="flex justify-between py-2 border-b">
        <span>Amortization Adjustment</span>
        <span className="font-medium">{selectedCellBreakdown.amortizationAdj?.toFixed(3)}</span>
      </div>
      <div className="flex justify-between py-2 border-b">
        <span>Prepayment Adjustment</span>
        <span className="font-medium">{selectedCellBreakdown.prepaymentAdj?.toFixed(3)}</span>
      </div>
      <div className="flex justify-between py-2 border-b">
        <span>Rent Adjustment</span>
        <span className="font-medium">{selectedCellBreakdown.rentAdj?.toFixed(3)}</span>
      </div>
      <div className="flex justify-between py-2 border-b">
        <span>Markup / Margin</span>
        <span className="font-medium text-green-600">-{selectedCellBreakdown.markup?.toFixed(3)}</span>
      </div>

      <div className="flex justify-between py-4 border-t-2 border-black text-lg font-bold">
        <span>Final Price</span>
        <span>{selectedCellBreakdown.finalPrice?.toFixed(2)}</span>
      </div>
    </div>
  </div>
)}

{/* FICO Warning */}
{selectedProduct && !isFicoEligible() && (
  <div className="mb-8 p-6 bg-red-50 border border-red-200 rounded-3xl text-center">
    <p className="text-red-700 font-medium">
      Borrower FICO ({manualForm.borrowerFico || '—'}) is too low for this product.<br />
      Minimum required FICO is typically 660+.
    </p>
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
        {availableRates.map((rate) => (
            <tr key={rate}>
            <td className="border p-4 font-medium bg-gray-50">{rate.toFixed(3)}%</td>
          {ltvBuckets.map((ltv) => {
  const price = getPrice(rate, ltv);
  const dscr = calculateDSCR(rate, ltv);
  
  // NEW FICO + DSCR Eligibility Check
  const ficoLtvOk = isFicoLtvEligible(rate, ltv);
  const dscrOk = isDscrEligible(rate, ltv);
  const isEligible = price !== null && ficoLtvOk && dscrOk;

  return (
    <td
      key={ltv}
      onClick={() => isEligible && handleCellClick(rate, ltv)}
      className={`border p-4 text-center cursor-pointer hover:bg-blue-50 transition-colors ${!isEligible ? 'bg-red-50' : ''}`}
    >
      {isEligible ? (
        <>
          <div className="font-bold text-lg">{getDisplayValue(rate, ltv)}</div>
          <div className="text-xs text-gray-600">{dscr.toFixed(2)}x DSCR</div>
        </>
      ) : (
        <div className="text-red-600 text-xs font-medium">
          Ineligible
          <br />
          <span className="text-[10px] opacity-75">
            {dscr.toFixed(2)}x DSCR
          </span>
        </div>
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
  // ... your existing no product messag
        <div className="bg-white border rounded-3xl p-16 text-center text-xl text-gray-500">
          Select a loan product above to view the pricing grid
        </div>
      )}

      {/* Selected Quotes */}
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
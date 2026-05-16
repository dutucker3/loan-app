'use client';

import { useState, useEffect } from 'react';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PDFDownloadLink } from '@react-pdf/renderer';
import { LoanApplicationPDF } from '@/components/LoanApplicationPDF';
import { useUser } from '@clerk/nextjs';
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
  const [loanAmount, setLoanAmount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // New: User role and organization for pricing
  const [currentUserRole, setCurrentUserRole] = useState<string>('BROKER_AE');
  const [organization, setOrganization] = useState<any>(null);

  const isBorrowerUser = isBorrower({ id: user?.id || '', role: currentUserRole });

  // Pricing controls
  const [propertyType, setPropertyType] = useState<string>('SFR');
  const [interestOnly, setInterestOnly] = useState<boolean>(false);
  const [prepaymentPenalty, setPrepaymentPenalty] = useState<string>('O(360)');
  const [rentQualification, setRentQualification] = useState<string>('Long Term Rental (LTR)');

  // PDF data
  const [form, setForm] = useState<any>({});
  const [borrowers, setBorrowers] = useState<any[]>([]);
  const [rentRoll, setRentRoll] = useState<any[]>([]);
  const [owners, setOwners] = useState<any[]>([]);

  const [supabase, setSupabase] = useState<any>(null);

  useEffect(() => {
    import('@/lib/supabase').then(({ supabase: client }) => {
      setSupabase(client);
    });
  }, []);

  // Load user role + organization markup
  useEffect(() => {
    if (!user || !supabase) return;

    const loadUserAndOrg = async () => {
      const { data: userData } = await supabase
        .from('users')
        .select('role, organization_id')
        .eq('id', user.id)
        .single();

      const role = userData?.role || 'BROKER_AE';
      setCurrentUserRole(role);

      if (userData?.organization_id) {
        const { data: org } = await supabase
          .from('organizations')
          .select('wholesale_markup, retail_markup, name')
          .eq('id', userData.organization_id)
          .single();
        setOrganization(org);
      }
    };

    loadUserAndOrg();
  }, [user, supabase]);

  useEffect(() => {
    if (!appId || !supabase) return;

    const loadData = async () => {
      setLoading(true);
      setError(null);
      try {
        const [{ data: app, error: appError }, { data: prods, error: prodError }] = await Promise.all([
          supabase.from('loan_applications').select('*').eq('id', appId).single(),
          supabase.from('loan_products').select('*').order('created_at', { ascending: false })
        ]);

        if (appError) throw appError;
        if (prodError) throw prodError;

        if (app) {
          setApplication(app);
          setForm(app.form_data || {});
          setBorrowers(app.borrowers || []);
          setRentRoll(app.form_data?.rentRoll || []);
          setOwners(app.form_data?.owners || []);

          if (app.form_data?.loanAmount) {
            setLoanAmount(parseFloat(app.form_data.loanAmount.replace(/,/g, '')) || 0);
          }
        }

        setProducts(prods || []);

        if (prods && prods.length > 0) {
          setSelectedProduct(prods[0]);
        }
      } catch (err: any) {
        console.error(err);
        setError(err.message || 'Failed to load data');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [appId, supabase]);

  // ====================== MARKUP + RETAIL LOGIC ======================
  const getMarkup = () => {
    if (!organization) return 0;
    return isBorrowerUser 
      ? (organization.retail_markup || 0) 
      : (organization.wholesale_markup || 0);
  };

  const getFinalPrice = (basePrice: number | null): number | null => {
    if (basePrice === null) return null;
    let final = basePrice + getMarkup();

    if (isBorrowerUser) {
      final = Math.min(final, 100.00); // Retail cap
    }

    if (final > 103.00) return null;
    if (final >= 102.01) final = 102.00;
    if (final < 96.00) return null;
    if (final >= 96.00 && final < 97.00) final = 97.00;

    return Math.floor(final * 100) / 100;
  };

  // ====================== YOUR ORIGINAL HELPERS (kept fully intact) ======================
  const purchasePrice = parseFloat((form.estimatedValue || '0').replace(/,/g, '')) || 0;
  const requestedLTV = parseFloat(form.ltv || '0');
  const annualRent = parseFloat((form.rentalIncome || '0').replace(/,/g, '')) || 0;
  const annualTaxes = parseFloat((form.taxes || '0').replace(/,/g, '')) || 0;
  const annualInsurance = parseFloat((form.insurance || '0').replace(/,/g, '')) || 0;
  const annualHOA = parseFloat((form.hoa || '0').replace(/,/g, '')) || 0;
  const annualExpense = annualTaxes + annualInsurance + annualHOA;

  const propertyTypeOptions = [
    'SFR', 'Condo - Warrantable', 'Condo - Non-Warrantable', 
    'Condotel', '2-4 Unit', '5-10 Unit', 'Mixed Use (2-8 units)', 
    'Portfolio – SFR or 2-4 Unit'
  ];

  const prepaymentOptions = [
    '5%(60),O(300)', '5%(48),O(312)', '5%(36),O(324)', '5%(24),O(336)',
    '5%(12),O(348)', '5%(12),4%(12),3%(12),2%(12),1%(12),O(300)',
    '4%(12),3%(12),2%(12),1%(12),O(312)', '3%(12),2%(12),1%(12),O(324)',
    '2%(12),1%(12),O(336)', '1%(12),O(348)', 'O(360)'
  ];

  const interestRates = Array.from({ length: 57 }, (_, i) => parseFloat((5.0 + i * 0.125).toFixed(3)));
  const ltvBuckets = [50, 55, 60, 65, 70, 75, 80];

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
    if (dscr >= 1.15) return '>=1.15x and <1.25x';
    if (dscr >= 1.00) return '>=1.00x and <1.15x';
    
    if (dscr >= 0.95 && fico >= 720) {
      return isPurchase ? '0.95-0.99x (Purch, 720+ FICO)' : '0.95-0.99x (Refi, 720+ FICO)';
    }
    if (dscr >= 0.85 && fico >= 720) {
      return isPurchase ? '0.85-0.94x (Purch, 720+ FICO)' : '0.85-0.94x (Refi, 720+ FICO)';
    }
    if (dscr >= 0.75 && fico >= 720) {
      return isPurchase ? '0.75-0.84x (Purch, 720+ FICO)' : '0.75-0.84x (Refi, 720+ FICO)';
    }
    
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

  const getBrokerPrice = (rate: number, ltv: number): number | null => {
    if (!selectedProduct?.pricing_matrix) return null;

    let matrix: any = {};
    try {
      matrix = typeof selectedProduct.pricing_matrix === 'string'
        ? JSON.parse(selectedProduct.pricing_matrix)
        : selectedProduct.pricing_matrix || {};
    } catch (e) {
      console.error("Parse error:", e);
      return null;
    }

    const baseMatrix = matrix['baseRates'] || matrix['Base Rate'] || {};
    
    const baseKey3 = rate.toFixed(3);
    const baseKey4 = rate.toFixed(4);
    const baseKeyRaw = rate.toString();

    let basePriceStr = 
      baseMatrix[baseKey4] || 
      baseMatrix[baseKey3] || 
      baseMatrix[baseKeyRaw] ||
      baseMatrix[rate] || 
      baseMatrix[parseFloat(baseKey4)];

    if (!basePriceStr) {
      console.warn(`Base Rate not found for ${rate}% in product: ${selectedProduct?.name}`);
      return null;
    }

    let price = parseFloat(basePriceStr);

    const ltvKey = getLtvBucket(ltv);
    const fico = parseFloat(application?.borrowers?.[0]?.fico || '720');
    const dscr = calculateDSCR(rate, ltv);
    const isPurchase = true;

    const ficoMatrix = matrix['ficoLtvGrid'] || matrix['FICO Adjustment'] || {};
    const ficoBucket = getFicoBucket(fico);
    price += parseFloat(ficoMatrix[ficoBucket]?.[ltvKey] || '0') || 0;

    const dscrMatrix = matrix['dscrLtvGrid'] || matrix['DSCR Adjustment'] || {};
    const dscrBucket = getDscrBucket(dscr, fico, isPurchase);
    price += parseFloat(dscrMatrix[dscrBucket]?.[ltvKey] || dscrMatrix[dscrBucket] || '0') || 0;

    const loanSizeMatrix = matrix['loanBalanceLtvGrid'] || {};
    const loanSizeBucket = getLoanSizeBucket(loanAmount);
    price += parseFloat(loanSizeMatrix[loanSizeBucket]?.[ltvKey] || loanSizeMatrix[loanSizeBucket]?.all || '0') || 0;

    const profitPercent = selectedProduct.default_profit_percent || 1.0;
    price += profitPercent;

    return price;
  };

  const calculateDSCR = (rate: number, ltv: number) => {
    const purchasePriceNum = purchasePrice || 500000;
    const loanForThisCell = purchasePriceNum * (ltv / 100);

    const monthlyRate = rate / 100 / 12;
    const numPayments = 360;
    const monthlyPayment = loanForThisCell * 
      (monthlyRate * Math.pow(1 + monthlyRate, numPayments)) / 
      (Math.pow(1 + monthlyRate, numPayments) - 1);

    const annualDebtService = monthlyPayment * 12;
    return annualRent / (annualDebtService + annualExpense) || 1.0;
  };

  const getPrice = (rate: number, ltv: number): number | null => {
    const basePrice = getBrokerPrice(rate, ltv);
    return getFinalPrice(basePrice);
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
    const price = getPrice(rate, ltv);
    if (price !== null) {
      setSelectedRate(rate.toFixed(3));
      setSelectedLTV(ltv);
    }
  };

  const dscr = calculateDSCR(parseFloat(selectedRate) || 6, selectedLTV);

  if (error) return <div className="p-10 text-red-600 text-center text-xl">Error: {error}</div>;
  if (loading || !application) return <div className="p-10 text-center text-xl">Loading pricing matrix...</div>;

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
          {isBorrowerUser ? 'Retail Pricing Matrix' : 'Wholesale Pricing Matrix'} – {form.propertyAddress || 'New Loan'}
        </h1>

        <PDFDownloadLink
          document={
            <LoanApplicationPDF 
             form={form}
      borrowers={borrowers}
      rentRoll={rentRoll}
      owners={owners}
      organization={organization}   // ← Add this line
            />
          }
          fileName={`Loan-Application-${form.propertyAddress || 'Untitled'}.pdf`}
        >
          {({ loading }) => (
            <button className="px-8 py-4 bg-blue-600 text-white rounded-3xl font-medium hover:bg-blue-700">
              {loading ? 'Generating PDF...' : '📄 Download Full Application PDF'}
            </button>
          )}
        </PDFDownloadLink>
      </div>

      {/* Pricing Mode Banner */}
      <div className={`mb-8 p-4 rounded-2xl text-center font-medium ${isBorrowerUser ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}>
        {isBorrowerUser 
          ? '📌 You are viewing RETAIL rates • Origination Fee shown (max rate 100.00)' 
          : '📌 You are viewing WHOLESALE rates'}
      </div>

      {/* Top Summary Grid */}
      <div className="bg-white border rounded-3xl p-8 mb-10 grid grid-cols-2 md:grid-cols-6 gap-6 text-sm">
        <div>
          <div className="text-gray-500">Purchase Price</div>
          <div className="text-2xl font-semibold">${purchasePrice.toLocaleString()}</div>
        </div>
        <div>
          <div className="text-gray-500">Requested LTV</div>
          <div className="text-2xl font-semibold">{requestedLTV}%</div>
        </div>
        <div>
          <div className="text-gray-500">Annual Rent</div>
          <div className="text-2xl font-semibold">${annualRent.toLocaleString()}</div>
        </div>
        <div>
          <div className="text-gray-500">Annual Expense</div>
          <div className="text-2xl font-semibold">${annualExpense.toLocaleString()}</div>
        </div>
        <div>
          <div className="text-gray-500">Interest Only</div>
          <div className="text-2xl font-semibold">{interestOnly ? 'Yes' : 'No'}</div>
        </div>
        <div>
          <div className="text-gray-500">Loan Amount</div>
          <input 
            type="text" 
            value={loanAmount.toLocaleString()} 
            onChange={(e) => setLoanAmount(parseFloat(e.target.value.replace(/,/g, '')) || 0)} 
            className="text-2xl font-semibold w-full border-b focus:outline-none" 
          />
        </div>
      </div>

      {/* Dynamic Controls */}
      <div className="bg-white border rounded-3xl p-8 mb-10 grid grid-cols-2 md:grid-cols-4 gap-6">
        <div>
          <label className="block text-sm font-medium mb-2">Property Type</label>
          <select 
            value={propertyType} 
            onChange={(e) => setPropertyType(e.target.value)} 
            className="w-full border rounded-2xl p-3"
          >
            {propertyTypeOptions.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-2">Amortization</label>
          <select 
            value={interestOnly ? 'Yes' : 'No'} 
            onChange={(e) => setInterestOnly(e.target.value === 'Yes')} 
            className="w-full border rounded-2xl p-3"
          >
            <option value="No">Amortized</option>
            <option value="Yes">Interest Only</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-2">Prepayment Penalty</label>
          <select 
            value={prepaymentPenalty} 
            onChange={(e) => setPrepaymentPenalty(e.target.value)} 
            className="w-full border rounded-2xl p-3 text-sm"
          >
            {prepaymentOptions.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-2">Rent Qualification</label>
          <select 
            value={rentQualification} 
            onChange={(e) => setRentQualification(e.target.value)} 
            className="w-full border rounded-2xl p-3"
          >
            <option value="Long Term Rental (LTR)">Long Term Rental (LTR)</option>
            <option value="Short Term Rental (STR)">Short Term Rental (STR)</option>
          </select>
        </div>
      </div>

      {/* Product Selector */}
      <div className="mb-8 bg-white border rounded-3xl p-8">
        <label className="block text-sm font-medium mb-3 text-lg">Select Loan Product</label>
        <select 
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
          <option value="">— Choose a Loan Product to load pricing grid —</option>
          {products.map(p => (
            <option key={p.id} value={p.id}>
              {p.name} {p.loan_type ? `(${p.loan_type})` : ''}
            </option>
          ))}
        </select>
      </div>

      {/* Pricing Grid */}
      {selectedProduct ? (
        <div className="bg-white border-2 border-black rounded-3xl p-8">
          <h2 className="text-3xl font-bold text-center mb-8">
            {selectedProduct.name} Pricing Grid
          </h2>

          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-gray-100">
                <th className="border p-4 text-left font-semibold">Interest Rate</th>
                {ltvBuckets.map(ltv => (
                  <th key={ltv} className="border p-4 text-center font-semibold">{ltv}% LTV</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {interestRates
                .filter(rate => ltvBuckets.some(ltv => getPrice(rate, ltv) !== null))
                .map((rate) => {
                  const rowPrices = ltvBuckets.map(ltv => getPrice(rate, ltv));
                  const hasAnyValid = rowPrices.some(p => p !== null);

                  return (
                    <tr key={rate}>
                      <td className="border p-4 font-medium bg-gray-50">{rate.toFixed(3)}%</td>
                      {ltvBuckets.map((ltv) => {
                        const price = getPrice(rate, ltv);
                        const dscrCalc = calculateDSCR(rate, ltv);
                        const isEligible = price !== null && dscrCalc >= 1.00;
                        const isSelected = selectedRate === rate.toFixed(3) && selectedLTV === ltv;

                        return (
                          <td
                            key={ltv}
                            onClick={() => isEligible && handleCellClick(rate, ltv)}
                            className={`border p-4 text-center cursor-pointer hover:bg-blue-50 transition-colors ${
                              isSelected ? 'bg-blue-100 ring-2 ring-blue-500' : ''
                            } ${!isEligible ? 'bg-red-50' : ''}`}
                          >
                            {isEligible && price !== null ? (
                              <>
                                <div className="font-bold text-lg">{getDisplayValue(rate, ltv)}</div>
                                <div className="text-xs text-gray-500">{dscrCalc.toFixed(2)}x DSCR</div>
                              </>
                            ) : (
                              <div className="text-red-600 text-xs font-medium">Ineligible</div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
            </tbody>
          </table>

          {/* Selected Rate Summary */}
          {selectedRate && (
            <div className="mt-8 p-6 bg-black text-white rounded-3xl flex justify-between items-center">
              <div>
                <span className="text-sm opacity-70">Selected:</span>
                <span className="ml-3 text-3xl font-bold">{selectedRate}% @ {selectedLTV}% LTV</span>
                <span className="ml-6 text-sm opacity-70">
                  {isBorrowerUser 
                    ? `${(100 - (getPrice(parseFloat(selectedRate), selectedLTV) || 100)).toFixed(2)}% Origination Fee` 
                    : `${getPrice(parseFloat(selectedRate), selectedLTV)} Price`}
                </span>
              </div>
              <button 
                onClick={() => alert('Term Sheet coming soon!')} 
                className="px-10 py-4 bg-white text-black rounded-3xl font-semibold hover:bg-gray-100"
              >
                Generate Term Sheet →
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white border rounded-3xl p-16 text-center text-xl text-gray-500">
          Select a loan product above to view the pricing grid
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
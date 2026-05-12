'use client';

import { useState, useEffect } from 'react';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PDFDownloadLink } from '@react-pdf/renderer';
import { LoanApplicationPDF } from '@/components/LoanApplicationPDF';

function NewLoanContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const appId = searchParams.get('id');

  const [application, setApplication] = useState<any>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [selectedRate, setSelectedRate] = useState<string>('');
  const [selectedLTV, setSelectedLTV] = useState<number>(0);
  const [loanAmount, setLoanAmount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

        // Auto-select first product
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

  // Calculations
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


   // ====================== UPDATED BUCKET HELPERS ======================
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
    // More specific matching for your complex CSV rows
    if (dscr >= 1.25) return '>=1.25x';
    if (dscr >= 1.15) return '>=1.15x and <1.25x';
    if (dscr >= 1.00) return '>=1.00x and <1.15x';
    
    // Lower DSCR with FICO/Purpose conditions
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

  // ====================== STRICT 97-102 CLAMPING ======================
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
    // 1. Base Rate - Most Flexible Lookup (for both products)
    const baseMatrix = matrix['baseRates'] || matrix['Base Rate'] || {};
    
    const baseKey3 = rate.toFixed(3);      // e.g. "6.625"
    const baseKey4 = rate.toFixed(4);      // e.g. "6.6250"
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
    const isPurchase = true; // TODO: Make this dynamic later based on loan purpose

    // 2. FICO
    const ficoMatrix = matrix['ficoLtvGrid'] || matrix['FICO Adjustment'] || {};
    const ficoBucket = getFicoBucket(fico);
    price += parseFloat(ficoMatrix[ficoBucket]?.[ltvKey] || '0') || 0;

    // 3. DSCR
    const dscrMatrix = matrix['dscrLtvGrid'] || matrix['DSCR Adjustment'] || {};
    const dscrBucket = getDscrBucket(dscr, fico, isPurchase);
    price += parseFloat(dscrMatrix[dscrBucket]?.[ltvKey] || dscrMatrix[dscrBucket] || '0') || 0;

    // 4. Loan Size
    const loanSizeMatrix = matrix['loanBalanceLtvGrid'] || {};
    const loanSizeBucket = getLoanSizeBucket(loanAmount);
    price += parseFloat(loanSizeMatrix[loanSizeBucket]?.[ltvKey] || loanSizeMatrix[loanSizeBucket]?.all || '0') || 0;

    // 5. Profit Margin
    const profitPercent = selectedProduct.default_profit_percent || 1.0;
    price += profitPercent;

    // ====================== YOUR EXACT CLAMPING RULE ======================
    let finalPrice = price;

    if (finalPrice > 103.00) {
      return null;                    // > 103.00 = Ineligible
    } 
    else if (finalPrice >= 102.01) {
      finalPrice = 102.00;            // 102.01 - 103.00 → 102.00
    } 
    else if (finalPrice < 96.00) {
      return null;                    // < 96.00 = Ineligible
    } 
    else if (finalPrice >= 96.00 && finalPrice < 97.00) {
      finalPrice = 97.00;             // 96.00 - 96.99 → 97.00
    }

    finalPrice = Math.floor(finalPrice * 100) / 100;   // Ensure 2 decimals

    return finalPrice;
  };
    // ====================== DEBUG HELPERS ======================
  const getBaseRateDebug = (rate: number) => {
    let matrix;
    try {
      matrix = typeof selectedProduct?.pricing_matrix === 'string' 
        ? JSON.parse(selectedProduct.pricing_matrix) 
        : selectedProduct?.pricing_matrix || {};
    } catch {
      matrix = {};
    }
    
    const baseMatrix = matrix['baseRates'] || matrix['Base Rate'] || {};
    const baseKey3 = rate.toFixed(3);
    const baseKey4 = rate.toFixed(4);
    
    return baseMatrix[baseKey4] || baseMatrix[baseKey3] || 
           baseMatrix[rate.toString()] || baseMatrix[rate] || 'Not Found';
  };

  const getFicoAdjustmentDebug = (rate: number, ltv: number) => {
    const matrix = selectedProduct?.pricing_matrix || {};
    const ficoMatrix = matrix['FICO Adjustment'] || {};
    const ficoBucket = getFicoBucket(parseFloat(application?.borrowers?.[0]?.fico || 720));
    const ltvBucket = getLtvBucket(ltv);
    const adj = parseFloat(ficoMatrix[ficoBucket]?.[ltvBucket] || '0');
    return adj >= 0 ? `+${adj.toFixed(2)}` : adj.toFixed(2);
  };

  const getDscrAdjustmentDebug = (rate: number, ltv: number) => {
    const matrix = selectedProduct?.pricing_matrix || {};
    const dscrMatrix = matrix['DSCR Adjustment'] || {};
    const dscrBucket = getDscrBucket(calculateDSCR(rate, ltv));
    const ltvBucket = getLtvBucket(ltv);
    const adj = parseFloat(dscrMatrix[dscrBucket]?.[ltvBucket] || '0');
    return adj >= 0 ? `+${adj.toFixed(2)}` : adj.toFixed(2);
  };

  const getLoanSizeAdjustmentDebug = (rate: number, ltv: number) => {
    const matrix = selectedProduct?.pricing_matrix || {};
    const lsMatrix = matrix['Loan Size'] || matrix['Loan Balance Adjustment'] || {};
    const lsBucket = getLoanSizeBucket(loanAmount);
    const ltvBucket = getLtvBucket(ltv);
    const adj = parseFloat(lsMatrix[lsBucket]?.[ltvBucket] || '0');
    return adj >= 0 ? `+${adj.toFixed(2)}` : adj.toFixed(2);
  };

  const getPropAdjustmentDebug = (rate: number, ltv: number) => {
    const matrix = selectedProduct?.pricing_matrix || {};
    const propMatrix = matrix['Property Type Adjustment'] || {};
    const ltvBucket = getLtvBucket(ltv);
    const adj = parseFloat(propMatrix[propertyType]?.[ltvBucket] || propMatrix[propertyType] || '0');
    return adj >= 0 ? `+${adj.toFixed(2)}` : adj.toFixed(2);
  };

  const getAmortAdjustmentDebug = (rate: number, ltv: number) => {
    const matrix = selectedProduct?.pricing_matrix || {};
    const amortMatrix = matrix['Amortization Adjustment'] || {};
    const amortType = interestOnly ? 'Partial-IO (10 Years)*' : 'Fully Amortizing';
    const ltvBucket = getLtvBucket(ltv);
    const adj = parseFloat(amortMatrix[amortType]?.[ltvBucket] || amortMatrix[amortType] || '0');
    return adj >= 0 ? `+${adj.toFixed(2)}` : adj.toFixed(2);
  };

  const getPrepayAdjustmentDebug = (rate: number, ltv: number) => {
    const matrix = selectedProduct?.pricing_matrix || {};
    const prepayMatrix = matrix['Prepayment Adjustment'] || matrix['Prepayment Penalty'] || {};
    const ltvBucket = getLtvBucket(ltv);
    const adj = parseFloat(prepayMatrix[prepaymentPenalty]?.[ltvBucket] || prepayMatrix[prepaymentPenalty] || '0');
    return adj >= 0 ? `+${adj.toFixed(2)}` : adj.toFixed(2);
  };
  const getLtvAdjustmentDebug = (rate: number, ltv: number) => {
    let matrix: any = {};
    try {
      matrix = typeof selectedProduct?.pricing_matrix === 'string' 
        ? JSON.parse(selectedProduct.pricing_matrix) 
        : selectedProduct?.pricing_matrix || {};
    } catch { matrix = {}; }

    const ltvMatrix = matrix['ltvAdjustments'] || {};
    const ltvKey = ltv.toString();           // e.g. "70"
    const adj = parseFloat(ltvMatrix[ltvKey] || '0');
    return adj >= 0 ? `+${adj.toFixed(2)}` : adj.toFixed(2);
  };

  const getRentAdjustmentDebug = (rate: number, ltv: number) => {
    const matrix = selectedProduct?.pricing_matrix || {};
    const rentMatrix = matrix['Rent Adjustments'] || matrix['Rent Qualification'] || {};
    const ltvBucket = getLtvBucket(ltv);
    const adj = parseFloat(rentMatrix[rentQualification]?.[ltvBucket] || rentMatrix[rentQualification] || '0');
    return adj >= 0 ? `+${adj.toFixed(2)}` : adj.toFixed(2);
  };

  // Keep your existing calculateDSCR (or improve it if you want more precision)
   const calculateDSCR = (rate: number, ltv: number) => {
    const purchasePriceNum = purchasePrice || 500000;
    const loanForThisCell = purchasePriceNum * (ltv / 100);   // Dynamic loan amount

    const monthlyRate = rate / 100 / 12;
    const numPayments = 360;
    const monthlyPayment = loanForThisCell * 
      (monthlyRate * Math.pow(1 + monthlyRate, numPayments)) / 
      (Math.pow(1 + monthlyRate, numPayments) - 1);

    const annualDebtService = monthlyPayment * 12;
    return annualRent / (annualDebtService + annualExpense) || 1.0;
  };

  const handleCellClick = (rate: number, ltv: number) => {
    setSelectedRate(rate.toFixed(3));
    setSelectedLTV(ltv);
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
          Pricing Matrix – {form.propertyAddress || 'New Loan'}
        </h1>

        <PDFDownloadLink
          document={
            <LoanApplicationPDF 
              form={form}
              borrowers={borrowers}
              rentRoll={rentRoll}
              owners={owners}
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
            const productId = Number(value); // More reliable than parseInt
            const product = products.find(p => p.id === productId || String(p.id) === value);
            console.log('Selected product:', product); // ← Debug
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

        {products.length === 0 && (
          <p className="text-amber-600 mt-4">No loan products found. Go to /products and create some.</p>
        )}
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
                .filter(rate => {
                  // Only show rates that have AT LEAST ONE valid cell (97-102)
                  return ltvBuckets.some(ltv => {
                    const price = getBrokerPrice(rate, ltv);
                    const dscrCalc = calculateDSCR(rate, ltv);
                    return price !== null && price >= 97 && price <= 102 && dscrCalc >= 1.00;
                  });
                })
                .map((rate) => {
                  const rowPrices = ltvBuckets.map(ltv => getBrokerPrice(rate, ltv));
                  const hasAnyValid = rowPrices.some(p => p !== null && p >= 97 && p <= 102);

                  return (
                    <tr key={rate}>
                      <td className="border p-4 font-medium bg-gray-50">{rate.toFixed(3)}%</td>
                      {ltvBuckets.map((ltv) => {
  const price = getBrokerPrice(rate, ltv);           // Use the function directly
  const dscrCalc = calculateDSCR(rate, ltv);

  // Use the clamped value returned by getBrokerPrice
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
          <div className="font-bold text-lg">{price.toFixed(2)}</div>
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

              
                   {/* ====================== UPDATED DEBUG PANEL ====================== */}
          {selectedRate && (
            <div className="mt-8 p-6 bg-gray-100 border border-gray-300 rounded-3xl">
              <h3 className="font-bold text-lg mb-4">🔍 Debug: {selectedRate}% @ {selectedLTV}% LTV</h3>
              
              <div className="bg-white rounded-2xl p-5 space-y-3 text-sm">
                <div><strong>Base Rate:</strong> {getBaseRateDebug(parseFloat(selectedRate))}</div>
                
                <div className="pt-3 border-t font-medium">Adjustments Applied:</div>
                
                <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs">
                  <div>FICO ({getFicoBucket(parseFloat(application?.borrowers?.[0]?.fico || 720))}):</div>
                  <div>{getFicoAdjustmentDebug(parseFloat(selectedRate), selectedLTV)}</div>

                  <div>DSCR ({calculateDSCR(parseFloat(selectedRate), selectedLTV).toFixed(2)}x):</div>
                  <div>{getDscrAdjustmentDebug(parseFloat(selectedRate), selectedLTV)}</div>

                  <div><strong>LTV Adjustment:</strong></div>
                  <div>{getLtvAdjustmentDebug(parseFloat(selectedRate), selectedLTV)}</div>

                  <div>Loan Size ({getLoanSizeBucket(loanAmount)}):</div>
                  <div>{getLoanSizeAdjustmentDebug(parseFloat(selectedRate), selectedLTV)}</div>

                  <div>Property Type ({propertyType}):</div>
                  <div>{getPropAdjustmentDebug(parseFloat(selectedRate), selectedLTV)}</div>

                  <div>Amortization:</div>
                  <div>{getAmortAdjustmentDebug(parseFloat(selectedRate), selectedLTV)}</div>

                  <div>Prepayment Penalty:</div>
                  <div>{getPrepayAdjustmentDebug(parseFloat(selectedRate), selectedLTV)}</div>

                  <div>Rent Qualification:</div>
                  <div>{getRentAdjustmentDebug(parseFloat(selectedRate), selectedLTV)}</div>

                  <div><strong>Default Profit Margin:</strong></div>
                  <div>+{(selectedProduct?.default_profit_percent || 1.0).toFixed(2)}</div>
                </div>

                <div className="pt-4 border-t font-bold text-lg">
                  Final Price: {getBrokerPrice(parseFloat(selectedRate), selectedLTV) || 'Ineligible'}
                </div>
              </div>
            </div>
          )}

          {selectedRate && (
            <div className="mt-8 p-6 bg-black text-white rounded-3xl flex justify-between items-center">
              <div>
                <span className="text-sm opacity-70">Selected:</span>
                <span className="ml-3 text-3xl font-bold">{selectedRate}% @ {selectedLTV}% LTV</span>
                <span className="ml-6 text-sm opacity-70">DSCR: {dscr.toFixed(2)}x</span>
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
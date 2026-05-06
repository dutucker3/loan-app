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

  // Controls for pricing engine
  const [propertyType, setPropertyType] = useState<string>('SFR');
  const [interestOnly, setInterestOnly] = useState<boolean>(false);
  const [prepaymentPenalty, setPrepaymentPenalty] = useState<string>('O(360)');
  const [rentQualification, setRentQualification] = useState<string>('Long Term Rental (LTR)');

  // Data for PDF
  const [form, setForm] = useState<any>({});
  const [borrowers, setBorrowers] = useState<any[]>([]);
  const [rentRoll, setRentRoll] = useState<any[]>([]);
  const [owners, setOwners] = useState<any[]>([]);

  const [supabase, setSupabase] = useState<any>(null);

  useEffect(() => {
    import('@/lib/supabase').then(({ supabase: client }) => setSupabase(client));
  }, []);

  useEffect(() => {
    if (!appId || !supabase) return;

    const loadData = async () => {
      const [{ data: app }, { data: prods }] = await Promise.all([
        supabase.from('loan_applications').select('*').eq('id', appId).single(),
        supabase.from('loan_products').select('*')
      ]);

      if (app) {
        setApplication(app);
        setForm(app.form_data || {});
        setBorrowers(app.borrowers || []);
        // Try to extract rent roll and owners from form_data if they were saved there
        setRentRoll(app.form_data?.rentRoll || []);
        setOwners(app.form_data?.owners || []);

        if (app.form_data?.loanAmount) {
          setLoanAmount(parseFloat(app.form_data.loanAmount.replace(/,/g, '')) || 0);
        }
      }
      setProducts(prods || []);
    };

    loadData();
  }, [appId, supabase]);

  if (!application) {
    return <div className="p-10 text-center text-xl">Loading application...</div>;
  }

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

  const getBrokerPrice = (rate: number, ltv: number): number => {
    if (!selectedProduct?.pricing_matrix) return 100;
    const matrix = selectedProduct.pricing_matrix;
    let price = 100.0;

    const baseMatrix = matrix['Base Rate'] || {};
    price = parseFloat(baseMatrix[rate.toFixed(3)] || baseMatrix[rate.toString()] || '100');

    const ltvMatrix = matrix['Loan Balance Adjustment'] || matrix['LTV Adjustment'] || {};
    price += parseFloat(ltvMatrix[ltv.toString()] || '0');

    const fico = parseFloat(application?.borrowers?.[0]?.fico || '700');
    const ficoMatrix = matrix['FICO Adjustment'] || {};
    const ficoKey = Object.keys(ficoMatrix).sort((a, b) => parseInt(b) - parseInt(a)).find(k => fico >= parseInt(k)) || '700';
    price += parseFloat(ficoMatrix[ficoKey] || '0');

    const dscr = calculateDSCR(rate, ltv);
    const dscrMatrix = matrix['DSCR Adjustment'] || {};
    price += parseFloat(dscrMatrix[dscr.toFixed(1)] || '0');

    const propMatrix = matrix['Property Type Adjustment'] || {};
    price += parseFloat(propMatrix[propertyType] || '0');

    const amortType = interestOnly ? 'Interest Only' : 'Amortized';
    const amortMatrix = matrix['Amortization Adjustment'] || {};
    price += parseFloat(amortMatrix[amortType] || '0');

    const prepayMatrix = matrix['Prepayment Adjustment'] || matrix['Prepayment Penalty'] || {};
    price += parseFloat(prepayMatrix[prepaymentPenalty] || '0');

    const rentMatrix = matrix['Rent Adjustments'] || matrix['Rent Qualification'] || {};
    price += parseFloat(rentMatrix[rentQualification] || '0');

    return Math.max(Math.min(price, 118), 82);
  };

  const calculateDSCR = (rate: number, ltv: number) => {
    const loan = loanAmount || 1000000;
    const annualDebtService = interestOnly
      ? (loan * rate / 100)
      : (loan * (rate / 100) * 1.2);
    return annualRent / (annualDebtService + annualExpense);
  };

  const handleCellClick = (rate: number, ltv: number) => {
    setSelectedRate(rate.toFixed(3));
    setSelectedLTV(ltv);
  };

  const dscr = calculateDSCR(parseFloat(selectedRate) || 6, selectedLTV);

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
        <div><div className="text-gray-500">Purchase Price</div><div className="text-2xl font-semibold">${purchasePrice.toLocaleString()}</div></div>
        <div><div className="text-gray-500">Requested LTV</div><div className="text-2xl font-semibold">{requestedLTV}%</div></div>
        <div><div className="text-gray-500">Annual Rent</div><div className="text-2xl font-semibold">${annualRent.toLocaleString()}</div></div>
        <div><div className="text-gray-500">Annual Expense</div><div className="text-2xl font-semibold">${annualExpense.toLocaleString()}</div></div>
        <div><div className="text-gray-500">Interest Only</div><div className="text-2xl font-semibold">{interestOnly ? 'Yes' : 'No'}</div></div>
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
          <select value={propertyType} onChange={(e) => setPropertyType(e.target.value)} className="w-full border rounded-2xl p-3">
            {propertyTypeOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-2">Amortization</label>
          <select value={interestOnly ? 'Yes' : 'No'} onChange={(e) => setInterestOnly(e.target.value === 'Yes')} className="w-full border rounded-2xl p-3">
            <option value="No">Amortized</option>
            <option value="Yes">Interest Only</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-2">Prepayment Penalty</label>
          <select value={prepaymentPenalty} onChange={(e) => setPrepaymentPenalty(e.target.value)} className="w-full border rounded-2xl p-3 text-sm">
            {prepaymentOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-2">Rent Qualification</label>
          <select value={rentQualification} onChange={(e) => setRentQualification(e.target.value)} className="w-full border rounded-2xl p-3">
            <option value="Long Term Rental (LTR)">Long Term Rental (LTR)</option>
            <option value="Short Term Rental (STR)">Short Term Rental (STR)</option>
          </select>
        </div>
      </div>

      {/* Product Selector */}
      <div className="mb-8">
        <label className="block text-sm font-medium mb-2">Loan Product</label>
        <select 
          onChange={(e) => setSelectedProduct(products.find(p => p.id === parseInt(e.target.value)))}
          className="w-full max-w-xs border rounded-3xl p-5 text-lg"
        >
          <option value="">Select Loan Product</option>
          {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {selectedProduct && (
        <div className="bg-white border-2 border-black rounded-3xl p-8">
          <h2 className="text-3xl font-bold text-center mb-8">{selectedProduct.name} Pricing Grid</h2>

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
              {interestRates.map(rate => (
                <tr key={rate}>
                  <td className="border p-4 font-medium bg-gray-50">{rate.toFixed(3)}%</td>
                  {ltvBuckets.map(ltv => {
                    const dscrCalc = calculateDSCR(rate, ltv);
                    const price = getBrokerPrice(rate, ltv);
                    const isEligible = dscrCalc >= 1.0;
                    const isSelected = selectedRate === rate.toFixed(3) && selectedLTV === ltv;

                    return (
                      <td
                        key={ltv}
                        onClick={() => handleCellClick(rate, ltv)}
                        className={`border p-4 text-center cursor-pointer hover:bg-blue-50 transition-colors ${
                          isSelected ? 'bg-blue-100 ring-2 ring-blue-500' : ''
                        } ${!isEligible ? 'bg-red-50' : ''}`}
                      >
                        {isEligible ? (
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
              ))}
            </tbody>
          </table>

          {selectedRate && (
            <div className="mt-8 p-6 bg-black text-white rounded-3xl flex justify-between items-center">
              <div>
                <span className="text-sm opacity-70">Selected:</span>
                <span className="ml-3 text-3xl font-bold">{selectedRate}% @ {selectedLTV}% LTV</span>
                <span className="ml-6 text-sm opacity-70">DSCR: {dscr.toFixed(2)}x</span>
              </div>
              <button onClick={() => alert('Term Sheet coming soon!')} className="px-10 py-4 bg-white text-black rounded-3xl font-semibold hover:bg-gray-100">
                Generate Term Sheet →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function NewLoanPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-xl">Loading pricing matrix...</div>}>
      <NewLoanContent />
    </Suspense>
  );
}

export const dynamic = 'force-dynamic';
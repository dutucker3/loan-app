'use client';

import { useState, useRef, useEffect } from 'react';
import { useUser } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useSupabase } from '@/hooks/useSupabase';

const SignatureCanvas = dynamic(() => import('react-signature-canvas'), { ssr: false }) as any;

interface Borrower {
  fullName: string;
  dateOfBirth: string;
  socialSecurity: string;
  fullHomeAddress: string;
  ethnicity: string;
  race: string;
  sex: string;
  declarationsExplanation: string;
  [key: string]: string | boolean | undefined;
  judgments?: boolean;
  bankruptcy?: boolean;
  foreclosure?: boolean;
  lawsuit?: boolean;
  priorLoanIssue?: boolean;
  delinquent?: boolean;
  alimony?: boolean;
  downPaymentBorrowed?: boolean;
  coMaker?: boolean;
  usCitizen?: boolean;
  residentAlien?: boolean;
  primaryResidence?: boolean;
}

export default function LoanApplicationPage() {
  const router = useRouter();
  const { user } = useUser();
  const supabase = useSupabase();           // ← This replaces the old state

  const sigPad = useRef<any>(null);

  const [isClient, setIsClient] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);

  // Borrowers
  const [borrowers, setBorrowers] = useState<Borrower[]>([{
    fullName: '',
    dateOfBirth: '',
    socialSecurity: '',
    fullHomeAddress: '',
    ethnicity: '',
    race: '',
    sex: '',
    declarationsExplanation: '',
  }]);

  // Form Data
  const [form, setForm] = useState({
    propertyAddress: '1810 S Valrico Rd',
    city: 'Valrico',
    county: 'Hillsborough',
    state: 'Florida',
    zip: '33596',
    rentalIncome: '3700',
    taxes: '10299',
    insurance: '4500',
    hoa: '',
    estimatedValue: '1100000',
    units: '1',
    yearBuilt: '1985',
    sqFt: '4422',
    fico: '737',
    netWorth: '400000',
    liquidAssets: '20',
    experience: '5',
    rentOrOwn: '',
    propertiesOwnedFlips: '',
    experienceDescription: 'I buy and hold Rental Properties.',
    borrowerName: '',
    residential: true,
    mixedUse: false,
    condo: false,
    pud: false,
    vacant: false,

    loanAmount: '',
    ltv: '',
    acquisition: true,
    refinance: false,
    cashOutRefi: false,
    cashOutDescription: '',
    acquisitionPurchasePrice: '',
    acquisitionClosingDate: '',
    refinanceCurrentDebt: '',
    refinanceInterestRate: '',
    refinanceMonthlyPayment: '',
    refinanceMaturityDate: '',
    refinancePurchaseDate: '',
    refinancePurchasePrice: '',
    refinanceRehab: '',
    refinanceLastListed: '',

    entityName: '',
    entityTaxId: '',
    entityStateFiled: '',
    entityGoodStanding: true,
    entityNested: false,
    entityAddress: '',
    entityType: '',
    propertyHeldInBorrowingEntity: true,
    propertyHeldInName: '',

    previousFunding: false,
    previousFundingReason: '',

    judgments: false,
    bankruptcy: false,
    foreclosure: false,
    lawsuit: false,
    loanDefault: false,
    federalDebt: false,
    alimony: false,
    downPaymentBorrowed: false,
    coMaker: false,
    usCitizen: true,
    residentAlien: false,
    primaryResidence: false,

    ethnicity: '',
    race: '',
    sex: '',
    dateOfBirth: '',
    socialSecurity: '',
    fullHomeAddress: '',
    declarationsExplanation: '',
  });

  const [rentRoll, setRentRoll] = useState([{ unit: '1', type: 'Residential', monthlyRent: '3700', leaseStart: '3/1/2026', leaseEnd: '2/28/2027' }]);
  const [owners, setOwners] = useState([{ name: 'Alyssa Atchley', ownership: '100' }]);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type, checked } = e.target as any;
    setForm(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleFormatBlur = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    let num = e.target.value.replace(/[^0-9.]/g, '');
    if (num === '') return;
    const parts = num.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    setForm(prev => ({ ...prev, [field]: parts.join('.') }));
  };

  const addBorrower = () => {
    setBorrowers(prev => [...prev, {
      fullName: '', dateOfBirth: '', socialSecurity: '', fullHomeAddress: '',
      ethnicity: '', race: '', sex: '', declarationsExplanation: '',
    }]);
  };

  const updateBorrowerField = (index: number, field: string, value: string | boolean) => {
    setBorrowers(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };
const handleSubmit = async () => {
  if (!user) {
    alert('Please sign in to submit the application.');
    return;
  }

  try {
    console.log("🚀 Submitting via Server Action...");

    const { submitLoanApplication } = await import('@/app/actions/submitApplication');

    const result = await submitLoanApplication(user.id, form, borrowers);

    console.log("✅ SUCCESS:", result);
    alert('✅ Application submitted successfully!');
    router.push(`/loans/new?id=${result.id}`);
  } catch (err: any) {
    console.error("Submit failed:", err);
    alert('Error submitting application: ' + err.message);
  }
};
  const calculateLoanFromLtv = () => {
    if (form.estimatedValue && form.ltv) {
      const calculated = Math.round(parseFloat(form.estimatedValue) * parseFloat(form.ltv) / 100);
      setForm(prev => ({ ...prev, loanAmount: calculated.toString() }));
    }
  };

  const addRentRow = () => setRentRoll([...rentRoll, { unit: '', type: '', monthlyRent: '', leaseStart: '', leaseEnd: '' }]);
  const addOwnerRow = () => setOwners([...owners, { name: '', ownership: '' }]);
  const clearSignature = () => sigPad.current?.clear();
  const nextStep = () => setCurrentStep(prev => Math.min(prev + 1, 5));
  const prevStep = () => setCurrentStep(prev => Math.max(prev - 1, 1));

  if (!isClient) {
    return <div className="p-10 text-center text-xl">Loading application form...</div>;
  }

  return (
    <div className="max-w-4xl mx-auto p-8 bg-white min-h-screen">
      {/* Progress Bar */}
      <div className="mb-8">
        <div className="flex justify-between text-sm mb-2 font-medium">
          <div>Step {currentStep} of 5</div>
        </div>
        <div className="h-3 bg-gray-200 rounded-3xl overflow-hidden">
          <div className="h-full bg-black transition-all duration-300" style={{ width: `${(currentStep / 5) * 100}%` }} />
        </div>
      </div>

      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold">CTF Funding Loan Application</h1>
      </div>

      <div id="loan-application-form" className="border-2 border-black rounded-3xl p-10 bg-white min-h-[650px]">
  
  
        {/* STEP 1 - Property & Borrower Profile */}
{currentStep === 1 && (
  <div>
    <h2 className="text-2xl font-semibold mb-8">Step 1: Property & Borrower Profile</h2>

    {/* PROPERTY INFORMATION - Exact match to PDF Page 1 */}
    <div className="mb-10">
      <h3 className="font-semibold mb-4">PROPERTY INFORMATION</h3>
      <p className="text-sm text-gray-600 mb-6">
        Please fill out below for the subject property you are seeking financing for
      </p>

      <div className="grid grid-cols-2 gap-x-12 gap-y-6 text-sm">
        {/* Left Column */}
        <div className="space-y-6">
          <div>
            <label className="block text-gray-600 mb-1">Property Street Address</label>
            <input name="propertyAddress" value={form.propertyAddress} onChange={handleChange} className="w-full border-b focus:outline-none" required />
          </div>
          <div>
            <label className="block text-gray-600 mb-1">Property City</label>
            <input name="city" value={form.city} onChange={handleChange} className="w-full border-b focus:outline-none" required />
          </div>
          <div>
            <label className="block text-gray-600 mb-1">Property County</label>
            <input name="county" value={form.county} onChange={handleChange} className="w-full border-b focus:outline-none" required />
          </div>
          <div>
            <label className="block text-gray-600 mb-1">Property State</label>
            <input name="state" value={form.state} onChange={handleChange} className="w-full border-b focus:outline-none" required />
          </div>
          <div>
            <label className="block text-gray-600 mb-1">Property Zip Code</label>
            <input name="zip" value={form.zip} onChange={handleChange} className="w-full border-b focus:outline-none" required />
          </div>
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          <div>
            <label className="block text-gray-600 mb-1">Estimated Value</label>
            <div className="flex items-center border-b">
              <span className="text-gray-500 mr-2">$</span>
              <input name="estimatedValue" value={form.estimatedValue} onChange={handleChange} onBlur={handleFormatBlur('estimatedValue')} className="flex-1 focus:outline-none" required />
            </div>
          </div>

          <div>
            <label className="block text-gray-600 mb-1">Number of Units</label>
            <input name="units" value={form.units} onChange={handleChange} className="w-full border-b focus:outline-none" required />
          </div>

          {/* Property Type */}
          <div>
            <label className="block text-gray-600 mb-2">Property Type (Select One)</label>
            <div className="flex items-center gap-8">
              <label className="flex items-center gap-3">
                <input type="radio" name="propertyType" checked={form.residential} onChange={() => setForm(prev => ({ ...prev, residential: true, mixedUse: false }))} />
                Residential
              </label>
              <label className="flex items-center gap-3">
                <input type="radio" name="propertyType" checked={form.mixedUse} onChange={() => setForm(prev => ({ ...prev, residential: false, mixedUse: true }))} />
                Mixed Use*
              </label>
            </div>
          </div>

          <div>
            <label className="block text-gray-600 mb-1">Year Built</label>
            <input name="yearBuilt" value={form.yearBuilt} onChange={handleChange} className="w-full border-b focus:outline-none" />
          </div>

          <div>
            <label className="block text-gray-600 mb-1">Square Footage</label>
            <input name="sqFt" value={form.sqFt} onChange={handleChange} className="w-full border-b focus:outline-none" />
          </div>
        </div>
      </div>

      <p className="text-xs text-gray-500 mt-6">
        *Mixed Use properties are 2-8 unit properties that are at least 51% residential by square footage. If possible, please disclose the square footage of all units in the appropriate boxes above to confirm eligibility.
      </p>
    </div>

    {/* MONEY FIELDS - Rental Income with Warning Restored */}
    <div className="mb-10 grid grid-cols-2 gap-x-12 gap-y-6">
      <div>
        <label className="block text-gray-600 mb-1">Rental Income (Annual)</label>
        <div className="flex items-center border-b">
          <span className="text-gray-500 mr-2">$</span>
          <input name="rentalIncome" value={form.rentalIncome} onChange={handleChange} onBlur={handleFormatBlur('rentalIncome')} className="flex-1 focus:outline-none" required />
        </div>
        {/* Annual Rental Income Warning - RESTORED */}
        {parseFloat(form.rentalIncome || '0') > 0 && 
         parseFloat(form.rentalIncome || '0') < (parseFloat(form.taxes || '0') + parseFloat(form.insurance || '0') + parseFloat(form.hoa || '0')) && (
          <p className="text-red-600 text-sm mt-1">⚠️ Rental Income is less than the sum of Taxes + Insurance + HOA</p>
        )}
      </div>

      <div>
        <label className="block text-gray-600 mb-1">Property Taxes (Annual)</label>
        <div className="flex items-center border-b">
          <span className="text-gray-500 mr-2">$</span>
          <input name="taxes" value={form.taxes} onChange={handleChange} onBlur={handleFormatBlur('taxes')} className="flex-1 focus:outline-none" required />
        </div>
      </div>

      <div>
        <label className="block text-gray-600 mb-1">Property Insurance (Annual)</label>
        <div className="flex items-center border-b">
          <span className="text-gray-500 mr-2">$</span>
          <input name="insurance" value={form.insurance} onChange={handleChange} onBlur={handleFormatBlur('insurance')} className="flex-1 focus:outline-none" required />
        </div>
      </div>

      <div>
        <label className="block text-gray-600 mb-1">HOA Fees (Annual)</label>
        <div className="flex items-center border-b">
          <span className="text-gray-500 mr-2">$</span>
          <input name="hoa" value={form.hoa} onChange={handleChange} onBlur={handleFormatBlur('hoa')} className="flex-1 focus:outline-none" />
        </div>
      </div>
    </div>

    {/* BORROWER REAL ESTATE PROFILE - Exact match to PDF */}
    <div className="mb-10">
      <h3 className="font-semibold mb-4">BORROWER REAL ESTATE PROFILE</h3>
      <div className="grid grid-cols-2 gap-x-12 gap-y-6 text-sm">
        <div>
          <label className="block text-gray-600 mb-1">Estimated FICO</label>
          <input name="fico" value={form.fico} onChange={handleChange} className="w-full border-b focus:outline-none" />
        </div>
        <div>
          <label className="block text-gray-600 mb-1">Rent or Own Home</label>
          <select name="rentOrOwn" value={form.rentOrOwn} onChange={handleChange} className="w-full border-b focus:outline-none">
            <option value="Own">Own</option>
            <option value="Rent">Rent</option>
          </select>
        </div>

        <div>
          <label className="block text-gray-600 mb-1">Estimated Net Worth</label>
          <div className="flex items-center border-b">
            <span className="text-gray-500 mr-2">$</span>
            <input name="netWorth" value={form.netWorth} onChange={handleChange} onBlur={handleFormatBlur('netWorth')} className="flex-1 focus:outline-none" />
          </div>
        </div>
        <div>
          <label className="block text-gray-600 mb-1">Estimated Liquid Assets</label>
          <div className="flex items-center border-b">
            <span className="text-gray-500 mr-2">$</span>
            <input name="liquidAssets" value={form.liquidAssets} onChange={handleChange} onBlur={handleFormatBlur('liquidAssets')} className="flex-1 focus:outline-none" />
          </div>
        </div>

        <div>
          <label className="block text-gray-600 mb-1">Years of Experience</label>
          <input name="experience" value={form.experience} onChange={handleChange} className="w-full border-b focus:outline-none" />
        </div>
        <div>
          <label className="block text-gray-600 mb-1"># of Properties Owned/Flips Done</label>
          <input name="propertiesOwnedFlips" value={form.propertiesOwnedFlips} onChange={handleChange} className="w-full border-b focus:outline-none" />
        </div>
      </div>

      <div className="mt-8">
        <label className="block text-gray-600 mb-1">Briefly describe your real estate experience and current portfolio:</label>
        <textarea name="experienceDescription" value={form.experienceDescription} onChange={handleChange} rows={3} className="w-full border rounded-2xl p-4 focus:outline-none" />
      </div>
    </div>

  </div>
)}

        {/* Step 2 - Loan Request & Purpose */}
{currentStep === 2 && (
  <div>
    <h2 className="text-2xl font-semibold mb-8">Step 2: Loan Request & Loan Purpose</h2>

    <div className="grid grid-cols-2 gap-x-12 gap-y-6 text-sm">
      {/* LTV dropdown - fixed instant calculation */}
      <div>
        <strong>LTV Requested (%):</strong>
        <select 
          name="ltv" 
          value={form.ltv} 
          onChange={(e) => {
            const newLtv = e.target.value;
            setForm(prev => ({ ...prev, ltv: newLtv }));
            // Fixed calculation using latest values
            if (form.estimatedValue && newLtv) {
              const calculated = Math.round(parseFloat(form.estimatedValue) * (parseFloat(newLtv) *10));
              setForm(prev => ({ ...prev, loanAmount: calculated.toString() }));
            }
          }} 
          className="w-full border-b focus:outline-none bg-white" 
          required
        >
          {Array.from({ length: 101 }, (_, i) => (
            <option key={i} value={i}>
              {i}%
            </option>
          ))}
        </select>
      </div>

      <div>
        <strong>Loan Amount Request:</strong>
        <input 
          value={form.loanAmount ? `$${parseFloat(form.loanAmount).toLocaleString('en-US')}` : ''}
          readOnly 
          className="w-full border-b bg-gray-100 focus:outline-none" 
        />
      </div>
    </div>

    {/* Loan Purpose Section */}
    <div className="mt-12">
      <h3 className="font-semibold mb-4">LOAN PURPOSE</h3>
      <div className="flex gap-8 mb-6">
        <label className="flex items-center gap-3">
          <input type="radio" name="loanPurpose" checked={form.acquisition} onChange={() => setForm(prev => ({ ...prev, acquisition: true, refinance: false, cashOutRefi: false }))} />
          <span>Acquisition</span>
        </label>
        <label className="flex items-center gap-3">
          <input type="radio" name="loanPurpose" checked={form.refinance} onChange={() => setForm(prev => ({ ...prev, acquisition: false, refinance: true, cashOutRefi: false }))} />
          <span>Refinance</span>
        </label>
        <label className="flex items-center gap-3">
          <input type="radio" name="loanPurpose" checked={form.cashOutRefi} onChange={() => setForm(prev => ({ ...prev, acquisition: false, refinance: false, cashOutRefi: true }))} />
          <span>Cash-Out Refinance</span>
        </label>
      </div>

      {/* Acquisition fields with comma formatting */}
      {form.acquisition && (
        <div className="grid grid-cols-2 gap-x-12 gap-y-6 text-sm mb-8">
          <div className="relative">
            <strong>Purchase Price:</strong>
            <div className="flex">
              <span className="inline-flex items-center px-3 border border-r-0 border-gray-300 bg-gray-50 rounded-l-xl text-gray-500">$</span>
              <input 
                name="acquisitionPurchasePrice" 
                value={form.acquisitionPurchasePrice} 
                onChange={handleChange} 
                onBlur={handleFormatBlur('acquisitionPurchasePrice')}
                className="flex-1 border border-l-0 border-gray-300 focus:outline-none rounded-r-xl" 
              />
            </div>
          </div>
          <div><strong>Expected Closing Date:</strong> <input name="acquisitionClosingDate" value={form.acquisitionClosingDate} onChange={handleChange} className="w-full border-b focus:outline-none" /></div>
        </div>
      )}

      {/* Refinance fields with comma formatting */}
      {(form.refinance || form.cashOutRefi) && (
        <div className="grid grid-cols-2 gap-x-12 gap-y-6 text-sm">
          <div className="relative">
            <strong>Current Debt Outstanding:</strong>
            <div className="flex">
              <span className="inline-flex items-center px-3 border border-r-0 border-gray-300 bg-gray-50 rounded-l-xl text-gray-500">$</span>
              <input 
                name="refinanceCurrentDebt" 
                value={form.refinanceCurrentDebt} 
                onChange={handleChange} 
                onBlur={handleFormatBlur('refinanceCurrentDebt')}
                className="flex-1 border border-l-0 border-gray-300 focus:outline-none rounded-r-xl" 
              />
            </div>
          </div>
          <div><strong>Current Debt Interest Rate:</strong> <input name="refinanceInterestRate" value={form.refinanceInterestRate} onChange={handleChange} className="w-full border-b focus:outline-none" /></div>
          <div><strong>Current Debt Monthly Payment:</strong> <input name="refinanceMonthlyPayment" value={form.refinanceMonthlyPayment} onChange={handleChange} className="w-full border-b focus:outline-none" /></div>
          <div><strong>Current Debt Maturity Date:</strong> <input name="refinanceMaturityDate" value={form.refinanceMaturityDate} onChange={handleChange} className="w-full border-b focus:outline-none" /></div>
          <div><strong>Property Purchase Date:</strong> <input name="refinancePurchaseDate" value={form.refinancePurchaseDate} onChange={handleChange} className="w-full border-b focus:outline-none" /></div>
          <div className="relative">
            <strong>Property Purchase Price:</strong>
            <div className="flex">
              <span className="inline-flex items-center px-3 border border-r-0 border-gray-300 bg-gray-50 rounded-l-xl text-gray-500">$</span>
              <input 
                name="refinancePurchasePrice" 
                value={form.refinancePurchasePrice} 
                onChange={handleChange} 
                onBlur={handleFormatBlur('refinancePurchasePrice')}
                className="flex-1 border border-l-0 border-gray-300 focus:outline-none rounded-r-xl" 
              />
            </div>
          </div>
          <div className="relative">
            <strong>Documented Rehab $ Last 12 Mo.:</strong>
            <div className="flex">
              <span className="inline-flex items-center px-3 border border-r-0 border-gray-300 bg-gray-50 rounded-l-xl text-gray-500">$</span>
              <input 
                name="refinanceRehab" 
                value={form.refinanceRehab} 
                onChange={handleChange} 
                onBlur={handleFormatBlur('refinanceRehab')}
                className="flex-1 border border-l-0 border-gray-300 focus:outline-none rounded-r-xl" 
              />
            </div>
          </div>
          <div><strong>Date Property Last Listed for Sale:</strong> <input name="refinanceLastListed" value={form.refinanceLastListed} onChange={handleChange} className="w-full border-b focus:outline-none" /></div>
        </div>
      )}

      {/* Cash-Out Description */}
      {form.cashOutRefi && (
        <div className="mt-8">
          <strong>If purpose of loan is a Cash-Out Refinance (greater than $2,000 in proceeds), please provide a brief description of the use of the proceeds. Please note that using the proceeds for personal, family or household purposes is prohibited.</strong>
          <textarea 
            name="cashOutDescription" 
            value={form.cashOutDescription} 
            onChange={handleChange} 
            className="w-full border rounded-2xl p-4 h-24 mt-3" 
            placeholder="Describe the use of proceeds..."
          />
        </div>
      )}

      {/* Previous lender funding */}
      <div className="mt-10">
        <strong>Have you previously sought funding with a different lender for the specific loan being requested?</strong>
        <div className="flex gap-8 mt-3">
          <label className="flex items-center gap-3">
            <input type="radio" name="previousFunding" checked={form.previousFunding} onChange={() => setForm(prev => ({ ...prev, previousFunding: true }))} />
            <span>Yes</span>
          </label>
          <label className="flex items-center gap-3">
            <input type="radio" name="previousFunding" checked={!form.previousFunding} onChange={() => setForm(prev => ({ ...prev, previousFunding: false, previousFundingReason: '' }))} />
            <span>No</span>
          </label>
        </div>
        {form.previousFunding && (
          <div className="mt-4">
            <strong>If yes, why was the loan ultimately not approved or closed?</strong>
            <textarea 
              name="previousFundingReason" 
              value={form.previousFundingReason} 
              onChange={handleChange} 
              className="w-full border rounded-2xl p-4 h-24 mt-3" 
            />
          </div>
        )}
      </div>
    </div>
  </div>
)}
        {/* Step 3 - Rent Roll */}
        {currentStep === 3 && (
          <div>
            <h2 className="text-2xl font-semibold mb-8">Step 3: Rent Roll</h2>
            {/* New instructional text */}
    <p className="text-sm text-gray-600 mb-8">
      Please fill out the rent roll below for all units at the property. 
      If any unit is vacant or utilized as a short-term rental please use an estimate of market rent for Monthly Rent.
    </p>
            <table className="w-full border text-sm">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border p-3">Unit #</th>
                  <th className="border p-3">Type</th>
                  <th className="border p-3">Monthly Rent</th>
                  <th className="border p-3">Lease Start</th>
                  <th className="border p-3">Lease End</th>
                </tr>
              </thead>
              <tbody>
                {rentRoll.map((row, i) => (
                  <tr key={i}>
                    <td className="border p-3"><input value={row.unit} onChange={(e) => { const copy = [...rentRoll]; copy[i].unit = e.target.value; setRentRoll(copy); }} className="w-full" /></td>
                    <td className="border p-3"><input value={row.type} onChange={(e) => { const copy = [...rentRoll]; copy[i].type = e.target.value; setRentRoll(copy); }} className="w-full" /></td>
                    <td className="border p-3"><input value={row.monthlyRent} onChange={(e) => { const copy = [...rentRoll]; copy[i].monthlyRent = e.target.value; setRentRoll(copy); }} className="w-full" /></td>
                    <td className="border p-3"><input value={row.leaseStart} onChange={(e) => { const copy = [...rentRoll]; copy[i].leaseStart = e.target.value; setRentRoll(copy); }} className="w-full" /></td>
                    <td className="border p-3"><input value={row.leaseEnd} onChange={(e) => { const copy = [...rentRoll]; copy[i].leaseEnd = e.target.value; setRentRoll(copy); }} className="w-full" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button onClick={addRentRow} className="mt-4 text-blue-600 text-sm">+ Add Row</button>
          </div>
        )}

        {/* Step 4 - Entity & Owners */}
    {currentStep === 4 && (
  <div>
    <h2 className="text-2xl font-semibold mb-8">Step 4: Entity Information & Owners</h2>

    {/* New instructional paragraph */}
    <p className="text-sm text-gray-600 mb-8 leading-relaxed">
      Mortgage loans may be extended to borrowers as individuals or to business entities such as LLCs,
      partnerships, corporations as well as some types of Trust. Please check one of the boxes below, and if
      the selection is “Entity,” please fill out the tables below. Note that any individual borrower to the
      mortgage loan or &gt;25% owner of the borrowing entity must fill out one of the following Borrower Info &amp;
      Declaration Pages and sign a guaranty upon close of loan. If the tables below do not apply or there
      are less than four qualifying entity owners, please leave such sections blank.
    </p>

    <div className="grid grid-cols-2 gap-x-12 gap-y-6 text-sm">
      
      {/* Entity Type Radio Buttons */}
      <div className="col-span-2">
        <strong>Entity Type (Select One)</strong>
        <div className="flex flex-wrap gap-x-8 gap-y-3 mt-3">
          <label className="flex items-center gap-3">
            <input type="radio" name="entityType" checked={form.entityType === 'LLC'} onChange={() => setForm(prev => ({ ...prev, entityType: 'LLC' }))} />
            <span>LLC</span>
          </label>
          <label className="flex items-center gap-3">
            <input type="radio" name="entityType" checked={form.entityType === 'Corporation'} onChange={() => setForm(prev => ({ ...prev, entityType: 'Corporation' }))} />
            <span>Corporation</span>
          </label>
          <label className="flex items-center gap-3">
            <input type="radio" name="entityType" checked={form.entityType === 'Partnership'} onChange={() => setForm(prev => ({ ...prev, entityType: 'Partnership' }))} />
            <span>Partnership</span>
          </label>
          <label className="flex items-center gap-3">
            <input type="radio" name="entityType" checked={form.entityType === 'Trust'} onChange={() => setForm(prev => ({ ...prev, entityType: 'Trust' }))} />
            <span>Trust</span>
          </label>
        </div>
      </div>

      <div><strong>Entity Name:</strong> <input name="entityName" value={form.entityName} onChange={handleChange} className="w-full border-b focus:outline-none" /></div>
      <div><strong>Tax ID:</strong> <input name="entityTaxId" value={form.entityTaxId} onChange={handleChange} className="w-full border-b focus:outline-none" /></div>
      <div><strong>State Filed:</strong> <input name="entityStateFiled" value={form.entityStateFiled} onChange={handleChange} className="w-full border-b focus:outline-none" /></div>

      <div>
        <strong>Good Standing?</strong>
        <div className="flex gap-6 mt-2">
          <label className="flex items-center gap-2"><input type="radio" name="entityGoodStanding" checked={form.entityGoodStanding} onChange={() => setForm(prev => ({...prev, entityGoodStanding: true}))} /> Yes</label>
          <label className="flex items-center gap-2"><input type="radio" name="entityGoodStanding" checked={!form.entityGoodStanding} onChange={() => setForm(prev => ({...prev, entityGoodStanding: false}))} /> No</label>
        </div>
      </div>

      <div>
        <strong>Nested Entity?</strong>
        <div className="flex gap-6 mt-2">
          <label className="flex items-center gap-2"><input type="radio" name="entityNested" checked={form.entityNested} onChange={() => setForm(prev => ({...prev, entityNested: true}))} /> Yes</label>
          <label className="flex items-center gap-2"><input type="radio" name="entityNested" checked={!form.entityNested} onChange={() => setForm(prev => ({...prev, entityNested: false}))} /> No</label>
        </div>
      </div>

      <div><strong>Entity Address:</strong> <input name="entityAddress" value={form.entityAddress} onChange={handleChange} className="w-full border-b focus:outline-none" /></div>
    </div>

    {/* Refinances Only Section - conditional */}
    {(form.refinance || form.cashOutRefi) && (
      <div className="mt-12 border-t pt-8">
        <strong>For Refinances Only:</strong><br />
        <strong>Is the property currently held in the name of the Borrowing Entity?</strong>
        <div className="flex gap-8 mt-3">
          <label className="flex items-center gap-3">
            <input type="radio" name="propertyHeldInBorrowingEntity" checked={form.propertyHeldInBorrowingEntity} onChange={() => setForm(prev => ({ ...prev, propertyHeldInBorrowingEntity: true, propertyHeldInName: '' }))} />
            <span>Yes</span>
          </label>
          <label className="flex items-center gap-3">
            <input type="radio" name="propertyHeldInBorrowingEntity" checked={!form.propertyHeldInBorrowingEntity} onChange={() => setForm(prev => ({ ...prev, propertyHeldInBorrowingEntity: false }))} />
            <span>No</span>
          </label>
        </div>

        {!form.propertyHeldInBorrowingEntity && (
          <div className="mt-6">
            <strong>If "No" - What is the name of the Entity or Individual the property is held in the name of?:</strong>
            <input name="propertyHeldInName" value={form.propertyHeldInName} onChange={handleChange} className="w-full border-b focus:outline-none mt-2" />
          </div>
        )}
      </div>
    )}

    {/* Owners Table */}
    <div className="mt-12">
      <h3 className="font-semibold mb-4">OWNERS W/&gt;25% INTEREST</h3>
      <table className="w-full border text-sm">
        <thead>
          <tr className="bg-gray-100">
            <th className="border p-3">Name</th>
            <th className="border p-3">% Ownership</th>
          </tr>
        </thead>
        <tbody>
          {owners.map((owner, i) => (
            <tr key={i}>
              <td className="border p-3"><input value={owner.name} onChange={(e) => { const copy = [...owners]; copy[i].name = e.target.value; setOwners(copy); }} className="w-full" /></td>
              <td className="border p-3"><input value={owner.ownership} onChange={(e) => { const copy = [...owners]; copy[i].ownership = e.target.value; setOwners(copy); }} className="w-full" /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={addOwnerRow} className="mt-4 text-blue-600 text-sm">+ Add Owner</button>
    </div>
  </div>
)}

        {/* Step 5 - Declarations, Demographics & Signature */}
              {/* Step 5 - Borrower Info, Demographics & Signature */}
   {currentStep === 5 && (
  <div>
    <h2 className="text-2xl font-semibold mb-8">Step 5: Borrower Info, Demographics & Signature</h2>

    {borrowers.map((borrower, index) => (
      <div key={index} className="mb-12 border border-gray-200 rounded-3xl p-8 bg-white">
        <div className="flex justify-between items-center mb-6">
          <h3 className="font-semibold text-lg">Borrower {index + 1}</h3>
          {borrowers.length > 1 && (
            <button onClick={() => setBorrowers(prev => prev.filter((_, i) => i !== index))} className="text-red-600 text-sm hover:underline">Remove</button>
          )}
        </div>

        {/* BORROWER INFO */}
        <div className="grid grid-cols-2 gap-6 mb-10">
          <div>
            <label className="block text-gray-600 mb-1">Full Name</label>
            <input value={borrower.fullName} onChange={(e) => updateBorrowerField(index, 'fullName', e.target.value)} className="w-full border-b focus:outline-none" />
          </div>
          <div>
            <label className="block text-gray-600 mb-1">Date of Birth</label>
            <input value={borrower.dateOfBirth} onChange={(e) => updateBorrowerField(index, 'dateOfBirth', e.target.value)} className="w-full border-b focus:outline-none" />
          </div>
          <div>
            <label className="block text-gray-600 mb-1">Social Security</label>
            <input value={borrower.socialSecurity} onChange={(e) => updateBorrowerField(index, 'socialSecurity', e.target.value)} className="w-full border-b focus:outline-none" />
          </div>
          <div>
            <label className="block text-gray-600 mb-1">Full Home Address</label>
            <input value={borrower.fullHomeAddress} onChange={(e) => updateBorrowerField(index, 'fullHomeAddress', e.target.value)} className="w-full border-b focus:outline-none" />
          </div>
        </div>

        {/* DEMOGRAPHIC INFO */}
        <div className="mb-10">
          <h3 className="font-semibold mb-4">BORROWER DEMOGRAPHIC INFO</h3>
          <p className="text-sm text-gray-600 mb-6">The purpose of collecting this information is to help ensure that all applicants are treated fairly...</p>
          <div className="grid grid-cols-2 gap-x-12 gap-y-8 text-sm">
            <div>
              <strong>Ethnicity:</strong>
              <div className="mt-3 space-y-2">
                {['Hispanic or Latino', 'Mexican', 'Cuban', 'Puerto Rican', 'Not Hispanic or Latino', 'Do not wish to provide'].map(opt => (
                  <label key={opt} className="flex items-center gap-3">
                    <input type="radio" name={`ethnicity-${index}`} checked={borrower.ethnicity === opt} onChange={() => updateBorrowerField(index, 'ethnicity', opt)} />
                    {opt}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <strong>Race:</strong>
              <div className="mt-3 space-y-2">
                {['American Indian or Alaska Native', 'Asian', 'Black or African American', 'White', 'Native Hawaiian or Other Pacific Islander', 'Do not wish to provide'].map(opt => (
                  <label key={opt} className="flex items-center gap-3">
                    <input type="radio" name={`race-${index}`} checked={borrower.race === opt} onChange={() => updateBorrowerField(index, 'race', opt)} />
                    {opt}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-8">
            <strong>Sex:</strong>
            <div className="mt-3 flex gap-8">
              {['Male', 'Female', 'Do not wish to provide'].map(opt => (
                <label key={opt} className="flex items-center gap-3">
                  <input type="radio" name={`sex-${index}`} checked={borrower.sex === opt} onChange={() => updateBorrowerField(index, 'sex', opt)} />
                  {opt}
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* DECLARATIONS - All 11 from PDF Page 5 */}
        <div className="mb-10">
          <h3 className="font-semibold mb-4">DECLARATIONS</h3>
          <div className="space-y-4 text-sm">
            {[
              { label: "Are there any outstanding judgments against you?", field: "judgments" },
              { label: "Have you declared bankruptcy within the last 7 years?", field: "bankruptcy" },
              { label: "Have you had property foreclosed upon or given title of deed in lieu thereof in the last 7 years?", field: "foreclosure" },
              { label: "Are you party to a lawsuit?", field: "lawsuit" },
              { label: "Have you directly or indirectly been obligated on any loan which resulted in foreclosure, transfer of title in lieu of foreclosure or judgment?", field: "priorLoanIssue" },
              { label: "Are you presently delinquent or in default on any Federal debt or any other loan, mortgage, financial obligation, bond, or loan guarantee?", field: "delinquent" },
              { label: "Are you obligated to pay alimony, child support, or separate maintenance?", field: "alimony" },
              { label: "Is part of the down payment borrowed?", field: "downPaymentBorrowed" },
              { label: "Are you a co-maker or endorser on a note?", field: "coMaker" },
              { label: "Are you a US Citizen?", field: "usCitizen" },
              { label: "Are you a permanent or non-permanent resident alien?", field: "residentAlien" },
              { label: "Do you intend to occupy the property as your primary residence or any other residence?", field: "primaryResidence" }
            ].map(q => (
              <div key={q.field} className="flex justify-between items-center">
                <span>{q.label}</span>
                <div className="flex gap-6">
                  <label className="flex items-center gap-2">
                    <input 
                      type="radio" 
                      name={`${q.field}-${index}`} 
                      checked={(borrower as any)[q.field] === true} 
                      onChange={() => updateBorrowerField(index, q.field, true)} 
                    /> 
                    Yes
                  </label>
                  <label className="flex items-center gap-2">
                    <input 
                      type="radio" 
                      name={`${q.field}-${index}`} 
                      checked={(borrower as any)[q.field] === false} 
                      onChange={() => updateBorrowerField(index, q.field, false)} 
                    /> 
                    No
                  </label>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Explanation */}
        <div className="mb-10">
          <label className="block text-gray-600 mb-2">Please provide explanations below if you answered YES to any of the above questions (excepting the question regarding US Citizenship)</label>
          <textarea value={borrower.declarationsExplanation} onChange={(e) => updateBorrowerField(index, 'declarationsExplanation', e.target.value)} rows={4} className="w-full border rounded-2xl p-4" />
        </div>

        {/* Signature */}
        <div>
          <h3 className="font-semibold mb-4">Borrower Signature</h3>
          <div className="border-2 border-dashed border-gray-400 rounded-3xl p-6 bg-gray-50">
            <SignatureCanvas ref={sigPad} penColor="black" canvasProps={{ className: 'w-full h-64 border rounded-2xl bg-white' }} />
          </div>
          <button onClick={() => sigPad.current?.clear()} className="mt-3 text-red-600 text-sm hover:underline">Clear Signature</button>
        </div>
      </div>
    ))}

    {/* Add Additional Borrower */}
    <button onClick={addBorrower} className="mt-8 px-8 py-4 border border-dashed border-gray-400 text-blue-600 rounded-2xl flex items-center gap-2 hover:bg-gray-50">
      + Add Additional Borrower
    </button>

  </div>
)}
    </div>

      {/* Navigation Buttons */}
      <div className="flex justify-between mt-12">
        <button 
          onClick={prevStep} 
          disabled={currentStep === 1}
          className="px-12 py-6 border-2 border-black rounded-3xl text-lg disabled:opacity-40"
        >
          ← Previous
        </button>

        {currentStep < 5 ? (
          <button onClick={nextStep} className="px-12 py-6 bg-black text-white rounded-3xl text-lg">
            Next →
          </button>
        ) : (
          <button onClick={handleSubmit} className="px-12 py-6 bg-black text-white rounded-3xl text-lg">
            Submit Application
          </button>
        )}
      </div>
    </div>
  );
}
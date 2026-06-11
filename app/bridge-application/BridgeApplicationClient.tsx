'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { isBorrower } from '@/lib/permissions';
import { submitLoanApplication } from '@/app/actions/submitApplication';

// Full Axelrad-based Bridge/Fix & Flip application form (per user request).
// - No product selection on the form (the form is the same regardless of available products; products are chosen on the review/term sheet side).
// - Only borrower-facing conditional: "Rehab Funding Needed? Yes/No" which opens the "Rehab Funding Amount" field.
// - Dynamic "Add Additional Borrower" button (starts with 1 primary borrower, adds 1 at a time).
// - Declarations on a per-borrower basis: for each borrower, individual Yes/No checkboxes for each question (no 4-column Guarantor table).
// - Exact structure, sections, questions from the Axelrad PDF as much as possible.
// - White-label tenant branding (logo, primary color, name) applied server-side via props from the page.
// - Signature section only shown if the logged-in user is BORROWER role (company users skip; system logs originator).

interface Props {
  tenantName: string;
  tenantLogo?: string | null;
  tenantColor?: string;
}

export default function BridgeApplicationClient({ tenantName, tenantLogo, tenantColor = '#111827' }: Props) {
  const router = useRouter();

  const [currentUserRole, setCurrentUserRole] = useState<string>('BROKER_AE');
  const [borrowerUser, setBorrowerUser] = useState(false);

  // Global property / loan proposal fields (from Axelrad I.)
  const [form, setForm] = useState({
    borrowerEntityName: '',
    subjectPropertyAddress: '',
    propertyTypes: {
      residentialSingle: false,
      residential2to4: false,
      residentialCondo: false,
      rawLand: false,
      commercialMulti5: false,
      commercialMixed: false,
      commercialOffice: false,
      commercialOther: false,
    },
    commercialOtherExplain: '',
    noOfUnits: '',
    occupancyStatus: '',
    purposes: {
      purchase: false,
      fixAndFlip: false,
      gap: false,
      business: false,
      refinance: false,
      transactional: false,
      lineOfCredit: false,
      newConstruction: false,
      bridgeLoan: false,
      other: false,
    },
    purposeOtherExplain: '',
    loanTerm: '',
    loanAmountRequest: '',
    currentMarketValueAsIs: '',
    purchasePrice: '',
    purchaseDate: '',
    anticipatedArv: '',
    existingDebtIfRefi: '',
    monthlyRentMarket: '',
    annualPropertyTaxes: '',
    floodZone: '',
    annualInsurancePremium: '',
    hoaDues: '',
    projectSummary: '',
    exitStrategy: '',
    totalCashReserves: '',
    titleCompanyContact: '',
    targetClosingDate: '',
    reasonForTargetDate: '',

    // Required Rehab Funding Needed (the only conditional on the form)
    rehabFundingNeeded: false,
    rehabFundingAmount: '',

    // IV. REAL ESTATE OWNED (global)
    reoProperties: Array.from({ length: 4 }, () => ({
      address: '',
      ownership: '',
      mortgageOwed: '',
      marketValue: '',
      description: '',
    })),

    // Global complex funding explanation
    complexFundingExplanation: '',

    // Signatures (one per borrower, only used if borrowerUser)
    borrowerSignatures: [''],
    borrowerSignatureDates: [''],
  });

  // Dynamic borrowers - start with 1 primary
  const [borrowers, setBorrowers] = useState([
    {
      fullLegalName: '',
      creditScoreRange: '',
      dob: '',
      ssn: '',
      homePhone: '',
      cellPhone: '',
      email: '',
      presentAddress: '',
      mailingAddress: '',
      employer: '',
      // Per-borrower declarations: yes/no for each question
      declarations: {
        judgments: false,
        bankruptcy: false,
        foreclosure: false,
        lawsuit: false,
        priorLoanForeclosure: false,
        delinquent: false,
        usCitizen: false,
        permanentResident: false,
        intendToOccupy: false,
      },
    },
  ]);

  const [submitting, setSubmitting] = useState(false);

  // Load user role for signature visibility (same pattern as rental form)
  useEffect(() => {
    async function loadUser() {
      const { data: { user: u } } = await supabase.auth.getUser();
      if (u) {
        try {
          const { data: prof } = await supabase.from('profiles').select('role').eq('id', u.id).maybeSingle();
          const role = prof?.role || 'BROKER_AE';
          setCurrentUserRole(role);
          setBorrowerUser(role === 'BORROWER');
        } catch (e) {
          console.error('[bridge-form] role load error', e);
        }
      }
    }
    loadUser();
  }, []);

  // Update a top-level form field
  const updateForm = (path: string, value: any) => {
    setForm(prev => {
      const newForm: any = { ...prev };
      const keys = path.split('.');
      let current = newForm;
      for (let i = 0; i < keys.length - 1; i++) {
        if (!current[keys[i]]) current[keys[i]] = {};
        current = current[keys[i]];
      }
      current[keys[keys.length - 1]] = value;
      return newForm;
    });
  };

  // Toggle propertyTypes / purposes checkboxes
  const toggleCheckbox = (group: string, key: string) => {
    setForm(prev => {
      const newForm: any = JSON.parse(JSON.stringify(prev));
      if (group === 'propertyTypes' || group === 'purposes') {
        newForm[group][key] = !newForm[group][key];
      }
      return newForm;
    });
  };

  // Add one additional borrower at a time
  const addBorrower = () => {
    setBorrowers(prev => [
      ...prev,
      {
        fullLegalName: '',
        creditScoreRange: '',
        dob: '',
        ssn: '',
        homePhone: '',
        cellPhone: '',
        email: '',
        presentAddress: '',
        mailingAddress: '',
        employer: '',
        declarations: {
          judgments: false,
          bankruptcy: false,
          foreclosure: false,
          lawsuit: false,
          priorLoanForeclosure: false,
          delinquent: false,
          usCitizen: false,
          permanentResident: false,
          intendToOccupy: false,
        },
      },
    ]);
    // Add signature slot for the new borrower (only used if borrowerUser)
    setForm(prev => ({
      ...prev,
      borrowerSignatures: [...prev.borrowerSignatures, ''],
      borrowerSignatureDates: [...prev.borrowerSignatureDates, ''],
    }));
  };

  // Update a field on a specific borrower
  const updateBorrower = (index: number, field: string, value: any) => {
    setBorrowers(prev => {
      const newB = [...prev];
      newB[index] = { ...newB[index], [field]: value };
      return newB;
    });
  };

  // Toggle yes/no for a per-borrower declaration
  const toggleBorrowerDeclaration = (bIndex: number, field: string) => {
    setBorrowers(prev => {
      const newB = [...prev];
      newB[bIndex] = {
        ...newB[bIndex],
        declarations: {
          ...newB[bIndex].declarations,
          [field]: !newB[bIndex].declarations[field],
        },
      };
      return newB;
    });
  };

  const updateReo = (index: number, field: string, value: string) => {
    setForm(prev => {
      const newReo = [...prev.reoProperties];
      newReo[index] = { ...newReo[index], [field]: value };
      return { ...prev, reoProperties: newReo };
    });
  };

  const updateBorrowerSignature = (index: number, value: string) => {
    setForm(prev => {
      const sigs = [...prev.borrowerSignatures];
      sigs[index] = value;
      return { ...prev, borrowerSignatures: sigs };
    });
  };

  const updateBorrowerSignatureDate = (index: number, value: string) => {
    setForm(prev => {
      const dates = [...prev.borrowerSignatureDates];
      dates[index] = value;
      return { ...prev, borrowerSignatureDates: dates };
    });
  };

  const handleSubmit = async () => {
    setSubmitting(true);

    const fullData = {
      ...form,
      borrowers, // dynamic array with per-borrower declarations
      submittedAsBorrower: borrowerUser,
      // Note: no product selection here. The 4% config and mortgagee are applied on the review page when a product is chosen.
    };

    console.log('[bridge-application] Full form data (Axelrad structure + requested changes):', fullData);
    console.log('[bridge-application] Tenant branding:', { name: tenantName, logo: tenantLogo, color: tenantColor });

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('You must be signed in to submit an application.');
      }

      // Persist using the shared server action (sets organization_id automatically)
      await submitLoanApplication(user.id, fullData, borrowers);

      // Role-based post-submit routing per requirements:
      // Borrowers -> thank you page
      // Organization users, brokers, AEs -> dashboard (where they can review via Applications tab)
      if (borrowerUser) {
        router.push('/thank-you');
      } else {
        router.push('/dashboard');
      }
    } catch (e: any) {
      console.error(e);
      alert(e?.message || 'Submission error (see console).');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-8" style={{ color: tenantColor }}>
      {/* White-label tenant header (server-side data from page.tsx) */}
      <div className="flex items-center gap-4 mb-6 border-b pb-4">
        {tenantLogo && <img src={tenantLogo} alt={tenantName} className="h-10 w-auto" />}
        <div>
          <div className="text-2xl font-semibold">{tenantName}</div>
          <div className="text-sm opacity-70">Bridge / Fix &amp; Flip Loan Application</div>
        </div>
      </div>

      <h1 className="text-3xl font-semibold mb-2">Loan Application</h1>
      <p className="text-sm text-gray-600 mb-6">
        This application is designed to be completed by the Borrower or authorized representative, as well as the Guarantor or Co-Guarantor(s) in their individual capacity.
        (Structure based on the Axelrad PDF with your specified changes.)
      </p>

      {/* I. LOAN PROPOSAL AND PROPERTY INFORMATION (from Axelrad, global) */}
      <div className="mb-10">
        <h2 className="text-xl font-semibold mb-4 border-b pb-1">I. LOAN PROPOSAL AND PROPERTY INFORMATION</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <input placeholder="Borrower Entity Name" className="border p-3 rounded" value={form.borrowerEntityName} onChange={e => updateForm('borrowerEntityName', e.target.value)} />
          <input placeholder="Subject Property Address (street, city, state, & ZIP)" className="border p-3 rounded" value={form.subjectPropertyAddress} onChange={e => updateForm('subjectPropertyAddress', e.target.value)} />
        </div>

        <div className="mb-4">
          <div className="font-medium mb-2">Property Type</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
            {[
              ['residentialSingle', 'Residential: Single-Family'],
              ['residential2to4', 'Residential: 2-4 Units'],
              ['residentialCondo', 'Residential: Condo'],
              ['rawLand', 'Raw Land'],
              ['commercialMulti5', 'Commercial: Multi-Family (5+ Units) / Apt. Complex'],
              ['commercialMixed', 'Commercial: Mixed-Use'],
              ['commercialOffice', 'Commercial: Office'],
              ['commercialOther', 'Commercial: Other (please explain)'],
            ].map(([key, label]) => (
              <label key={key} className="flex items-center gap-2">
                <input type="checkbox" checked={(form.propertyTypes as any)[key]} onChange={() => toggleCheckbox('propertyTypes', key)} />
                {label}
              </label>
            ))}
          </div>
          {form.propertyTypes.commercialOther && (
            <input placeholder="Please explain (Commercial: Other)" className="mt-2 w-full border p-2 rounded text-sm" value={form.commercialOtherExplain} onChange={e => updateForm('commercialOtherExplain', e.target.value)} />
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <input placeholder="No. of Units" className="border p-3 rounded" value={form.noOfUnits} onChange={e => updateForm('noOfUnits', e.target.value)} />
          <input placeholder="Occupancy Status" className="border p-3 rounded" value={form.occupancyStatus} onChange={e => updateForm('occupancyStatus', e.target.value)} />
          <div>
            <div className="text-sm mb-1">Property in Flood Zone</div>
            <select className="border p-3 rounded w-full" value={form.floodZone} onChange={e => updateForm('floodZone', e.target.value)}>
              <option value="">Select</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </div>
        </div>

        <div className="mb-4">
          <div className="font-medium mb-2">Purpose for the Loan Funds (check all that apply)</div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
            {[
              ['purchase', 'Purchase'],
              ['fixAndFlip', 'Fix & Flip'],
              ['gap', 'GAP'],
              ['business', 'Business'],
              ['refinance', 'Refinance'],
              ['transactional', 'Transactional'],
              ['lineOfCredit', 'Line of Credit Cash-Out'],
              ['newConstruction', 'New Construction'],
              ['bridgeLoan', 'Bridge Loan'],
              ['other', 'Other'],
            ].map(([key, label]) => (
              <label key={key} className="flex items-center gap-2">
                <input type="checkbox" checked={(form.purposes as any)[key]} onChange={() => toggleCheckbox('purposes', key)} />
                {label}
              </label>
            ))}
          </div>
          {form.purposes.other && (
            <input placeholder="Purpose for the Loan Funds (please explain)" className="mt-2 w-full border p-3 rounded" value={form.purposeOtherExplain} onChange={e => updateForm('purposeOtherExplain', e.target.value)} />
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <input placeholder="Loan Term (12 mos, 18 mos, 24 mos, 30yrs)" className="border p-3 rounded" value={form.loanTerm} onChange={e => updateForm('loanTerm', e.target.value)} />
          <input placeholder="Amount of Loan Request" className="border p-3 rounded" value={form.loanAmountRequest} onChange={e => updateForm('loanAmountRequest', e.target.value)} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <input placeholder="Current Market Value (As-Is)" className="border p-3 rounded" value={form.currentMarketValueAsIs} onChange={e => updateForm('currentMarketValueAsIs', e.target.value)} />
          <input placeholder="Purchase Price" className="border p-3 rounded" value={form.purchasePrice} onChange={e => updateForm('purchasePrice', e.target.value)} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <input placeholder="Purchase Date (mm/dd/yy)" className="border p-3 rounded" value={form.purchaseDate} onChange={e => updateForm('purchaseDate', e.target.value)} />
          <div>
            <div className="text-sm mb-1">Rehab Funding Needed?</div>
            <select
              className="border p-3 rounded w-full"
              value={form.rehabFundingNeeded ? 'yes' : 'no'}
              onChange={e => updateForm('rehabFundingNeeded', e.target.value === 'yes')}
            >
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
          </div>
        </div>
        {form.rehabFundingNeeded && (
          <input
            placeholder="Rehab Funding Amount"
            className="w-full border p-3 rounded mb-4"
            value={form.rehabFundingAmount}
            onChange={e => updateForm('rehabFundingAmount', e.target.value)}
          />
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <input placeholder="Anticipated After Repair Value" className="border p-3 rounded" value={form.anticipatedArv} onChange={e => updateForm('anticipatedArv', e.target.value)} />
          <input placeholder="Existing Debt, if Refi" className="border p-3 rounded" value={form.existingDebtIfRefi} onChange={e => updateForm('existingDebtIfRefi', e.target.value)} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <input placeholder="Monthly Rent/Market Rent" className="border p-3 rounded" value={form.monthlyRentMarket} onChange={e => updateForm('monthlyRentMarket', e.target.value)} />
          <input placeholder="Annual Property Taxes" className="border p-3 rounded" value={form.annualPropertyTaxes} onChange={e => updateForm('annualPropertyTaxes', e.target.value)} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <input placeholder="Annual Insurance Premium" className="border p-3 rounded" value={form.annualInsurancePremium} onChange={e => updateForm('annualInsurancePremium', e.target.value)} />
          <input placeholder="HOA Dues (If Applicable)" className="border p-3 rounded" value={form.hoaDues} onChange={e => updateForm('hoaDues', e.target.value)} />
        </div>

        <textarea placeholder="Project Summary" className="w-full border p-3 rounded mb-4 h-20" value={form.projectSummary} onChange={e => updateForm('projectSummary', e.target.value)} />
        <textarea placeholder="Exit Strategy" className="w-full border p-3 rounded mb-4 h-20" value={form.exitStrategy} onChange={e => updateForm('exitStrategy', e.target.value)} />
        <input placeholder="Total Cash Reserves Available" className="w-full border p-3 rounded mb-4" value={form.totalCashReserves} onChange={e => updateForm('totalCashReserves', e.target.value)} />
        <textarea placeholder="Title Company Contact Info." className="w-full border p-3 rounded mb-4 h-16" value={form.titleCompanyContact} onChange={e => updateForm('titleCompanyContact', e.target.value)} />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <input placeholder="Target Closing Date" className="border p-3 rounded" value={form.targetClosingDate} onChange={e => updateForm('targetClosingDate', e.target.value)} />
          <input placeholder="Reason for Target Closing Date" className="border p-3 rounded" value={form.reasonForTargetDate} onChange={e => updateForm('reasonForTargetDate', e.target.value)} />
        </div>
      </div>

      {/* Borrowers - dynamic "Add Additional Borrower", per-borrower declarations */}
      <div className="mb-10">
        <h2 className="text-xl font-semibold mb-4 border-b pb-1">II. BORROWER INFORMATION</h2>

        {borrowers.map((b, bIndex) => (
          <div key={bIndex} className="mb-8 p-4 border rounded">
            <div className="font-semibold mb-3">Borrower {bIndex + 1}</div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <input
                placeholder="Full Legal Name (include Jr. or Sr. if applicable)"
                className="border p-3 rounded"
                value={b.fullLegalName}
                onChange={e => updateBorrower(bIndex, 'fullLegalName', e.target.value)}
              />
              <input
                placeholder="Credit Score Range (e.g. 620-639, 680-719, etc.)"
                className="border p-3 rounded"
                value={b.creditScoreRange}
                onChange={e => updateBorrower(bIndex, 'creditScoreRange', e.target.value)}
              />

              <input placeholder="DOB (mm/dd/yyyy)" className="border p-3 rounded" value={b.dob} onChange={e => updateBorrower(bIndex, 'dob', e.target.value)} />
              <input placeholder="Social Security Number" className="border p-3 rounded" value={b.ssn} onChange={e => updateBorrower(bIndex, 'ssn', e.target.value)} />

              <input placeholder="Home Phone" className="border p-3 rounded" value={b.homePhone} onChange={e => updateBorrower(bIndex, 'homePhone', e.target.value)} />
              <input placeholder="Cell Phone" className="border p-3 rounded" value={b.cellPhone} onChange={e => updateBorrower(bIndex, 'cellPhone', e.target.value)} />
              <input placeholder="Email Address" className="border p-3 rounded" value={b.email} onChange={e => updateBorrower(bIndex, 'email', e.target.value)} />

              <textarea placeholder="Present Address (street, city, state, ZIP)" className="border p-3 rounded md:col-span-2" value={b.presentAddress} onChange={e => updateBorrower(bIndex, 'presentAddress', e.target.value)} />
              <textarea placeholder="Mailing Address (if different)" className="border p-3 rounded md:col-span-2" value={b.mailingAddress} onChange={e => updateBorrower(bIndex, 'mailingAddress', e.target.value)} />

              <textarea placeholder="Name & Address of Employer (or note if Self-Employed)" className="border p-3 rounded md:col-span-2" value={b.employer} onChange={e => updateBorrower(bIndex, 'employer', e.target.value)} />
            </div>

            {/* Per-borrower Declarations - yes/no checkboxes for each question (no 4-column table) */}
            <div className="mt-6">
              <div className="font-semibold mb-2">Declarations – Borrower {bIndex + 1}</div>
              <div className="space-y-2 text-sm">
                {[
                  { label: 'Are there any outstanding judgments against you?', field: 'judgments' as const },
                  { label: 'Have you been declared bankrupt in the past 7 years?', field: 'bankruptcy' as const },
                  { label: 'Have you had a property foreclosed upon or given title or deed in lieu thereof in the last 7 years?', field: 'foreclosure' as const },
                  { label: 'Are you a party to a lawsuit?', field: 'lawsuit' as const },
                  { label: 'Have you directly or indirectly been obligated on any loan which resulted in foreclosure, transfer of title in lieu of foreclosure, or judgement?', field: 'priorLoanForeclosure' as const },
                  { label: 'Are you presently delinquent or in default on any Federal debt or any other loan, mortgage, financial obligation, bond, or loan guarantee?', field: 'delinquent' as const },
                  { label: 'Are you a U.S. citizen?', field: 'usCitizen' as const },
                  { label: 'Are you a permanent resident alien?', field: 'permanentResident' as const },
                  { label: 'Do you intend to occupy the subject property?', field: 'intendToOccupy' as const },
                ].map((q, qIndex) => (
                  <div key={qIndex} className="flex items-center justify-between border-b pb-1">
                    <span>{q.label}</span>
                    <div className="flex gap-4">
                      <label className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={b.declarations[q.field]}
                          onChange={() => toggleBorrowerDeclaration(bIndex, q.field)}
                        /> Yes
                      </label>
                      <label className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={!b.declarations[q.field]}
                          onChange={() => toggleBorrowerDeclaration(bIndex, q.field)}
                        /> No
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}

        <button
          type="button"
          onClick={addBorrower}
          className="mt-2 px-6 py-2 border border-dashed border-gray-400 text-blue-600 rounded-2xl hover:bg-gray-50"
        >
          + Add Additional Borrower
        </button>
      </div>

      {/* IV. REAL ESTATE OWNED (global, from Axelrad) */}
      <div className="mb-10">
        <h2 className="text-xl font-semibold mb-2 border-b pb-1">IV. REAL ESTATE OWNED</h2>
        <p className="text-xs text-gray-600 mb-4">*Note: If you have an SREO, please fill out 1 address using your primary address &amp; attach the SREO separately.</p>

        {form.reoProperties.map((prop, i) => (
          <div key={i} className="mb-6 p-4 border rounded">
            <div className="font-semibold mb-2">PROPERTY {i + 1}</div>
            <input placeholder="Address" className="w-full border p-3 rounded mb-2" value={prop.address} onChange={e => updateReo(i, 'address', e.target.value)} />
            <input placeholder="Ownership (Entity and Ownership Percentage)" className="w-full border p-3 rounded mb-2" value={prop.ownership} onChange={e => updateReo(i, 'ownership', e.target.value)} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-2">
              <input placeholder="Mortgage Amount Owed" className="border p-3 rounded" value={prop.mortgageOwed} onChange={e => updateReo(i, 'mortgageOwed', e.target.value)} />
              <input placeholder="Present Market Value" className="border p-3 rounded" value={prop.marketValue} onChange={e => updateReo(i, 'marketValue', e.target.value)} />
            </div>
            <textarea placeholder="Description" className="w-full border p-3 rounded" value={prop.description} onChange={e => updateReo(i, 'description', e.target.value)} />
          </div>
        ))}
      </div>

      <div className="mb-10">
        <div className="mt-4">
          <label className="block text-sm font-medium mb-1">***IF COMPLEX/CREATIVE FUNDING: please explain in detail the deal structure:</label>
          <textarea
            className="w-full border p-3 rounded h-24"
            value={form.complexFundingExplanation}
            onChange={e => updateForm('complexFundingExplanation', e.target.value)}
          />
        </div>
      </div>

      {/* VI. ACKNOWLEDGEMENT AND AGREEMENT (full text from PDF) + signatures */}
      <div className="mb-10">
        <h2 className="text-xl font-semibold mb-4 border-b pb-1">VI. ACKNOWLEDGEMENT AND AGREEMENT</h2>

        <div className="text-sm leading-relaxed mb-6 p-4 bg-gray-50 border rounded">
          The Borrower (or Co-Borrower), and Guarantor (or Co-Guarantor) – each of the undersigned – represents to Commercial Lender, LLC (Commercial Lender) and to Commercial Lender's actual or potential agents, brokers, processors, attorneys, insurers, servicers, successors and assigns and agrees and acknowledges that: (1) neither Commercial Lender nor its agents, brokers, insurers, servicers, successors or assigns has made any representation or warranty, express or implied, to me regarding the property or the condition or value of the property (2) the loan requested pursuant to this application (the “Loan”) will be secured by a mortgage or deed of trust on the property or properties described in this application; (3) the property will not be used for any illegal or prohibited purpose or use; (4) all statements made in this application are made for the purpose of obtaining a commercial mortgage loan; (5) the property will be occupied or not occupied as indicated in this application; (6) Commercial Lender, its servicers, successors or assigns are given my (our) consent to retain the original and/or an electronic record of this application, whether or not the Loan is approved; (7) Commercial Lender and its agents, brokers, insurers, servicers, successors, and assigns may continuously rely on the information contained in the application, and I am obligated to and agree to amend and/or supplement the information provided in this application if any of the material facts that I have represented herein should change prior to closing of the Loan; (8) I understand and acknowledge that, in the event that my payments on the Loan become delinquent, Commercial Lender, its servicers, successors or assigns may, in addition to any other rights and remedies that it may have relating to such delinquency, report my name and account information to one or more consumer reporting agencies; (9) I understand and acknowledge that ownership of the Loan and/or administration or servicing of the Loan account may be transferred with such notice as may be required by law; (10) my transmission of this application as an "electronic record" containing my "electronic signature," as those terms are defined in applicable federal and/or state laws (excluding audio and video recordings), or my facsimile transmission of this application containing a facsimile of my signature, shall be as effective, enforceable and valid as if a paper version of this application were delivered containing my original written signature pursuant to applicable law; and (11) I further represent, covenant, and warrant that the information provided in this application is true and correct as of the date set forth opposite my signature and that any intentional or negligent misrepresentation of the information in this application may result in civil liability, including monetary damages, to any person who may suffer any loss due to reliance upon any misrepresentation that I have made on this application. The Borrower (or Co-Borrower) and Guarantor (or Co-Guarantor) – each of the undersigned – acknowledges and agrees that Commercial Lender may assign, transfer or hypothecate this Loan opportunity to another lender or funding source and to that end, share the information in this application with other lenders and investors in furtherance of closing the requested Loan. Each of the undersigned hereby acknowledges that any owner of the Loan, its servicers, successors and assigns, may verify or re-verify any information contained in this application or obtain any information or data relating to the Loan, for any legitimate business purpose through any source, including a source named in this application or a consumer reporting agency.

          Each of the undersigned understand that by signing this application, hereby authorize Commercial Lender, LLC, or its assigns on its own or through its service provider to conduct (1) a consumer credit report to verify other credit information, including past and present mortgage and landlord references; (2) a background investigation report and verify both criminal and civil records; and (3) order an appraisal to determine the property's value and charge you for this appraisal. It is understood that a copy of this application serves as authorization to conduct these checks and that the information gathered is in connection with a credit transaction involving myself and/or my company, as applicable. The information Commercial Lender, LLC obtains is only to be used in conjunction with this application for the Loan, or for the collection of an account on a closed loan.

          I further understand that any expenses incurred by me or others in pursuit of this Loan, whether paid to Lender or a third party, is not refundable or reimbursable for any reason by Lender, including without limitation, appraisals, inspections, or any third-party review services. The closing of a Loan is subject to all applicable terms and conditions, and subject at all times to force majeure events.

          Appraisal Notice: We will promptly give you a copy of the appraisal utilized to evaluate the Application in accordance with 12 CFR Part 1002, even if your loan does not close. You may pay for an additional appraisal for your own use at your own cost.

          Privacy Act Notice: This request for personal identifying information and other required information is to be used and stored by Commercial Lender or its assignees in determining whether you qualify as a prospective mortgagor under its program and in order to verify identities as required by federal law. It will not be disclosed outside the agency except as required and permitted by law. You do not have to provide this information, but if you do not your application for approval as a prospective mortgagor or sponsor may be delayed or rejected.

          If this is an application for joint credit, Borrower and Co-Borrower each agree that we intend to apply for joint credit (sign below):
        </div>

        {/* Signatures — only for BORROWER role users (one per borrower) */}
        {borrowerUser ? (
          <div>
            <h3 className="font-semibold mb-3">Borrower Signatures</h3>
            {borrowers.map((_, i) => (
              <div key={i} className="mb-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <div className="text-sm mb-1">Borrower {i + 1}'s Signature</div>
                  <textarea
                    placeholder="Signature"
                    className="w-full border p-3 rounded h-16"
                    value={form.borrowerSignatures[i] || ''}
                    onChange={e => updateBorrowerSignature(i, e.target.value)}
                  />
                </div>
                <div>
                  <div className="text-sm mb-1">Date Signed</div>
                  <input
                    placeholder="Date"
                    className="w-full border p-3 rounded"
                    value={form.borrowerSignatureDates[i] || ''}
                    onChange={e => updateBorrowerSignatureDate(i, e.target.value)}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-4 bg-yellow-50 border border-yellow-200 rounded text-sm">
            Company / non-borrower user submitting this application — signature section is omitted. The system will record you as the originator/submitter. Borrowers will complete signatures on the term sheet and at closing.
          </div>
        )}
      </div>

      <button
        onClick={handleSubmit}
        disabled={submitting}
        className="w-full md:w-auto px-12 py-4 bg-black text-white rounded-3xl text-lg disabled:opacity-50"
      >
        {submitting ? 'Submitting...' : 'Submit Application'}
      </button>
    </div>
  );
}

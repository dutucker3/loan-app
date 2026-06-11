'use server';

import { supabaseAdmin } from '@/lib/supabase-admin';

// Reggora Lender API (sandbox)
const REGGORA_BASE_URL = 'https://sandbox.reggora.io/lender';

const REGGORA_AUTH_TOKEN = process.env.REGGORA_AUTH_TOKEN;
const REGGORA_INTEGRATION_KEY = process.env.REGGORA_INTEGRATION_KEY;

function getReggoraHeaders(): HeadersInit {
  if (!REGGORA_AUTH_TOKEN || !REGGORA_INTEGRATION_KEY) {
    throw new Error('REGGORA_AUTH_TOKEN or REGGORA_INTEGRATION_KEY is not set');
  }
  return {
    'Authorization': `Bearer ${REGGORA_AUTH_TOKEN}`,
    'integration': REGGORA_INTEGRATION_KEY,
    'Content-Type': 'application/json',
  };
}

function parsePropertyAddress(fullAddress: string | null | undefined) {
  const fallback = {
    subject_property_address: '123 Main Street',
    subject_property_city: 'Boston',
    subject_property_state: 'MA',
    subject_property_zip: '02101',
  };
  if (!fullAddress) return fallback;
  // crude parse: "123 Main St, Boston, MA 02101" or similar
  const parts = fullAddress.split(',').map(p => p.trim()).filter(Boolean);
  let address = parts[0] || fallback.subject_property_address;
  let city = parts[1] || fallback.subject_property_city;
  let state = fallback.subject_property_state;
  let zip = fallback.subject_property_zip;
  if (parts[2]) {
    const sz = parts[2].split(/\s+/);
    state = sz[0] || state;
    zip = sz[1] || zip;
  }
  return {
    subject_property_address: address,
    subject_property_city: city,
    subject_property_state: state,
    subject_property_zip: zip,
  };
}

export async function fetchReggoraOrders(): Promise<{ orders?: any[]; error?: string }> {
  if (!REGGORA_AUTH_TOKEN || !REGGORA_INTEGRATION_KEY) {
    return { error: 'Reggora not configured. Add REGGORA_* env vars and restart.' };
  }
  try {
    const res = await fetch(`${REGGORA_BASE_URL}/orders?limit=50&ordering=-created`, {
      headers: getReggoraHeaders(),
      cache: 'no-store',
    });
    if (!res.ok) {
      const txt = await res.text();
      return { error: `Reggora orders fetch failed: ${res.status} ${txt}` };
    }
    const json = await res.json();
    return { orders: json.data?.orders || [] };
  } catch (e: any) {
    console.error('fetchReggoraOrders error', e);
    return { error: e.message || 'Failed to fetch Reggora orders' };
  }
}

export async function fetchReggoraProducts(): Promise<{ products?: any[]; error?: string }> {
  if (!REGGORA_AUTH_TOKEN || !REGGORA_INTEGRATION_KEY) {
    return { error: 'Reggora not configured. Add REGGORA_* env vars and restart.' };
  }
  try {
    const res = await fetch(`${REGGORA_BASE_URL}/products?limit=100`, {
      headers: getReggoraHeaders(),
      cache: 'no-store',
    });
    if (!res.ok) {
      const txt = await res.text();
      return { error: `Reggora products fetch failed: ${res.status} ${txt}` };
    }
    const json = await res.json();
    return { products: json.data?.products || [] };
  } catch (e: any) {
    console.error('fetchReggoraProducts error', e);
    return { error: e.message || 'Failed to fetch Reggora products' };
  }
}

export async function fetchReggoraUsers(): Promise<{ users?: any[]; error?: string }> {
  if (!REGGORA_AUTH_TOKEN || !REGGORA_INTEGRATION_KEY) {
    return { error: 'Reggora not configured. Add REGGORA_* env vars and restart.' };
  }
  try {
    const res = await fetch(`${REGGORA_BASE_URL}/users?limit=100`, {
      headers: getReggoraHeaders(),
      cache: 'no-store',
    });
    if (!res.ok) {
      const txt = await res.text();
      return { error: `Reggora users fetch failed: ${res.status} ${txt}` };
    }
    const json = await res.json();
    return { users: json.data?.users || [] };
  } catch (e: any) {
    console.error('fetchReggoraUsers error', e);
    return { error: e.message || 'Failed to fetch Reggora users' };
  }
}

export async function createReggoraLoan(
  loanData: any,
  dueDate?: string
): Promise<{ reggoraLoanId?: string; error?: string }> {
  if (!REGGORA_AUTH_TOKEN || !REGGORA_INTEGRATION_KEY) {
    return { error: 'Reggora not configured. Add REGGORA_* env vars and restart.' };
  }
  try {
    // Prefer structured data from linked application (loan_applications.form_data or borrowers JSON)
    // Fallback to flat loan fields (populated during origination from application)
    const appData = loanData.application || loanData.form_data || {};
    const borrowers = loanData.borrowers || appData.borrowers || [];
    const primaryBorrower = borrowers[0] || {};

    const borrowerName = primaryBorrower.name || loanData.borrower_name || 'Borrower';
    const [firstName = 'Borrower', ...lastParts] = borrowerName.split(' ');
    const lastName = lastParts.join(' ') || '';

    const consumers = [{
      first_name: firstName,
      last_name: lastName || 'Applicant',
      email: primaryBorrower.email || loanData.borrower_email || '',
      phone: primaryBorrower.phone || loanData.borrower_phone || '',
    }];

    // Address: prefer application data, fallback to loan.property_address (parsed)
    const appAddress = appData.propertyAddress || appData.address || loanData.property_address;
    const parsedAddr = parsePropertyAddress(appAddress);

    const loanNumber = loanData.loan_number || `LOAN-${loanData.id || Date.now()}`;
    const appraisalType = appData.loanPurpose || appData.purpose || loanData.purpose || loanData.loan_type || 'Purchase';

    // Rich fields from application (purchase price, est value, loan purpose)
    const loanAmount = appData.purchasePrice || appData.loanAmount || loanData.loan_amount || 0;
    const appraisedValue = appData.estimatedValue || appData.appraisedValue || loanData.estimated_value || loanAmount;
    const loanPurpose = appData.loanPurpose || appData.purpose || appraisalType;

    const due = dueDate ? `${dueDate}T17:00:00Z` : new Date(Date.now() + 30 * 86400000).toISOString();

    const body: any = {
      loan_number: loanNumber,
      due_date: due,
      appraisal_type: appraisalType,
      subject_property_address: parsedAddr.subject_property_address,
      subject_property_city: parsedAddr.subject_property_city,
      subject_property_state: parsedAddr.subject_property_state,
      subject_property_zip: parsedAddr.subject_property_zip,
      loan_type: loanData.loan_type || 'Conventional',
      loan_amount: Number(loanAmount) || undefined,
      appraised_value: Number(appraisedValue) || undefined,
      loan_purpose: loanPurpose,
      consumers,  // borrower details from application (name, email, phone)
    };

    // Remove undefined keys so Reggora doesn't choke on nulls
    Object.keys(body).forEach(k => body[k] === undefined && delete body[k]);

    const res = await fetch(`${REGGORA_BASE_URL}/loan`, {
      method: 'POST',
      headers: getReggoraHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text();
      return { error: `Create Reggora loan failed: ${res.status} ${txt}` };
    }
    const json = await res.json();
    const reggoraLoanId: string = json.data;
    if (!reggoraLoanId) {
      return { error: 'No loan ID returned from Reggora' };
    }

    // Store on our loan record (field or notes fallback). Id is bigint in DB.
    if (supabaseAdmin && loanData.id != null) {
      const loanIdNum = typeof loanData.id === 'string' ? parseInt(loanData.id, 10) : loanData.id;
      try {
        // Prefer dedicated column
        const { error: updErr } = await supabaseAdmin
          .from('loans')
          .update({ reggora_loan_id: reggoraLoanId })
          .eq('id', loanIdNum);
        if (updErr) {
          // fallback append to notes
          const noteAdd = `\n[Reggora] loan_id=${reggoraLoanId} (created ${new Date().toISOString()})`;
          await supabaseAdmin
            .from('loans')
            .update({ notes: (loanData.notes || '') + noteAdd })
            .eq('id', loanIdNum);
        }
      } catch (storeErr) {
        console.warn('Could not persist reggora_loan_id to loan', storeErr);
      }
    }

    return { reggoraLoanId };
  } catch (e: any) {
    console.error('createReggoraLoan error', e);
    return { error: e.message || 'Failed to create Reggora loan' };
  }
}

/**
 * Lookup existing Reggora loan by loan_number (or fall back to address search).
 * Used to import existing appraisals without duplicating the Reggora loan record.
 */
export async function findExistingReggoraLoan(loanNumber: string, address?: string): Promise<{ reggoraLoanId?: string; error?: string }> {
  if (!REGGORA_AUTH_TOKEN || !REGGORA_INTEGRATION_KEY) {
    return { error: 'Reggora not configured. Add REGGORA_* env vars and restart.' };
  }
  try {
    // Try exact loan_number search
    let res = await fetch(`${REGGORA_BASE_URL}/loans?loan_number=${encodeURIComponent(loanNumber)}&limit=1`, {
      headers: getReggoraHeaders(),
      cache: 'no-store',
    });
    if (res.ok) {
      const json = await res.json();
      const match = json.data?.loans?.[0];
      if (match?.id) return { reggoraLoanId: match.id };
    }

    // Fallback: search by address snippet if provided
    if (address) {
      const parsed = parsePropertyAddress(address);
      const q = encodeURIComponent(parsed.subject_property_address);
      res = await fetch(`${REGGORA_BASE_URL}/loans?search=${q}&limit=5`, {
        headers: getReggoraHeaders(),
        cache: 'no-store',
      });
      if (res.ok) {
        const json = await res.json();
        const match = (json.data?.loans || []).find((l: any) =>
          l.subject_property_address?.toLowerCase().includes(parsed.subject_property_address.toLowerCase())
        );
        if (match?.id) return { reggoraLoanId: match.id };
      }
    }

    return { reggoraLoanId: undefined };
  } catch (e: any) {
    console.error('findExistingReggoraLoan error', e);
    return { error: e.message || 'Failed to lookup existing Reggora loan' };
  }
}

export async function createReggoraOrder(params: {
  loan: string; // reggora loan id
  products: string[];
  due_date: string; // ISO with Z
  priority: 'Normal' | 'Rush';
  allocation_type: 'automatically' | 'manually';
  vendors?: string[];
  additional_fees?: Array<{ description: string; amount: string }>;
}): Promise<{ orderId?: string; error?: string }> {
  if (!REGGORA_AUTH_TOKEN || !REGGORA_INTEGRATION_KEY) {
    return { error: 'Reggora not configured. Add REGGORA_* env vars and restart.' };
  }
  try {
    const body: any = {
      loan: params.loan,
      products: params.products,
      due_date: params.due_date,
      priority: params.priority,
      allocation_type: params.allocation_type,
    };
    if (params.allocation_type === 'manually' && params.vendors && params.vendors.length > 0) {
      body.vendors = params.vendors;
    }
    if (params.additional_fees && params.additional_fees.length > 0) {
      body.additional_fees = params.additional_fees;
    }

    const res = await fetch(`${REGGORA_BASE_URL}/order`, {
      method: 'POST',
      headers: getReggoraHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text();
      return { error: `Create Reggora order failed: ${res.status} ${txt}` };
    }
    const json = await res.json();
    const orderId: string = json.data;
    if (!orderId) {
      return { error: 'No order ID returned from Reggora' };
    }
    return { orderId };
  } catch (e: any) {
    console.error('createReggoraOrder error', e);
    return { error: e.message || 'Failed to create Reggora order' };
  }
}

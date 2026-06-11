'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClientComponentClient } from '@/lib/supabase';
import { useTenant } from '@/lib/tenant-context';

type FormState = {
  company_name: string;
  contact_name: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  website: string;
  owners: { name: string; percentage: string }[];
  managers: string[];
  additionalUsers: { name: string; email: string; role: string }[];
  products: string[];
  notes: string;
  agreementAccepted: boolean;
  // Note: required corporate docs (operatingAgreement, einLetter, articlesOfOrganization, certificateOfGoodStanding)
  // are managed in separate docFiles state (File[] per DocKey) because they contain binary File objects.
  // On submit, their URLs are collected into payload.documents JSON + agreement_accepted flag is set.
};

// Roles selectable for additional team members in the application form.
// PENDING is intentionally excluded here: it is automatically assigned only to the initial applicant
// during the sign-up / organization application routing process (see /api/pending-organizations POST and approve flow in lib/create-organization.ts).
// Additional team members get proper roles like BROKER_AE or higher.
const additionalUserRoles = [
  'BROKER_AE',
  'ACCOUNT_EXECUTIVE',
  'SENIOR_ACCOUNT_EXECUTIVE',
  'LOAN_PROCESSOR',
  'LOAN_UNDERWRITER',
  'ADMIN',
] as const;

type DocKey = 'operatingAgreement' | 'einLetter' | 'articlesOfOrganization' | 'certificateOfGoodStanding';

// US States for dropdown (50 states + DC for completeness)
const US_STATES = [
  { abbr: 'AL', name: 'Alabama' },
  { abbr: 'AK', name: 'Alaska' },
  { abbr: 'AZ', name: 'Arizona' },
  { abbr: 'AR', name: 'Arkansas' },
  { abbr: 'CA', name: 'California' },
  { abbr: 'CO', name: 'Colorado' },
  { abbr: 'CT', name: 'Connecticut' },
  { abbr: 'DE', name: 'Delaware' },
  { abbr: 'FL', name: 'Florida' },
  { abbr: 'GA', name: 'Georgia' },
  { abbr: 'HI', name: 'Hawaii' },
  { abbr: 'ID', name: 'Idaho' },
  { abbr: 'IL', name: 'Illinois' },
  { abbr: 'IN', name: 'Indiana' },
  { abbr: 'IA', name: 'Iowa' },
  { abbr: 'KS', name: 'Kansas' },
  { abbr: 'KY', name: 'Kentucky' },
  { abbr: 'LA', name: 'Louisiana' },
  { abbr: 'ME', name: 'Maine' },
  { abbr: 'MD', name: 'Maryland' },
  { abbr: 'MA', name: 'Massachusetts' },
  { abbr: 'MI', name: 'Michigan' },
  { abbr: 'MN', name: 'Minnesota' },
  { abbr: 'MS', name: 'Mississippi' },
  { abbr: 'MO', name: 'Missouri' },
  { abbr: 'MT', name: 'Montana' },
  { abbr: 'NE', name: 'Nebraska' },
  { abbr: 'NV', name: 'Nevada' },
  { abbr: 'NH', name: 'New Hampshire' },
  { abbr: 'NJ', name: 'New Jersey' },
  { abbr: 'NM', name: 'New Mexico' },
  { abbr: 'NY', name: 'New York' },
  { abbr: 'NC', name: 'North Carolina' },
  { abbr: 'ND', name: 'North Dakota' },
  { abbr: 'OH', name: 'Ohio' },
  { abbr: 'OK', name: 'Oklahoma' },
  { abbr: 'OR', name: 'Oregon' },
  { abbr: 'PA', name: 'Pennsylvania' },
  { abbr: 'RI', name: 'Rhode Island' },
  { abbr: 'SC', name: 'South Carolina' },
  { abbr: 'SD', name: 'South Dakota' },
  { abbr: 'TN', name: 'Tennessee' },
  { abbr: 'TX', name: 'Texas' },
  { abbr: 'UT', name: 'Utah' },
  { abbr: 'VT', name: 'Vermont' },
  { abbr: 'VA', name: 'Virginia' },
  { abbr: 'WA', name: 'Washington' },
  { abbr: 'WV', name: 'West Virginia' },
  { abbr: 'WI', name: 'Wisconsin' },
  { abbr: 'WY', name: 'Wyoming' },
  { abbr: 'DC', name: 'District of Columbia' },
];

export default function OrganizationApplyPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClientComponentClient();
  const tenant = useTenant();

  const [user, setUser] = useState<any>(null);
  const [loadingUser, setLoadingUser] = useState(true);

  const [form, setForm] = useState<FormState>({
    company_name: '',
    contact_name: '',
    phone: '',
    address: '',
    city: '',
    state: '',
    zip: '',
    website: '',
    owners: [{ name: '', percentage: '' }],
    managers: [''],
    additionalUsers: [{ name: '', email: '', role: additionalUserRoles[0] }],
    products: [],
    notes: '',
    agreementAccepted: false,
  });

  // Separate state for selected corporate document files (support multiple per category)
  const [docFiles, setDocFiles] = useState<Record<DocKey, File[]>>({
    operatingAgreement: [],
    einLetter: [],
    articlesOfOrganization: [],
    certificateOfGoodStanding: [],
  });

  const [loading, setLoading] = useState(false);

  // 2-page process for new org application (per requirements)
  const [currentStep, setCurrentStep] = useState(1);
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const signatureCanvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  // Upload status for better UX
  const [uploadStatus, setUploadStatus] = useState<{
    [key: string]: 'idle' | 'uploading' | 'success' | 'error';
  }>({});

  // AE referral: prefilled from invite link (?referred_by=AE_USER_ID) hides the dropdown; otherwise show selectable from SENIOR+ACCOUNT_EXEC
  const [prefilledReferredBy, setPrefilledReferredBy] = useState<string | null>(null);
  const [aeReferrers, setAeReferrers] = useState<Array<{ id: string; full_name?: string; email?: string; role?: string }>>([]);
  const [selectedReferredBy, setSelectedReferredBy] = useState<string>('');

  // Check if user is authenticated (via Supabase session from email code sign-up)
  useEffect(() => {
    const checkAuth = async () => {
      try {
        // Handle Supabase magic link / custom OTP redirect hash (the #access_token... part)
        // This ensures the session is properly established from the verify link and cleans the URL.
        if (typeof window !== 'undefined' && window.location.hash) {
          await supabase.auth.getSession(); // exchanges hash tokens for session
          // Clean the URL so it becomes clean /apply/organization without the trailing #
          window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
        }

        // Capture referred_by from invite link query (for AE referral dashboards). Hide dropdown if present.
        const refFromQuery = searchParams.get('referred_by');
        if (refFromQuery) {
          setPrefilledReferredBy(refFromQuery);
          setSelectedReferredBy(refFromQuery);
        }

        const { data: { user } } = await supabase.auth.getUser();

        // Ensure freshest user data (metadata from signup) after the magic link hash exchange
        let effectiveUser = user;
        if (user) {
          const { data: { user: refetched } } = await supabase.auth.getUser();
          if (refetched) effectiveUser = refetched;
        }

        if (!effectiveUser) {
          // Preserve the current query (incl. referred_by) across the sign-up redirect so the apply target keeps the AE referral.
          // Clean any stray hash so we don't end up on .../# after the OTP flow.
          if (typeof window !== 'undefined' && window.location.hash) {
            history.replaceState(null, '', window.location.pathname + window.location.search);
          }
          const currentQuery = typeof window !== 'undefined' ? window.location.search : '';
          // Build a FULL absolute redirect URL.
          // Prefer tenant.domain (from useTenant at top of component, resolved via current hostname)
          // so the redirect param to sign-up is guaranteed to be the tenant's domain.
          // This prevents localhost from ever leaking into the OTP flow.
          let origin = '';
          if (tenant && tenant.domain) {
            origin = 'https://' + tenant.domain;
          } else if (typeof window !== 'undefined') {
            origin = window.location.origin;
          }
          const redirectTarget = `${origin}/apply/organization${currentQuery}`;
          router.push(`/sign-up?redirect=${encodeURIComponent(redirectTarget)}`);
          return;
        }

        setUser(effectiveUser);
        setLoadingUser(false);

        // Pre-fill from user metadata + fetch full profile for more data
        const metadata = effectiveUser.user_metadata || {};

        // Try to load existing profile data for better pre-fill
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', effectiveUser.id)
          .single();

        // Pre-fill form from signup metadata (company_name / full_name) and profile
        const md = effectiveUser.user_metadata || {};
        const newForm: Partial<FormState> = {};

        if (md.company_name) newForm.company_name = md.company_name;
        if (md.full_name) newForm.contact_name = md.full_name;
        if (profile?.phone) newForm.phone = profile.phone;

        // Note: Full pre-filling can be expanded (e.g. address fields if stored in profile)
        if (Object.keys(newForm).length > 0) {
          setForm(prev => ({ ...prev, ...newForm }));
        }

        // Also check user metadata for referred_by (in case sign-up flow passed it through)
        if (!refFromQuery && md.referred_by) {
          setPrefilledReferredBy(md.referred_by);
          setSelectedReferredBy(md.referred_by);
        }
      } catch (e: any) {
        const msg = e?.message || 'Unknown Supabase client error';
        console.error('Auth check in apply/organization failed (check NEXT_PUBLIC_SUPABASE_* keys and restart):', msg);

        if (msg.includes('Missing Supabase public environment variables') || msg.includes('NEXT_PUBLIC_SUPABASE')) {
          // Keys missing in this dev server process (e.g. pm2 started from wrong tree without .env.local).
          // Treat as "not signed in" so the intended flow still works:
          // unauthenticated visitor (dashboard AE link, referred_by, direct) → redirect to /sign-up (with redirect param)
          // so they can complete the 6-digit OTP custom signup → land back here to create the user + organization.
          if (typeof window !== 'undefined' && window.location.hash) {
            history.replaceState(null, '', window.location.pathname + window.location.search);
          }
          const currentQuery = typeof window !== 'undefined' ? window.location.search : '';
          // Build a FULL absolute redirect URL.
          // Prefer tenant.domain so we never leak localhost into the redirect param for the OTP flow.
          let origin = '';
          if (tenant && tenant.domain) {
            origin = 'https://' + tenant.domain;
          } else if (typeof window !== 'undefined') {
            origin = window.location.origin;
          }
          const redirectTarget = `${origin}/apply/organization${currentQuery}`;
          router.push(`/sign-up?redirect=${encodeURIComponent(redirectTarget)}`);
        }
        setLoadingUser(false);
      }
    };

    checkAuth();
  }, [supabase, router, searchParams]);

  // (sponsorship loading removed - auto-determined by tenant context now)

  // Load AE referrers (SENIOR_ACCOUNT_EXECUTIVE + ACCOUNT_EXECUTIVE) for the dropdown when not prefilled by invite link.
  useEffect(() => {
    if (prefilledReferredBy) return; // hidden
    const loadAEs = async () => {
      try {
        const { data } = await supabase
          .from('profiles')
          .select('id, full_name, email, role')
          .in('role', ['SENIOR_ACCOUNT_EXECUTIVE', 'ACCOUNT_EXECUTIVE'])
          .order('created_at', { ascending: false });
        setAeReferrers(data || []);
      } catch (e) {
        console.warn('Failed to load AE referrers for dropdown', e);
        setAeReferrers([]);
      }
    };
    loadAEs();
  }, [supabase, prefilledReferredBy]);

  // Dynamic names/addresses for the Lender Licensing Agreement (step 2) and the signed PDFs.
  // Lender = the platform/tenant org ("loan-app" branding or the white-label tenant name + its org address fields via raw_attrs or fallback).
  // Broker = the applying organization (from step 1 form fields the user is entering for their company).
  const isTenantContext = !!(tenant && !tenant.is_root);
  const lenderName = isTenantContext ? (tenant!.name || 'Loan-App') : 'Loan-App';
  const lenderAddress = isTenantContext
    ? ((tenant as any)?.raw_attrs?.address || (tenant as any)?.raw_attrs?.physical_address || (tenant as any)?.address || `${tenant!.name} (address on file with platform)`)
    : '6203 San Ignacio Ave #110, San Jose, CA 95119';

  const lenderFullAddress = isTenantContext && tenant
    ? [
        (tenant as any)?.raw_attrs?.address || (tenant as any)?.address || '',
        (tenant as any)?.raw_attrs?.city || (tenant as any)?.city || '',
        (tenant as any)?.raw_attrs?.state || (tenant as any)?.state || '',
        (tenant as any)?.raw_attrs?.zip || (tenant as any)?.zip || '',
      ].filter(Boolean).join(', ') || lenderAddress
    : lenderAddress;
  const lenderEmail = isTenantContext
    ? ((tenant as any)?.raw_attrs?.from_email || (tenant as any)?.from_email || 'contact via platform')
    : 'loans@loan-app.example';

  const brokerName = form.company_name || '[Full Legal Name of Broker]';
  const brokerAddress = [form.address, form.city, form.state, form.zip].filter(Boolean).join(', ') || '[Broker Address]';
  const brokerSigner = form.contact_name || '[Authorized Signer]';

  // Dynamic current date for agreement text (per user request: "7th day of October, 2026" style)
  const today = new Date();
  const dayNum = today.getDate();
  const daySuffix = (dayNum % 10 === 1 && dayNum !== 11) ? 'st' : (dayNum % 10 === 2 && dayNum !== 12) ? 'nd' : (dayNum % 10 === 3 && dayNum !== 13) ? 'rd' : 'th';
  const currentMonth = today.toLocaleString('en-US', { month: 'long' });
  const currentYear = today.getFullYear();
  const formattedEffectiveDate = `${dayNum}${daySuffix} day of ${currentMonth}, ${currentYear}`;
  const formattedSigDate = `${currentMonth} ${dayNum}, ${currentYear}`;


  // Signature pad helpers (mouse drawing for step 2 agreement)
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, 0.8, 0, Math.PI * 2);
    ctx.fillStyle = '#111827';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.stroke();
  };

  const endDrawing = () => {
    setIsDrawing(false);
    const canvas = signatureCanvasRef.current;
    if (canvas) {
      setSignatureData(canvas.toDataURL('image/png'));
    }
  };

  const clearSignature = () => {
    const canvas = signatureCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    setSignatureData(null);
  };

  // Simple 2-step wizard per clarification: Step 1 = info collection (hidden when on step 2), Step 2 = full agreement (no inner scroll block, canvas embedded in signature section of the agreement text).
  // When step 2 viewed, step 1 content is hidden.
  const TOTAL_STEPS = 2;

  // ==================== HANDLERS ====================
  const addOwner = () => setForm(p => ({ ...p, owners: [...p.owners, { name: '', percentage: '' }] }));
  const updateOwner = (index: number, field: 'name' | 'percentage', value: string) => {
    const newOwners = [...form.owners];
    newOwners[index][field] = value;
    setForm(p => ({ ...p, owners: newOwners }));
  };
  const removeOwner = (index: number) => setForm(p => ({ ...p, owners: p.owners.filter((_, i) => i !== index) }));

  const addManager = () => setForm(p => ({ ...p, managers: [...p.managers, ''] }));
  const updateManager = (index: number, value: string) => {
    const newManagers = [...form.managers];
    newManagers[index] = value;
    setForm(p => ({ ...p, managers: newManagers }));
  };
  const removeManager = (index: number) => setForm(p => ({ ...p, managers: p.managers.filter((_, i) => i !== index) }));

  const addAdditionalUser = () => setForm(p => ({ ...p, additionalUsers: [...p.additionalUsers, { name: '', email: '', role: additionalUserRoles[0] }] }));
  const updateAdditionalUser = (index: number, field: 'name' | 'email' | 'role', value: string) => {
    const newUsers = [...form.additionalUsers];
    newUsers[index][field] = value;
    setForm(p => ({ ...p, additionalUsers: newUsers }));
  };
  const removeAdditionalUser = (index: number) => setForm(p => ({ ...p, additionalUsers: p.additionalUsers.filter((_, i) => i !== index) }));

  const toggleProduct = (product: string) => {
    setForm(p => ({
      ...p,
      products: p.products.includes(product)
        ? p.products.filter(p => p !== product)
        : [...p.products, product]
    }));
  };

  // File handlers for multi-file support + local previews (using object URLs for display)
  const addFilesForDoc = (key: DocKey, newFiles: FileList | null) => {
    if (!newFiles || newFiles.length === 0) return;
    const filesArray = Array.from(newFiles);
    setDocFiles(prev => ({
      ...prev,
      [key]: [...prev[key], ...filesArray],
    }));
    setUploadStatus(prev => ({ ...prev, [key]: 'idle' }));
  };

  const removeFileForDoc = (key: DocKey, index: number) => {
    setDocFiles(prev => ({
      ...prev,
      [key]: prev[key].filter((_, i) => i !== index),
    }));
  };

  const uploadFile = async (fileOrBlob: File | Blob, pathPrefix: string, originalName?: string): Promise<string | null> => {
    if (!fileOrBlob) return null;
    const isBlob = !(fileOrBlob instanceof File);
    const baseName = originalName || (fileOrBlob instanceof File ? fileOrBlob.name : 'document.pdf');
    const safeName = baseName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9.-]/g, '');
    const fileName = `${pathPrefix}/${Date.now()}-${safeName}`;
    const contentType = fileOrBlob instanceof File ? fileOrBlob.type : 'application/pdf';

    try {
      const { data, error } = await supabase.storage
        .from('organization-documents') // Ensure bucket 'organization-documents' exists in Supabase (public read or signed with policies for org docs)
        .upload(fileName, fileOrBlob, { upsert: true, contentType });
      if (error) {
        console.error('Upload error for', baseName, error);
        return null;
      }
      // Use signed URL (long expiry) instead of public, for reliable access even on private bucket
      const { data: signedData, error: signErr } = await supabase.storage
        .from('organization-documents')
        .createSignedUrl(fileName, 60 * 60 * 24 * 365 * 5); // 5 years
      if (signErr || !signedData?.signedUrl) {
        console.error('Signed URL error for', baseName, signErr);
        return null;
      }
      return signedData.signedUrl;
    } catch (e) {
      console.error('Upload failed', e);
      return null;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    // 5-stage flow: must be on final (agreement) step with signature
    if (currentStep !== 2 || !signatureData) {
      alert('Please complete step 1, then on the Lender Licensing Agreement (step 2) provide your signature before submitting.');
      return;
    }

    // Enforce required corporate document uploads (all 4 categories must have >=1 file)
    const requiredDocChecks: { key: DocKey; label: string }[] = [
      { key: 'operatingAgreement', label: 'Company Operating Agreement' },
      { key: 'einLetter', label: 'Company EIN Letter' },
      { key: 'articlesOfOrganization', label: 'Company Articles of Organization' },
      { key: 'certificateOfGoodStanding', label: 'Company Certificate of Good Standing' },
    ];
    for (const { key, label } of requiredDocChecks) {
      if (!docFiles[key] || docFiles[key].length === 0) {
        alert(`Required upload missing: ${label}. Please select at least one file for each corporate document category.`);
        setLoading(false);
        return;
      }
    }

    setLoading(true);
    setUploadStatus({});

    const documents: Record<string, string | string[]> = {};
    const errors: string[] = [];

    // Helper to upload a list for a doc category (supports multiples)
    const uploadCategory = async (key: DocKey, label: string, storageSubdir: string) => {
      const files = docFiles[key];
      if (!files || files.length === 0) return;
      setUploadStatus(prev => ({ ...prev, [key]: 'uploading' }));
      const urls: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const url = await uploadFile(f, `org-${user.id}/${storageSubdir}`);
        if (url) {
          urls.push(url);
        } else {
          errors.push(`Failed to upload ${label} file: ${f.name}`);
        }
      }
      if (urls.length > 0) {
        documents[`${storageSubdir.replace(/-/g, '_')}_url`] = urls.length === 1 ? urls[0] : urls;
        setUploadStatus(prev => ({ ...prev, [key]: 'success' }));
      } else {
        setUploadStatus(prev => ({ ...prev, [key]: 'error' }));
      }
    };

    // Upload all 4 corporate document categories (wait for completion)
    await uploadCategory('operatingAgreement', 'Operating Agreement', 'operating-agreement');
    await uploadCategory('einLetter', 'EIN Letter', 'ein-letter');
    await uploadCategory('articlesOfOrganization', 'Articles of Organization', 'articles');
    await uploadCategory('certificateOfGoodStanding', 'Certificate of Good Standing', 'good-standing');

    if (errors.length > 0) {
      console.warn('Upload errors during submit:', errors);
    }

    // PDF generation is DEFERRED to approval time (per requirements).
    // On submit we only persist the 4 required corporate docs + the raw signature (data URL).
    // When an admin approves via /admin/applications (or PATCH), the approve flow will:
    //   - capture approver (Lender side) signature
    //   - generate both full signed PDFs (application summary + the Lender Licensing Agreement with both sigs embedded, dates, populated names/addresses)
    //   - upload them to organization-documents
    //   - store the URLs on the created organization (raw_attrs or documents)
    //   - email copies/links to the applicant/creator.
    // (No client-side PDF work or upload of PDFs here anymore.)
    // The signatureData is already in the payload below.

    if (errors.length > 0) {
      console.warn('Upload errors during submit:', errors);
    }

    // Resolve parent using tenant (root home = L1 under platform root, tenant home = L2 under that tenant)
    // Root "Loan-App Platform" ID: org_dc5bc24f25b7 (provided for fallback)
    const ROOT_ORG_ID = 'org_dc5bc24f25b7';
    let resolvedParentId: string | undefined = undefined;
    if (tenant) {
      if (tenant.is_root || !tenant.parent_organization_id) {
        // L1 under root
        try {
          const { data: root } = await supabase
            .from('organizations')
            .select('id')
            .or('slug.eq.loan-app-platform,is_root.eq.true')
            .limit(1)
            .maybeSingle();
          resolvedParentId = root?.id || ROOT_ORG_ID;
        } catch {
          resolvedParentId = ROOT_ORG_ID;
        }
      } else {
        resolvedParentId = tenant.id;
      }
    } else {
      resolvedParentId = ROOT_ORG_ID;
    }

    const payload = {
      company_name: form.company_name || (user.user_metadata?.company_name as string) || '',
      contact_name: form.contact_name || user.user_metadata?.full_name || '',
      phone: form.phone || undefined,
      email: user.email,
      address: form.address,
      city: form.city,
      state: form.state,
      zip: form.zip,
      website: form.website,
      owners: form.owners,
      managers: form.managers,
      additionalUsers: form.additionalUsers,
      products: form.products,
      notes: form.notes,
      agreement_accepted: true,
      signature: signatureData || undefined,
      documents: Object.keys(documents).length > 0 ? documents : undefined,
      referred_by: prefilledReferredBy || selectedReferredBy || undefined,
      parent_organization_id: resolvedParentId,
    };

    try {
      // Forward the Supabase access token (from email code sign-up auth session) so server
      // createServerClient + auth.getUser() succeeds for this flow.
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      }

      const response = await fetch('/api/pending-organizations', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      if (!response.ok) {
        alert('Failed: ' + (result.error || 'Unknown error'));
      } else {
        const successMsg = errors.length > 0
          ? `✅ Application submitted! Some uploads had issues (see console). Required documents + your signature recorded where possible.`
          : '✅ Application submitted successfully! All required corporate documents uploaded. Your signature was saved. The full signed application PDF + Lender Licensing Agreement PDF (with your signature + approver signature) will be generated, stored on the organization profile, and emailed to you when an admin approves the application.';
        alert(successMsg);
        router.push('/thank-you?org=1');
      }
    } catch (err: any) {
      alert('Error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loadingUser) {
    return <div className="p-10 text-center">Loading...</div>;
  }

  if (!user) {
    return <div className="p-10 text-center">Redirecting to sign up...</div>;
  }

  return (
    <div className="max-w-3xl mx-auto p-8">
      <h1 className="text-4xl font-bold mb-2">Organization Application</h1>
      <p className="text-gray-600 mb-10">
        Welcome, {form.contact_name || user.user_metadata?.full_name || user.email} — applying for <strong>{form.company_name || user.user_metadata?.company_name || 'your company'}</strong>
      </p>

      <form onSubmit={handleSubmit} className="bg-white rounded-3xl border p-10 space-y-10">
        {/* Step 1 content: hidden when currentStep === 2 (per clarification: only view step 2 when on it) */}
        <div className={currentStep === 2 ? 'hidden' : ''}>
        {/* Company Name and Contact Name - prefilled from signup, now editable in case of mixup */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium mb-2">Company Name <span className="text-red-500">*</span></label>
            <input 
              value={form.company_name} 
              onChange={e => setForm({...form, company_name: e.target.value})}
              className="w-full px-5 py-4 border rounded-2xl" 
              required
            />
            <p className="text-xs text-gray-500 mt-1">From your signup. Edit if needed.</p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Contact / Your Full Name <span className="text-red-500">*</span></label>
            <input 
              value={form.contact_name} 
              onChange={e => setForm({...form, contact_name: e.target.value})}
              className="w-full px-5 py-4 border rounded-2xl" 
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Business Phone</label>
            <input 
              type="tel"
              value={form.phone} 
              onChange={e => setForm({...form, phone: e.target.value})}
              className="w-full px-5 py-4 border rounded-2xl" 
              placeholder="(555) 123-4567"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Website URL</label>
            <input 
              type="text" 
              value={form.website} 
              onChange={e => setForm({...form, website: e.target.value})} 
              className="w-full px-5 py-4 border rounded-2xl" 
              placeholder="yourcompany.com" 
            />
          </div>
        </div>

        {/* Sponsorship section removed per requirements.
             Parent is now auto-determined via TenantContext:
             - Coming from root home (is_root) → new org is Level 1 under root "Loan-App Platform"
             - Coming from a tenant's home → new org is Level 2 under that tenant.
             Root org ID (for reference): org_dc5bc24f25b7 */}

        {/* Address Fields */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium mb-2">Address</label>
            <input value={form.address} onChange={e => setForm({...form, address: e.target.value})} className="w-full px-5 py-4 border rounded-2xl" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">City</label>
            <input value={form.city} onChange={e => setForm({...form, city: e.target.value})} className="w-full px-5 py-4 border rounded-2xl" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">State</label>
            <select 
              value={form.state} 
              onChange={e => setForm({...form, state: e.target.value})} 
              className="w-full px-5 py-4 border rounded-2xl bg-white"
              required
            >
              <option value="">Select a state...</option>
              {US_STATES.map(s => (
                <option key={s.abbr} value={s.abbr}>{s.name} ({s.abbr})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">ZIP Code</label>
            <input value={form.zip} onChange={e => setForm({...form, zip: e.target.value})} className="w-full px-5 py-4 border rounded-2xl" />
          </div>
        </div>

        {/* Website moved to top contact grid for better grouping with phone */}

        {/* Owners */}
        <div>
          <label className="block text-sm font-medium mb-3">Company Owners (25%+ ownership)</label>
          {form.owners.map((owner, index) => (
            <div key={index} className="flex gap-4 mb-4">
              <input 
                placeholder="Owner Name" 
                value={owner.name} 
                onChange={(e) => updateOwner(index, 'name', e.target.value)} 
                className="flex-1 px-5 py-4 border rounded-2xl" 
              />
              <input 
                placeholder="% Ownership" 
                type="number" 
                value={owner.percentage} 
                onChange={(e) => updateOwner(index, 'percentage', e.target.value)} 
                className="w-32 px-5 py-4 border rounded-2xl" 
              />
              <button type="button" onClick={() => removeOwner(index)} className="text-red-600">Remove</button>
            </div>
          ))}
          <button type="button" onClick={addOwner} className="text-blue-600 hover:underline">+ Add Owner</button>
        </div>

        {/* Managers (from prior form state - now surfaced for completeness) */}
        <div>
          <label className="block text-sm font-medium mb-3">Company Managers / Authorized Signers (optional)</label>
          {form.managers.map((mgr, index) => (
            <div key={index} className="flex gap-4 mb-4">
              <input 
                placeholder="Manager / Signer Full Name" 
                value={mgr} 
                onChange={(e) => updateManager(index, e.target.value)} 
                className="flex-1 px-5 py-4 border rounded-2xl" 
              />
              <button type="button" onClick={() => removeManager(index)} className="text-red-600">Remove</button>
            </div>
          ))}
          <button type="button" onClick={addManager} className="text-blue-600 hover:underline">+ Add Manager / Signer</button>
        </div>

        {/* Additional Users */}
        <div>
          <label className="block text-sm font-medium mb-3">Additional Team Members (will be created upon approval)</label>
          {form.additionalUsers.map((u, index) => (
            <div key={index} className="flex gap-4 mb-4 items-end">
              <input placeholder="Full Name" value={u.name} onChange={(e) => updateAdditionalUser(index, 'name', e.target.value)} className="flex-1 px-5 py-4 border rounded-2xl" />
              <input placeholder="Email Address" type="email" value={u.email} onChange={(e) => updateAdditionalUser(index, 'email', e.target.value)} className="flex-1 px-5 py-4 border rounded-2xl" />
              <select 
                value={u.role || additionalUserRoles[0]} 
                onChange={(e) => updateAdditionalUser(index, 'role', e.target.value)} 
                className="px-5 py-4 border rounded-2xl text-sm"
              >
                {/* PENDING is reserved for the initial applicant during sign-up/apply; additional team members cannot be created as PENDING */}
                {additionalUserRoles.map(r => (
                  <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
                ))}
              </select>
              <button type="button" onClick={() => removeAdditionalUser(index)} className="text-red-600">Remove</button>
            </div>
          ))}
          <button type="button" onClick={addAdditionalUser} className="text-blue-600 hover:underline">+ Add Team Member</button>
        </div>

        {/* Products */}
        <div>
          <label className="block text-sm font-medium mb-3">Products Offered</label>
          <div className="grid grid-cols-2 gap-3">
            {['Bridge Loans', 'RTL Loans', 'DSCR Loans', 'Business Purpose', 'Retail Loans'].map(product => (
              <label key={product} className="flex items-center gap-3 cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={form.products.includes(product)}
                  onChange={() => toggleProduct(product)} 
                  className="w-5 h-5" 
                />
                <span>{product}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Corporate Document Uploads - improved with multi-file, previews, required, status */}
        <div className="border-t pt-8">
          <label className="block text-sm font-medium mb-3">
            Corporate Documents <span className="text-red-500">*</span> (required)
          </label>
          <p className="text-xs text-gray-500 mb-4">Upload PDFs or images. Multiple files per category supported. <strong>All four documents below are required</strong> and will be uploaded to the 'organization-documents' Supabase Storage bucket on submit. URLs saved to pending_organizations.documents JSON.</p>

          <div className="space-y-6">
            {([
              { key: 'operatingAgreement' as DocKey, label: 'Company Operating Agreement', hint: 'LLC/Partnership operating agreement or equivalent' },
              { key: 'einLetter' as DocKey, label: 'Company EIN Letter / Tax ID Confirmation', hint: 'IRS EIN confirmation letter or equivalent' },
              { key: 'articlesOfOrganization' as DocKey, label: 'Company Articles of Organization / Incorporation', hint: 'Filed articles or certificate of formation' },
              { key: 'certificateOfGoodStanding' as DocKey, label: 'Company Certificate of Good Standing', hint: 'Current certificate from state of formation' },
            ] as const).map(({ key, label, hint }) => {
              const files = docFiles[key];
              const status = uploadStatus[key] || 'idle';
              return (
                <div key={key} className="border rounded-2xl p-4 bg-white">
                  <div className="flex items-baseline justify-between mb-2">
                    <div>
                      <span className="font-medium text-sm">{label} <span className="text-red-500">*</span></span>
                      <span className="ml-2 text-[10px] text-gray-400">(PDF / image)</span>
                    </div>
                    {status === 'uploading' && <span className="text-xs text-blue-600">Uploading...</span>}
                    {status === 'success' && <span className="text-xs text-green-600">✓ Uploaded on submit</span>}
                    {status === 'error' && <span className="text-xs text-red-600">Upload error (will retry?)</span>}
                  </div>
                  <p className="text-[10px] text-gray-500 mb-3">{hint}</p>

                  <div className="flex items-center gap-3">
                    <label className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 border border-dashed rounded-2xl text-sm hover:bg-gray-50">
                      <input 
                        type="file" 
                        multiple
                        accept=".pdf,.png,.jpg,.jpeg,.webp" 
                        className="hidden"
                        onChange={(e) => addFilesForDoc(key, e.target.files)}
                      />
                      + Choose file(s)
                    </label>
                    <span className="text-xs text-gray-400">or drop (multiple OK)</span>
                  </div>

                  {/* Selected files list + previews */}
                  {files.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {files.map((file, idx) => {
                        const isImage = file.type.startsWith('image/');
                        const localPreview = isImage ? URL.createObjectURL(file) : null; // note: urls leak slightly but ok for form lifetime
                        return (
                          <div key={idx} className="flex items-center gap-3 p-2 bg-gray-50 rounded-xl text-sm">
                            {isImage && localPreview && (
                              <img 
                                src={localPreview} 
                                alt={file.name} 
                                className="w-10 h-10 object-cover rounded border" 
                                onLoad={() => URL.revokeObjectURL(localPreview)} // cleanup attempt
                              />
                            )}
                            {!isImage && (
                              <div className="w-10 h-10 flex items-center justify-center bg-red-100 text-red-600 text-[10px] rounded border font-mono">PDF</div>
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="truncate font-medium">{file.name}</div>
                              <div className="text-[10px] text-gray-500">{(file.size / 1024).toFixed(0)} KB • {file.type || 'file'}</div>
                            </div>
                            <button 
                              type="button" 
                              onClick={() => removeFileForDoc(key, idx)}
                              className="text-red-500 hover:text-red-700 px-2 text-xs"
                              title="Remove this file"
                            >
                              ✕
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {files.length === 0 && (
                    <p className="text-xs text-red-600 mt-1">No file selected yet — this is a required document.</p>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-xs text-gray-500 mt-3">All selected files will be uploaded securely when you submit the application. Progress shown above during submit.</p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Additional Notes</label>
          <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={5} className="w-full px-5 py-4 border rounded-2xl" />
        </div>

        {/* AE Referral "Referred by" — shown as dropdown from SENIOR_ACCOUNT_EXECUTIVE + ACCOUNT_EXECUTIVE.
            Hidden (and prefilled) when arriving via AE invite link (?referred_by=...) to preserve the referral attribution for dashboards/hierarchy.
            Value is sent in payload to /api/pending-organizations and synced to organizations on approve. */}
        {!prefilledReferredBy ? (
          <div className="border-t pt-8">
            <label className="block text-sm font-medium mb-2">Referred by (Account Executive / Senior AE)</label>
            <select
              value={selectedReferredBy}
              onChange={(e) => setSelectedReferredBy(e.target.value)}
              className="w-full px-5 py-4 border rounded-2xl bg-white"
            >
              <option value="">Select referring AE (optional)</option>
              {aeReferrers.map((ae) => (
                <option key={ae.id} value={ae.id}>
                  {ae.full_name || ae.email} {ae.role ? `(${ae.role.replace(/_/g, ' ')})` : ''}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">Select the Senior or Account Executive who referred you. This powers AE dashboards, team hierarchy, and loan filtering by assigned brokers.</p>
          </div>
        ) : (
          <div className="text-sm text-purple-700 bg-purple-50 border border-purple-200 rounded-2xl p-4">
            ✓ Referred by pre-filled from your invite link (AE user ID: <span className="font-mono">{prefilledReferredBy}</span>). Dropdown hidden to preserve attribution.
          </div>
        )}

          {/* Next button for step 1, inside the info wrapper so it hides with step 1 */}
          <button
            type="button"
            onClick={() => setCurrentStep(2)}
            className="w-full py-5 bg-blue-600 text-white rounded-3xl font-semibold text-xl hover:bg-blue-700 mt-4"
          >
            Next: Lender Licensing Agreement (Step 2 of 2)
          </button>
        </div> {/* end of step 1 info content wrapper (hidden on step 2) */}

        {currentStep === 2 && (
          <div className="border-t pt-8">
            <div className="mb-2 text-xs uppercase tracking-wider text-gray-500">Step 2 of 2</div>
            <h2 className="text-2xl font-semibold mb-2">Lender Licensing Agreement</h2>
            <p className="text-sm text-gray-600 mb-4">Review the full terms below (Lender name/address from root org address or tenant org address, city, state, zip; Broker details from the information you entered). The drawing canvas is placed inside the agreement at the signature section. Your signature is saved with the application. The full signed PDFs are generated when the org is approved (approver adds Lender signature then), stored on the organization profile, and emailed to you.</p>

            {/* Full agreement content — no individual block scroll bar (the content is part of the page flow). */}
            <div className="text-[12.5px] leading-relaxed p-3 mb-4 prose prose-sm bg-gray-50 rounded-xl">

              {/* Exact requested paragraph with dynamic date and Lender address from org (root or tenant) fields */}
              <p className="mb-3">
                This Lender Licensing Agreement (the “Agreement”), is entered into this <strong>{formattedEffectiveDate}</strong> (the “Effective Date”) between Loan-App, a platform operator, located at <strong>{lenderFullAddress}</strong> (“Lender”) and {brokerName}, with an address at {brokerAddress} (“Broker”). Lender and Broker are herein referred to as “Parties”, individually, and “Parties”, collectively.
              </p>

              <p className="mb-3">
                Broker is in the business of originating and Lender is in the business of making loans secured by residential real estate (“Loans”),
                and Broker and Lender wish for Broker to submit to Lender Loan Submission Packages for its consideration. Loans submitted by Broker
                may be funded directly by Lender, funded through a warehouse lending facility, or assigned or sold to third-party investors at Lender’s discretion.
              </p>

              <p className="mb-4">
                THEREFORE, in consideration of the mutual promises contained herein, and other good and sufficient consideration, the receipt and adequacy of which is hereby acknowledged by both Parties, the Parties above stated agree as follows:
              </p>

              <p className="mb-4">The purpose of this Agreement is to set forth the Parties’ responsibilities and rights pertaining to mortgage loan applications the Broker may from time to time submit to Lender for consideration.</p>

              <h4 className="font-semibold mt-4 mb-1">SECTION 1: BROKER RESPONSIBILITIES</h4>
              <p className="mb-2"><strong>1.1</strong> Broker agrees to originate, prepare, process, and deliver to Lender Loan Submission Packages that are taken by Broker in accordance with all Applicable Laws. The term “Applicable Laws” means all applicable federal, state and local laws, regulations, opinions, and guidelines; agency guidelines; standard industry practices; and all policies, procedures and guidelines issued, posted or published by Lender on its website or otherwise, which may be amended from time to time, that pertain to Loan origination, brokering, lending, and servicing in the states or jurisdictions where the real property proposed on the application to secure the Loan (the “Subject Property”) is located.</p>
              <p className="mb-2"><strong>1.2</strong> Broker shall submit to Lender “Loan Submission Packages” which means a loan application signed by applicant(s), and such credit, financial, and other information and documentation necessary for Lender to evaluate and underwrite the Loan application. Broker shall assist Lender in obtaining any additional information as requested.</p>
              <p className="mb-2"><strong>1.3</strong> Broker shall notify Lender in writing immediately (but not later than three (3) business days of its discovery) of any suspected fraud, error, omission, misrepresentation, negligence, complaint, or similar occurrence by any party with respect to any Loan Submission Package.</p>
              <p className="mb-2"><strong>1.4</strong> Without limiting any other provision of this Agreement, Broker shall not discriminate with respect to any applicant and related loan in violation of Applicable Laws. Lender may terminate this Agreement for Broker’s failure to comply with all fair lending laws and regulations. Broker acknowledges that Broker: (i) has implemented a policy to support fair and responsible originations, brokering and lending in compliance with Applicable Laws; and (ii) will review applications for conformity with Applicable Laws.</p>
              <p className="mb-2"><strong>1.5</strong> Within ten (10) business days of Lender’s written request at any time (including after termination of this Agreement), Broker shall provide additional documents or information and take all actions necessary to remedy any matter not in compliance with Applicable Laws.</p>
              <p className="mb-2"><strong>1.6</strong> Broker shall notify Lender within ten (10) business days: (a) of any material change in its financial condition, executive management, or broker application submission; (b) if any representation or warranty in this Agreement is or becomes untrue; (c) of Broker’s receipt of a writing from any lender or investor demanding that Broker indemnify such party or purchase a loan; and (d) if Broker enters into a decree or order with or receives notice of the finalization of an administrative enforcement action by any agency, regulator or governmental sponsored entity.</p>
              <p className="mb-2"><strong>1.7</strong> Upon thirty (30) business days’ notice from Lender, Broker shall provide to Lender any and all documentation or information Lender reasonably requires regarding Lender including evidence of bonds, insurance, and licenses.</p>
              <p className="mb-2"><strong>1.8</strong> Broker shall notify Lender immediately if Broker receives a subpoena relating to this Agreement or any Mortgage Loan submitted to Lender.</p>

              <h4 className="font-semibold mt-4 mb-1">SECTION 2: LENDER RESPONSIBILITIES</h4>
              <p className="mb-2"><strong>2.1</strong> Upon receipt of a Loan Submission Package from Broker, Lender may underwrite and approve or deny the Loan Submission Package based on Lender’s underwriting criteria, rules and regulations, and secondary market standards. Nothing herein constitutes any representation or commitment of Lender that it will extend credit to any applicant, and Lender’s determination as to the creditworthiness of any applicant is final and conclusive.</p>
              <p className="mb-2">A mortgage loan resulting from Broker’s submission of a Loan Submission Package (“Mortgage Loan”) may be closed in the name of Lender, funded through a warehouse lending facility utilized by Lender, or assigned or sold to a third-party investor or purchaser at Lender’s discretion.</p>
              <p className="mb-2"><strong>2.2</strong> Lender shall compensate Broker for its performance of services under this Agreement in connection with each Mortgage Loan as set forth in an Addendum to this Agreement which is attached hereto and incorporated herein by reference and which Lender and Broker may revise as set forth therein. Broker shall not charge, accept, or pay any compensation except as permitted by Applicable Laws. Broker’s compensation under this Agreement shall be the same for all Loan Submission Packages submitted by or on behalf of Broker regardless of the branch, office, or geographic location of the loan originator.</p>

              <h4 className="font-semibold mt-4 mb-1">SECTION 3: REPRESENTATIONS AND WARRANTIES OF THE BROKER</h4>
              <p className="mb-2">Broker represents and warrants to Lender, as an inducement for entering into this Agreement and making any Mortgage Loan, that as of the date of this Agreement, at the time of each Loan Submission Package delivered by Broker, through the closing and funding date of any Mortgage Loan and while any Mortgage Loan remains outstanding, all the following are true, complete, and accurate:</p>
              <p className="mb-2"><strong>3.1</strong> All statements Broker made, and all documents Broker provided to Lender in connection with Lender’s broker application package remain true, complete, and correct.</p>
              <p className="mb-2"><strong>3.2</strong> For each application submitted by Broker to Lender stating it is for a business or commercial purpose, (a) no portion of the Mortgage Loan proceeds shall be for personal, family or household use; and (b) no applicant, borrower or their family members shall occupy or live in the Subject Property.</p>
              <p className="mb-2"><strong>3.3</strong> Broker is duly organized and in good standing in the state of its formation and qualified to conduct business in each state where a Subject Property is situated.</p>
              <p className="mb-2"><strong>3.4</strong> Broker has the requisite corporate authority, power, and capacity to enter into this Agreement, and Broker’s compliance with the terms and conditions of this Agreement will not violate the terms of any governing or organizational instrument of Broker or any other instrument or agreement to which Broker is a party.</p>
              <p className="mb-2"><strong>3.5</strong> Broker, its employees, and all other persons required to be licensed under Applicable Laws hold the required licenses to accept and process each application, and Broker will notify Lender if a license issued to Broker, or its employees, is revoked or a licensing authority determines not to renew a license.</p>
              <p className="mb-2"><strong>3.6</strong> Broker does not employ anyone who is listed on HUD’s debarment list, or Fannie Mae or Freddie Mac’s exclusionary list, or who is otherwise not permitted to be employed by a company that originates loans to be insured, subsidized or guaranteed by or delivered to any governmental, quasi-governmental or government-sponsored agency.</p>
              <p className="mb-2"><strong>3.7</strong> Broker has a process which accurately monitors and updates NMLS licensing and registration as required by Applicable Laws.</p>
              <p className="mb-2"><strong>3.8</strong> Broker is in compliance with all Applicable Laws including, but not limited to federal, state and local anti-money laundering laws, orders and regulations to the extent applicable to Broker, including without limitation, the USA Patriot Act of 2001, the Bank Secrecy Act and the regulations of the Office of Foreign Assets Control (“OFAC”).</p>
              <p className="mb-2"><strong>3.9</strong> Broker has a process to check and monitor the OFAC list for all new hires and participants in any Loan Submission Package.</p>
              <p className="mb-2"><strong>3.10</strong> Broker brokered each Mortgage Loan and paid and received compensation in compliance with, and each Loan Submission Package and documents provided for each Mortgage Loan are in compliance with: (i) Applicable Laws, including but not limited to, rules promulgated by the Consumer Financial Protection Bureau (“CFPB”) and authoritative state regulatory agencies; (ii) Prohibitions on unfair lending; unfair and deceptive acts and practices; and unethical conduct; (iii) Applicable Laws for providing disclosures accurately and timely, including stating on the disclosure the date the disclosure was provided to the applicant(s); (iv) Applicable Laws requiring Broker to ensure there is/will be a Tangible Net Benefit to borrower(s) for the Loan submitted; (v) Applicable Laws related to anti-steering and that no applicant was encouraged or required to select a loan product offered by the Broker which is a higher cost product designed for a less creditworthy applicant...; and (vi) Applicable Laws related to fee and compensation restrictions and requirements, including loan officer compensation, fee caps, and proper disclosure of fees to applicant(s).</p>
              <p className="mb-2"><strong>3.11 – 3.23</strong> (Additional reps &amp; warranties regarding quality control, complaints, privacy/Gramm-Leach-Bliley, appraisals, conflicts of interest, no fraud/misrep, bona fide employee origination, genuineness of documents, disclosures, first right of refusal on program changes, ownership of funded loans, no rescission rights, QC plan, fees, system access credentials, no pending actions, website terms, reporting, etc. — full text presented on-screen and incorporated into the signed PDF.)</p>

              <h4 className="font-semibold mt-4 mb-1">SECTION 4: QUALITY CONTROL</h4>
              <p className="mb-2"><strong>4.1</strong> Broker shall maintain a Quality Control Program which shall be acceptable to and comply with all Applicable Laws. Broker shall upon request make available copies of Broker’s written policies, procedures, internal controls, and training materials... and provide Lender access during normal business hours to the offices of Broker in order for Lender to make appropriate on-site reviews...</p>

              <h4 className="font-semibold mt-4 mb-1">SECTION 5: PRIVACY</h4>
              <p className="mb-2"><strong>5.1 – 5.2</strong> All customer information in the possession of either Party is and shall remain confidential and proprietary... Parties agree to comply with all Applicable Laws applicable to the protection and privacy of consumer information, including without limitation, the privacy provisions of the Gramm-Leach-Bliley Act... Each Party will immediately notify the other party upon identification of a breach which impacts the safety or confidentiality of consumer information...</p>

              <h4 className="font-semibold mt-4 mb-1">SECTION 6: AUDITS &amp; EXAMINATIONS</h4>
              <p className="mb-2"><strong>6.1 – 6.3</strong> Broker understands that Lender is or may be subject to various laws, regulations, and/or secondary market investor requirements... Periodic examinations may be performed by Lender, its agents, representatives... Broker acknowledges the authority of Lender to perform such audits... Lender shall provide no less than seven (7) days’ notice in advance of such audit, examination or inspection...</p>

              <h4 className="font-semibold mt-4 mb-1">SECTION 7: INDEMNIFICATION &amp; DISPUTE RESOLUTION</h4>
              <p className="mb-2"><strong>7.1</strong> Broker shall indemnify and hold Lender and its past, present and future directors, officers, shareholders, employees, agents, representatives, subsidiaries, attorneys, partners, and successors and assigns (“Indemnified Parties”) harmless from and against, and will reimburse the Indemnified Parties with respect to, all losses, claims, damages, liability, costs, fees, and expenses... arising directly or indirectly out of or in connection with: (i) inaccuracy or breach of any warranty or representation made by Broker in this Agreement; (ii) the breach by Broker of any obligation or covenant...; (iii) any acts or omissions of, or services provided by, Broker...; (iv) any claim by a borrower... resulting from Lender’s failure or refusal to fund a loan...; (v) Broker’s violation of any Applicable Laws; (vi) Broker’s negligent or willful act... including mortgage fraud; or (vii) a repurchase or required reimbursement... </p>
              <p className="mb-2"><strong>7.2</strong> In the event of any complaint, claim, legal proceeding or other action against Lender or Broker by a Mortgage Loan applicant or borrower, Lender shall have the exclusive right to determine the conduct and defense of such legal proceeding or investigation... Broker shall pay Lender its reasonable share of legal costs and expenses.</p>

              <h4 className="font-semibold mt-4 mb-1">SECTION 8: MANDATORY ARBITRATION</h4>
              <p className="mb-2"><strong>8.1</strong> In the event of any dispute, claim or controversy between or among the Parties to this Agreement arising out of or relating to this Agreement or any breach thereof... such dispute, claim or controversy shall be settled by and through an arbitration proceeding to be administered by the American Arbitration Association within the state of California, in accordance with the American Arbitration Association’s Commercial Arbitration Rules... The arbitration shall be conducted by one (1) arbitrator... The prevailing Party... is entitled to recover its reasonable attorney’s fees and costs.</p>

              <h4 className="font-semibold mt-4 mb-1">SECTION 9: PURCHASE</h4>
              <p className="mb-2"><strong>9.1 – 9.2</strong> In the event Lender is requested to repurchase a Mortgage Loan, upon the request of Lender, Broker hereby agrees to purchase the related Mortgage Loan(s) within thirty (30) days... The purchase price... shall be the sum of: (i) the current unpaid principal owed, plus (ii) accrued and unpaid interest, plus (iii) all Lender paid compensation... plus (iv) all monies that Broker received at the direction of borrower... plus (v) all of Lender’s costs and expenses...</p>

              <h4 className="font-semibold mt-4 mb-1">SECTION 10: EARLY LOAN PAYOFF / EARLY PAYMENT DEFAULT &amp; OFFSET</h4>
              <p className="mb-2"><strong>10.1 – 10.6</strong> Broker shall pay Lender a Fee (as defined below) with respect to any Mortgage Loan that meets any of the following conditions: (i) The Mortgage Loan paid off (“Early Payoff”) within one hundred and eighty (180) days of the funding date; (ii) The borrower on the Mortgage Loan fails to make any of the first four (4) monthly payments... Broker is prohibited from making payments on behalf of the borrower to prevent an Early Payment Default... Lender may, in its sole discretion, and without prior notice or demand to Broker, take an offset against any monies due for any reason from Lender to Broker for any Fee or other amount due from Broker to Lender under this Agreement... The “Fee” shall be the greater of: (i) all original lender paid compensation Broker received from Lender, or (ii) One Thousand Five Hundred Dollars ($1,500).</p>

              <h4 className="font-semibold mt-4 mb-1">SECTION 11: COMMENCEMENT/TERMINATION OF AGREEMENT</h4>
              <p className="mb-2"><strong>11.1 – 11.2</strong> This Agreement will commence upon the later date of both Parties’ execution and shall continue until either Party terminates by providing written notice to the other Party... Either Party may terminate this Agreement at any time with or without cause upon written notice... This Agreement and the warranties, representations and covenants... and Broker’s liability to Lender of any nature or kind... shall survive the termination or cancellation of this Agreement...</p>

              <h4 className="font-semibold mt-4 mb-1">SECTION 12: NOTICES</h4>
              <p className="mb-2">All demands, notices, and communications delivered to a Party pursuant to this Agreement shall be provided in writing... Lender: {lenderName}, {lenderAddress}, Email: {lenderEmail}. Broker: {brokerName}, Contact Name: {brokerSigner}, Address: {brokerAddress}.</p>

              <h4 className="font-semibold mt-4 mb-1">SECTION 13: MISCELLANEOUS</h4>
              <p className="mb-2"><strong>13.1 – 13.23</strong> Lender may unilaterally and immediately amend, update, and modify this Agreement as necessary, in Lender’s sole discretion, to comply with Applicable Laws or secondary market investor requirements... This Agreement shall be governed by and interpreted in accordance with any state or federal law within the State of California... Broker agrees to exclusive personal jurisdiction and venue in the state and federal courts of the United States located in the State of California... Entire agreement, severability, non-exclusive relationship, independent contractor status, no authority to bind Lender, intellectual property, power of attorney, business resumption and disaster recovery, waiver, reporting, communication authorization, etc. (Full terms reviewed on screen.)</p>

              <div className="mt-6 border-t pt-4 text-xs">
                <strong>WHOLESALE BROKER COMPENSATION ADDENDUM</strong><br />
                This Mortgage Broker Compensation Addendum (“Addendum”) is dated {formattedEffectiveDate} and supplements, amends and becomes part of that certain Lender Licensing Agreement. Lender shall pay Broker in accordance with the compensation schedule in effect at the time Broker submits a Loan Submission Package to Lender. Broker may provide to Lender a proposed modified compensation Addendum Exhibit no more frequently than once every ninety (90) days. Broker shall receive compensation solely in the form of Broker-Paid Compensation (BPC) paid by Lender. Broker-Paid Compensation shall not exceed 2.25% of the Mortgage Loan amount (inclusive of all broker-retained fees). Broker shall not receive Borrower-Paid Compensation on any Mortgage Loan submitted to Lender under this Agreement.
              </div>

              <div className="mt-4 border-t pt-4 text-xs">
                <strong>ZERO TOLERANCE FRAUD CERTIFICATION</strong><br />
                Broker to be held accountable for all actions of its employees, agents, and licensees and is responsible for the information provided with each application submitted to {lenderName} (Lender). Lender’s policy is to report all instances of potential fraud or suspicious activity to state and federal law enforcement agencies. Examples of fraudulent misrepresentation include: non-disclosure of relevant information; submitting inaccurate information or falsification of documents; signing documents on behalf of Borrower(s); failure to obtain all required information; unquestioned acceptance of known or suspected inaccurate information. Impacts of loan fraud are severe (criminal prosecution, loss of license, civil action, repurchase, loss of approval status). Broker hereby represents and warrants to Lender its full compliance with this Zero Tolerance Fraud Certification and agrees to immediately report suspected loan fraud to Lender.
              </div>

              <div className="mt-4 border-t pt-4 text-xs">
                <strong>ANTI-MONEY LAUNDERING &amp; BSA ACT COMPLIANCE</strong><br />
                Broker hereby certifies that they are fully compliant with final Rule 31 CFR, (Parts 1010 and 1029) of the Bank Secrecy Act, as amended from time-to-time, issued by the U.S. Department of Treasury, Financial Crimes Enforcement Network (FinCEN) requiring non-bank residential mortgage lenders, mortgage loan brokers and originators to establish an Anti-Money Laundering (AML) program and file Suspicious Activity Reports (SARs).
              </div>

              <div className="mt-6 text-[10px] text-gray-500">
                IN WITNESS WHEREOF, the Parties have agreed to and executed this Agreement as of the Effective Date herein.
                <br />BROKER: {brokerName}
                <br />By:
                <canvas
                  ref={signatureCanvasRef}
                  width={300}
                  height={70}
                  className="border border-gray-400 bg-white cursor-crosshair rounded touch-none align-middle"
                  onMouseDown={startDrawing}
                  onMouseMove={draw}
                  onMouseUp={endDrawing}
                  onMouseLeave={endDrawing}
                  style={{ verticalAlign: 'middle', marginLeft: '8px' }}
                />
                <button type="button" onClick={clearSignature} className="text-xs text-blue-600 hover:underline ml-2 align-middle">Clear</button>
                <br />Its: {brokerSigner} &nbsp; Date: {formattedSigDate}
                <br />LENDER: {lenderName} &nbsp;&nbsp; By: (leave blank to apply signature of authorized signer when organization is approved by parent.) &nbsp; Its: Authorized Officer &nbsp; Date: {formattedSigDate}
              </div>
            </div>

            <div className="flex gap-3 mt-4">
              <button type="button" onClick={() => setCurrentStep(1)} className="px-6 py-3 border rounded-2xl">Back to Information</button>
              <button
                type="submit"
                disabled={loading || !signatureData}
                className="flex-1 py-5 bg-blue-600 text-white rounded-3xl font-semibold text-xl hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? 'Submitting Application...' : 'Sign and Submit Application'}
              </button>
            </div>
            <p className="text-[10px] text-gray-500 mt-2">By signing and submitting you confirm the information is accurate and you agree to the Lender Licensing Agreement (including Compensation Addendum, Zero Tolerance Fraud Certification, and AML &amp; BSA Compliance Certification). Your signature is saved; the signed PDFs are generated on admin approval.</p>
          </div>
        )}
      </form>
    </div>
  );
}

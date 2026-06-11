'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { supabase } from './supabase';
import { submitSupportTicket } from '@/app/actions/submitApplication'; // server action for submit + email via resend + xai if needed

type Tenant = {
  id: string;
  name: string;
  slug?: string;
  logo_url?: string;
  primary_color?: string;
  domain?: string;
  parent_organization_id?: string | null;
  is_root?: boolean;
  base_rates?: any;
  from_email?: string;
  reply_to_email?: string;
  raw_attrs?: any;
};

export const TenantContext = createContext<Tenant | null>(null);

export function TenantProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [tenant, setTenant] = useState<Tenant | null>(null);
  // Supabase-auth user (replaces Clerk useUser after migration). We normalize to a small shape for ticket + display.
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [userLoaded, setUserLoaded] = useState(false);

  // === GLOBAL SUPPORT TICKET STATE (on EVERY page via this provider) ===
  const [showTicketModal, setShowTicketModal] = useState(false);
  const [description, setDescription] = useState('');
  const [screenshotFiles, setScreenshotFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [userOrgId, setUserOrgId] = useState<string | null>(null);
  const [userOrgName, setUserOrgName] = useState<string>('');

  useEffect(() => {
    const loadTenant = async () => {
      const hostname = window.location.hostname;

      // 1. First try custom domain (for white-label on tenant's own domain)
      let { data: byDomain } = await supabase
        .from('organizations')
        .select('id, name, slug, logo_url, primary_color, domain, parent_organization_id, is_root, base_rates, from_email, reply_to_email, raw_attrs')
        .eq('domain', hostname)
        .maybeSingle();

      let tenantData = byDomain || null;

      // 2. If no domain match (e.g. platform root domain, vercel preview, localhost), fallback to user's org for branding.
      // This ensures FULL tenant override on child pages (/products, /dashboard, /loans etc) with no root "Loan-App Platform" branding leak
      // when a tenant user accesses via the platform domain. Root home (app/page) will special-case platform name.
      // Respects org.is_root flag for root vs subdomain/tenant mode config.
      if (!tenantData) {
        try {
          const { data: { user: sbUser } } = await supabase.auth.getUser();
          if (sbUser?.id) {
            const { data: prof } = await supabase.from('profiles').select('organization_id').eq('id', sbUser.id).maybeSingle();
            const orgId = prof?.organization_id;
            if (orgId) {
              const { data: userOrg } = await supabase
                .from('organizations')
                .select('id, name, slug, logo_url, primary_color, domain, parent_organization_id, is_root, base_rates, from_email, reply_to_email, raw_attrs')
                .eq('id', orgId)
                .maybeSingle();
              if (userOrg) {
                tenantData = userOrg;
              }
            }
          }
        } catch (e) {
          // non-fatal; public pages have no user
        }
      }

      // If still none, or explicitly a root org (is_root or name), we may keep null or set; root page handles "Loan-App Platform" explicitly.
      setTenant(tenantData);
    };

    loadTenant();
  }, []); // run once; domain based, or extend if needed for user-driven orgs. User fallback prevents root leak per white-label task.

  // Load current Supabase user (replaces Clerk). Also load user's org for ticket auto-capture.
  useEffect(() => {
    async function loadCurrentUserAndOrg() {
      try {
        const { data: { user: sbUser } } = await supabase.auth.getUser();
        if (sbUser) {
          // Try to enrich with full_name from profiles or users table (common in this app)
          let fullName = sbUser.user_metadata?.full_name || sbUser.user_metadata?.name || null;
          let email = sbUser.email || '';
          try {
            const { data: prof } = await supabase.from('profiles').select('full_name, email').eq('id', sbUser.id).maybeSingle();
            if (prof) {
              fullName = prof.full_name || fullName;
              email = prof.email || email;
            }
            // Legacy 'users' table fallback removed (caused 404s after Supabase-auth migration; profiles is canonical)
          } catch {}
          setCurrentUser({ id: sbUser.id, fullName, primaryEmailAddress: { emailAddress: email } });
        } else {
          setCurrentUser(null);
        }
        setUserLoaded(true);

        // Also load org for ticket (prefer linked in profiles or users table; catch errors to avoid console noise)
        const uid = sbUser?.id;
        if (uid) {
          let orgId = null;
          try {
            let { data: u } = await supabase.from('profiles').select('organization_id').eq('id', uid).maybeSingle();
            // Legacy 'users' table fallback removed to eliminate console 404 noise (profiles is the source of truth post Clerk removal)
            orgId = u?.organization_id || null;
          } catch (e) {
            // ignore permission / missing row errors (e.g. on public pages before sign-in)
          }
          setUserOrgId(orgId);
          if (orgId) {
            try {
              const { data: org } = await supabase.from('organizations').select('name').eq('id', orgId).maybeSingle();
              setUserOrgName(org?.name || '');
            } catch {}
          } else if (tenant) {
            setUserOrgId(tenant.id);
            setUserOrgName(tenant.name);
          }
        }
      } catch (e) {
        console.warn('load current sb user failed', e);
        setUserLoaded(true);
      }
    }
    loadCurrentUserAndOrg();
  }, [tenant]);

  // Reset form when modal closes
  useEffect(() => {
    if (!showTicketModal) {
      setDescription('');
      setScreenshotFiles([]);
    }
  }, [showTicketModal]);

  const handleScreenshotSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const imageFiles = files.filter(f => f.type.startsWith('image/'));
    setScreenshotFiles(prev => [...prev, ...imageFiles].slice(0, 5)); // max 5 screenshots
  };

  const removeScreenshot = (index: number) => {
    setScreenshotFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmitTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) {
      alert('Please enter a description.');
      return;
    }
    if (!currentUser) {
      alert('Please sign in to submit a support ticket.');
      return;
    }

    setSubmitting(true);
    setUploading(true);

    try {
      // Upload screenshots client-side to storage (bucket must exist: 'support-screenshots')
      // Auto-captures: user (sb id + name/email), org, page_url=pathname
      const screenshotUrls: string[] = [];
      const bucket = 'support-screenshots';
      for (const file of screenshotFiles) {
        const fileExt = file.name.split('.').pop();
        const fileName = `ticket-${currentUser.id}-${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`;
        const { data: up, error: upErr } = await supabase.storage
          .from(bucket)
          .upload(fileName, file, { upsert: false, contentType: file.type });
        if (upErr) {
          console.error('Screenshot upload error (ensure bucket exists + policies):', upErr);
          // continue without this screenshot; or throw
        } else if (up) {
          const { data: urlD } = supabase.storage.from(bucket).getPublicUrl(fileName);
          if (urlD?.publicUrl) screenshotUrls.push(urlD.publicUrl);
        }
      }

      setUploading(false);

      // Call server action: inserts to support_tickets (via admin), sends Resend email to TECH_SUPPORT/SUPER_ADMIN
      const result = await submitSupportTicket({
        userId: currentUser.id,
        userName: currentUser.fullName || currentUser.primaryEmailAddress?.emailAddress || 'Unknown',
        userEmail: currentUser.primaryEmailAddress?.emailAddress || '',
        orgId: userOrgId || tenant?.id || null,
        orgName: userOrgName || tenant?.name || '',
        pageUrl: pathname || window.location.pathname,
        description: description.trim(),
        screenshotUrls,
      });

      if ((result as any)?.success) {
        alert('✅ Support ticket submitted! You will receive a confirmation, and our team was notified.');
        setShowTicketModal(false);
      } else {
        throw new Error((result as any)?.error || 'Submit failed');
      }
    } catch (err: any) {
      console.error('Ticket submit error:', err);
      alert('Failed to submit ticket: ' + (err.message || 'Unknown error. Check console.'));
    } finally {
      setUploading(false);
      setSubmitting(false);
    }
  };

  // Floating global button - visible on EVERY page
  const GlobalSupportButton = (
    <button
      onClick={() => setShowTicketModal(true)}
      className="fixed bottom-6 right-6 z-[9999] flex items-center gap-2 px-5 py-3 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-3xl shadow-xl font-medium text-sm transition-all hover:scale-105"
      title="Submit a Support Ticket"
      aria-label="Submit a Support Ticket"
    >
      <span>💬</span>
      <span>Submit a Support Ticket</span>
    </button>
  );

  // Modal form - auto captures user/org/path
  const TicketModal = showTicketModal && (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 p-4" onClick={() => !submitting && setShowTicketModal(false)}>
      <div
        className="bg-white rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b flex items-center justify-between bg-gray-50">
          <h3 className="text-xl font-semibold">Submit a Support Ticket</h3>
          <button onClick={() => setShowTicketModal(false)} disabled={submitting} className="text-2xl leading-none text-gray-400 hover:text-gray-600">×</button>
        </div>

        <form onSubmit={handleSubmitTicket} className="p-6 space-y-4">
          {/* Auto-captured fields (readonly display) */}
          <div className="grid grid-cols-1 gap-3 text-sm">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">CURRENT USER (from auth)</label>
              <div className="px-4 py-2 bg-gray-100 rounded-2xl text-gray-700">
                {currentUser ? `${currentUser.fullName || ''} (${currentUser.primaryEmailAddress?.emailAddress || currentUser.id})` : 'Not signed in'}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">ORGANIZATION (from profile/tenant)</label>
              <div className="px-4 py-2 bg-gray-100 rounded-2xl text-gray-700">
                {userOrgName || tenant?.name || 'No organization'} {userOrgId ? `(${userOrgId})` : ''}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">CURRENT PAGE (pathname)</label>
              <div className="px-4 py-2 bg-gray-100 rounded-2xl text-gray-700 font-mono text-xs break-all">
                {pathname || '/'}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Description <span className="text-red-500">*</span></label>
            <textarea
              required
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Describe the issue, error, or request in detail. Include steps to reproduce if applicable."
              className="w-full h-32 px-4 py-3 border rounded-2xl resize-y focus:outline-none focus:border-blue-500"
              disabled={submitting}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Screenshots (optional, up to 5 images)</label>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={handleScreenshotSelect}
              disabled={submitting || screenshotFiles.length >= 5}
              className="block w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-2xl file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
            />
            {screenshotFiles.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {screenshotFiles.map((f, i) => (
                  <div key={i} className="relative group text-xs bg-gray-100 px-3 py-1 rounded-2xl flex items-center gap-1">
                    📎 {f.name.length > 20 ? f.name.slice(0,17)+'…' : f.name}
                    <button type="button" onClick={() => removeScreenshot(i)} className="ml-1 text-red-500 hover:text-red-700">×</button>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[10px] text-gray-500 mt-1">Images uploaded to storage on submit. URLs stored as JSON.</p>
          </div>

          <div className="pt-2 flex gap-3">
            <button
              type="button"
              onClick={() => setShowTicketModal(false)}
              disabled={submitting}
              className="flex-1 py-3 rounded-2xl border hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !description.trim()}
              className="flex-1 py-3 rounded-2xl bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {submitting ? (uploading ? 'Uploading screenshots...' : 'Submitting...') : 'Submit Ticket'}
            </button>
          </div>

          <p className="text-[10px] text-center text-gray-400">A notification email will be sent to TECH_SUPPORT (or SUPER_ADMIN fallback) via Resend.</p>
        </form>
      </div>
    </div>
  );

  return (
    <TenantContext.Provider value={tenant}>
      {children}
      {/* Global floating support button + modal - present on all pages */}
      {GlobalSupportButton}
      {TicketModal}
    </TenantContext.Provider>
  );
}

export const useTenant = () => useContext(TenantContext);
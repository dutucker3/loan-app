'use client';

import { useState, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useTenant } from '@/lib/tenant-context';
import { sendCustomOtp, verifyCustomOtp } from '@/lib/create-organization';

export default function SignUpPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tenant = useTenant();

  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const redirectParam = searchParams.get('redirect') || '/apply/organization';

  // Compute an absolute redirect URL based on the current origin (critical for ngrok/custom domains + magic links).
  // This ensures the magiclink's redirect_to points back to the same host the user is on.
  const redirectTo = useMemo(() => {
    if (redirectParam.startsWith('http')) return redirectParam;
    if (typeof window !== 'undefined') {
      const origin = window.location.origin;
      return `${origin}${redirectParam.startsWith('/') ? redirectParam : `/${redirectParam}`}`;
    }
    // Server fallback (will be overridden on client anyway)
    return redirectParam;
  }, [redirectParam]);

  // Also expose a relative version for display/fallbacks if ever needed
  const relativeRedirect = redirectParam.startsWith('http')
    ? new URL(redirectParam).pathname + new URL(redirectParam).search
    : redirectParam;

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setLoading(true);
    setError('');
    setMessage('');

    try {
      // White-label: resolve from_email from the current tenant (domain-matched org like Plumbing Kings)
      // so the OTP email comes from dustin@plumbingkings.net (or whatever is set on the org) instead of the platform default.
      let fromAddress: string | undefined;
      const tFrom = (tenant as any)?.from_email || (tenant as any)?.raw_attrs?.from_email;
      if (tFrom) {
        const display = tenant?.name || companyName || fullName || 'Lending';
        fromAddress = `${display} <${tFrom}>`;
      }

      // Custom white-label OTP: we generate the code, store it, and send via Resend (not Supabase email)
      await sendCustomOtp(email.trim(), fullName, companyName, fromAddress);
      setMessage('Check your email for the 6-digit code to continue.');
      setStep('code');
    } catch (err: any) {
      setError(err.message || 'Failed to send code.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !code) return;

    setLoading(true);
    setError('');

    try {
      // ULTRA ROBUST for white-label:
      // 1. Extract only the path + query from the redirectParam (ignore any bad origin like localhost that might have leaked in).
      // 2. Prefer the tenant.domain from the resolved tenant (via useTenant + current hostname lookup) to build the origin.
      //    This guarantees we use the correct tenant domain even if window.location.origin is polluted (localhost tab, bookmarks, etc.).
      // 3. Fall back to current window.location.origin.
      let targetPath = '/apply/organization';
      try {
        if (redirectParam && redirectParam.startsWith('http')) {
          const u = new URL(redirectParam);
          targetPath = u.pathname + u.search;
        } else if (redirectParam) {
          targetPath = redirectParam;
        }
      } catch {}
      targetPath = targetPath.split('#')[0];
      if (!targetPath.startsWith('/')) targetPath = '/' + targetPath;

      // Build origin: 
      // - If redirectParam is already a full good URL (from the apply page), use its origin (most reliable for the current flow).
      // - Else prefer tenant.domain from the resolved tenant (via hostname lookup on this visit).
      // - Fall back to current window.location.origin.
      let origin: string;
      try {
        if (redirectParam && redirectParam.startsWith('http')) {
          origin = new URL(redirectParam).origin;
        } else if (tenant?.domain) {
          origin = 'https://' + tenant.domain;
        } else if (typeof window !== 'undefined') {
          origin = window.location.origin;
        } else {
          origin = 'https://aloe-unhelpful-clip.ngrok-free.dev'; // last resort for this test domain
        }
      } catch {
        origin = (typeof window !== 'undefined' ? window.location.origin : 'https://aloe-unhelpful-clip.ngrok-free.dev');
      }

      const absoluteTarget = `${origin}${targetPath}`;

      // Verify against our stored code (custom, no Supabase OTP email)
      const result = await verifyCustomOtp(email.trim(), code.trim(), absoluteTarget);

      const cleanFinal = absoluteTarget.split('#')[0];

      if (result.actionLink) {
        // Magic link returned by generateLink (no email sent) — navigate to establish session + redirect
        let finalLink = result.actionLink;
        try {
          // Client-side override: force the redirect_to param to our computed tenant origin.
          // This defeats cases where Supabase's Site URL / whitelist or the server-passed value
          // ends up as localhost despite us passing the correct absoluteTarget.
          const url = new URL(result.actionLink);
          url.searchParams.set('redirect_to', cleanFinal);
          finalLink = url.toString();
        } catch {}
        window.location.href = finalLink;
      } else {
        // Fallback: force full navigation with the tenant origin
        window.location.assign(cleanFinal);
      }
    } catch (err: any) {
      setError(err.message || 'Invalid code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-3xl p-10 shadow-xl">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Create your account</h1>
          <p className="text-gray-600 mt-2">Get a 6-digit code to start the application</p>
        </div>

        {step === 'email' && (
          <form onSubmit={handleSendCode} className="space-y-6">
            <div>
              <label className="block text-sm font-medium mb-2">Work email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-5 py-3 border rounded-2xl focus:outline-none focus:border-blue-600"
                placeholder="you@yourcompany.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Full Name *</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                className="w-full px-5 py-3 border rounded-2xl focus:outline-none focus:border-blue-600"
                placeholder="John Smith"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Organization Name *</label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                required
                className="w-full px-5 py-3 border rounded-2xl focus:outline-none focus:border-blue-600"
                placeholder="Acme Capital LLC"
              />
            </div>

            {error && <p className="text-red-600 text-sm">{error}</p>}
            {message && <p className="text-green-600 text-sm">{message}</p>}

            <button
              type="submit"
              disabled={loading || !email}
              className="w-full py-4 bg-black text-white rounded-3xl font-semibold disabled:opacity-50 hover:bg-zinc-800"
            >
              {loading ? 'Sending...' : 'Send 6-digit code'}
            </button>
          </form>
        )}

        {step === 'code' && (
          <form onSubmit={handleVerifyCode} className="space-y-6">
            <div>
              <label className="block text-sm font-medium mb-2">
                Enter the 6-digit code sent to {email}
              </label>
              <input
                type="text"
                value={code}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, '');
                  // Take the last 6 digits (in case user pastes a long token from the email link instead of the 6-digit OTP)
                  setCode(digits.slice(-6));
                }}
                maxLength={6}
                required
                className="w-full px-5 py-3 border rounded-2xl text-center text-2xl tracking-[8px] font-mono focus:outline-none focus:border-blue-600"
                placeholder="123456"
              />
              <p className="text-xs text-gray-500 mt-1">
                Copy only the <strong>6-digit number</strong> from your email (ignore the long link/token).
              </p>
            </div>

            {error && <p className="text-red-600 text-sm">{error}</p>}

            <button
              type="submit"
              disabled={loading || code.length !== 6}
              className="w-full py-4 bg-blue-600 text-white rounded-3xl font-semibold disabled:opacity-50 hover:bg-blue-700"
            >
              {loading ? 'Verifying...' : 'Verify & continue'}
            </button>

            <button
              type="button"
              onClick={() => {
                setStep('email');
                setCode('');
                setError('');
                setMessage('');
              }}
              className="w-full text-sm text-gray-500 hover:underline"
            >
              ← Use a different email
            </button>
          </form>
        )}

        <div className="mt-8 text-center text-sm text-gray-500">
          Already have an account?{' '}
          <a href="/sign-in" className="text-blue-600 hover:underline">
            Sign in here
          </a>
        </div>

        <p className="mt-6 text-[11px] text-center text-gray-400">
          This creates your account using a 6-digit code sent via our branded email (Resend). No password is set during initial signup. You can set one later via the welcome link.
        </p>
      </div>
    </div>
  );
}

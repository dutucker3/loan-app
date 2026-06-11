'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';

interface Props {
  tenantName: string;
  tenantLogo?: string | null;
  tenantColor?: string;
}

export default function SignInClient({ tenantName, tenantLogo, tenantColor = '#111827' }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'login' | 'reset'>('login');
  const [resetEmail, setResetEmail] = useState('');
  const [resetMessage, setResetMessage] = useState('');

  const redirectTo = searchParams.get('redirect') || '/dashboard';

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setError('Username and password are required.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Resolve username to email if necessary (support username or email as "username")
      let loginEmail = username.trim();

      // If it doesn't look like an email, try to look up by full_name or email in users table
      if (!loginEmail.includes('@')) {
        const { data: userByName } = await supabase
          .from('profiles')
          .select('email, full_name')
          .or(`full_name.ilike.%${loginEmail}%,email.ilike.%${loginEmail}%`)
          .maybeSingle();

        if (userByName?.email) {
          loginEmail = userByName.email;
        } else {
          // Fallback: try profiles or just use as-is (will fail if invalid)
          loginEmail = username.trim();
        }
      }

      // Use Supabase password auth under the hood (standard password flow)
      // This establishes a proper Supabase session so the rest of the app (getUser(), RLS, etc.) continues to work.
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password: password,
      });

      if (signInError) {
        throw signInError;
      }

      if (data.session) {
        // Success - redirect to dashboard or the requested redirect target
        router.push(redirectTo);
      } else {
        setError('Login succeeded but no session was created. Please try again.');
      }
    } catch (err: any) {
      console.error('Sign in error:', err);
      setError(err.message || 'Invalid username or password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = () => {
    setMode('reset');
    setError('');
    setResetMessage('');
    setResetEmail(username); // prefill if they entered something
  };

  const handleSendReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetEmail) {
      setError('Please enter your username or email.');
      return;
    }

    setLoading(true);
    setError('');
    setResetMessage('');

    try {
      let emailToReset = resetEmail.trim();

      // Resolve username to email if necessary
      if (!emailToReset.includes('@')) {
        const { data: userByName } = await supabase
          .from('profiles')
          .select('email')
          .or(`full_name.ilike.%${emailToReset}%,email.ilike.%${emailToReset}%`)
          .maybeSingle();

        if (userByName?.email) {
          emailToReset = userByName.email;
        }
      }

      const { error: resetError } = await supabase.auth.resetPasswordForEmail(emailToReset, {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (resetError) {
        throw resetError;
      }

      setResetMessage('If an account exists for that email, a password reset link has been sent.');
    } catch (err: any) {
      console.error('Reset password error:', err);
      // Don't reveal if user exists or not for security
      setResetMessage('If an account exists for that email, a password reset link has been sent.');
    } finally {
      setLoading(false);
    }
  };

  const backToLogin = () => {
    setMode('login');
    setError('');
    setResetMessage('');
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-3xl p-10 shadow-xl">
        <div className="text-center mb-8">
          {tenantLogo && (
            <img src={tenantLogo} alt={tenantName} className="h-10 w-auto mx-auto mb-3" />
          )}
          <div className="text-xl font-semibold mb-1" style={{ color: tenantColor }}>
            {tenantName}
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Sign in</h1>
          <p className="text-gray-600 mt-2">Enter your username and password</p>
        </div>

        {mode === 'login' && (
          <form onSubmit={handleSignIn} className="space-y-6">
            <div>
              <label className="block text-sm font-medium mb-2">Username or Email</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className="w-full px-5 py-3 border rounded-2xl focus:outline-none focus:border-blue-600"
                placeholder="yourusername or you@company.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full px-5 py-3 border rounded-2xl focus:outline-none focus:border-blue-600"
                placeholder="••••••••"
              />
            </div>

            {error && <p className="text-red-600 text-sm">{error}</p>}

            <button
              type="submit"
              disabled={loading || !username || !password}
              className="w-full py-4 bg-black text-white rounded-3xl font-semibold disabled:opacity-50 hover:bg-zinc-800 transition"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>

            <div className="text-center">
              <button
                type="button"
                onClick={handleForgotPassword}
                className="text-sm text-blue-600 hover:underline"
              >
                Forgot your password?
              </button>
            </div>
          </form>
        )}

        {mode === 'reset' && (
          <div className="space-y-6">
            <div className="text-center mb-4">
              <h2 className="text-xl font-semibold">Reset your password</h2>
              <p className="text-sm text-gray-600 mt-1">Enter your username or email and we'll send a reset link.</p>
            </div>

            <form onSubmit={handleSendReset} className="space-y-6">
              <div>
                <label className="block text-sm font-medium mb-2">Username or Email</label>
                <input
                  type="text"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  required
                  className="w-full px-5 py-3 border rounded-2xl focus:outline-none focus:border-blue-600"
                  placeholder="yourusername or you@company.com"
                />
              </div>

              {error && <p className="text-red-600 text-sm">{error}</p>}
              {resetMessage && <p className="text-green-600 text-sm">{resetMessage}</p>}

              <button
                type="submit"
                disabled={loading || !resetEmail}
                className="w-full py-4 bg-black text-white rounded-3xl font-semibold disabled:opacity-50 hover:bg-zinc-800 transition"
              >
                {loading ? 'Sending reset link...' : 'Send reset link'}
              </button>
            </form>

            <div className="text-center">
              <button
                type="button"
                onClick={backToLogin}
                className="text-sm text-gray-500 hover:underline"
              >
                ← Back to sign in
              </button>
            </div>
          </div>
        )}

        <div className="mt-8 text-center text-sm text-gray-500">
          New to the platform?{' '}
          <a href="/apply/organization" className="text-blue-600 hover:underline">
            Apply for an organization
          </a>
        </div>

        <p className="mt-6 text-[11px] text-center text-gray-400">
          Username and password login. Password resets are handled via secure email link.
        </p>
      </div>
    </div>
  );
}

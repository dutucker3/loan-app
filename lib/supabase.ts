import { createClient } from '@supabase/supabase-js';

// Read public client vars. Support both the classic ANON_KEY name and the newer
// "publishable key" name that appears in some Supabase dashboard / template outputs.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const supabaseServiceKey = process.env.SUPABASE_SECRET_KEY;

// We intentionally do NOT throw at module evaluation time.
// Root public pages (/, /sign-up, /apply/* etc.) import this via TenantProvider + AppHeader
// in the root layout. A hard throw here would crash every public page when the dev server
// was started without the NEXT_PUBLIC_* vars (common with pm2, worktrees, or .env edits
// without a full clean restart).
//
// Actual usage will surface a clear error (logged only once to avoid console spam).
// Server code paths have their own guards.
let hasLoggedMissingPublicVars = false;

function ensurePublicClientVars() {
  if (!supabaseUrl || !supabaseAnonKey) {
    if (!hasLoggedMissingPublicVars) {
      const msg = 'Missing Supabase public environment variables. Make sure .env.local (or your pm2 env) contains NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).';
      if (typeof window !== 'undefined') {
        console.error(msg);
      } else {
        console.warn(msg);
      }
      hasLoggedMissingPublicVars = true;
    }
    throw new Error('Missing Supabase public environment variables');
  }
}

// Lazy singleton so the module can be imported on public pages without crashing at import time.
let _supabase: ReturnType<typeof createClient> | null = null;

export const supabase = new Proxy({} as any, {
  get(_target, prop: string | symbol) {
    if (!_supabase) {
      ensurePublicClientVars();
      _supabase = createClient(supabaseUrl!, supabaseAnonKey!);
    }
    return (_supabase as any)[prop];
  },
});

// Admin client - only available on server (guarded so missing public vars don't break module load)
export const supabaseAdmin = (supabaseServiceKey && supabaseUrl)
  ? createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  : null;

// Legacy helper updated for pure Supabase orgs (no more clerk_org_id).
// Use the organization's own `id` (e.g. the `org_...` value) or resolve via user's profile.organization_id.
export async function getCurrentOrganization(sb: any, orgId: string) {
  const { data } = await sb
    .from('organizations')
    .select('*')
    .eq('id', orgId)
    .single();
  return data;
}

// Only log on server
if (!supabaseAdmin && typeof window === 'undefined') {
  console.warn('⚠️ SUPABASE_SECRET_KEY is missing - server uploads will fail');
}

/**
 * Client-side Supabase client factory (for use in 'use client' components).
 * Used by the organization application flow (app/apply/organization) which relies on
 * Supabase email/passwordless auth sessions (separate from Clerk main auth).
 * Reuses the main singleton client to avoid "Multiple GoTrueClient instances".
 */
export function createClientComponentClient() {
  return supabase;
}

/**
 * Server-side Supabase client factory.
 * Supports optional Request to extract Authorization: Bearer <supabase-access-token>
 * so that auth.getUser() succeeds when the client (e.g. apply form) forwards the session token
 * from its Supabase auth (email code sign-up flow).
 * Falls back to anonymous client if no token (getUser will be null).
 */
export async function createServerClient(req?: { headers: { get(name: string): string | null } }) {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase public environment variables (required for createServerClient)');
  }

  if (req) {
    const authHeader =
      req.headers.get('authorization') || req.headers.get('Authorization');
    if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
      const token = authHeader.substring(7).trim();
      // Create client with global Authorization header.
      // This ensures that auth.getUser() (and subsequent .from() calls) are executed
      // in the context of the user who owns the JWT. This is more reliable than setSession
      // + getUser() on server (avoids refresh/empty-refresh issues).
      return createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
        global: {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      });
    }
  }

  // No bearer token: return anonymous client (getUser() will yield null)
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
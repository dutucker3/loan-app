import { supabase } from '@/lib/supabase';

// Deprecated: Clerk token sync removed after full Supabase auth migration.
// All pages now use direct `import { supabase } from '@/lib/supabase'` + supabase.auth.getUser().
// This hook is kept for backward compat and just returns the plain client.
export function useSupabase() {
  return supabase;
}
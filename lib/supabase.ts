import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase public environment variables');
}

// Public client - safe for browser
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Admin client - only available on server
export const supabaseAdmin = supabaseServiceKey 
  ? createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  : null;

// Only log on server
if (!supabaseAdmin && typeof window === 'undefined') {
  console.warn('⚠️ SUPABASE_SECRET_KEY is missing - server uploads will fail');
}
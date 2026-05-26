// lib/supabase.ts
import { createClient } from '@supabase/supabase-js';
import { useAuth } from '@clerk/nextjs';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

console.log("🔍 [Supabase Init] URL:", supabaseUrl ? "✅ LOADED" : "❌ MISSING");
console.log("🔍 [Supabase Init] Publishable Key:", supabaseKey ? "✅ LOADED" : "❌ MISSING");

let clientInstance: any = null;

export const createClientComponentClient = () => {
  const { getToken } = useAuth();

  if (!clientInstance) {
    console.log("🛠️ [Supabase] Creating new client instance...");
    clientInstance = createClient(supabaseUrl, supabaseKey, {
      global: {
        async fetch(url: string, options: any = {}) {
          console.log(`🌐 [Supabase Fetch] ${url}`);

          try {
            const token = await getToken();
            if (token) {
              options.headers = {
                ...options.headers,
                Authorization: `Bearer ${token}`,
                apikey: supabaseKey,
              };
              console.log("🔑 [Supabase] Clerk token + apikey attached successfully");
            } else {
              console.warn("⚠️ [Supabase] No Clerk token received");
            }
          } catch (err) {
            console.error("❌ [Supabase] Failed to get Clerk token:", err);
          }

          return fetch(url, options);
        },
      },
    });
  } else {
    console.log("♻️ [Supabase] Reusing existing client instance");
  }

  return clientInstance;
};
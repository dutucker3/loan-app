import { useEffect } from 'react';
import { useUser, useAuth } from '@clerk/nextjs';
import { supabase } from '@/lib/supabase';

export function useSupabase() {
  const { user } = useUser();
  const { getToken } = useAuth();

  useEffect(() => {
    const syncToken = async () => {
      if (!user) {
        console.log("🔑 No Clerk user yet");
        return;
      }

      try {
        console.log("🔑 Getting Supabase token for user:", user.id);
        const token = await getToken({ template: 'supabase' });

        if (!token) {
          console.error("❌ No token returned from Clerk");
          return;
        }

        console.log("✅ Token received, setting Supabase session...");
        await supabase.auth.setSession({
          access_token: token,
          refresh_token: '',
        });

        console.log("✅ Supabase session set successfully");
      } catch (err: any) {
        console.error("❌ Failed to sync Clerk token with Supabase:", err.message || err);
      }
    };

    syncToken();
  }, [user, getToken]);

  return supabase;
}
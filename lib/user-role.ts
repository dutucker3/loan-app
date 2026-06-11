import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export type UserRole = 
  | 'SUPER_ADMIN'
  | 'LENDING_SUPERVISOR'
  | 'SENIOR_AE'
  | 'PROCESSOR'
  | 'BROKER_AE'
  | 'TECH_SUPPORT';

export function useUserRole() {
  const [role, setRole] = useState<UserRole>('BROKER_AE');
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    async function loadUserAndRole() {
      try {
        const { data: { user: sbUser } } = await supabase.auth.getUser();
        if (!sbUser?.id) {
          setLoading(false);
          return;
        }
        setUserId(sbUser.id);

        // Try users table first (clerk_id or id)
        let { data } = await supabase
          .from('profiles')
          .select('role')
          .or(`id.eq.${sbUser.id},clerk_id.eq.${sbUser.id}`)
          .maybeSingle();

        if (!data?.role) {
          // fallback to profiles
          const { data: prof } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', sbUser.id)
            .maybeSingle();
          if (prof?.role) {
            data = { role: prof.role };
          }
        }

        if (data?.role) {
          setRole(data.role as UserRole);
        }
      } catch (e) {
        console.warn('useUserRole load error', e);
      } finally {
        setLoading(false);
      }
    }

    loadUserAndRole();
  }, []);

  const hasRole = (requiredRoles: UserRole[]) => requiredRoles.includes(role);

  return { role, loading, hasRole, userId };
}
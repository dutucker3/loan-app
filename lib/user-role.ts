import { useUser } from '@clerk/nextjs';
import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export type UserRole = 
  | 'SUPER_ADMIN'
  | 'LENDING_SUPERVISOR'
  | 'SENIOR_AE'
  | 'PROCESSOR'
  | 'BROKER_AE';

export function useUserRole() {
  const { user } = useUser();
  const [role, setRole] = useState<UserRole>('BROKER_AE');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadRole() {
      if (!user?.id) {
        setLoading(false);
        return;
      }

      const { data } = await supabase
        .from('users')
        .select('role')
        .eq('clerk_id', user.id)
        .single();

      if (data?.role) {
        setRole(data.role as UserRole);
      }
      setLoading(false);
    }

    loadRole();
  }, [user?.id]);

  const hasRole = (requiredRoles: UserRole[]) => requiredRoles.includes(role);

  return { role, loading, hasRole };
}
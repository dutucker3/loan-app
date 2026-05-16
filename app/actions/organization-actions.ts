'use server';

import { approveAndCreateOrganization } from '@/lib/create-organization';

export async function approveOrganization(appId: string) {
  try {
    await approveAndCreateOrganization(appId);
    return { success: true };
  } catch (error: any) {
    console.error("Approve error:", error);
    return { success: false, error: error.message };
  }
}

export async function rejectOrganization(appId: string) {
  try {
    const { supabase } = await import('@/lib/supabase');

    const { error } = await supabase
      .from('pending_organizations')
      .update({ 
        status: 'rejected',
        reviewed_at: new Date().toISOString()
      })
      .eq('id', appId);

    if (error) throw error;

    return { success: true };
  } catch (error: any) {
    console.error("Reject error:", error);
    return { success: false, error: error.message };
  }
}
'use server';

import { supabaseAdmin } from '@/lib/supabase';
import { revalidatePath } from 'next/cache';

export async function submitLoanApplication(userId: string, formData: any, borrowers: any[]) {
  if (!supabaseAdmin) {
    throw new Error('SUPABASE_SECRET_KEY is not configured');
  }

  const { data, error } = await supabaseAdmin
    .from('loan_applications')
    .insert({
      user_id: userId,
      form_data: formData,
      borrowers: borrowers,
      status: 'submitted',
    })
    .select()
    .single();

  if (error) throw error;

  revalidatePath('/dashboard');
  return data;
}
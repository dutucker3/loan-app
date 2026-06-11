'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useTenant } from '@/lib/tenant-context';

export default function ProfilePage() {
  const router = useRouter();
  const tenant = useTenant();
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function load() {
      const { data: { user: sbUser } } = await supabase.auth.getUser();
      setUser(sbUser);

      if (sbUser?.id) {
        const { data: prof } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', sbUser.id)
          .maybeSingle();
        setProfile(prof);
      }
      setLoading(false);
    }
    load();
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  if (loading) {
    return <div className="p-10 text-center">Loading profile...</div>;
  }

  if (!user) {
    return (
      <div className="max-w-xl mx-auto p-8">
        <p>You must be signed in to view your profile.</p>
        <button onClick={() => router.push('/select-org')} className="mt-4 px-6 py-2 bg-blue-600 text-white rounded-2xl">
          Go to Sign In
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">My Profile</h1>
        <p className="text-gray-500">Manage your account and organization settings</p>
      </div>

      <div className="bg-white border rounded-3xl p-8 mb-6 space-y-6">
        <div>
          <label className="text-sm font-medium text-gray-600">Email</label>
          <div className="mt-1 text-lg font-medium">{user.email}</div>
        </div>

        <div>
          <label className="text-sm font-medium text-gray-600">Full Name</label>
          <div className="mt-1">{profile?.full_name || user.user_metadata?.full_name || 'Not set'}</div>
        </div>

        <div>
          <label className="text-sm font-medium text-gray-600">Role</label>
          <div className="mt-1">
            <span className="inline-block px-3 py-1 bg-blue-100 text-blue-700 rounded-2xl text-sm font-medium">
              {profile?.role || 'Unknown'}
            </span>
          </div>
        </div>

        <div>
          <label className="text-sm font-medium text-gray-600">Current Organization</label>
          <div className="mt-1 text-lg">
            {tenant?.name || 'No organization linked'}
            {tenant?.id && <span className="ml-2 text-xs font-mono text-gray-400">({tenant.id})</span>}
          </div>
          {['SUPER_ADMIN', 'ADMIN', 'TECH_SUPPORT'].includes(profile?.role || '') && (
            <button 
              onClick={() => router.push('/select-org')} 
              className="mt-2 text-sm text-blue-600 hover:underline"
            >
              Switch organization →
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-4">
        <button 
          onClick={() => router.push('/dashboard')}
          className="px-6 py-3 bg-gray-100 hover:bg-gray-200 rounded-2xl font-medium"
        >
          ← Back to Dashboard
        </button>

        <button 
          onClick={handleSignOut}
          className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-2xl font-medium"
        >
          Log Out
        </button>
      </div>

      <div className="mt-12 text-xs text-gray-400">
        Profile editing (name, password reset, etc.) can be expanded here. Currently shows data from Supabase Auth + profiles table.
      </div>
    </div>
  );
}

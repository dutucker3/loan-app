'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';

export default function AdminOverview() {
  const [stats, setStats] = useState({
    totalOrganizations: 0,
    pendingApplications: 0,
    activeProducts: 0,
    totalUsers: 0,
  });

  const [recentApplications, setRecentApplications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboardData();
  }, []);

  async function loadDashboardData() {
    try {
      // Total Organizations
      const { count: totalOrganizations } = await supabase
        .from('organizations')
        .select('*', { count: 'exact' });

      // Pending Applications
      const { count: pendingApplications } = await supabase
        .from('pending_organizations')
        .select('*', { count: 'exact' })
        .eq('status', 'pending');

      // Active Products
      const { count: activeProducts } = await supabase
        .from('loan_products')
        .select('*', { count: 'exact' })
        .eq('active', true);

      // Total Users (optional)
      const { count: totalUsers } = await supabase
        .from('users')
        .select('*', { count: 'exact' });

      // Recent Applications
      const { data: recent } = await supabase
        .from('pending_organizations')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5);

      setStats({
        totalOrganizations: totalOrganizations || 0,
        pendingApplications: pendingApplications || 0,
        activeProducts: activeProducts || 0,
        totalUsers: totalUsers || 0,
      });

      setRecentApplications(recent || []);
    } catch (error) {
      console.error('Dashboard data error:', error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return <div className="p-10 text-center text-xl">Loading dashboard...</div>;
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-10">
        <h1 className="text-4xl font-bold">Admin Overview</h1>
        <p className="text-gray-500">Welcome back, Super Admin</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
        <div className="bg-white rounded-3xl p-8 border shadow-sm">
          <p className="text-gray-500 text-sm">Total Organizations</p>
          <p className="text-5xl font-bold mt-4">{stats.totalOrganizations}</p>
        </div>

        <div className="bg-white rounded-3xl p-8 border shadow-sm relative overflow-hidden">
          <p className="text-gray-500 text-sm">Pending Applications</p>
          <p className="text-5xl font-bold mt-4 text-amber-600">{stats.pendingApplications}</p>
          {stats.pendingApplications > 0 && (
            <Link 
              href="/admin/applications" 
              className="absolute bottom-6 right-6 text-amber-600 hover:underline text-sm font-medium"
            >
              Review Now →
            </Link>
          )}
        </div>

        <div className="bg-white rounded-3xl p-8 border shadow-sm">
          <p className="text-gray-500 text-sm">Active Products</p>
          <p className="text-5xl font-bold mt-4">{stats.activeProducts}</p>
        </div>

        <div className="bg-white rounded-3xl p-8 border shadow-sm">
          <p className="text-gray-500 text-sm">Total Users</p>
          <p className="text-5xl font-bold mt-4">{stats.totalUsers}</p>
        </div>
      </div>

      {/* Recent Applications */}
      <div className="bg-white rounded-3xl border p-8">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-semibold">Recent Applications</h2>
          <Link href="/admin/applications" className="text-blue-600 hover:underline font-medium">
            View All Applications →
          </Link>
        </div>

        {recentApplications.length === 0 ? (
          <p className="text-gray-500 py-12 text-center">No recent applications.</p>
        ) : (
          <div className="divide-y">
            {recentApplications.map((app) => (
              <div key={app.id} className="py-6 flex justify-between items-center">
                <div>
                  <h4 className="font-semibold">{app.company_name}</h4>
                  <p className="text-sm text-gray-600">{app.contact_name} • {app.email}</p>
                </div>
                <div className="text-right">
                  <span className="text-xs bg-yellow-100 text-yellow-700 px-3 py-1 rounded-full">
                    Pending
                  </span>
                  <p className="text-xs text-gray-400 mt-2">
                    {new Date(app.created_at).toLocaleDateString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
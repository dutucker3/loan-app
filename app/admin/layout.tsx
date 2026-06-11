'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { canAccessAdminPortal } from '@/lib/permissions';
import { logPageVisit } from '@/lib/audit';

const navItems = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/applications', label: 'Applications' },
  { href: '/admin/organizations', label: 'Organizations' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/products', label: 'Products' },
  { href: '/admin/settings', label: 'My Company Settings' },
  { href: '/admin/reporting', label: 'Reporting' },
  { href: '/admin/billing', label: 'Billing' },
  { href: '/admin/audit', label: 'Audit Logs' },
  { href: '/admin/support', label: 'Support Requests' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [sbUser, setSbUser] = useState<any>(null);
  const [userLoaded, setUserLoaded] = useState(false);
  const pathname = usePathname();
  const [userRole, setUserRole] = useState<string>('');
  const [userOrgId, setUserOrgId] = useState<string | null>(null);
  const [roleLoading, setRoleLoading] = useState(true);
  const [showBilling, setShowBilling] = useState(false);

  useEffect(() => {
    async function loadSbUser() {
      const { data: { user: u } } = await supabase.auth.getUser();
      setSbUser(u);
      setUserLoaded(true);
    }
    loadSbUser();
  }, []);

  useEffect(() => {
    async function loadRole() {
      if (!sbUser?.id) {
        setRoleLoading(false);
        return;
      }
      try {
        // Prefer profiles table for Supabase auth users (legacy 'users' table removed to stop 404 spam in console)
        let { data } = await supabase
          .from('profiles')
          .select('role, organization_id')
          .eq('id', sbUser.id)
          .maybeSingle();
        let role = data?.role || '';
        let orgId = data?.organization_id || null;
        if (!orgId) {
          // Fallback for cases where org context is only in legacy users table (data migration safety)
          const { data: urow } = await supabase
            .from('users')
            .select('role, organization_id')
            .eq('id', sbUser.id)
            .maybeSingle();
          if (urow) {
            role = urow.role || role;
            orgId = urow.organization_id || orgId;
          }
        }
        setUserRole(role);
        setUserOrgId(orgId);
        setShowBilling(['SUPER_ADMIN', 'ADMIN'].includes(role));
      } catch (e) {
        console.warn('role load in admin layout', e);
      } finally {
        setRoleLoading(false);
      }
    }
    if (userLoaded) loadRole();
  }, [sbUser?.id, userLoaded]);

  // Light page visit logging for /admin (critical admin pages). Non-blocking, no perf hit.
  useEffect(() => {
    if (userLoaded && sbUser?.id) {
      const orgId = null; // org context loaded elsewhere; admin layout is broad
      logPageVisit(pathname || '/admin', sbUser.id, null).catch(() => {});
    }
  }, [userLoaded, sbUser?.id, pathname]);

  if (!userLoaded || roleLoading) return <div className="p-10">Loading...</div>;
  if (!sbUser) {
    // Simple redirect for unauth instead of Clerk RedirectToSignIn
    if (typeof window !== 'undefined') window.location.href = '/sign-in';
    return <div className="p-10">Redirecting to sign in...</div>;
  }

  const allowedRoles = ['SUPER_ADMIN', 'ADMIN', 'ORG_ADMIN', 'TECH_SUPPORT'];
  // Enforce junior block using centralized helper (all BROKER_AE incl. Level 2, juniors etc blocked entirely from /admin).
  // ORG_ADMIN (ADMIN/ORG_ADMIN + org) allowed in, and will only see *their* org products in admin (scoped queries in pages).
  const userForPerm = { id: sbUser.id || '', role: userRole, organization_id: null as any };
  const hasAdminAccess = !!userRole && (allowedRoles.includes(userRole) || canAccessAdminPortal(userForPerm));
  if (!hasAdminAccess) {
    return (
      <div className="p-10 text-center">
        <h1 className="text-2xl font-bold text-red-600">Access Denied</h1>
        <p className="mt-4">Your role ({userRole || 'unknown'}) does not allow access to the Admin Portal.</p>
        <p className="text-sm text-gray-500 mt-2">Junior users (BROKER_AE including Level 2, JUNIOR_BROKER etc.) are blocked from admin entirely. Only SUPER_ADMIN, ADMIN, ORG_ADMIN, TECH_SUPPORT permitted.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Sidebar */}
      <div className="w-64 bg-white border-r p-6 flex flex-col">
        <div className="mb-10">
          <h1 className="text-2xl font-bold text-blue-600">Admin Portal</h1>
        </div>

        <nav className="flex-1 space-y-2">
          {navItems.map((item, index) => {
            if (item.href === '/admin/billing' && !showBilling) return null;
            let finalHref = item.href;
            // "My Company Settings" always goes to the dedicated /admin/settings page,
            // which internally filters/loads the current user's organization (L1 for tenants, root/platform for level 0 supers).
            if (item.label === 'My Company Settings') {
              finalHref = '/admin/settings';
            }
            // isActive: Organizations list for the generic list, My Company for the tenant's own org detail
            let isActive = pathname === finalHref || (finalHref === '/admin/support' && pathname.startsWith('/admin/support')) || (finalHref === '/admin/audit' && pathname.startsWith('/admin/audit'));
            if (item.label === 'Organizations' && userOrgId) {
              isActive = pathname === '/admin/organizations';
            } else if (item.label === 'My Company Settings') {
              isActive = pathname === '/admin/settings' || pathname.startsWith('/admin/settings');
            } else if (item.label === 'Products') {
              isActive = pathname === '/admin/products' || pathname.startsWith('/admin/products/');
            } else if (item.label === 'Users') {
              isActive = pathname === '/admin/users' || pathname.startsWith('/admin/users');
            }
            return (
              <Link
                key={`${item.label}-${index}`}
                href={finalHref}
                className={`block px-4 py-3 rounded-2xl font-medium transition ${
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'hover:bg-gray-100'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto pt-6 border-t space-y-1">
          <Link 
            href="/dashboard" 
            className="block text-sm px-3 py-2 mb-2 border rounded-2xl hover:bg-gray-50 text-center"
          >
            ← Back to Dashboard
          </Link>
          <p className="text-xs text-gray-500">Logged in as {sbUser?.email || sbUser?.user_metadata?.email || 'Unknown'}</p>
          {userRole && <p className="text-[10px] text-blue-600">Role: {userRole}</p>}
          <Link href="/profile" className="text-[10px] text-blue-600 hover:underline block">View full profile →</Link>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1">
        <header className="bg-white border-b px-8 py-5 flex justify-between items-center">
          <h2 className="text-2xl font-semibold">Administration</h2>
          <Link 
            href="/dashboard" 
            className="text-sm px-4 py-2 border rounded-2xl hover:bg-gray-50 flex items-center gap-1"
          >
            ← Back to Dashboard
          </Link>
        </header>
        <main className="p-8">{children}</main>
      </div>
    </div>
  );
}
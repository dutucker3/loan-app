'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useTenant } from '@/lib/tenant-context';
import Link from 'next/link';

export default function AppHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const tenant = useTenant();

  const [user, setUser] = useState<any>(null);
  const [userRole, setUserRole] = useState<string>('');
  const [loadingUser, setLoadingUser] = useState(true);
  const [showUserMenu, setShowUserMenu] = useState(false);

  // Don't show on public / unauthenticated flows
  const isPublicPage =
    pathname?.startsWith('/apply') ||
    pathname?.startsWith('/providers') ||
    pathname?.startsWith('/thank-you') ||
    pathname === '/' ||
    pathname?.startsWith('/loan-application') ||
    pathname?.startsWith('/sign-in') ||
    pathname?.startsWith('/sign-up');

  useEffect(() => {
    if (isPublicPage) {
      setLoadingUser(false);
      return;
    }

    async function loadUser() {
      setLoadingUser(true);
      try {
        const { data: { user: sbUser } } = await supabase.auth.getUser();
        setUser(sbUser);

        if (sbUser?.id) {
          const { data: prof } = await supabase
            .from('profiles')
            .select('role, full_name')
            .eq('id', sbUser.id)
            .maybeSingle();
          setUserRole(prof?.role || '');
        }
      } catch (e) {
        // non-fatal on public pages
      } finally {
        setLoadingUser(false);
      }
    }

    loadUser();
  }, [isPublicPage, pathname]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setShowUserMenu(false);
    router.push('/'); // or a dedicated sign-in landing
  };

  if (isPublicPage) return null;

  const displayName = tenant?.name || 'Lending Platform';
  const userEmail = user?.email || user?.user_metadata?.email || '';
  const userLabel = user?.user_metadata?.full_name || userEmail?.split('@')[0] || 'User';

  return (
    <header className="sticky top-0 z-50 bg-white border-b shadow-sm">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        {/* Left: Tenant / Brand */}
        <Link href="/dashboard" className="flex items-center gap-3 group">
          {tenant?.logo_url && (
            <img 
              src={tenant.logo_url} 
              alt={displayName} 
              className="h-9 w-9 rounded-xl object-cover border" 
            />
          )}
          <div>
            <div 
              className="font-semibold text-xl tracking-tight group-hover:text-blue-600 transition-colors"
              style={{ color: tenant?.primary_color || '#111827' }}
            >
              {displayName}
            </div>
            {tenant?.domain && (
              <div className="text-[10px] text-gray-500 -mt-1">{tenant.domain}</div>
            )}
          </div>
        </Link>

        {/* Right side: User controls */}
        <div className="flex items-center gap-4">
          {!loadingUser && user && (
            <div className="relative">
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-2xl hover:bg-gray-100 transition text-sm"
              >
                <div className="text-right leading-tight">
                  <div className="font-medium text-gray-900">{userLabel}</div>
                  <div className="text-[11px] text-gray-500">{userEmail}</div>
                </div>
                <div className="h-8 w-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-semibold text-gray-600">
                  {userLabel?.[0]?.toUpperCase() || 'U'}
                </div>
              </button>

              {showUserMenu && (
                <div className="absolute right-0 mt-2 w-56 bg-white border rounded-2xl shadow-xl py-1 z-[100]">
                  <div className="px-4 py-2 border-b">
                    <div className="text-sm font-medium">{userLabel}</div>
                    <div className="text-xs text-gray-500 truncate">{userEmail}</div>
                    {userRole && (
                      <div className="text-[10px] mt-0.5 text-blue-600 font-medium">{userRole}</div>
                    )}
                  </div>

                  <Link
                    href="/profile"
                    className="block px-4 py-2.5 text-sm hover:bg-gray-50"
                    onClick={() => setShowUserMenu(false)}
                  >
                    👤 My Profile
                  </Link>

                  <Link
                    href="/dashboard"
                    className="block px-4 py-2.5 text-sm hover:bg-gray-50"
                    onClick={() => setShowUserMenu(false)}
                  >
                    📊 Dashboard
                  </Link>

                  {['SUPER_ADMIN', 'ADMIN', 'TECH_SUPPORT'].includes(userRole) && (
                    <Link
                      href="/select-org"
                      className="block px-4 py-2.5 text-sm hover:bg-gray-50"
                      onClick={() => setShowUserMenu(false)}
                    >
                      🔄 Switch Organization
                    </Link>
                  )}

                  <div className="border-t my-1" />

                  <button
                    onClick={handleLogout}
                    className="w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 hover:text-red-700 font-medium"
                  >
                    🚪 Log out
                  </button>
                </div>
              )}
            </div>
          )}

          {!loadingUser && !user && (
            <Link 
              href="/select-org" 
              className="text-sm px-4 py-1.5 rounded-2xl border hover:bg-gray-50"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

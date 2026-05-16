'use client';

import { useUser, RedirectToSignIn, SignedIn } from '@clerk/nextjs';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/applications', label: 'Applications' },
  { href: '/admin/organizations', label: 'Organizations' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoaded } = useUser();
  const pathname = usePathname();

  if (!isLoaded) return <div className="p-10">Loading...</div>;
  if (!user) return <RedirectToSignIn />;

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Sidebar */}
      <div className="w-64 bg-white border-r p-6 flex flex-col">
        <div className="mb-10">
          <h1 className="text-2xl font-bold text-blue-600">Admin Portal</h1>
        </div>

        <nav className="flex-1 space-y-2">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`block px-4 py-3 rounded-2xl font-medium transition ${
                pathname === item.href
                  ? 'bg-blue-600 text-white'
                  : 'hover:bg-gray-100'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="mt-auto pt-6 border-t">
          <p className="text-xs text-gray-500">Logged in as {user.emailAddresses[0]?.emailAddress}</p>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1">
        <header className="bg-white border-b px-8 py-5 flex justify-between items-center">
          <h2 className="text-2xl font-semibold">Administration</h2>
        </header>
        <main className="p-8">{children}</main>
      </div>
    </div>
  );
}
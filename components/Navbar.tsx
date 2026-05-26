// components/Navbar.tsx
'use client';

import { 
  SignedIn, 
  SignedOut, 
  OrganizationSwitcher, 
  UserButton 
} from '@clerk/nextjs';

export default function Navbar() {
  return (
    <nav className="border-b bg-white sticky top-0 z-50 shadow-sm">
      <div className="max-w-7xl mx-auto px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <h1 className="font-bold text-2xl tracking-tight">Loan-App</h1>
          
          <SignedIn>
            <OrganizationSwitcher 
              afterCreateOrganizationUrl="/dashboard"
              afterSelectOrganizationUrl="/loans/new"
              hidePersonal={false}
            />
          </SignedIn>
        </div>

        <div className="flex items-center gap-4">
          <SignedIn>
            <UserButton afterSignOutUrl="/" />
          </SignedIn>
          
          <SignedOut>
            <a href="/sign-in" className="text-sm font-medium hover:underline">
              Sign In
            </a>
          </SignedOut>
        </div>
      </div>
    </nav>
  );
}
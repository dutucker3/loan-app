import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

export default clerkMiddleware(async (auth, req) => {
  const url = req.nextUrl;
  const hostname = url.hostname;

  // Skip for localhost and Vercel preview domains
  if (hostname === 'localhost' || hostname.includes('vercel.app')) {
    return NextResponse.next();
  }

  // Check if this is a custom root domain
  const { data: tenant } = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/organizations?domain=eq.${hostname}`, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
    },
  }).then(res => res.json());

  if (tenant && tenant.length > 0) {
    // This is a white-labeled domain → pass the tenant info
    url.searchParams.set('tenant_domain', hostname);
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ['/((?!.+\\.[\\w]+$|_next).*)', '/', '/(api|trpc)(.*)'],
};
import Link from 'next/link';
import { headers } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase-admin';

export default async function ThankYouPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const isOrg = params.org === '1' || params.type === 'organization';

  // Server-side domain detection for instant white-label tenant thank-you (consistent with root home).
  // Reads the Host header and queries the org directly so the correct tenant content is shown on first response.
  const headersList = await headers();
  let host = headersList.get('host') || headersList.get('x-forwarded-host') || '';
  const hostname = host.split(':')[0].toLowerCase().trim();

  let tenant: any = null;
  try {
    // Only attempt lookup for real hostnames (skip localhost / vercel previews in dev)
    if (hostname && hostname !== 'localhost' && !hostname.endsWith('.vercel.app') && !hostname.includes('.local')) {
      const { data } = await supabaseAdmin
        .from('organizations')
        .select('id, name, slug, logo_url, primary_color, domain, parent_organization_id, is_root')
        .eq('domain', hostname)
        .maybeSingle();
      tenant = data;
    }
  } catch (err) {
    console.warn('[thank-you] server tenant lookup failed for host:', hostname, err);
  }

  const isWhiteLabelTenant = tenant && !tenant.is_root && tenant.domain;
  const tenantName = tenant?.name || 'Our Lending Network';

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="max-w-lg mx-auto text-center px-6">
        <div className="text-7xl mb-8">🎉</div>
        
        <h1 className="text-5xl font-bold mb-6 text-gray-900">
          {isOrg ? 'Organization Application Submitted!' : 'Application Submitted!'}
        </h1>
        
        <p className="text-xl text-gray-600 mb-10">
          {isOrg 
            ? `Thank you for applying to join ${tenantName} as a white-label organization.` 
            : 'Thank you for your interest in joining our lending platform.'}
        </p>

        <div className="bg-white rounded-3xl p-8 border mb-10">
          <p className="text-gray-700 leading-relaxed">
            {isOrg ? (
              <>
                Your White Label Company Agreement PDF (generated via @react-pdf/renderer) and all four required corporate document uploads (Company Operating Agreement, Company EIN Letter, Company Articles of Organization, Company Certificate of Good Standing) have been stored in the organization-documents Supabase bucket.<br />
                URLs + agreement_accepted flag saved to pending_organizations.documents JSON.<br />
                Our team will review your full application (including docs) within <span className="font-semibold">1-2 business days</span>.<br />
                You will receive an email with next steps once approved.
              </>
            ) : (
              <>
                Our team will review your application within <span className="font-semibold">1-2 business days</span>.<br />
                You will receive an email once your organization has been approved.
              </>
            )}
          </p>
        </div>

        <div className="space-y-4">
          <Link 
            href="/sign-in"
            className="block w-full py-5 bg-blue-600 text-white rounded-3xl font-semibold hover:bg-blue-700 text-lg"
          >
            Go to Sign In
          </Link>
          
          <Link 
            href="/"
            className="block w-full py-5 border border-gray-300 rounded-3xl font-medium hover:bg-gray-50"
          >
            Return to Homepage
          </Link>
        </div>
      </div>
    </div>
  );
}

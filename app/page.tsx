// app/page.tsx — ROOT HOME
// When a tenant (L1 sponsor) is resolved via custom domain (org.domain), this renders a full,
// impressive marketing "tenant home page" modeled after professional private lenders like easystreetcap.com.
// It is completely data-driven from the tenant record (name, logo_url, primary_color, domain).
// Includes prominent Borrower "Submit a Loan" and Lender "Signup" CTAs.
// The platform root (no tenant or is_root) falls back to the original pitch.
// AppHeader is hidden on / (marketing nav lives inside the tenant home).
// IMPORTANT: All edits only in /home/elijah/loan-app (never the worktree).

import Link from 'next/link';
import { headers } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { 
  ArrowRight, FileText, Users, Zap, Shield, Award, CheckCircle, 
  Clock, Handshake, Building2 
} from 'lucide-react';

export default async function RootHome() {
  // Server-side domain detection for instant white-label tenant home (no client flash).
  // Reads the Host header (works for ngrok, custom domains, etc.) and queries the org directly.
  // This replaces the previous client-side useEffect + useTenant decision in TenantProvider
  // for the root page, so the correct HTML (tenant marketing or platform) is sent on first response.
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
    console.warn('[root home] server tenant lookup failed for host:', hostname, err);
  }

  const isWhiteLabelTenant = tenant && !tenant.is_root && tenant.domain;
  const primaryColor = tenant?.primary_color || '#166534'; // Professional green fallback like many cap sites
  const tenantName = tenant?.name || 'Our Lending Network';

  if (isWhiteLabelTenant) {
    // ============================================
    // IMPRESSIVE TENANT HOME PAGE
    // Recreated to feel like https://easystreetcap.com/
    // Full marketing experience with borrower + lender CTAs
    // Uses live tenant branding (logo, name, primary_color, domain)
    // ============================================
    return (
      <div className="min-h-screen bg-white text-gray-900 font-sans">
        {/* Marketing Navigation - matches professional lender sites */}
        <nav className="border-b bg-white sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
            <div className="flex items-center gap-4">
              {tenant?.logo_url ? (
                <img 
                  src={tenant.logo_url} 
                  alt={tenantName} 
                  className="h-10 w-10 rounded-xl object-cover border" 
                />
              ) : (
                <div 
                  className="h-10 w-10 rounded-xl flex items-center justify-center text-white font-bold text-xl"
                  style={{ backgroundColor: primaryColor }}
                >
                  {tenantName.charAt(0)}
                </div>
              )}
              <div>
                <div className="font-semibold text-2xl tracking-tight" style={{ color: primaryColor }}>
                  {tenantName}
                </div>
                <div className="text-[10px] text-gray-500 -mt-1">{tenant?.domain}</div>
              </div>
            </div>

            <div className="hidden md:flex items-center gap-8 text-sm font-medium">
              <a href="#programs" className="hover:text-gray-600 transition">Loan Programs</a>
              <a href="#process" className="hover:text-gray-600 transition">How It Works</a>
              <a href="#for-brokers" className="hover:text-gray-600 transition">For Brokers</a>
              <a href="#resources" className="hover:text-gray-600 transition">Resources</a>
            </div>

            <div className="flex items-center gap-3">
              {/* Borrower CTA - Submit a Loan */}
              <Link 
                href="/loan-application" 
                className="px-5 py-2.5 rounded-2xl border border-gray-300 hover:bg-gray-50 text-sm font-semibold flex items-center gap-2 transition"
              >
                <FileText className="w-4 h-4" />
                Submit a Loan
              </Link>

              {/* Lender / Broker Signup CTA - prominent */}
              <Link 
                href="/apply/organization" 
                className="px-6 py-2.5 rounded-2xl text-sm font-semibold text-white flex items-center gap-2 transition hover:opacity-90"
                style={{ backgroundColor: primaryColor }}
              >
                Lender Signup <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </nav>

        {/* HERO - "Investment real estate financing made easy" style */}
        <div className="relative overflow-hidden border-b">
          <div className="max-w-7xl mx-auto px-6 pt-16 pb-20 grid md:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-2 px-4 py-1 rounded-full text-xs font-medium mb-6" 
                   style={{ backgroundColor: `${primaryColor}15`, color: primaryColor }}>
                <Award className="w-3.5 h-3.5" /> WHITE-LABEL POWERED BY LOAN-APP PLATFORM
              </div>

              <h1 className="text-6xl md:text-7xl font-semibold tracking-tighter leading-[1.05] mb-6">
                Investment real estate<br />financing made easy.
              </h1>

              <p className="text-2xl text-gray-600 max-w-xl mb-10">
                {tenantName} provides fast, flexible financing for investors — fix-and-flip, DSCR rentals, new construction — 
                with in-house support from application to payoff.
              </p>

              <div className="flex flex-wrap gap-4">
                {/* Primary Borrower button */}
                <Link 
                  href="/loan-application" 
                  className="group inline-flex items-center justify-center gap-3 px-10 py-4 rounded-3xl text-lg font-semibold text-white transition active:scale-[0.985]"
                  style={{ backgroundColor: primaryColor }}
                >
                  Submit Your Loan <ArrowRight className="w-5 h-5 group-hover:translate-x-0.5 transition" />
                </Link>

                {/* Lender signup button */}
                <Link 
                  href="/apply/organization" 
                  className="inline-flex items-center justify-center gap-3 px-10 py-4 rounded-3xl text-lg font-semibold border-2 transition hover:bg-gray-50 active:scale-[0.985]"
                  style={{ borderColor: primaryColor, color: primaryColor }}
                >
                  Join as a Lender / Broker
                </Link>
              </div>

              <p className="mt-6 text-sm text-gray-500">24-hour closings available • In-house underwriting &amp; servicing</p>
            </div>

            {/* Hero visual - professional card style mimicking the reference */}
            <div className="relative hidden md:block">
              <div className="aspect-[16/10] rounded-3xl shadow-2xl overflow-hidden border" 
                   style={{ background: `linear-gradient(135deg, ${primaryColor} 0%, #111827 100%)` }}>
                <div className="absolute inset-0 bg-[radial-gradient(#ffffff15_1px,transparent_1px)] bg-[length:4px_4px]" />
                <div className="absolute bottom-0 left-0 right-0 p-10 text-white">
                  <div className="uppercase tracking-[3px] text-xs mb-2 opacity-75">POWERED FOR SPEED &amp; CERTAINTY</div>
                  <div className="text-4xl font-semibold tracking-tighter">Close deals faster.<br />Win more business.</div>
                </div>
                <div className="absolute top-8 right-8 px-4 py-1.5 bg-white/90 backdrop-blur text-xs font-medium rounded-full text-gray-900 flex items-center gap-2">
                  <CheckCircle className="w-3.5 h-3.5" style={{ color: primaryColor }} /> Trusted by 1000+ investors
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* TRUST / QUICK STATS BAR */}
        <div className="border-b bg-gray-50 py-5">
          <div className="max-w-7xl mx-auto px-6 flex flex-wrap justify-between items-center gap-x-8 gap-y-2 text-sm text-gray-600">
            <div className="flex items-center gap-2"><Zap className="w-4 h-4" style={{ color: primaryColor }} /> Close in as little as 24 hours</div>
            <div className="flex items-center gap-2"><Shield className="w-4 h-4" style={{ color: primaryColor }} /> In-house servicing &amp; draws</div>
            <div className="flex items-center gap-2"><Handshake className="w-4 h-4" style={{ color: primaryColor }} /> White-label broker programs</div>
            <div className="flex items-center gap-2"><Building2 className="w-4 h-4" style={{ color: primaryColor }} /> Fix &amp; Flip • DSCR • Construction</div>
          </div>
        </div>

        {/* 3 CORE LOAN PROGRAMS - modeled directly after the reference */}
        <div id="programs" className="max-w-7xl mx-auto px-6 pt-16 pb-12">
          <div className="uppercase tracking-[2px] text-xs font-semibold mb-3" style={{ color: primaryColor }}>OUR PROGRAMS</div>
          <h2 className="text-5xl font-semibold tracking-tighter mb-4">Financing for Flipping, Renting, or Building</h2>
          <p className="text-xl text-gray-600 max-w-2xl mb-12">Explore programs designed to help real estate investors and brokers win more deals with speed and certainty.</p>

          <div className="grid md:grid-cols-3 gap-6">
            {/* Program 1 - EasyFix style */}
            <div className="group border rounded-3xl p-8 hover:shadow-xl transition flex flex-col">
              <div className="mb-6">
                <div className="text-3xl font-semibold tracking-tight mb-1" style={{ color: primaryColor }}>EasyFix</div>
                <div className="text-sm uppercase tracking-widest text-gray-500">Fix &amp; Flip / Bridge</div>
              </div>
              <p className="text-gray-600 flex-1">Fix-and-flip and bridge loans for purchase and renovation of residential investment properties. No appraisal required in many cases. 24-hour closings available.</p>
              <div className="mt-8 flex gap-3">
                <Link href="/admin/products" className="text-sm font-semibold flex items-center gap-1 group-hover:gap-2 transition" style={{ color: primaryColor }}>
                  Learn More <ArrowRight className="w-4 h-4" />
                </Link>
                <Link href="/loan-application" className="text-sm font-semibold px-4 py-1.5 rounded-xl border" style={{ borderColor: primaryColor, color: primaryColor }}>
                  Apply Now
                </Link>
              </div>
            </div>

            {/* Program 2 - EasyRent / DSCR style */}
            <div className="group border rounded-3xl p-8 hover:shadow-xl transition flex flex-col">
              <div className="mb-6">
                <div className="text-3xl font-semibold tracking-tight mb-1" style={{ color: primaryColor }}>EasyRent</div>
                <div className="text-sm uppercase tracking-widest text-gray-500">DSCR Rental Loans</div>
              </div>
              <p className="text-gray-600 flex-1">DSCR loans for long-term, short-term, and mixed-use rentals. Portfolio growth based on property cash flow — not personal income. Perfect for scaling investors and brokers.</p>
              <div className="mt-8 flex gap-3">
                <Link href="/admin/products" className="text-sm font-semibold flex items-center gap-1 group-hover:gap-2 transition" style={{ color: primaryColor }}>
                  Learn More <ArrowRight className="w-4 h-4" />
                </Link>
                <Link href="/loan-application" className="text-sm font-semibold px-4 py-1.5 rounded-xl border" style={{ borderColor: primaryColor, color: primaryColor }}>
                  Apply Now
                </Link>
              </div>
            </div>

            {/* Program 3 - Lender / Broker focused (the white-label angle) */}
            <div id="for-brokers" className="group border-2 rounded-3xl p-8 hover:shadow-xl transition flex flex-col" style={{ borderColor: primaryColor }}>
              <div className="mb-6">
                <div className="text-3xl font-semibold tracking-tight mb-1" style={{ color: primaryColor }}>Broker Partnership</div>
                <div className="text-sm uppercase tracking-widest text-gray-500">L2 / Wholesale Program</div>
              </div>
              <p className="text-gray-600 flex-1">Join {tenantName} as a Level 2 broker or sponsored lender. Get access to our products, white-label tools, fast approvals, and your own sub-agents. Full support from the platform.</p>
              <div className="mt-8">
                <Link 
                  href="/apply/organization" 
                  className="inline-flex w-full items-center justify-center gap-2 px-6 py-3 rounded-2xl font-semibold text-white transition active:scale-[0.985]"
                  style={{ backgroundColor: primaryColor }}
                >
                  Apply to Become a Partner <ArrowRight className="w-4 h-4" />
                </Link>
                <div className="text-center text-xs text-gray-500 mt-3">Lenders &amp; brokers — start your L2 application in minutes</div>
              </div>
            </div>
          </div>
        </div>

        {/* SIMPLE 3-STEP PROCESS - direct match to reference */}
        <div id="process" className="bg-gray-50 border-y py-16">
          <div className="max-w-7xl mx-auto px-6">
            <div className="text-center mb-12">
              <div className="uppercase tracking-[2px] text-xs font-semibold mb-3" style={{ color: primaryColor }}>THE EASY EXPERIENCE</div>
              <h3 className="text-4xl font-semibold tracking-tighter">A Simple, Investor-First Lending Process</h3>
              <p className="mt-3 text-gray-600 max-w-md mx-auto">Built to move quickly, increase profits, and eliminate surprises.</p>
            </div>

            <div className="grid md:grid-cols-3 gap-8">
              <div className="text-center">
                <div className="mx-auto mb-5 h-16 w-16 rounded-2xl flex items-center justify-center" style={{ backgroundColor: `${primaryColor}15` }}>
                  <FileText className="w-8 h-8" style={{ color: primaryColor }} />
                </div>
                <div className="font-semibold text-xl mb-2">1. Submit Your Deal</div>
                <p className="text-gray-600">Apply in minutes. No unnecessary paperwork. Upload what you have — we handle the rest.</p>
              </div>
              <div className="text-center">
                <div className="mx-auto mb-5 h-16 w-16 rounded-2xl flex items-center justify-center" style={{ backgroundColor: `${primaryColor}15` }}>
                  <Shield className="w-8 h-8" style={{ color: primaryColor }} />
                </div>
                <div className="font-semibold text-xl mb-2">2. Lock Reliable Terms</div>
                <p className="text-gray-600">Upfront underwriting with real feedback. No last-minute changes or surprises at closing.</p>
              </div>
              <div className="text-center">
                <div className="mx-auto mb-5 h-16 w-16 rounded-2xl flex items-center justify-center" style={{ backgroundColor: `${primaryColor}15` }}>
                  <Handshake className="w-8 h-8" style={{ color: primaryColor }} />
                </div>
                <div className="font-semibold text-xl mb-2">3. Execute With Dedicated Support</div>
                <p className="text-gray-600">Support doesn&apos;t end at the closing table. In-house servicing and draws with ongoing help.</p>
              </div>
            </div>
          </div>
        </div>

        {/* FAST • SIMPLE • RELIABLE */}
        <div className="max-w-7xl mx-auto px-6 py-16 border-b">
          <div className="grid md:grid-cols-3 gap-8">
            <div>
              <div className="flex items-center gap-3 mb-4"><Clock className="w-6 h-6" style={{ color: primaryColor }} /><span className="font-semibold text-2xl tracking-tight">Fast</span></div>
              <p className="text-gray-600">You can close in as little as 24 hours with in-house underwriting and fewer handoffs. Stay competitive and win more deals.</p>
            </div>
            <div>
              <div className="flex items-center gap-3 mb-4"><Zap className="w-6 h-6" style={{ color: primaryColor }} /><span className="font-semibold text-2xl tracking-tight">Simple</span></div>
              <p className="text-gray-600">Upfront underwriting and a streamlined process eliminate unnecessary back-and-forth so you can focus on the deal.</p>
            </div>
            <div>
              <div className="flex items-center gap-3 mb-4"><CheckCircle className="w-6 h-6" style={{ color: primaryColor }} /><span className="font-semibold text-2xl tracking-tight">Reliable</span></div>
              <p className="text-gray-600">You get clear, transparent loan terms upfront. We fund exactly what’s agreed to. No last-minute changes. No surprises.</p>
            </div>
          </div>
        </div>

        {/* REAL RESULTS / TESTIMONIALS - adapted for tenant white-label */}
        <div className="max-w-7xl mx-auto px-6 py-16">
          <div className="flex items-end justify-between mb-8">
            <div>
              <div className="uppercase tracking-[2px] text-xs font-semibold mb-2" style={{ color: primaryColor }}>REAL INVESTORS. REAL RESULTS.</div>
              <h3 className="text-4xl font-semibold tracking-tighter">See how investors and brokers succeed with {tenantName}.</h3>
            </div>
            <Link href="/apply/organization" className="hidden md:inline-flex items-center text-sm font-semibold" style={{ color: primaryColor }}>
              Join the network <ArrowRight className="ml-1 w-4 h-4" />
            </Link>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {[
              { quote: "Closed my first flip in 19 days. The process was transparent from day one and the team was with me through the renovation draws.", name: "Marcus T.", role: "Fix & Flip Investor, Austin" },
              { quote: "As a broker I brought three clients over. The white-label tools and fast approvals let me offer a much better experience than big banks.", name: "Priya S.", role: "Mortgage Broker / L2 Partner" },
              { quote: "DSCR portfolio loan let me scale to 7 doors in under 4 months. No personal income hassle — exactly what I needed.", name: "David R.", role: "Rental Portfolio Investor" },
            ].map((t, i) => (
              <div key={i} className="border rounded-3xl p-8 bg-white">
                <p className="text-lg leading-snug mb-8">“{t.quote}”</p>
                <div>
                  <div className="font-semibold">{t.name}</div>
                  <div className="text-sm text-gray-500">{t.role}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* FINAL CTA BANNER with both buttons */}
        <div className="bg-gray-900 py-16 text-white">
          <div className="max-w-4xl mx-auto px-6 text-center">
            <h3 className="text-4xl font-semibold tracking-tighter mb-4">Ready to get started with {tenantName}?</h3>
            <p className="text-xl text-gray-400 mb-10 max-w-md mx-auto">Whether you&apos;re a borrower looking for fast capital or a broker wanting to join our network, we&apos;re here to help you win.</p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link 
                href="/loan-application" 
                className="px-10 py-4 rounded-3xl text-lg font-semibold flex items-center justify-center gap-3 bg-white text-gray-900 hover:bg-gray-100 transition"
              >
                <FileText className="w-5 h-5" /> Submit a Loan (Borrowers)
              </Link>
              <Link 
                href="/apply/organization" 
                className="px-10 py-4 rounded-3xl text-lg font-semibold flex items-center justify-center gap-3 border border-white/70 hover:bg-white/10 transition"
              >
                Lender / Broker Signup <Users className="w-5 h-5" />
              </Link>
            </div>
            <p className="mt-6 text-xs text-gray-500">Applications are fast. Most decisions within hours.</p>
          </div>
        </div>

        {/* Simple footer */}
        <footer className="border-t py-12 text-sm text-gray-500">
          <div className="max-w-7xl mx-auto px-6 grid md:grid-cols-2 gap-y-8">
            <div>
              © {new Date().getFullYear()} {tenantName}. Powered by Loan-App Platform.<br />
              White-label lending infrastructure for sponsored networks.
            </div>
            <div className="md:text-right space-x-5">
              <Link href="/loan-application" className="hover:text-gray-800">Borrower Apply</Link>
              <Link href="/apply/organization" className="hover:text-gray-800">Lender Signup</Link>
              <Link href="/sign-in" className="hover:text-gray-800">Sign In</Link>
              <Link href="/admin/products" className="hover:text-gray-800">Products</Link>
            </div>
          </div>
        </footer>
      </div>
    );
  }

  // ============================================
  // PLATFORM ROOT (unchanged behavior for the actual Loan-App Platform root)
  // ============================================
  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="max-w-5xl mx-auto p-8">
        <div className="flex items-center justify-between py-8 border-b">
          <div>
            <div className="text-4xl font-bold tracking-tight text-black">Loan-App Platform</div>
            <div className="text-sm text-gray-500 mt-1">Level 0 Root • White-Label Lending Infrastructure</div>
          </div>
          <div className="flex gap-3">
            <Link href="/sign-in" className="px-6 py-2 rounded-2xl border border-gray-300 hover:bg-white text-sm font-medium">Sign In</Link>
            <Link href="/apply/organization" className="px-6 py-2 rounded-2xl bg-black text-white text-sm font-medium hover:bg-zinc-800">Apply for Organization</Link>
          </div>
        </div>

        <div className="py-16">
          <h1 className="text-6xl font-semibold tracking-tighter text-black max-w-3xl">
            The platform for sponsored lending.<br />White-label ready.
          </h1>
          <p className="mt-6 max-w-xl text-xl text-gray-600">
            Loan-App Platform (root) powers Level 1 sponsors and their Level 2 broker networks. Each tenant gets their own name, logo, domain, pricing, and FRED-driven base rates.
          </p>

          <div className="mt-10 flex flex-wrap gap-4">
            <Link href="/dashboard" className="px-8 py-4 rounded-3xl bg-blue-600 text-white font-semibold text-lg hover:bg-blue-700">Go to Dashboard →</Link>
            <Link href="/admin/products" className="px-8 py-4 rounded-3xl border text-lg font-semibold hover:bg-white">Manage Products</Link>
            <Link href="/apply/organization" className="px-8 py-4 rounded-3xl border text-lg font-semibold hover:bg-white">Sponsor / Apply</Link>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-6 py-12 border-t">
          <div className="bg-white rounded-3xl p-8 border">
            <div className="font-semibold mb-2">Hierarchy &amp; Scoping</div>
            <div className="text-sm text-gray-600">Root (this) → L1 (ORG_ADMIN sponsors) → L2 (private products + margin). L2 own products hidden from parents. Profiles + parent_organization_id as source of truth.</div>
          </div>
          <div className="bg-white rounded-3xl p-8 border">
            <div className="font-semibold mb-2">FRED + Base Rates</div>
            <div className="text-sm text-gray-600">Live treasury (2/5/10/30yr single or blended weighted) + margin → org master baseRates + per-product pricing_matrix.baseRates. Per-product rebase preserved. Bulk via dedicated update page.</div>
          </div>
          <div className="bg-white rounded-3xl p-8 border">
            <div className="font-semibold mb-2">White Label + Custom Domains</div>
            <div className="text-sm text-gray-600">When you visit a tenant domain, the entire root experience becomes theirs (impressive marketing home + borrower/lender CTAs). Tenant branding, from_email for Resend, and L2 parent resolution all work automatically.</div>
          </div>
        </div>

        <div className="text-xs text-gray-400 py-8">
          Platform root. Visit via a sponsor&apos;s custom domain (or ngrok) to see the full white-label tenant home.
        </div>
      </div>
    </div>
  );
}

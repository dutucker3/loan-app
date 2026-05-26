'use client';

import Link from 'next/link';
import { useUser } from '@clerk/nextjs';

export default function HomePage() {
  const { user, isLoaded } = useUser();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 text-white">
      {/* Hero Section */}
      <div className="max-w-6xl mx-auto px-6 pt-24 pb-20 text-center">
        <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-md px-6 py-2 rounded-full mb-6">
          <span className="text-emerald-400">●</span>
          <span className="text-sm font-medium">Now in Beta</span>
        </div>

        <h1 className="text-7xl font-bold tracking-tight mb-6">
          Modern Lending.<br />
          <span className="bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
            Built for Brokers.
          </span>
        </h1>

        <p className="text-2xl text-gray-300 max-w-3xl mx-auto mb-12">
          Whitelabel platform with automated workflows, 
          real-time loan matrix, and AI-powered underwriting.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          {isLoaded && user ? (
            <Link 
              href="/apply/organization"
              className="px-10 py-5 bg-white text-black rounded-2xl font-semibold text-xl hover:bg-gray-100 transition-all inline-flex items-center justify-center gap-3"
            >
              Continue Application →
            </Link>
          ) : (
            <Link 
              href="/sign-up?redirect=/apply/organization"
              className="px-10 py-5 bg-white text-black rounded-2xl font-semibold text-xl hover:bg-gray-100 transition-all inline-flex items-center justify-center gap-3"
            >
              Get Started Free
              <span>→</span>
            </Link>
          )}
        </div>

        <p className="text-sm text-gray-400 mt-6">No credit card required • 14-day free trial</p>
      </div>

      {/* Features Section */}
      <div id="features" className="bg-white text-black py-24">
        <div className="max-w-6xl mx-auto px-6">
          <h2 className="text-5xl font-bold text-center mb-16">Everything you need to scale</h2>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            <div className="bg-gray-50 rounded-3xl p-10">
              <div className="text-4xl mb-6">🏷️</div>
              <h3 className="text-2xl font-semibold mb-4">Full Whitelabel</h3>
              <p className="text-gray-600">Your logo, your colors, your domain. Looks like your own platform.</p>
            </div>

            <div className="bg-gray-50 rounded-3xl p-10">
              <div className="text-4xl mb-6">⚡</div>
              <h3 className="text-2xl font-semibold mb-4">Automated Workflows</h3>
              <p className="text-gray-600">From application to underwriting to closing — fully automated with AI assistance.</p>
            </div>

            <div className="bg-gray-50 rounded-3xl p-10">
              <div className="text-4xl mb-6">📊</div>
              <h3 className="text-2xl font-semibold mb-4">Real-time Loan Matrix</h3>
              <p className="text-gray-600">Instant pricing engine with dynamic adjustments, DSCR, LTV, FICO and more.</p>
            </div>

            <div className="bg-gray-50 rounded-3xl p-10">
              <div className="text-4xl mb-6">🤖</div>
              <h3 className="text-2xl font-semibold mb-4">AI Processing</h3>
              <p className="text-gray-600">Smart document analysis, risk scoring, and instant feedback to borrowers and brokers.</p>
            </div>

            <div className="bg-gray-50 rounded-3xl p-10">
              <div className="text-4xl mb-6">📧</div>
              <h3 className="text-2xl font-semibold mb-4">Client Portal</h3>
              <p className="text-gray-600">Beautiful borrower and broker portals with status tracking and document requests.</p>
            </div>

            <div className="bg-gray-50 rounded-3xl p-10">
              <div className="text-4xl mb-6">📈</div>
              <h3 className="text-2xl font-semibold mb-4">Scale Effortlessly</h3>
              <p className="text-gray-600">Built for high-volume brokers and lending companies.</p>
            </div>
          </div>

          <div className="text-center mt-16">
            <Link 
              href={isLoaded && user ? "/apply/organization" : "/sign-up?redirect=/apply/organization"}
              className="inline-block px-12 py-6 bg-blue-600 text-white rounded-3xl font-semibold text-2xl hover:bg-blue-700 transition-all"
            >
              {isLoaded && user ? "Continue Application →" : "Start Your Free Trial →"}
            </Link>
          </div>
        </div>
      </div>

      {/* Final CTA */}
      <div className="bg-slate-900 py-20 text-center">
        <p className="text-3xl font-medium text-white mb-6">Ready to modernize your lending business?</p>
        <Link href="/sign-up" className="text-blue-400 hover:text-blue-300 text-xl font-medium">
          Create your account in under 60 seconds →
        </Link>
      </div>
    </div>
  );
}
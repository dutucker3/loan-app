'use client';

import Link from 'next/link';

export default function ThankYouPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="max-w-lg mx-auto text-center px-6">
        <div className="text-7xl mb-8">🎉</div>
        
        <h1 className="text-5xl font-bold mb-6 text-gray-900">Application Submitted!</h1>
        
        <p className="text-xl text-gray-600 mb-10">
          Thank you for your interest in joining our lending platform.
        </p>

        <div className="bg-white rounded-3xl p-8 border mb-10">
          <p className="text-gray-700 leading-relaxed">
            Our team will review your application within <span className="font-semibold">1-2 business days</span>.<br />
            You will receive an email once your organization has been approved.
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
'use client';

import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md">
        <SignUp 
          appearance={{
            elements: {
              rootBox: "mx-auto",
              card: "shadow-xl rounded-3xl",
            }
          }}
          afterSignUpUrl="/sync-user"        // ← This is the most reliable
          redirectUrl="/sync-user"
          signInUrl="/sign-in"
        />
      </div>
    </div>
  );
}
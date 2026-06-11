/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'img.clerk.com',
      },
      {
        protocol: 'https',
        hostname: 'afnftqzhszrdiproovyx.supabase.co',
      },
    ],
  },

  // Force webpack (more stable for your current setup) + webpack fallback for Supabase/Clerk
  // Note: experimental.turbopack removed (was causing "unrecognized key" warnings in Next 15.5+)

  // Allow dev origins for ngrok and local testing to prevent chunk load / cross-origin errors for _next/static
  allowedDevOrigins: ['aloe-unhelpful-clip.ngrok-free.dev', 'localhost'],

  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
    };
    return config;
  },
};

export default nextConfig;
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
  experimental: {
    turbopack: false,
  },

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
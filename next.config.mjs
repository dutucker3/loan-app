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

  // Fix Turbopack + webpack conflict
  experimental: {
    turbopack: false,   // Force webpack for now (more stable with your current setup)
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
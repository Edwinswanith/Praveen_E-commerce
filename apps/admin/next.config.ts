import type { NextConfig } from 'next';

const apiUrl = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@vyra/ui', '@vyra/shared'],
  images: { unoptimized: true },
  async rewrites() {
    return [
      { source: '/api/v1/:path*', destination: `${apiUrl}/api/v1/:path*` },
      { source: '/media/:path*', destination: `${apiUrl}/media/:path*` },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;

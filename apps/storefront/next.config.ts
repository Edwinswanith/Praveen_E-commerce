import type { NextConfig } from 'next';

const API_URL = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

/** Extra https image hosts (e.g. a CDN/S3 bucket), comma-separated hostnames. */
const extraImageHosts = (process.env.NEXT_PUBLIC_IMAGE_HOSTS ?? '')
  .split(',')
  .map((h) => h.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@vyra/ui', '@vyra/shared'],
  async rewrites() {
    return [
      { source: '/api/v1/:path*', destination: `${API_URL}/api/v1/:path*` },
      { source: '/media/:path*', destination: `${API_URL}/media/:path*` },
    ];
  },
  images: {
    remotePatterns: [
      { protocol: 'http', hostname: 'localhost', port: '4000', pathname: '/**' },
      ...extraImageHosts.map((hostname) => ({
        protocol: 'https' as const,
        hostname,
        pathname: '/**',
      })),
    ],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;

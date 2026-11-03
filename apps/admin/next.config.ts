import type { NextConfig } from 'next';
import { API_PREFIX, resolveApiUrl } from '@vyra/shared';

/** Fails the build/start in production when API_URL is missing or invalid. */
const apiUrl = resolveApiUrl(process.env);

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@vyra/ui', '@vyra/shared'],
  images: { unoptimized: true },
  async rewrites() {
    return [
      { source: `${API_PREFIX}/:path*`, destination: `${apiUrl}${API_PREFIX}/:path*` },
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

import type { NextConfig } from 'next';
import { API_PREFIX, resolveApiUrl } from '@vyra/shared';

/** Fails the build/start in production when API_URL is missing or invalid. */
const API_URL = resolveApiUrl(process.env);
const api = new URL(API_URL);

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
      { source: `${API_PREFIX}/:path*`, destination: `${API_URL}${API_PREFIX}/:path*` },
      { source: '/media/:path*', destination: `${API_URL}/media/:path*` },
    ];
  },
  images: {
    remotePatterns: [
      { protocol: api.protocol.replace(':', '') as 'http' | 'https', hostname: api.hostname, port: api.port, pathname: '/**' },
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

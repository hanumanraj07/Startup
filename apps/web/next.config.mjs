/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Money/types/utils/validation are workspace packages consumed as source in
  // dev; transpile them rather than requiring each to be pre-built.
  transpilePackages: ['@onsite/types', '@onsite/validation', '@onsite/money', '@onsite/utils'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'geolocation=(self), camera=(self), microphone=()',
          },
        ],
      },
    ];
  },
};

export default nextConfig;

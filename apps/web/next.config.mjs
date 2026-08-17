/** @type {import('next').NextConfig} */
const API_TARGET = process.env.API_PROXY_TARGET || 'http://localhost:4020';

const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    // Dev / no-nginx fallback: proxy /api to the Fastify service. In
    // production nginx routes <DOMAIN>/api to the API before Next sees it.
    return [{ source: '/api/:path*', destination: `${API_TARGET}/api/:path*` }];
  },
};

export default nextConfig;

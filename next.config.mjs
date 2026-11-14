import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
export default {
  // Server-only packages that must not be bundled.
  serverExternalPackages: ['@electric-sql/pglite', 'exceljs', 'jszip', 'pdfkit'],
  outputFileTracingIncludes: { '/**': ['./db/migrations/**/*'] },
  experimental: { serverActions: { bodySizeLimit: '30mb' } },
  poweredByHeader: false,
  // No other site may show these pages in a frame (clickjacking); browsers must not guess file types.
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'same-origin' },
    ] }];
  },
  webpack(config) {
    config.resolve.alias = { ...config.resolve.alias, '@': root };
    return config;
  },
};

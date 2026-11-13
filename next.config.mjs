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
  webpack(config) {
    config.resolve.alias = { ...config.resolve.alias, '@': root };
    return config;
  },
};

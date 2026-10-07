import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // unpdf ships its own serverless build of pdf.js. Loading it from node_modules
  // at runtime (instead of bundling it) avoids bundler issues with pdf.js internals.
  serverExternalPackages: ['unpdf'],
};

export default nextConfig;

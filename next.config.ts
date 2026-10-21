import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // unpdf ships its own serverless build of pdf.js. Loading it from node_modules
  // at runtime (instead of bundling it) avoids bundler issues with pdf.js internals.
  serverExternalPackages: ['unpdf'],
  // The demo reads these from disk at request time (the recordings, and the sample
  // resumes). Next's tracing already finds them today (checked on Vercel without this
  // setting), but only by guessing from the path code; naming them keeps the demo
  // from breaking silently if that code changes.
  outputFileTracingIncludes: {
    '/api/review': ['./demo/recordings/**/*', './fixtures/*.txt'],
  },
  // Tracing follows the fixtures path and would sweep in the private folder when it exists
  // on the machine doing the build. It must never be part of a deployed function.
  outputFileTracingExcludes: {
    '/api/review': ['./fixtures/private/**/*'],
  },
};

export default nextConfig;

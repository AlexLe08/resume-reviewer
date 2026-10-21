/**
 * Kept apart from upload.ts so the browser can use it without pulling in the
 * PDF reader. Under 4.5 MB, the request-body limit of the usual serverless hosts
 * (Vercel's, for one): a bigger request is refused before our code runs, so the
 * browser has to check first or the person only sees a bare platform error.
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export const TOO_LARGE_MESSAGE = 'That file is over 4 MB. Export a smaller PDF and try again.';

export function isTooLarge(size: number): boolean {
  return size > MAX_UPLOAD_BYTES;
}

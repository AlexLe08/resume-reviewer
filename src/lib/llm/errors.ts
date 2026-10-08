export type ProviderErrorCode =
  | 'unreachable'
  | 'model_not_found'
  | 'structured_output_unsupported'
  | 'bad_response'
  | 'http';

/**
 * Errors our own provider code throws. `status` mirrors an HTTP status where
 * there is one, so the retry logic treats these like any other API error.
 */
export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly status: number | undefined;

  constructor(message: string, code: ProviderErrorCode, status?: number, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ProviderError';
    this.code = code;
    this.status = status;
  }
}

export interface StructuredStreamRequest {
  system: string;
  user: string;
  /** JSON Schema the model's output must follow. */
  jsonSchema: Record<string, unknown>;
  temperature?: number;
  signal?: AbortSignal;
  /**
   * What the mock provider should return for this request. Real providers
   * ignore it. Each pipeline supplies its own, so the mock can stand in for
   * reviews, requirement extraction, and matching alike.
   */
  mockResponse?: () => unknown;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** Tokens spent on the model's internal reasoning. Billed as output on most providers. */
  thinkingTokens: number;
}

export interface StreamChunk {
  text: string;
  usage?: TokenUsage;
  /** The model the provider reports actually served this response. */
  model?: string;
}

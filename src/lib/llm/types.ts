export interface StructuredStreamRequest {
  system: string;
  user: string;
  /** JSON Schema the model's output must follow. */
  jsonSchema: Record<string, unknown>;
  temperature?: number;
  signal?: AbortSignal;
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

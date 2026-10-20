import type { CallRecord } from '@/lib/llm/usage';

/** What one model call used, shown under a reviewer's results. */
export function UsageList({ call, quotes }: { call: CallRecord; quotes?: { quotes: number; found: number } }) {
  return (
    <dl className="usage">
      <div>
        <dt>Model</dt>
        <dd>{call.provider === 'replay' ? `${call.model} (recorded run)` : `${call.provider} / ${call.model}`}</dd>
      </div>
      <div>
        <dt>Tokens in / out / thinking</dt>
        <dd>
          {call.inputTokens.toLocaleString()} / {call.outputTokens.toLocaleString()} / {call.thinkingTokens.toLocaleString()}
        </dd>
      </div>
      {/* A replay answers in milliseconds: showing that as the time would be misleading. */}
      {call.provider !== 'replay' && (
        <div>
          <dt>Time</dt>
          <dd>{(call.latencyMs / 1000).toFixed(1)} s</dd>
        </div>
      )}
      {quotes && quotes.quotes > 0 && (
        <div>
          <dt>Quotes found in resume</dt>
          <dd>
            {quotes.found} of {quotes.quotes}
          </dd>
        </div>
      )}
      {call.estimatedCostUsd > 0 && (
        <div>
          <dt>Estimated cost</dt>
          <dd>${call.estimatedCostUsd.toFixed(4)}</dd>
        </div>
      )}
    </dl>
  );
}

import type { CheckResult, CheckStatus } from '@/lib/checks';

const STATUS_TEXT: Record<CheckStatus, string> = {
  pass: 'Looks good',
  warn: 'Worth a look',
  fail: 'Problem',
};

const STATUS_MARK: Record<CheckStatus, string> = {
  pass: '✓',
  warn: '!',
  fail: '✕',
};

export function ChecksPanel({ checks }: { checks: CheckResult[] }) {
  return (
    <ul className="checks">
      {checks.map((check) => (
        <li key={check.id} className={`check check-${check.status}`}>
          <span className="check-mark" aria-hidden="true">
            {STATUS_MARK[check.status]}
          </span>
          <div>
            <p className="check-label">
              {check.label}
              <span className="visually-hidden">: {STATUS_TEXT[check.status]}</span>
            </p>
            <p className="check-detail">{check.detail}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

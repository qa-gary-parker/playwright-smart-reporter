import type { JSX } from 'preact';
import { cx } from './util';

export type TestStatus = 'failed' | 'timedOut' | 'interrupted' | 'passed' | 'flaky' | 'skipped' | 'quarantined';

const LABEL: Record<TestStatus, string> = {
  failed: 'failed',
  timedOut: 'timed out',
  interrupted: 'interrupted',
  passed: 'passed',
  flaky: 'flaky',
  skipped: 'skipped',
  quarantined: 'quarantined',
};

const TONE: Record<TestStatus, 'fail' | 'pass' | 'flaky' | 'skip'> = {
  failed: 'fail',
  timedOut: 'fail',
  interrupted: 'skip',
  passed: 'pass',
  flaky: 'flaky',
  skipped: 'skip',
  quarantined: 'skip',
};

function shape(status: TestStatus): JSX.Element {
  switch (status) {
    case 'failed':
    case 'timedOut':
      return (
        <>
          <circle cx="8" cy="8" r="7" fill="currentColor" />
          <path class="glyph__mark" d="M5.75 5.75l4.5 4.5M10.25 5.75l-4.5 4.5" />
        </>
      );
    case 'passed':
      return (
        <>
          <circle cx="8" cy="8" r="6.25" />
          <path d="M5.4 8.3l1.8 1.8 3.4-3.7" />
        </>
      );
    case 'flaky':
      return (
        <>
          <circle cx="8" cy="8" r="6.25" />
          <path d="M8 1.75a6.25 6.25 0 0 0 0 12.5z" fill="currentColor" />
        </>
      );
    case 'quarantined':
      return (
        <>
          <circle cx="8" cy="8" r="6.25" />
          <path d="M6.5 5.5v5M9.5 5.5v5" />
        </>
      );
    case 'interrupted':
      return (
        <>
          <circle cx="8" cy="8" r="6.25" />
          <path d="M3.6 12.4l8.8-8.8" />
        </>
      );
    case 'skipped':
      return <circle cx="8" cy="8" r="6.25" stroke-dasharray="2.4 2.1" />;
  }
}

export function statusLabel(status: TestStatus): string {
  return LABEL[status];
}

export function StatusGlyph({
  status,
  size = 14,
  showLabel = false,
  decorative = false,
}: {
  status: TestStatus;
  size?: number;
  showLabel?: boolean;
  decorative?: boolean;
}) {
  const hidden = decorative || showLabel;
  return (
    <span class={cx('glyph', `tone-${TONE[status]}`)} data-status={status}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        role={hidden ? undefined : 'img'}
        aria-label={hidden ? undefined : LABEL[status]}
        aria-hidden={hidden ? 'true' : undefined}
      >
        {shape(status)}
      </svg>
      {showLabel && <span class="glyph__label">{LABEL[status]}</span>}
    </span>
  );
}

export function Count({
  status,
  value,
  label,
  onClick,
}: {
  status?: TestStatus;
  value: number | string;
  label?: string;
  onClick?: () => void;
}) {
  const text = label ?? (status ? LABEL[status] : '');
  const body = (
    <>
      {status && <StatusGlyph status={status} decorative={!!text} />}
      <span class={cx('count__value', status && `tone-${TONE[status]}`)}>{value}</span>
      {text && <span class="count__label"> {text}</span>}
    </>
  );
  return onClick ? (
    <button type="button" class="count count--button" onClick={onClick}>
      {body}
    </button>
  ) : (
    <span class="count">{body}</span>
  );
}

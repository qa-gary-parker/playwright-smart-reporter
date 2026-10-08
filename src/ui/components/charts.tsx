import { statusLabel, type TestStatus } from './status';
import { cx } from './util';

export function Sparkline({
  values,
  label,
  width = 96,
  height = 24,
}: {
  values: number[];
  label: string;
  width?: number;
  height?: number;
}) {
  if (values.length < 2) return null;
  const pad = 2;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const pts = values.map((v, i) => [
    pad + (i / (values.length - 1)) * (width - pad * 2),
    pad + (1 - (v - lo) / span) * (height - pad * 2),
  ]);
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg class="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      <polyline
        points={pts.map((p) => p.join(',')).join(' ')}
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linejoin="round"
        stroke-linecap="round"
      />
      <circle class="spark__last" cx={lx} cy={ly} r="2" />
    </svg>
  );
}

type Tone = 'pass' | 'fail' | 'flaky' | 'skip';

export function MiniBar({
  segments,
  showLabels = true,
}: {
  segments: Array<{ tone: Tone; value: number; label: string }>;
  showLabels?: boolean;
}) {
  const total = segments.reduce((n, s) => n + s.value, 0) || 1;
  const visible = segments.filter((s) => s.value > 0);
  return (
    <div class="minibar">
      <div class="minibar__track" role="img" aria-label={visible.map((s) => `${s.value} ${s.label}`).join(', ')}>
        {visible.map((s) => (
          <span class={cx('minibar__seg', `seg-${s.tone}`)} style={{ flexGrow: s.value / total }} />
        ))}
      </div>
      {showLabels && (
        <div class="minibar__labels">
          {visible.map((s) => (
            <span>
              <span class={cx('minibar__value', `tone-${s.tone}`)}>{s.value}</span> {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const STRIP_TONE: Record<TestStatus, Tone> = {
  failed: 'fail',
  timedOut: 'fail',
  interrupted: 'skip',
  passed: 'pass',
  flaky: 'flaky',
  skipped: 'skip',
  quarantined: 'skip',
};

export function OutcomeStrip({ runs, label }: { runs: Array<{ status: TestStatus; title?: string }>; label: string }) {
  return (
    <div class="strip" role="img" aria-label={label}>
      {runs.map((r) => (
        <span class={cx('strip__cell', `seg-${STRIP_TONE[r.status]}`)} title={r.title ?? statusLabel(r.status)} />
      ))}
    </div>
  );
}

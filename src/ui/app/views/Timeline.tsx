import { useState } from 'preact/hooks';
import { Button } from '../../components';
import { formatDuration } from '../data';
import { requestFailed, type Timeline } from '../detail-model';

const pct = (v: number, total: number) => `${Math.min(100, Math.max(0, (v / Math.max(total, 1)) * 100))}%`;

function activeAt<T extends { start: number; end: number }>(items: T[], at: number): T | undefined {
  return items.find((i) => i.start <= at && at <= i.end);
}

export function CausalTimeline({ timeline }: { timeline: Timeline }) {
  const { duration, lanes, firstAnomaly } = timeline;
  const [at, setAt] = useState(firstAnomaly?.at ?? 0);
  const step = activeAt(lanes.steps, at);
  const request = activeAt(lanes.network, at);
  const lastLog = [...lanes.console].reverse().find((c) => c.at <= at);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * duration);

  return (
    <div class="timeline">
      {firstAnomaly && (
        <div class="timeline__anomaly" role="note">
          <span class="timeline__anomaly-label">Possible first anomaly (suggestion)</span>
          <span>{firstAnomaly.summary}</span>
          <span class="mono faint">at {formatDuration(firstAnomaly.at)}</span>
          <Button size="sm" variant="ghost" onClick={() => setAt(firstAnomaly.at)}>
            Jump to
          </Button>
        </div>
      )}
      <div class="timeline__grid">
        <span class="timeline__lane-label">Steps</span>
        <div class="timeline__lane">
          {lanes.steps.map((s) => (
            <span
              class="timeline__bar"
              data-failed={s.failed ? '' : undefined}
              style={{ left: pct(s.start, duration), width: pct(Math.max(s.end - s.start, duration / 400), duration) }}
              title={`${s.title} · ${formatDuration(s.end - s.start)}`}
            />
          ))}
        </div>
        <span class="timeline__lane-label">Network</span>
        <div class="timeline__lane">
          {lanes.network.map((n) => (
            <span
              class="timeline__bar timeline__bar--net"
              data-failed={requestFailed(n.status) ? '' : undefined}
              style={{ left: pct(n.start, duration), width: pct(Math.max(n.end - n.start, duration / 400), duration) }}
              title={`${n.method} ${n.url} · ${n.status > 0 ? n.status : n.failure ?? 'failed'} · ${formatDuration(n.end - n.start)}`}
            />
          ))}
        </div>
        <span class="timeline__lane-label">Console</span>
        <div class="timeline__lane">
          {lanes.console.map((c) => (
            <span class="timeline__dot" data-level={c.level} style={{ left: pct(c.at, duration) }} title={`${c.level}: ${c.text}`} />
          ))}
        </div>
        <span />
        <div class="timeline__axis" aria-hidden="true">
          {firstAnomaly && <span class="timeline__marker" style={{ left: pct(firstAnomaly.at, duration) }} />}
          <span class="timeline__playhead" style={{ left: pct(at, duration) }} />
          {ticks.map((tk, i) => (
            <span class="timeline__tick" data-edge={i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : undefined} style={{ left: pct(tk, duration) }}>
              {formatDuration(tk)}
            </span>
          ))}
        </div>
      </div>
      <input
        class="timeline__scrub"
        type="range"
        min={0}
        max={Math.max(1, Math.round(duration))}
        value={Math.round(at)}
        onInput={(e) => setAt(Number((e.currentTarget as HTMLInputElement).value))}
        aria-label="Scrub the test timeline"
        aria-valuetext={formatDuration(at)}
      />
      <dl class="timeline__now">
        <dt>At {formatDuration(at)}</dt>
        <dd>
          <span class="faint">Step</span> <span class="mono">{step?.title ?? '—'}</span>
        </dd>
        <dd>
          <span class="faint">Request</span> <span class="mono">{request ? `${request.method} ${request.url} ${request.status > 0 ? request.status : request.failure ?? 'failed'}` : '—'}</span>
        </dd>
        <dd>
          <span class="faint">Last console</span> <span class="mono">{lastLog ? `${lastLog.level}: ${lastLog.text}` : '—'}</span>
        </dd>
      </dl>
    </div>
  );
}

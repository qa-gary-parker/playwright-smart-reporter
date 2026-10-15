import { useEffect, useRef, useState } from 'preact/hooks';
import { Button, EmptyState, Icon, MiniBar, StatusGlyph } from '../../components';
import { formatDuration } from '../data';
import { parseQuery } from '../filters';
import { formatRoute } from '../router';
import { data, testsById } from '../store';

type Phase = 'idle' | 'starting' | 'running' | 'completed' | 'cancelled';
interface Counters {
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
  completed: number;
  totalExpected: number;
}
interface Failure {
  testId: string;
  title: string;
  file: string;
  retry: number;
  error?: string;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const meta = (name: string) => document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content ?? '';
const placeholder = (v: string) => !v || v.startsWith('__');

export function Live() {
  const live = data.value.config.live;
  const sseUrl = meta('smart-live-sse');
  const canRun = meta('smart-live-run') === 'true';
  const [phase, setPhase] = useState<Phase>('idle');
  const [counters, setCounters] = useState<Counters | null>(null);
  const [failures, setFailures] = useState<Failure[]>([]);
  const [started, setStarted] = useState<number | null>(null);
  const [ended, setEnded] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const stop = useRef<() => void>(() => {});

  function onEvent(ev: { event: string; timestamp?: string; counters?: Counters; testId?: string; title?: string; file?: string; status?: string; retry?: number; error?: string; totalExpected?: number }) {
    // Time the run from its own events: a finished run's events all arrive at once.
    const at = Date.parse(ev.timestamp ?? '') || Date.now();
    if (ev.event === 'start') {
      setPhase('running');
      setStarted(at);
      setEnded(null);
      setCounters({ passed: 0, failed: 0, skipped: 0, flaky: 0, completed: 0, totalExpected: ev.totalExpected ?? 0 });
    } else if (ev.event === 'test') {
      if (ev.counters) setCounters(ev.counters);
      const id = ev.testId ?? ev.title ?? '';
      if (ev.status === 'failed' || ev.status === 'timedOut') {
        setFailures((f) => [{ testId: id, title: ev.title ?? id, file: ev.file ?? '', retry: ev.retry ?? 0, error: ev.error }, ...f.filter((x) => x.testId !== id)]);
      } else if ((ev.retry ?? 0) > 0) {
        setFailures((f) => f.filter((x) => x.testId !== id));
      }
    } else if (ev.event === 'complete') {
      if (ev.counters) setCounters(ev.counters);
      setEnded(at);
      setPhase('completed');
    }
  }

  function connect() {
    stop.current();
    if (!placeholder(sseUrl)) {
      const source = new EventSource(sseUrl);
      source.onmessage = (e) => {
        try {
          onEvent(JSON.parse(e.data));
        } catch {
          // ignore malformed lines
        }
      };
      stop.current = () => source.close();
      return;
    }
    if (!live) return;
    let seen = 0;
    let busy = false;
    const poll = () => {
      if (busy) return;
      busy = true;
      fetch(live.jsonlFile, { cache: 'no-store' })
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.text();
        })
        .then((text) => {
          const lines = text.trim().split('\n').filter(Boolean);
          // The server truncates the file when a new run starts.
          if (lines.length < seen) seen = 0;
          for (const line of lines.slice(seen)) {
            try {
              onEvent(JSON.parse(line));
            } catch {
              // ignore malformed lines
            }
          }
          seen = lines.length;
        })
        .catch(() => setError(location.protocol === 'file:' ? 'Live results need the report served over HTTP: npx playwright-smart-reporter-serve --live' : null))
        .finally(() => (busy = false));
    };
    const timer = setInterval(poll, 2000);
    poll();
    stop.current = () => clearInterval(timer);
  }

  useEffect(() => {
    if (live || !placeholder(sseUrl)) connect();
    return () => stop.current();
  }, []);

  useEffect(() => {
    if (phase !== 'running' && phase !== 'starting') return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  async function run() {
    const q = parseQuery(filter);
    const files = q.tokens.filter((t) => t.key === 'file').map((t) => t.value);
    // Playwright matches --grep against the title followed by the tags, so each condition is a lookahead:
    // any of the tags, and every word, in any order.
    const tags = q.tokens.filter((t) => t.key === 'tag').map((t) => escapeRegExp(t.value.startsWith('@') ? t.value : `@${t.value}`));
    const words = q.text.split(/\s+/).filter(Boolean).map(escapeRegExp);
    const conditions = [...(tags.length ? [`(?:${tags.join('|')})`] : []), ...words];
    const grep = conditions.length ? `^${conditions.map((c) => `(?=.*${c})`).join('')}` : '';
    setPhase('starting');
    setFailures([]);
    setCounters(null);
    setError(null);
    try {
      const res = await fetch('/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...(files.length ? { files } : {}), ...(grep ? { grep } : {}) }) });
      if (res.status === 409) throw new Error('A test run is already in progress.');
      if (!res.ok) throw new Error(`The server refused the run (HTTP ${res.status}).`);
      setPhase('running');
      setStarted(Date.now());
      setEnded(null);
      connect();
    } catch (e) {
      setPhase('idle');
      setError(e instanceof Error ? e.message : 'Could not reach the server.');
    }
  }

  async function cancel() {
    const res = await fetch('/run', { method: 'DELETE' }).catch(() => null);
    if (res?.ok) {
      stop.current();
      setPhase('cancelled');
    }
  }

  if (!live && placeholder(sseUrl) && !canRun) {
    return (
      <div class="page">
        <header class="page__head">
          <h1 class="page__title">Live</h1>
        </header>
        <EmptyState title="Live results are off" icon="radio">
          Enable <code>live: {'{ enabled: true }'}</code> and serve the report with <code>npx playwright-smart-reporter-serve --live</code> to watch runs as they happen.
        </EmptyState>
      </div>
    );
  }

  const c = counters;
  const label: Record<Phase, string> = { idle: 'Idle', starting: 'Starting', running: 'Running', completed: 'Completed', cancelled: 'Cancelled' };
  return (
    <div class="page">
      <header class="page__head">
        <h1 class="page__title">Live</h1>
        <span class="live-status" data-phase={phase}>
          <span class="live-status__dot" aria-hidden="true" />
          {label[phase]}
        </span>
        {started && <span class="mono faint">{formatDuration(Math.max(0, (ended ?? now) - started))}</span>}
      </header>
      {canRun && (
        <div class="live-run">
          <input
            class="live-run__filter"
            placeholder="Optional filter: file:checkout.spec.ts tag:@smoke or title words"
            aria-label="Filter which tests to run"
            value={filter}
            onInput={(e) => setFilter((e.currentTarget as HTMLInputElement).value)}
          />
          {phase === 'running' || phase === 'starting' ? (
            <Button icon="x" onClick={cancel}>
              Cancel
            </Button>
          ) : (
            <Button variant="primary" icon="play" onClick={run}>
              Run tests
            </Button>
          )}
        </div>
      )}
      {error && (
        <p class="live-error" role="alert">
          <Icon name="alert-triangle" size={14} /> {error}
        </p>
      )}
      {c && (
        <div class="live-progress">
          <MiniBar
            segments={[
              { tone: 'pass', value: c.passed, label: 'passed' },
              { tone: 'fail', value: c.failed, label: 'failed' },
              { tone: 'flaky', value: c.flaky, label: 'flaky' },
              { tone: 'skip', value: c.skipped, label: 'skipped' },
            ]}
          />
          <span class="mono faint">
            {c.completed} / {c.totalExpected || '?'} tests
          </span>
        </div>
      )}
      <section class="panel">
        <header class="panel__head">
          <h2 class="panel__title">Failures</h2>
          <span class="panel__meta">{failures.length}</span>
        </header>
        {failures.length === 0 ? (
          <p class="panel__empty">{phase === 'idle' ? 'Waiting for a run.' : 'No failures so far.'}</p>
        ) : (
          <ul class="lines">
            {failures.map((f) => (
              <li class="lines__item live-failure">
                <StatusGlyph status="failed" />
                <span class="lines__label">
                  {f.title}
                  <span class="mono faint"> {f.file}</span>
                  {f.error && <span class="live-failure__error mono">{f.error.split('\n')[0]}</span>}
                </span>
                {phase === 'completed' && testsById.value.has(f.testId) && <a href={formatRoute({ view: 'queue', queue: 'all', q: '', test: f.testId })}>View details</a>}
              </li>
            ))}
          </ul>
        )}
      </section>
      {phase === 'completed' && (
        <Button icon="refresh-cw" onClick={() => location.reload()}>
          Reload report
        </Button>
      )}
    </div>
  );
}

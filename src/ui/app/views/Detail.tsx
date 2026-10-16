import type { ComponentChildren } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import {
  Button,
  CodeFrame,
  Diff,
  ErrorMessage,
  FilterToken,
  Icon,
  IconButton,
  OutcomeStrip,
  Section,
  Sparkline,
  StatusGlyph,
  statusLabel,
  type TestStatus,
} from '../../components';
import { displayStatus, fileHref, formatDate, formatDuration, isFailing, location, plural, titlePath, type ReportTest } from '../data';
import { failingStepIndex, failureSummary, parseExpectation, parseSnippet, requestFailed, timelineOf } from '../detail-model';
import { data, multiProject, navigate, route, sectionState, setSection, showToast } from '../store';
import { Lightbox, type MediaItem } from './Lightbox';
import { Violations } from './Accessibility';
import { Markdown } from './Markdown';
import { CausalTimeline } from './Timeline';

const SIGNAL_LABEL: Record<string, string> = {
  'new-failure': 'New failure',
  regression: 'Regression',
  flaky: 'Flaky',
  quarantined: 'Quarantined',
  slow: 'Slow',
  fixed: 'Fixed',
  new: 'New test',
};

function S({ title, meta, children, defaultOpen = true }: { title: string; meta?: ComponentChildren; children: ComponentChildren; defaultOpen?: boolean }) {
  const open = sectionState.value[title] ?? defaultOpen;
  return (
    <Section title={title} meta={meta} open={open} onToggle={(o) => o !== open && setSection(title, o)}>
      {children}
    </Section>
  );
}

export async function copyText(text: string, done: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    showToast(done);
  } catch {
    window.prompt('Copy this text:', text);
  }
}

function StackError({ message }: { message: string }) {
  const lines = message.split('\n');
  const [all, setAll] = useState(lines.length <= 14);
  return (
    <>
      <ErrorMessage message={all ? message : lines.slice(0, 12).join('\n')} />
      {!all && (
        <Button size="sm" variant="ghost" icon="chevron-down" onClick={() => setAll(true)}>
          Show all {lines.length} lines
        </Button>
      )}
    </>
  );
}

function Steps({ t }: { t: ReportTest }) {
  const failed = failingStepIndex(t);
  const max = Math.max(...t.steps.map((s) => s.duration), 1);
  return (
    <ol class="steps">
      {t.steps.map((s, i) => (
        <li class="step" data-failed={i === failed ? '' : undefined}>
          {i === failed ? <StatusGlyph status="failed" size={12} /> : <span class="step__dot" />}
          <span class="step__title mono" title={s.title}>
            {s.title}
          </span>
          <span class="step__bar" aria-hidden="true">
            <span style={{ width: `${(s.duration / max) * 100}%` }} />
          </span>
          <span class="step__dur mono">{formatDuration(s.duration)}</span>
        </li>
      ))}
    </ol>
  );
}

function Attempts({ t }: { t: ReportTest }) {
  const attempts = t.attempts ?? [];
  // Side by side only makes sense when one attempt failed and a later one passed.
  const failedAttempt = attempts.find((a) => a.status === 'failed' || a.status === 'timedOut');
  const passedAttempt = [...attempts].reverse().find((a) => a.status === 'passed');
  const compare = failedAttempt && passedAttempt ? [failedAttempt, passedAttempt] : undefined;
  const rows = compare ? Math.max(compare[0].steps.length, compare[1].steps.length) : 0;
  return (
    <div class="attempts">
      <ol class="attempts__list">
        {attempts.map((a) => (
          <li class="attempts__item">
            <StatusGlyph status={a.status as TestStatus} />
            <span>Attempt {a.retry + 1}</span>
            <span class="faint">{statusLabel(a.status as TestStatus)}</span>
            <span class="mono faint">{formatDuration(a.duration)}</span>
            {a.error && <span class="attempts__error mono">{a.error.split('\n')[0]}</span>}
            {a.attachments && (
              <div class="attempts__evidence" role="group" aria-label={`Attempt ${a.retry + 1} attachments`}>
                <Attachments att={a.attachments} />
              </div>
            )}
          </li>
        ))}
      </ol>
      {compare && (
        <div class="retry-diff" role="table" aria-label="Steps by attempt">
          <div class="retry-diff__row retry-diff__head" role="row">
            <span role="columnheader">Attempt {compare[0].retry + 1} ({statusLabel(compare[0].status as TestStatus)})</span>
            <span role="columnheader">Attempt {compare[1].retry + 1} ({statusLabel(compare[1].status as TestStatus)})</span>
          </div>
          {Array.from({ length: rows }, (_, i) => {
            const [a, b] = [compare[0].steps[i], compare[1].steps[i]];
            const differs = !a || !b || a.title !== b.title || Math.max(a.duration, b.duration) > 2 * Math.max(1, Math.min(a.duration, b.duration));
            return (
              <div class="retry-diff__row" role="row" data-differs={differs ? '' : undefined}>
                {[a, b].map((s) => (
                  <span role="cell" class="mono">
                    {s ? (
                      <>
                        {s.title} <span class="faint">{formatDuration(s.duration)}</span>
                      </>
                    ) : (
                      <span class="faint">(no step)</span>
                    )}
                  </span>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function History({ t }: { t: ReportTest }) {
  const runs = t.history.map((h) => ({ status: (h.skipped ? 'skipped' : h.passed ? (h.retry ? 'flaky' : 'passed') : 'failed') as TestStatus, h }));
  const passed = runs.filter((r) => r.status === 'passed' || r.status === 'flaky').length;
  const drill = data.value.config.features.historyDrilldown && !!data.value.historySnapshots;
  return (
    <div class="history">
      <OutcomeStrip
        label={`Last ${runs.length} runs: ${passed} passed`}
        runs={runs.map((r) => ({
          status: r.status,
          title: `${formatDate(r.h.timestamp, true)} · ${statusLabel(r.status)} · ${formatDuration(r.h.duration)}`,
          onClick: drill && r.h.runId && data.value.historySnapshots?.[r.h.runId] ? () => navigate({ ...route.value, run: r.h.runId }) : undefined,
        }))}
      />
      <div class="statline">
        <span>
          Passed <strong>{passed}</strong> of last {runs.length}
        </span>
        <span>
          Avg <strong class="mono">{formatDuration(t.averageDuration ?? t.duration)}</strong>
        </span>
        {t.flakinessScore !== undefined && (
          <span>
            Flakiness <strong>{Math.round(t.flakinessScore * 100)}%</strong>
          </span>
        )}
        {t.stabilityScore && (
          <span>
            Grade <strong>{t.stabilityScore.grade}</strong>
          </span>
        )}
        {runs.length > 1 && <Sparkline label="Duration, last runs" values={t.history.map((h) => h.duration)} width={120} />}
      </div>
    </div>
  );
}

function Attachments({ att }: { att?: Partial<NonNullable<ReportTest['attachments']>> }) {
  const [index, setIndex] = useState<number | null>(null);
  const media: MediaItem[] = useMemo(
    () => [
      ...(att?.screenshots ?? []).map((src, i) => ({ kind: 'image' as const, src: fileHref(src), caption: `Screenshot ${i + 1}` })),
      ...(att?.videos ?? []).map((src, i) => ({ kind: 'video' as const, src: fileHref(src), caption: `Video ${i + 1}` })),
    ],
    [att],
  );
  const traceViewer = data.value.config.features.traceViewer;
  return (
    <div class="attachments">
      {media.map((m, i) => (
        <button type="button" class="thumb" onClick={() => setIndex(i)} aria-label={`Open ${m.caption}`}>
          {m.kind === 'image' ? <img src={m.src} alt="" loading="lazy" /> : <Icon name="film" size={20} />}
          <span class="thumb__label">{m.caption}</span>
        </button>
      ))}
      {(att?.traces ?? []).map((path, i) => (
        <div class="thumb thumb--trace">
          <Icon name="route" size={20} />
          <span class="thumb__label">Trace {i + 1}</span>
          <span class="thumb__actions">
            {traceViewer && window.openTraceModal && (
              <Button size="sm" variant="ghost" onClick={() => window.openTraceModal!(path)}>
                Open
              </Button>
            )}
            <a href={fileHref(path)} download>
              Download
            </a>
          </span>
        </div>
      ))}
      {(att?.custom ?? []).map((c) => (
        <a class="thumb" href={c.path ? fileHref(c.path) : `data:${c.contentType};base64,${c.body ?? ''}`} download={c.name}>
          <Icon name="paperclip" size={20} />
          <span class="thumb__label mono">{c.name}</span>
        </a>
      ))}
      <Lightbox items={media} index={index} onIndex={setIndex} onClose={() => setIndex(null)} />
    </div>
  );
}

function attachmentCount(t: ReportTest): number {
  const a = t.attachments;
  return a ? a.screenshots.length + a.videos.length + a.traces.length + a.custom.length : 0;
}

export function Detail({ t, onBack, onStep }: { t: ReportTest; onBack?: () => void; onStep?: (dir: 1 | -1) => void }) {
  const failing = isFailing(t);
  const path = titlePath(t, multiProject.value);
  const expectation = parseExpectation(t.error);
  const snippet = parseSnippet(t.errorSnippet);
  const timeline = timelineOf(t);
  const net = t.networkLogs?.entries ?? [];
  const failedReq = net.filter((n) => requestFailed(n.status)).length;
  const owners = t.owners ?? [];
  const ai = data.value.ai;

  const addFilter = (key: string, value: string) => {
    const r = route.value;
    if (r.view !== 'queue') return;
    navigate({ ...r, q: `${r.q} ${key}:${/\s/.test(value) ? `"${value}"` : value}`.trim() });
  };

  return (
    <article class="detail" aria-label="Test detail">
      <header class="detail__head">
        <div class="detail__title-row">
          {onBack && <IconButton icon="chevron-left" label="Back to list" onClick={onBack} />}
          <StatusGlyph status={displayStatus(t)} size={16} />
          <h2 class="detail__title">
            {path.slice(0, -1).map((p) => (
              <span class="detail__crumb">
                {p}
                <span class="row__sep">›</span>
              </span>
            ))}
            {path[path.length - 1]}
          </h2>
          {onStep && (
            <span class="detail__nav">
              <IconButton icon="chevron-up" label="Previous failure ([)" onClick={() => onStep(-1)} />
              <IconButton icon="chevron-down" label="Next failure (])" onClick={() => onStep(1)} />
            </span>
          )}
        </div>
        <div class="detail__meta">
          <span class="mono">{location(t)}</span>
          {t.project && <span>{t.project}</span>}
          <span class="mono">{formatDuration(t.duration)}</span>
          {t.retry > 0 && <span>{t.retry + 1} attempts</span>}
          {t.stabilityScore && <span>Grade {t.stabilityScore.grade}</span>}
          {owners.map((o) => (
            <button type="button" class="detail__chip" onClick={() => addFilter('owner', o)}>
              <FilterToken name="owner" value={o} />
            </button>
          ))}
          {t.signals.map((s) => (
            <span class="signal">{SIGNAL_LABEL[s] ?? s}</span>
          ))}
          {(t.tags ?? []).map((tag) => (
            <button type="button" class="detail__chip" onClick={() => addFilter('tag', tag)} aria-label={`Filter by ${tag}`}>
              <FilterToken name="tag" value={tag} />
            </button>
          ))}
        </div>
        {failing && (
          <div class="detail__actions">
            <Button size="sm" icon="copy" kbd="c" onClick={() => copyText(failureSummary(t, path, data.value.meta.ci), 'Failure summary copied')}>
              Copy failure summary
            </Button>
            {t.aiPrompt && (
              <Button size="sm" icon="bot" onClick={() => copyText(t.aiPrompt!, 'AI prompt copied')}>
                Copy AI prompt
              </Button>
            )}
            {t.attachments?.traces[0] && data.value.config.features.traceViewer && window.openTraceModal && (
              <Button size="sm" icon="play" onClick={() => window.openTraceModal!(t.attachments!.traces[0])}>
                Open trace
              </Button>
            )}
          </div>
        )}
      </header>
      {t.error && (
        <S title="Error">
          <StackError message={t.error} />
        </S>
      )}
      {expectation && (
        <S title="Expected and received">
          <Diff expected={expectation.expected} received={expectation.received} />
        </S>
      )}
      {snippet && (
        <S title="Source" meta={<span class="mono">{t.errorLocation ? `${t.errorLocation.file}:${t.errorLocation.line}` : location(t)}</span>}>
          <CodeFrame lines={snippet.lines} highlight={snippet.highlight} column={snippet.column} file={t.errorLocation?.file} />
        </S>
      )}
      {timeline && (
        <S title="Timeline" meta={timeline.firstAnomaly ? 'possible first anomaly found' : `${formatDuration(timeline.duration)}`}>
          <CausalTimeline timeline={timeline} />
        </S>
      )}
      {failing && (
        <S title="AI analysis" meta={t.aiSuggestion && ai.model ? ai.model : undefined}>
          {t.aiSuggestion ? (
            <Markdown text={t.aiSuggestion} />
          ) : ai.analysisOff ? (
            <p class="muted">AI analysis is off for this run (enableAIRecommendations is false). Copy AI prompt gives you the prompt to use elsewhere.</p>
          ) : (
            <p class="muted">
              No analysis for this run. Set an AI provider key (or a local model) to get one, or use Copy AI prompt.
            </p>
          )}
        </S>
      )}
      {(t.attempts?.length ?? 0) > 1 && (
        <S title="Attempts" meta={`${t.attempts!.length} attempts`}>
          <Attempts t={t} />
        </S>
      )}
      {t.steps.length > 0 && (
        <S title="Steps" meta={plural(t.steps.length, 'step')}>
          <Steps t={t} />
        </S>
      )}
      {net.length > 0 && (
        <S title="Network" meta={`${plural(Math.max(t.networkLogs?.totalRequests ?? 0, net.length), 'request')}${(t.networkLogs?.totalRequests ?? 0) > net.length ? `, ${net.length} shown` : ''}${failedReq ? ` · ${failedReq} failed` : ''}`}>
          <div class="net" role="table" aria-label="Network requests">
            {net.map((e) => (
              <div class="net__row" role="row" data-failed={requestFailed(e.status) ? '' : undefined} title={e.url}>
                <span role="cell" class="mono faint">
                  {e.method}
                </span>
                <span role="cell" class="net__status mono">
                  {requestFailed(e.status) && <StatusGlyph status="failed" size={12} />}
                  {e.status > 0 ? e.status : 'ERR'}
                </span>
                <span role="cell" class="net__url mono">
                  {e.urlPath || e.url}
                </span>
                <span role="cell" class="net__dur mono">
                  {formatDuration(e.duration)}
                </span>
              </div>
            ))}
          </div>
        </S>
      )}
      {timeline && timeline.lanes.console.length > 0 && (
        <S title="Console" meta={plural(timeline.lanes.console.filter((c) => c.level === 'error').length, 'error')}>
          <ul class="console">
            {timeline.lanes.console.map((c) => (
              <li class="console__line mono" data-level={c.level}>
                <span class="console__level">{c.level}</span>
                {c.text}
              </li>
            ))}
          </ul>
        </S>
      )}
      {attachmentCount(t) > 0 && (
        <S title="Attachments" meta={plural(attachmentCount(t), 'file')}>
          <Attachments att={t.attachments} />
        </S>
      )}
      {t.history.length > 0 && (
        <S title="History" meta={`last ${plural(t.history.length, 'run')}`}>
          <History t={t} />
        </S>
      )}
      {t.a11y && (
        <S title="Accessibility" meta={`${plural(t.a11y.violations.length, 'violation')} · ${t.a11y.standard}`}>
          {t.a11y.violations.length ? <Violations violations={t.a11y.violations} /> : <p class="muted">No violations on {t.a11y.url ?? 'the scanned page'}.</p>}
        </S>
      )}
      {(t.annotations?.length ?? 0) > 0 && (
        <S title="Annotations">
          <ul class="lines">
            {t.annotations!.map((a) => (
              <li class="lines__item">
                <span class="mono">{a.type}</span>
                {a.description && <span class="muted">{a.description}</span>}
              </li>
            ))}
          </ul>
        </S>
      )}
    </article>
  );
}

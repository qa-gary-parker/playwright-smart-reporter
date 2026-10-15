import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { Icon } from './Icon';
import { StatusGlyph, type TestStatus } from './status';
import { cx } from './util';

export function SplitPane({
  start,
  end,
  initial = 420,
  min = 280,
  max = 720,
  label = 'Resize list',
}: {
  start: ComponentChildren;
  end: ComponentChildren;
  initial?: number;
  min?: number;
  max?: number;
  label?: string;
}) {
  const [width, setWidth] = useState(initial);
  const rootRef = useRef<HTMLDivElement>(null);
  const clamp = (w: number) => Math.min(max, Math.max(min, w));

  function onPointerDown(e: PointerEvent) {
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    const left = rootRef.current!.getBoundingClientRect().left;
    const move = (ev: PointerEvent) => setWidth(clamp(ev.clientX - left));
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  }

  function onKeyDown(e: KeyboardEvent) {
    const next =
      e.key === 'ArrowLeft' ? width - 16 : e.key === 'ArrowRight' ? width + 16 : e.key === 'Home' ? min : e.key === 'End' ? max : null;
    if (next === null) return;
    e.preventDefault();
    setWidth(clamp(next));
  }

  return (
    <div class="split" ref={rootRef} style={{ gridTemplateColumns: `${width}px 1px minmax(0, 1fr)` }}>
      <div class="split__pane">{start}</div>
      <div
        class="split__handle"
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        aria-valuenow={width}
        aria-valuemin={min}
        aria-valuemax={max}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
      />
      <div class="split__pane">{end}</div>
    </div>
  );
}

export function Section({
  title,
  meta,
  open = true,
  onToggle,
  children,
}: {
  title: string;
  meta?: ComponentChildren;
  open?: boolean;
  onToggle?: (open: boolean) => void;
  children: ComponentChildren;
}) {
  return (
    <details class="section" open={open} onToggle={(e) => onToggle?.((e.currentTarget as HTMLDetailsElement).open)}>
      <summary class="section__header">
        <span class="chev">
          <Icon name="chevron-right" size={14} />
        </span>
        <span class="section__title">{title}</span>
        {meta && <span class="section__meta">{meta}</span>}
      </summary>
      <div class="section__body">{children}</div>
    </details>
  );
}

export function GroupHeader({
  label,
  count,
  meta,
  expanded,
  onToggle,
  mono = false,
}: {
  label: string;
  count: number;
  meta?: ComponentChildren;
  expanded: boolean;
  onToggle: () => void;
  mono?: boolean;
}) {
  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ' || (e.key === 'ArrowRight' && !expanded) || (e.key === 'ArrowLeft' && expanded)) {
      e.preventDefault();
      onToggle();
    }
  }
  return (
    <div
      class="group"
      role="treeitem"
      aria-level={1}
      aria-expanded={expanded}
      tabIndex={-1}
      onClick={onToggle}
      onKeyDown={onKeyDown}
    >
      <span class="chev">
        <Icon name="chevron-right" size={14} />
      </span>
      <span class={cx('group__label', mono && 'mono')}>{label}</span>
      <span class="group__count">{count}</span>
      {meta && <span class="group__meta">{meta}</span>}
    </div>
  );
}

export type Signal = 'new-failure' | 'regression' | 'flaky' | 'quarantined' | 'slow';

const SIGNAL_LABEL: Record<Signal, string> = {
  'new-failure': 'New failure',
  regression: 'Regression',
  flaky: 'Flaky',
  quarantined: 'Quarantined',
  slow: 'Slow',
};

const SIGNAL_ORDER: Signal[] = ['new-failure', 'regression', 'flaky', 'quarantined', 'slow'];

export function topSignal(signals: Signal[]): Signal | undefined {
  return SIGNAL_ORDER.find((s) => signals.includes(s));
}

export function ListRow({
  status,
  path,
  location,
  retries = 0,
  duration,
  signals = [],
  selected = false,
  level = 1,
  onSelect,
}: {
  status: TestStatus;
  path: string[];
  location?: string;
  retries?: number;
  duration?: string;
  signals?: Signal[];
  selected?: boolean;
  level?: number;
  onSelect?: () => void;
}) {
  const signal = topSignal(signals);
  const title = path[path.length - 1];
  return (
    <div
      class="row"
      role="treeitem"
      aria-level={level}
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      onClick={onSelect}
      onKeyDown={(e) => e.key === 'Enter' && onSelect?.()}
    >
      <StatusGlyph status={status} />
      <span class="row__title">
        {path.slice(0, -1).map((p) => (
          <span class="row__crumb">
            {p}
            <span class="row__sep" aria-hidden="true">
              ›
            </span>
          </span>
        ))}
        <span class="row__name">{title}</span>
      </span>
      {location && <span class="row__loc">{location}</span>}
      {signal && <span class="signal">{SIGNAL_LABEL[signal]}</span>}
      {retries > 0 && (
        <span class="row__retries" title={`${retries} ${retries === 1 ? 'retry' : 'retries'}`}>
          ×{retries + 1}
        </span>
      )}
      {duration && <span class="row__duration">{duration}</span>}
    </div>
  );
}

export function EmptyState({
  icon = 'inbox',
  title,
  children,
  action,
}: {
  icon?: string;
  title: string;
  children?: ComponentChildren;
  action?: ComponentChildren;
}) {
  return (
    <div class="empty">
      <span class="empty__icon">
        <Icon name={icon} size={20} />
      </span>
      <p class="empty__title">{title}</p>
      {children && <p class="empty__body">{children}</p>}
      {action && <div class="empty__action">{action}</div>}
    </div>
  );
}

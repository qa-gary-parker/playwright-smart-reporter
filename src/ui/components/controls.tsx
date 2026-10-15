import type { ComponentChildren, JSX } from 'preact';
import { useRef } from 'preact/hooks';
import { Icon } from './Icon';
import { cx } from './util';

type ButtonProps = Omit<JSX.HTMLAttributes<HTMLButtonElement>, 'icon' | 'size'> & {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md';
  icon?: string;
  kbd?: string;
  disabled?: boolean;
};

export function Button({ variant = 'secondary', size = 'md', icon, kbd, children, class: cls, ...rest }: ButtonProps) {
  return (
    <button type="button" class={cx('btn', `btn--${variant}`, size === 'sm' && 'btn--sm', cls as string)} {...rest}>
      {icon && <Icon name={icon} size={size === 'sm' ? 14 : 16} />}
      {children}
      {kbd && <Kbd>{kbd}</Kbd>}
    </button>
  );
}

type IconButtonProps = Omit<JSX.HTMLAttributes<HTMLButtonElement>, 'icon'> & {
  icon: string;
  label: string;
  pressed?: boolean;
  disabled?: boolean;
};

export function IconButton({ icon, label, pressed, class: cls, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      class={cx('icon-btn', cls as string)}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      {...rest}
    >
      <Icon name={icon} />
    </button>
  );
}

export function Kbd({ children }: { children: ComponentChildren }) {
  return <kbd class="kbd">{children}</kbd>;
}

export function FilterToken({ name, value, onRemove }: { name: string; value: string; onRemove?: () => void }) {
  return (
    <span class="token">
      <span class="token__key">{name}:</span>
      <span class="token__value">{value}</span>
      {onRemove && (
        <button type="button" class="token__remove" aria-label={`Remove ${name}:${value}`} onClick={onRemove}>
          <Icon name="x" size={12} />
        </button>
      )}
    </span>
  );
}

export interface TabItem {
  id: string;
  label: string;
  count?: number;
}

export function Tabs({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: TabItem[];
  value: string;
  onChange: (id: string) => void;
  label: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  function onKeyDown(e: KeyboardEvent) {
    const i = tabs.findIndex((t) => t.id === value);
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + step + tabs.length) % tabs.length;
    onChange(tabs[next].id);
    listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }

  return (
    <div class="tabs" role="tablist" aria-label={label} ref={listRef} onKeyDown={onKeyDown}>
      {tabs.map((t) => (
        <button
          type="button"
          role="tab"
          class="tab"
          aria-selected={t.id === value}
          tabIndex={t.id === value ? 0 : -1}
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {t.count !== undefined && <span class="tab__count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

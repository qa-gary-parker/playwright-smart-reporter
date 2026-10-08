import type { ComponentChildren } from 'preact';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { Icon } from './Icon';
import { IconButton, Kbd } from './controls';
import { cx } from './util';

export function Tooltip({ text, children }: { text: string; children: ComponentChildren }) {
  return (
    <span class="tip">
      {children}
      <span class="tip__bubble" role="tooltip">
        {text}
      </span>
    </span>
  );
}

export interface MenuItem {
  id: string;
  label: string;
  icon?: string;
  kbd?: string;
  checked?: boolean;
  group?: string;
}

export function Menu({
  label,
  items,
  onSelect,
  children,
  align = 'end',
}: {
  label: string;
  items: MenuItem[];
  onSelect: (id: string) => void;
  children: ComponentChildren;
  align?: 'start' | 'end';
}) {
  const id = useId();
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  function itemsEls() {
    return Array.from(popRef.current?.querySelectorAll<HTMLButtonElement>('.menu__item') ?? []);
  }

  function onToggle(e: ToggleEvent) {
    const isOpen = e.newState === 'open';
    setOpen(isOpen);
    if (!isOpen) return;
    const r = btnRef.current!.getBoundingClientRect();
    const pop = popRef.current!;
    pop.style.top = `${r.bottom + 4}px`;
    pop.style.left = align === 'end' ? `${Math.max(8, r.right - pop.offsetWidth)}px` : `${r.left}px`;
    (itemsEls().find((el) => el.getAttribute('aria-checked') === 'true') ?? itemsEls()[0])?.focus();
  }

  function onKeyDown(e: KeyboardEvent) {
    const els = itemsEls();
    const i = els.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      els[(i + (e.key === 'ArrowDown' ? 1 : -1) + els.length) % els.length]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      popRef.current?.hidePopover();
      btnRef.current?.focus();
    }
  }

  function pick(itemId: string) {
    onSelect(itemId);
    popRef.current?.hidePopover();
    btnRef.current?.focus();
  }

  const hasChecks = items.some((it) => it.checked !== undefined);
  let lastGroup: string | undefined;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        class="btn btn--secondary"
        popovertarget={id}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
      >
        {children}
      </button>
      <div id={id} ref={popRef} popover="auto" role="menu" aria-label={label} class="menu" onToggle={onToggle} onKeyDown={onKeyDown}>
        {items.map((it) => {
          const heading = it.group && it.group !== lastGroup ? it.group : undefined;
          lastGroup = it.group;
          return (
            <>
              {heading && <div class="menu__group">{heading}</div>}
              <button
                type="button"
                class="menu__item"
                role={hasChecks ? 'menuitemradio' : 'menuitem'}
                aria-checked={hasChecks ? !!it.checked : undefined}
                onClick={() => pick(it.id)}
              >
                {hasChecks && <span class="menu__check">{it.checked && <Icon name="check" size={14} />}</span>}
                {it.icon && <Icon name={it.icon} size={14} />}
                <span class="menu__label">{it.label}</span>
                {it.kbd && <Kbd>{it.kbd}</Kbd>}
              </button>
            </>
          );
        })}
      </div>
    </>
  );
}

export function Dialog({
  open,
  onClose,
  title,
  showTitle = true,
  size = 'md',
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  showTitle?: boolean;
  size?: 'md' | 'lg';
  children: ComponentChildren;
  footer?: ComponentChildren;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      class={cx('dialog', size === 'lg' && 'dialog--lg')}
      aria-label={title}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
    >
      <div class="dialog__inner">
        {showTitle && (
          <header class="dialog__header">
            <h2 class="dialog__title">{title}</h2>
            <IconButton icon="x" label="Close" onClick={onClose} />
          </header>
        )}
        <div class="dialog__body">{children}</div>
        {footer && <footer class="dialog__footer">{footer}</footer>}
      </div>
    </dialog>
  );
}

export function Toast({ message, onDone, duration = 2400 }: { message: string; onDone: () => void; duration?: number }) {
  useEffect(() => {
    const t = setTimeout(onDone, duration);
    return () => clearTimeout(t);
  }, [message]);
  return (
    <div class="toast" role="status">
      {message}
    </div>
  );
}

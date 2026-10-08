import { describe, it, expect } from 'vitest';
import { ACCENTS, ACCENT_NAMES, HC_ACCENT, MODES, STATUSES, renderTokensCss, type Hex, type Mode } from './tokens';

function luminance(hex: Hex): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: Hex, b: Hex): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const SURFACES = ['bg', 'bg-subtle', 'bg-hover', 'bg-selected'] as const;

function failures(pairs: Array<[string, Hex, Hex, number]>): string[] {
  return pairs
    .filter(([, fg, bg, min]) => contrast(fg, bg) < min)
    .map(([name, fg, bg, min]) => `${name}: ${fg} on ${bg} = ${contrast(fg, bg).toFixed(2)} < ${min}`);
}

describe('contrast helper', () => {
  it('matches WCAG reference values', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });
});

describe.each(['light', 'dark', 'hc'] as Mode[])('%s mode contrast', (mode) => {
  const { neutral, status } = MODES[mode];
  const textMin = mode === 'hc' ? 7 : 4.5;

  it('text tokens meet the text floor on every surface', () => {
    const pairs: Array<[string, Hex, Hex, number]> = [];
    for (const text of ['text', 'text-muted', 'text-faint'] as const) {
      for (const surface of SURFACES) {
        pairs.push([`${text}/${surface}`, neutral[text], neutral[surface], textMin]);
      }
    }
    expect(failures(pairs)).toEqual([]);
  });

  it('status colours are readable as text on base surfaces and on their own tint', () => {
    const pairs: Array<[string, Hex, Hex, number]> = [];
    for (const s of STATUSES) {
      pairs.push([`${s}-fg/bg`, status[s].fg, neutral.bg, 4.5]);
      pairs.push([`${s}-fg/bg-subtle`, status[s].fg, neutral['bg-subtle'], 4.5]);
      pairs.push([`${s}-fg/${s}-bg`, status[s].fg, status[s].bg, 4.5]);
      pairs.push([`${s}-fg/bg-hover`, status[s].fg, neutral['bg-hover'], 3]);
      pairs.push([`${s}-fg/bg-selected`, status[s].fg, neutral['bg-selected'], 3]);
    }
    expect(failures(pairs)).toEqual([]);
  });

  it('control borders meet the 3:1 non-text floor', () => {
    expect(
      failures([
        ['border-strong/bg', neutral['border-strong'], neutral.bg, 3],
        ['border-strong/bg-subtle', neutral['border-strong'], neutral['bg-subtle'], 3],
      ]),
    ).toEqual([]);
  });
});

describe('accent contrast', () => {
  it.each(ACCENT_NAMES)('%s works as link text and as a button fill in light and dark', (name) => {
    const pairs: Array<[string, Hex, Hex, number]> = [];
    for (const side of ['light', 'dark'] as const) {
      const { accent, fg } = ACCENTS[name][side];
      const { neutral } = MODES[side];
      pairs.push([`${side} accent/bg`, accent, neutral.bg, 4.5]);
      pairs.push([`${side} accent/bg-subtle`, accent, neutral['bg-subtle'], 4.5]);
      pairs.push([`${side} accent/bg-selected`, accent, neutral['bg-selected'], 3]);
      pairs.push([`${side} accent-fg/accent`, fg, accent, 4.5]);
    }
    expect(failures(pairs)).toEqual([]);
  });

  it('high contrast accent clears 7:1', () => {
    const { neutral } = MODES.hc;
    expect(
      failures([
        ['hc accent/bg', HC_ACCENT.accent, neutral.bg, 7],
        ['hc accent/bg-selected', HC_ACCENT.accent, neutral['bg-selected'], 7],
        ['hc accent-fg/accent', HC_ACCENT.fg, HC_ACCENT.accent, 7],
      ]),
    ).toEqual([]);
  });
});

describe('renderTokensCss', () => {
  const css = renderTokensCss();

  it('declares every mode block and accent preset', () => {
    expect(css).toContain('@media (prefers-color-scheme: dark){:root:not([data-mode])');
    for (const mode of ['light', 'dark', 'hc']) {
      expect(css).toContain(`:root[data-mode="${mode}"]{`);
    }
    for (const name of ACCENT_NAMES.filter((n) => n !== 'default')) {
      expect(css).toContain(`:root[data-accent="${name}"]{--accent-l:${ACCENTS[name].light.accent};`);
    }
  });

  it('emits the light neutral values on :root', () => {
    const root = css.slice(0, css.indexOf('}'));
    expect(root).toContain(`--bg:${MODES.light.neutral.bg};`);
    expect(root).toContain(`--text-faint:${MODES.light.neutral['text-faint']};`);
    expect(root).toContain('--accent:var(--accent-l);');
  });
});

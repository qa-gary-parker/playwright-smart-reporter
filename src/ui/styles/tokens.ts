export type Hex = `#${string}`;

export const NEUTRAL_ROLES = [
  'bg',
  'bg-subtle',
  'bg-hover',
  'bg-selected',
  'border',
  'border-strong',
  'text',
  'text-muted',
  'text-faint',
] as const;
export type NeutralRole = (typeof NEUTRAL_ROLES)[number];

export const STATUSES = ['fail', 'pass', 'flaky', 'skip'] as const;
export type Status = (typeof STATUSES)[number];

export interface ModeTokens {
  neutral: Record<NeutralRole, Hex>;
  status: Record<Status, { fg: Hex; bg: Hex }>;
}

export type Mode = 'light' | 'dark' | 'hc';

export const MODES: Record<Mode, ModeTokens> = {
  light: {
    neutral: {
      bg: '#ffffff',
      'bg-subtle': '#fafafa',
      'bg-hover': '#f2f2f2',
      'bg-selected': '#ebebeb',
      border: '#e6e6e6',
      'border-strong': '#8f8f8f',
      text: '#171717',
      'text-muted': '#525252',
      'text-faint': '#666666',
    },
    status: {
      fail: { fg: '#cf222e', bg: '#fdeceb' },
      pass: { fg: '#1a7f37', bg: '#e8f5ec' },
      flaky: { fg: '#8f5f00', bg: '#fdf4dc' },
      skip: { fg: '#666666', bg: '#f2f2f2' },
    },
  },
  dark: {
    neutral: {
      bg: '#111111',
      'bg-subtle': '#171717',
      'bg-hover': '#1f1f1f',
      'bg-selected': '#282828',
      border: '#262626',
      'border-strong': '#6e6e6e',
      text: '#ededed',
      'text-muted': '#a8a8a8',
      'text-faint': '#949494',
    },
    status: {
      fail: { fg: '#ff6b61', bg: '#2d1414' },
      pass: { fg: '#4ac26b', bg: '#0f2617' },
      flaky: { fg: '#e3b341', bg: '#2b2210' },
      skip: { fg: '#919191', bg: '#1f1f1f' },
    },
  },
  hc: {
    neutral: {
      bg: '#000000',
      'bg-subtle': '#0a0a0a',
      'bg-hover': '#1a1a1a',
      'bg-selected': '#262626',
      border: '#6b6b6b',
      'border-strong': '#b3b3b3',
      text: '#ffffff',
      'text-muted': '#d6d6d6',
      'text-faint': '#bdbdbd',
    },
    status: {
      fail: { fg: '#ff8a80', bg: '#3a0d0d' },
      pass: { fg: '#6cf08f', bg: '#0b2e16' },
      flaky: { fg: '#ffd34d', bg: '#332600' },
      skip: { fg: '#c2c2c2', bg: '#1a1a1a' },
    },
  },
};

export const ACCENT_NAMES = ['default', 'ocean', 'sunset', 'dracula', 'cyberpunk', 'forest', 'rose'] as const;
export type AccentName = (typeof ACCENT_NAMES)[number];

interface AccentPair {
  accent: Hex;
  fg: Hex;
}

export const ACCENTS: Record<AccentName, { light: AccentPair; dark: AccentPair }> = {
  default: { light: { accent: '#1764d8', fg: '#ffffff' }, dark: { accent: '#6aa2ff', fg: '#0b0b0b' } },
  ocean: { light: { accent: '#08788c', fg: '#ffffff' }, dark: { accent: '#3cc4d9', fg: '#0b0b0b' } },
  sunset: { light: { accent: '#bf4a0a', fg: '#ffffff' }, dark: { accent: '#ff8a4c', fg: '#0b0b0b' } },
  dracula: { light: { accent: '#7046d6', fg: '#ffffff' }, dark: { accent: '#b494ff', fg: '#0b0b0b' } },
  cyberpunk: { light: { accent: '#b0179e', fg: '#ffffff' }, dark: { accent: '#ff5fe0', fg: '#0b0b0b' } },
  forest: { light: { accent: '#1f7a55', fg: '#ffffff' }, dark: { accent: '#4fd197', fg: '#0b0b0b' } },
  rose: { light: { accent: '#c0245f', fg: '#ffffff' }, dark: { accent: '#ff7aa8', fg: '#0b0b0b' } },
};

// High contrast ignores the accent preset: yellow focus and selection on black.
export const HC_ACCENT: AccentPair = { accent: '#ffd400', fg: '#000000' };

export const SCALE = {
  space: [4, 8, 12, 16, 24, 32],
  radius: { sm: 4, md: 6 },
  text: {
    xs: [11, 16],
    sm: [12, 16],
    base: [13, 20],
    md: [15, 22],
    lg: [20, 28],
    xl: [28, 34],
  },
  duration: { fast: 100, base: 150 },
  ease: 'cubic-bezier(0.2, 0, 0, 1)',
  fontSans: '"Geist", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  fontMono: '"Geist Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
} as const;

function decls(entries: Array<[string, string | number]>): string {
  return entries.map(([k, v]) => `--${k}:${v};`).join('');
}

function modeDecls(mode: Mode): string {
  const t = MODES[mode];
  const entries: Array<[string, string]> = NEUTRAL_ROLES.map((r) => [r, t.neutral[r]]);
  for (const s of STATUSES) {
    entries.push([`${s}-fg`, t.status[s].fg], [`${s}-bg`, t.status[s].bg]);
  }
  if (mode === 'hc') {
    entries.push(['accent', HC_ACCENT.accent], ['accent-fg', HC_ACCENT.fg]);
  } else {
    const side = mode === 'light' ? 'l' : 'd';
    entries.push(['accent', `var(--accent-${side})`], ['accent-fg', `var(--accent-fg-${side})`]);
  }
  const shadow =
    mode === 'light'
      ? '0 0 0 1px var(--border),0 8px 24px -6px rgba(0,0,0,0.14)'
      : '0 0 0 1px var(--border-strong),0 8px 24px -6px rgba(0,0,0,0.6)';
  entries.push(['elevation', shadow]);
  entries.push(['backdrop', mode === 'light' ? 'rgba(0,0,0,0.32)' : 'rgba(0,0,0,0.64)']);
  return `color-scheme:${mode === 'light' ? 'light' : 'dark'};` + decls(entries);
}

function accentDecls(name: AccentName): string {
  const a = ACCENTS[name];
  return decls([
    ['accent-l', a.light.accent],
    ['accent-fg-l', a.light.fg],
    ['accent-d', a.dark.accent],
    ['accent-fg-d', a.dark.fg],
  ]);
}

export function renderTokensCss(): string {
  const scale: Array<[string, string | number]> = [
    ...SCALE.space.map((v, i): [string, string] => [`space-${i + 1}`, `${v}px`]),
    ['radius-sm', `${SCALE.radius.sm}px`],
    ['radius-md', `${SCALE.radius.md}px`],
    ...Object.entries(SCALE.text).flatMap(([k, [size, leading]]): Array<[string, string]> => [
      [`text-${k}`, `${size}px`],
      [`leading-${k}`, `${leading}px`],
    ]),
    ['duration-fast', `${SCALE.duration.fast}ms`],
    ['duration', `${SCALE.duration.base}ms`],
    ['ease', SCALE.ease],
    ['font-sans', SCALE.fontSans],
    ['font-mono', SCALE.fontMono],
    ['focus-ring', 'var(--accent)'],
  ];
  const accents = ACCENT_NAMES.filter((n) => n !== 'default')
    .map((n) => `:root[data-accent="${n}"]{${accentDecls(n)}}`)
    .join('');
  return [
    `:root{${decls(scale)}${accentDecls('default')}${modeDecls('light')}}`,
    accents,
    `@media (prefers-color-scheme: dark){:root:not([data-mode]){${modeDecls('dark')}}}`,
    `:root[data-mode="light"]{${modeDecls('light')}}`,
    `:root[data-mode="dark"]{${modeDecls('dark')}}`,
    `:root[data-mode="hc"]{${modeDecls('hc')}}`,
  ].join('\n');
}

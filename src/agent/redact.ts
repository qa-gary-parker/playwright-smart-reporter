import type { TestResultData } from '../types';

export const REDACTED = '[REDACTED]';

// Header and object-key names whose values are credentials.
const SENSITIVE_NAME =
  /authorization|cookie|api[-_]?key|apikey|token|secret|passw(?:or)?d|session|signature|credential|private[-_]?key|(?:^|[-_])auth(?:[-_]|$)/i;

// Env var names whose values must never leave the machine.
const SENSITIVE_ENV_NAME =
  /token|secret|passw(?:or)?d|api[-_]?key|apikey|access[-_]?key|private[-_]?key|credential|auth|session|cookie|webhook|dsn|signature|(?:^|_)(?:pass|pwd|key|pat)$/i;

const MIN_ENV_VALUE_LENGTH = 8;

// A key ending in a source-file extension is a path such as secrets.spec.ts:14:61, not a credential.
const KV_KEY =
  '[\\w.-]*(?:passw(?:or)?d|secret|token|api[-_]?key|apikey|access[-_]?key|private[-_]?key|credential|session[-_]?id|signature)[\\w.-]*(?<!\\.(?:[cm]?[jt]sx?|json|ya?ml|feature|html?|txt|log))';

const NOT_REDACTED = '(?!\\[REDACTED\\])';

const RULES: Array<[RegExp, string | ((...m: string[]) => string)]> = [
  [/-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END[A-Z ]*PRIVATE KEY-----|$)/g, REDACTED],
  [/\b((?:proxy-)?authorization["']?\s*[:=]\s*["']?)(?:[A-Za-z0-9-]+\s+)?[^\s"',;]+/gi, `$1${REDACTED}`],
  [/\b((?:set-)?cookie["']?\s*[:=]\s*["']?)[^\r\n"']+/gi, `$1${REDACTED}`],
  [/\b(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, `$1${REDACTED}`],
  [/\b([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)[^\s@/]+@/gi, `$1${REDACTED}@`],
  [/\beyJ[A-Za-z0-9_-]{4,}\.eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g, REDACTED],
  [/\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}/g, REDACTED],
  [/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, REDACTED],
  [/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, REDACTED],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, REDACTED],
  [/\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}/g, REDACTED],
  [/\bglpat-[A-Za-z0-9_-]{20,}/g, REDACTED],
  [/([?&](?:key|sig|code|jwt|token|access_token|auth|sid)=)[^&#\s]+/gi, `$1${REDACTED}`],
  [
    new RegExp(`(${KV_KEY}["']?\\s*[:=]\\s*)${NOT_REDACTED}(?:"(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|[^\\s&;,"'<>)}\\]]+)`, 'gi'),
    (match: string, prefix: string) => {
      const value = match.slice(prefix.length);
      const quote = value[0] === '"' || value[0] === "'" ? value[0] : '';
      return `${prefix}${quote}${REDACTED}${quote}`;
    },
  ],
];

export interface Redactor {
  string(value: string): string;
  // Masks values under credential-like keys (headers included) and secrets inside every string.
  deep<T>(value: T): T;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A string pattern is a regular expression source. Each pattern masks every match.
export function createRedactor(env: NodeJS.ProcessEnv = process.env, patterns: ReadonlyArray<string | RegExp> = []): Redactor {
  const envValues = Object.entries(env)
    .filter(([name, value]) => SENSITIVE_ENV_NAME.test(name) && typeof value === 'string' && value.length >= MIN_ENV_VALUE_LENGTH)
    .map(([, value]) => value as string)
    .sort((a, b) => b.length - a.length);
  const envPattern = envValues.length > 0 ? new RegExp(envValues.map(escapeRegExp).join('|'), 'g') : undefined;
  const userPatterns = patterns.map((p) =>
    typeof p === 'string' ? new RegExp(p, 'g') : new RegExp(p.source, p.flags.includes('g') ? p.flags : `${p.flags}g`),
  );

  const string = (value: string): string => {
    let out = envPattern ? value.replace(envPattern, REDACTED) : value;
    for (const pattern of userPatterns) out = out.replace(pattern, REDACTED);
    for (const [pattern, replacement] of RULES) {
      out = out.replace(pattern, replacement as string);
    }
    return out;
  };

  const deep = <T>(value: T): T => {
    if (typeof value === 'string') return string(value) as T;
    if (Array.isArray(value)) return value.map(deep) as T;
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, SENSITIVE_NAME.test(k) && v !== null && typeof v !== 'object' ? REDACTED : deep(v)]),
      ) as T;
    }
    return value;
  };

  return { string, deep };
}

// The text a test produced, redacted in place, so every output built from the result inherits it.
// Ids, titles and paths stay exact. Not .deep(): it would blank any value under a key like `session`.
export function redactTestResult(r: TestResultData, redact: (text: string) => string): void {
  if (r.error) r.error = redact(r.error);
  if (r.errorSnippet) r.errorSnippet = redact(r.errorSnippet);
  if (r.aiPrompt) r.aiPrompt = redact(r.aiPrompt);
  for (const step of r.steps) step.title = redact(step.title);
  if (r.timeline) {
    const { lanes, firstAnomaly } = r.timeline;
    for (const step of lanes.steps) step.title = redact(step.title);
    for (const request of lanes.network) request.url = redact(request.url);
    for (const event of lanes.console) event.text = redact(event.text);
    if (firstAnomaly) firstAnomaly.summary = redact(firstAnomaly.summary);
  }
  if (r.networkLogs) {
    const { entries, summary } = r.networkLogs;
    // slowest and errors can be entries the entry cap dropped.
    for (const entry of new Set([...entries, ...summary.errors, ...(summary.slowest ? [summary.slowest] : [])])) {
      entry.url = redact(entry.url);
      entry.urlPath = redact(entry.urlPath);
    }
  }
}

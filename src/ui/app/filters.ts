import { displayStatus, isFailing, type ReportTest } from './data';

export const FILTER_KEYS = ['status', 'tag', 'file', 'project', 'suite', 'grade', 'signal', 'owner'] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

export interface FilterToken {
  key: FilterKey;
  value: string;
}

export interface Query {
  tokens: FilterToken[];
  text: string;
}

const TOKEN = /(?:^|\s)([a-z]+):("([^"]*)"|\S+)/g;

export function parseQuery(input: string): Query {
  const tokens: FilterToken[] = [];
  const text = input
    .replace(TOKEN, (match, key: string, raw: string, quoted?: string) => {
      if (!(FILTER_KEYS as readonly string[]).includes(key)) return match;
      const value = quoted ?? raw;
      if (value && !tokens.some((t) => t.key === key && t.value === value)) tokens.push({ key: key as FilterKey, value });
      return ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();
  return { tokens, text };
}

export function formatQuery(q: Query): string {
  const tokens = q.tokens.map((t) => `${t.key}:${/\s/.test(t.value) ? `"${t.value}"` : t.value}`);
  return [...tokens, q.text].filter(Boolean).join(' ');
}

function matchesToken(t: ReportTest, { key, value }: FilterToken): boolean {
  const v = value.toLowerCase();
  switch (key) {
    case 'status':
      if (v === 'failed') return isFailing(t);
      return displayStatus(t).toLowerCase() === v || (v === 'flaky' && t.signals.includes('flaky'));
    case 'tag': {
      const want = v.startsWith('@') ? v : `@${v}`;
      return (t.tags ?? []).some((tag) => tag.toLowerCase() === want);
    }
    case 'file':
      return t.file.toLowerCase().includes(v);
    case 'project':
      return (t.project ?? '').toLowerCase() === v;
    case 'suite':
      return (t.suites ?? []).some((s) => s.toLowerCase() === v);
    case 'grade':
      return (t.stabilityScore?.grade ?? '').toLowerCase() === v;
    case 'signal':
      return t.signals.some((s) => s === v);
    case 'owner':
      return (t.owners ?? []).some((o) => o.toLowerCase() === v);
  }
}

export function matchesQuery(t: ReportTest, q: Query): boolean {
  const byKey = new Map<FilterKey, FilterToken[]>();
  for (const token of q.tokens) byKey.set(token.key, [...(byKey.get(token.key) ?? []), token]);
  // Same key ORs, different keys AND.
  for (const group of byKey.values()) {
    if (!group.some((token) => matchesToken(t, token))) return false;
  }
  if (!q.text) return true;
  const haystack = [t.title, t.file, ...(t.suites ?? []), t.project ?? ''].join(' ').toLowerCase();
  return q.text
    .toLowerCase()
    .split(' ')
    .every((word) => haystack.includes(word));
}

import { describe, expect, it } from 'vitest';
import type { NetworkLogEntry, TestResultData } from '../types';
import { createRedactor, redactTestResult } from './redact';

// Secrets are assembled at runtime so secret scanners never see a literal token in source.
const t = (...parts: string[]) => parts.join('');

const SECRETS = {
  bearer: 'abc.def.ghi-123',
  basic: 'dXNlcjpwYXNzd29yZA==',
  cookie: 'sid=s3cr3t',
  setCookie: 'refresh=xyz123',
  jwt: t('eyJhbGciOiJIUzI1NiJ9', '.', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', '.', 'dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'),
  anthropic: t('sk-', 'ant-', 'api03-', 'A'.repeat(24)),
  openai: t('sk-', 'proj-', 'B'.repeat(24)),
  aws: t('AKIA', 'IOSFODNN7EXAMPLE'),
  ghp: t('ghp', '_', 'aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789'),
  gho: t('gho', '_', 'aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789'),
  ghPat: t('github', '_pat_', '11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz'),
  slackBot: t('xox', 'b-', '1234567890-abcdefghij'),
  slackUser: t('xox', 'p-', '1234567890-abcdefghij'),
  password: 'hunter2',
  clientSecret: 'shh-very-secret',
  accessToken: 'tok123abc',
  urlKey: 'AIzaSyA0000',
  dbPassword: 'p4ssw0rd',
  privateKeyBody: 'MIIEowIBAAKCAQEA',
  envValue: 'super-secret-env-value-123',
};

const ENV = { MY_SERVICE_TOKEN: SECRETS.envValue, HOME: '/Users/someone', CI: 'true' };

const S = SECRETS;
const FIXTURE = [
  `Authorization: Bearer ${S.bearer}`,
  `proxy-authorization: Basic ${S.basic}`,
  `Cookie: ${S.cookie}; theme=dark`,
  `set-cookie: ${S.setCookie}; HttpOnly`,
  `jwt ${S.jwt}`,
  `anthropic ${S.anthropic}`,
  `openai ${S.openai}`,
  `aws ${S.aws}`,
  `github ${S.ghp} ${S.gho} ${S.ghPat}`,
  `slack ${S.slackBot} ${S.slackUser}`,
  `login password=${S.password}&user=bob`,
  `{"client_secret": "${S.clientSecret}", "name": "ok"}`,
  `GET https://api.example.com/v1?access_token=${S.accessToken}&page=2&key=${S.urlKey}`,
  `db postgres://admin:${S.dbPassword}@db.internal:5432/app`,
  `-----BEGIN RSA PRIVATE KEY-----\n${S.privateKeyBody}\n-----END RSA PRIVATE KEY-----`,
  `env leak ${S.envValue}`,
  'path /Users/someone/project true',
  'expect(locator).toHaveText("Welcome") failed',
].join('\n');

const EXPECTED = [
  'Authorization: [REDACTED]',
  'proxy-authorization: [REDACTED]',
  'Cookie: [REDACTED]',
  'set-cookie: [REDACTED]',
  'jwt [REDACTED]',
  'anthropic [REDACTED]',
  'openai [REDACTED]',
  'aws [REDACTED]',
  'github [REDACTED] [REDACTED] [REDACTED]',
  'slack [REDACTED] [REDACTED]',
  'login password=[REDACTED]&user=bob',
  '{"client_secret": "[REDACTED]", "name": "ok"}',
  'GET https://api.example.com/v1?access_token=[REDACTED]&page=2&key=[REDACTED]',
  'db postgres://admin:[REDACTED]@db.internal:5432/app',
  '[REDACTED]',
  'env leak [REDACTED]',
  'path /Users/someone/project true',
  'expect(locator).toHaveText("Welcome") failed',
].join('\n');

describe('createRedactor', () => {
  const redact = createRedactor(ENV);

  it('masks every secret pattern in free text and leaves ordinary text alone', () => {
    expect(redact.string(FIXTURE)).toBe(EXPECTED);
  });

  it('is idempotent, so re-redacting a bundle never mangles markers', () => {
    expect(redact.string(EXPECTED)).toBe(EXPECTED);
  });

  it('masks credential headers by name and secret values in other headers', () => {
    expect(
      redact.deep({
        Authorization: 'Bearer x',
        Cookie: 'a=b',
        'Set-Cookie': 'c=d',
        'Proxy-Authorization': 'Basic y',
        'X-Api-Key': 'k',
        'x-csrf-token': 't',
        'Content-Type': 'application/json',
        'X-Trace': S.jwt,
      }),
    ).toEqual({
      Authorization: '[REDACTED]',
      Cookie: '[REDACTED]',
      'Set-Cookie': '[REDACTED]',
      'Proxy-Authorization': '[REDACTED]',
      'X-Api-Key': '[REDACTED]',
      'x-csrf-token': '[REDACTED]',
      'Content-Type': 'application/json',
      'X-Trace': '[REDACTED]',
    });
  });

  it('redacts nested values by key name and by content', () => {
    expect(
      redact.deep({ summary: `GET /api 500 password=${S.password}`, nested: { apiKey: 'abc', count: 3, list: [`Bearer ${S.bearer}`] } }),
    ).toEqual({ summary: 'GET /api 500 password=[REDACTED]', nested: { apiKey: '[REDACTED]', count: 3, list: ['Bearer [REDACTED]'] } });
  });

  it('ignores env values that are too short to be secrets', () => {
    expect(createRedactor({ AUTH_ENABLED: 'true' }).string('flag true')).toBe('flag true');
  });

  it('leaves file paths, line numbers and test ids alone when a file name contains a secret word', () => {
    const r = createRedactor({});
    const kept = [
      'at /repo/tests/secrets.spec.ts:14:61',
      '[chromium] tests/password-reset.spec.ts::logout',
      'tests/api-token.test.ts:8',
      'Error at session-id.helper.js:3:10',
    ];
    for (const text of kept) expect(r.string(text)).toBe(text);
    expect(r.string(`db.password=${S.dbPassword} and session_id: ${S.accessToken}`)).toBe('db.password=[REDACTED] and session_id: [REDACTED]');
  });

  it('masks env values named *_PASS, *_PWD, *_KEY and *_PAT, Stripe and GitLab tokens, and auth query values', () => {
    const env = { DB_PASS: 'pass-value-1234', SMTP_PWD: 'pwd-value-1234', STRIPE_KEY: 'key-value-1234', GITLAB_PAT: 'pat-value-1234' };
    const r = createRedactor(env);
    const stripe = t('sk_', 'live_', 'C'.repeat(24));
    const gitlab = t('glpat', '-', 'D'.repeat(20));
    expect(r.string(`${env.DB_PASS} ${env.SMTP_PWD} ${env.STRIPE_KEY} ${env.GITLAB_PAT}`)).toBe('[REDACTED] [REDACTED] [REDACTED] [REDACTED]');
    expect(r.string(`stripe ${stripe} gitlab ${gitlab}`)).toBe('stripe [REDACTED] gitlab [REDACTED]');
    expect(r.string('GET /api?auth=abc123&sid=s1&token=t1&page=2')).toBe('GET /api?auth=[REDACTED]&sid=[REDACTED]&token=[REDACTED]&page=2');
  });

  it('masks every match of extra patterns, given as regex source strings or RegExps, and still applies the built-in rules', () => {
    const r = createRedactor({}, ['[\\w.]+@example\\.com', /order-\d+/i]);
    expect(r.string(`mail qa.user@example.com about ORDER-42 and order-7, password=${S.password}, keep this`))
      .toBe('mail [REDACTED] about [REDACTED] and [REDACTED], password=[REDACTED], keep this');
  });

  it('rejects an empty pattern, naming the option and the pattern', () => {
    expect(() => createRedactor({}, [''])).toThrow(new Error('redact.patterns[0] "" matches an empty string'));
  });

  it('rejects a pattern that can match an empty string', () => {
    expect(() => createRedactor({}, ['order-\\d+', /a*/])).toThrow(new Error('redact.patterns[1] /a*/ matches an empty string'));
  });

  it('rejects a pattern that is not a valid regular expression', () => {
    expect(() => createRedactor({}, ['order-\\d+', '('])).toThrow(new Error('redact.patterns[1] "(" is not a valid regular expression: /(/: Unterminated group'));
  });
});

describe('redactTestResult', () => {
  const secret = 'tok-unit-12345678';
  const R = '[REDACTED]';
  const entry = (urlPath: string): NetworkLogEntry => ({
    method: 'GET', url: `http://app.test${urlPath}`, urlPath, status: 500, statusText: 'Internal Server Error',
    duration: 5, timestamp: '2026-10-16T00:00:00.000Z', requestSize: 0, responseSize: 0,
  });
  const result = (s: string): TestResultData => ({
    testId: `a.spec.ts::uses ${secret}`,
    title: `uses ${secret}`,
    file: 'a.spec.ts',
    status: 'failed',
    duration: 5,
    retry: 0,
    history: [],
    error: `Error: got ${s} back`,
    errorSnippet: `> 3 | expect(token).toBe('${s}')`,
    aiPrompt: `# Stdout\n\nlogged ${s}`,
    steps: [{ title: `Fill "${s}" #password`, duration: 1, category: 'pw:api' }],
    timeline: {
      duration: 5,
      lanes: {
        steps: [{ title: `Fill "${s}" #password`, start: 0, end: 1, category: 'pw:api' }],
        network: [{ start: 1, end: 2, method: 'GET', url: `http://app.test/?t=${s}`, status: 500 }],
        console: [{ at: 3, level: 'error', text: `boom ${s}` }],
      },
      firstAnomaly: { kind: 'console-error', at: 3, summary: `Console error: boom ${s}`, ref: { lane: 'console', index: 0 } },
    },
    // slowest and errors are not in entries: the collector caps entries after it picks them.
    networkLogs: {
      entries: [entry(`/kept?t=${s}`)],
      totalRequests: 3,
      totalDuration: 15,
      summary: { byStatus: { 500: 3 }, byMethod: { GET: 3 }, slowest: entry(`/slowest?t=${s}`), errors: [entry(`/error?t=${s}`)] },
    },
  });

  it('redacts the error, snippet, AI prompt, step titles, timeline text and network URLs, and leaves the test id and title exact', () => {
    const actual = result(secret);
    redactTestResult(actual, createRedactor({ MY_API_TOKEN: secret }).string);

    expect(actual).toEqual({ ...result(R), testId: `a.spec.ts::uses ${secret}`, title: `uses ${secret}` });
  });
});

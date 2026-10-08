import { describe, expect, it } from 'vitest';
import { createRedactor } from './redact';

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
});

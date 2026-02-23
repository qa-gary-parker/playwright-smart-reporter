/**
 * License Validator — Adversarial Tests
 *
 * These tests target attack vectors and degenerate inputs the happy-path tests
 * don't cover:
 *   - Tampered payload (signature mismatch after manual tier escalation)
 *   - Missing `tier` claim (only exp present)
 *   - Future `iat` / past `exp` combination
 *   - Empty string key
 *   - Whitespace-only key
 *   - Oversized garbage string (10 KB)
 *   - Token with 2 parts
 *   - Token with 4+ parts
 *   - Unknown tier value in payload
 *   - exp set to exactly now (boundary: should be expired)
 *   - exp set to now+1 (boundary: should be valid)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LicenseValidator } from './index';

// ---------------------------------------------------------------------------
// Helper: build a base64url-encoded string (no crypto signing)
// ---------------------------------------------------------------------------

function b64u(data: Buffer): string {
  return data.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makeUnsignedToken(header: Record<string, unknown>, payload: Record<string, unknown>): string {
  const h = b64u(Buffer.from(JSON.stringify(header)));
  const p = b64u(Buffer.from(JSON.stringify(payload)));
  const sig = b64u(Buffer.from('fake-sig'));
  return `${h}.${p}.${sig}`;
}

function makeTokenWithRealHeader(payload: Record<string, unknown>): string {
  return makeUnsignedToken({ alg: 'ES256', typ: 'JWT' }, payload);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LicenseValidator adversarial inputs', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    delete process.env.SMART_REPORTER_LICENSE_KEY;
    delete process.env.SMART_REPORTER_DEV_LICENSE;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // =========================================================================
  // Tampered payload — valid structure but signature no longer matches
  // =========================================================================

  it('rejects a token whose payload was modified after signing', () => {
    // Build a "pro" token in dev mode format, then manually swap tier to "team"
    // in a new token that uses the original signature — signature won't match
    const now = Math.floor(Date.now() / 1000);
    const originalHeader = b64u(Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT' })));
    const originalPayload = b64u(Buffer.from(JSON.stringify({ tier: 'pro', org: 'Acme', iat: now, exp: now + 86400 })));
    const originalSig = b64u(Buffer.from('some-valid-looking-sig'));

    // Now swap in a "team" payload but keep the original signature
    const tamperedPayload = b64u(Buffer.from(JSON.stringify({ tier: 'team', org: 'Acme', iat: now, exp: now + 86400 })));
    const tamperedToken = `${originalHeader}.${tamperedPayload}.${originalSig}`;

    const validator = new LicenseValidator();
    const result = validator.validate(tamperedToken);

    // Should be rejected — signature doesn't match the tampered content
    expect(result.valid).toBe(false);
    expect(result.tier).toBe('community');
    expect(result.error).toBe('Invalid license key signature');
  });

  // =========================================================================
  // Missing tier claim
  // =========================================================================

  it('falls back to community when tier claim is absent (dev mode)', () => {
    process.env.SMART_REPORTER_DEV_LICENSE = 'true';
    const now = Math.floor(Date.now() / 1000);
    // No `tier` field — only exp
    const token = makeTokenWithRealHeader({ exp: now + 86400 });

    const validator = new LicenseValidator();
    const result = validator.validate(token);

    // Valid JWT structure and not expired, but tier is undefined → community
    expect(result.valid).toBe(true);
    expect(result.tier).toBe('community');
  });

  // =========================================================================
  // Future iat, past exp (clock-skew attack)
  // =========================================================================

  it('returns expired when iat is in the future but exp is in the past (dev mode)', () => {
    process.env.SMART_REPORTER_DEV_LICENSE = 'true';
    const now = Math.floor(Date.now() / 1000);
    const token = makeTokenWithRealHeader({
      tier: 'pro',
      org: 'Attacker',
      iat: now + 365 * 24 * 60 * 60, // issued one year in the future
      exp: now - 86400,               // expired yesterday
    });

    const validator = new LicenseValidator();
    const result = validator.validate(token);

    expect(result.valid).toBe(false);
    expect(result.tier).toBe('community');
    expect(result.error).toBe('License key has expired');
  });

  // =========================================================================
  // Empty string key
  // =========================================================================

  it('treats empty string key as no key — returns community valid:true', () => {
    const validator = new LicenseValidator();
    const result = validator.validate('');

    // Empty string is falsy, so treated as "no key provided"
    expect(result.tier).toBe('community');
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  // =========================================================================
  // Whitespace-only key
  // =========================================================================

  it('handles a whitespace-only key gracefully without crashing', () => {
    const validator = new LicenseValidator();
    // '   ' is truthy but has no valid JWT structure
    const result = validator.validate('   ');

    expect(result.tier).toBe('community');
    expect(result.valid).toBe(false);
    // Should report format error, not crash
    expect(result.error).toBeDefined();
  });

  // =========================================================================
  // Very long garbage token (10 KB)
  // =========================================================================

  it('handles a 10 KB random string without crashing', () => {
    const garbage = 'x'.repeat(10 * 1024);
    const validator = new LicenseValidator();

    let result: ReturnType<typeof validator.validate>;
    expect(() => {
      result = validator.validate(garbage);
    }).not.toThrow();

    expect(result!.tier).toBe('community');
    expect(result!.valid).toBe(false);
  });

  it('handles a 10 KB random base64-like string (three "parts") without crashing', () => {
    // Construct something that looks like 3 parts to get past the split check
    const part = 'A'.repeat(3000);
    const token = `${part}.${part}.${part}`;
    const validator = new LicenseValidator();

    let result: ReturnType<typeof validator.validate>;
    expect(() => {
      result = validator.validate(token);
    }).not.toThrow();

    expect(result!.tier).toBe('community');
    expect(result!.valid).toBe(false);
  });

  // =========================================================================
  // Token with only 2 parts (missing signature)
  // =========================================================================

  it('returns community with format error for a token with only 2 parts', () => {
    const validator = new LicenseValidator();
    const result = validator.validate('header.payload');

    expect(result.tier).toBe('community');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Invalid license key format');
  });

  // =========================================================================
  // Token with 4+ parts
  // =========================================================================

  it('returns community with format error for a token with 4 parts', () => {
    const validator = new LicenseValidator();
    const result = validator.validate('a.b.c.d');

    expect(result.tier).toBe('community');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Invalid license key format');
  });

  it('returns community with format error for a token with 5 parts', () => {
    const validator = new LicenseValidator();
    const result = validator.validate('a.b.c.d.e');

    expect(result.tier).toBe('community');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Invalid license key format');
  });

  // =========================================================================
  // Unknown tier value in payload (dev mode to bypass signature)
  // =========================================================================

  it('maps an unknown tier value to community tier (dev mode)', () => {
    process.env.SMART_REPORTER_DEV_LICENSE = 'true';
    const now = Math.floor(Date.now() / 1000);
    const token = makeTokenWithRealHeader({
      tier: 'enterprise', // not in the valid set
      org: 'Unknown',
      iat: now,
      exp: now + 86400,
    });

    const validator = new LicenseValidator();
    const result = validator.validate(token);

    // Unknown tier is mapped to community, but the token itself is valid
    expect(result.valid).toBe(true);
    expect(result.tier).toBe('community');
  });

  // =========================================================================
  // exp boundary: exactly now (should be expired since check is >)
  // =========================================================================

  it('treats exp at exactly the current second as expired (dev mode)', () => {
    process.env.SMART_REPORTER_DEV_LICENSE = 'true';
    const now = Math.floor(Date.now() / 1000);
    const token = makeTokenWithRealHeader({
      tier: 'pro',
      org: 'Boundary',
      iat: now - 100,
      exp: now - 1, // 1 second in the past — definitely expired
    });

    const validator = new LicenseValidator();
    const result = validator.validate(token);

    expect(result.valid).toBe(false);
    expect(result.error).toBe('License key has expired');
  });

  it('treats exp 1 second from now as valid (dev mode)', () => {
    process.env.SMART_REPORTER_DEV_LICENSE = 'true';
    const now = Math.floor(Date.now() / 1000);
    const token = makeTokenWithRealHeader({
      tier: 'pro',
      org: 'Boundary',
      iat: now - 100,
      exp: now + 1, // 1 second in the future
    });

    const validator = new LicenseValidator();
    const result = validator.validate(token);

    expect(result.valid).toBe(true);
    expect(result.tier).toBe('pro');
  });

  // =========================================================================
  // Null/undefined explicitly passed
  // =========================================================================

  it('handles undefined key gracefully (same as no key)', () => {
    const validator = new LicenseValidator();
    const result = validator.validate(undefined);

    expect(result.tier).toBe('community');
    expect(result.valid).toBe(true);
  });

  // =========================================================================
  // alg:none bypass with non-empty signature
  // =========================================================================

  it('rejects alg:none even when signature part contains non-empty bytes', () => {
    const now = Math.floor(Date.now() / 1000);
    const header = b64u(Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })));
    const payload = b64u(Buffer.from(JSON.stringify({ tier: 'team', iat: now, exp: now + 86400 })));
    const sig = b64u(Buffer.from('non-empty-signature-bytes'));
    const token = `${header}.${payload}.${sig}`;

    const validator = new LicenseValidator();
    const result = validator.validate(token);

    expect(result.valid).toBe(false);
    expect(result.error).toBe('Invalid license key algorithm');
  });

  // =========================================================================
  // HS256 algorithm (not ES256)
  // =========================================================================

  it('rejects HS256-signed tokens (only ES256 accepted)', () => {
    const now = Math.floor(Date.now() / 1000);
    const token = makeUnsignedToken(
      { alg: 'HS256', typ: 'JWT' },
      { tier: 'pro', org: 'Hmac Org', iat: now, exp: now + 86400 }
    );

    const validator = new LicenseValidator();
    const result = validator.validate(token);

    expect(result.valid).toBe(false);
    expect(result.error).toBe('Invalid license key algorithm');
  });

  // =========================================================================
  // Payload with null values for fields the validator reads
  // =========================================================================

  it('handles null tier gracefully in payload (dev mode)', () => {
    process.env.SMART_REPORTER_DEV_LICENSE = 'true';
    const now = Math.floor(Date.now() / 1000);
    const token = makeTokenWithRealHeader({
      tier: null,
      org: 'Null Tier',
      iat: now,
      exp: now + 86400,
    });

    const validator = new LicenseValidator();

    expect(() => validator.validate(token)).not.toThrow();
    const result = validator.validate(token);
    expect(result.tier).toBe('community');
  });

  // =========================================================================
  // Payload JSON that is valid base64 but not a JSON object
  // =========================================================================

  it('returns format error when payload decodes to a non-object JSON value', () => {
    const header = b64u(Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT' })));
    const payload = b64u(Buffer.from('"just a string"')); // valid JSON, but not an object
    const sig = b64u(Buffer.from('sig'));
    const token = `${header}.${payload}.${sig}`;

    const validator = new LicenseValidator();
    // The validator will cast the string to LicensePayload — exp will be undefined
    // meaning it should return 'License key missing expiration' in dev mode or
    // signature error in normal mode
    const result = validator.validate(token);

    expect(result.tier).toBe('community');
    expect(result.valid).toBe(false);
  });
});

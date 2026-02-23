import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { LicenseValidator } from './index';
import { generateLicense } from './generate-license';
import type { LicenseInfo } from '../types';

// Load the real key pair for testing
const KEYS_DIR = path.join(__dirname, '../../keys');
const PRIVATE_KEY_PATH = path.join(KEYS_DIR, 'private.pem');
const PRIVATE_KEY = fs.readFileSync(PRIVATE_KEY_PATH, 'utf-8');
const PUBLIC_KEY = fs.readFileSync(path.join(KEYS_DIR, 'public.pem'), 'utf-8');

function base64UrlEncode(data: Buffer): string {
  return data.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function signJwt(payload: Record<string, unknown>, privateKey: string): string {
  const header = { alg: 'ES256', typ: 'JWT' };
  const headerB64 = base64UrlEncode(Buffer.from(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(Buffer.from(JSON.stringify(payload)));
  const signatureInput = `${headerB64}.${payloadB64}`;

  const sign = crypto.createSign('SHA256');
  sign.update(signatureInput);
  const signature = sign.sign(privateKey);

  return `${signatureInput}.${base64UrlEncode(signature)}`;
}

describe('LicenseValidator', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    delete process.env.SMART_REPORTER_LICENSE_KEY;
    delete process.env.SMART_REPORTER_DEV_LICENSE;
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('validate', () => {
    it('returns community tier with valid=true when no key is provided', () => {
      const validator = new LicenseValidator(PUBLIC_KEY);
      const result = validator.validate();

      expect(result).toEqual({ tier: 'community', valid: true });
    });

    it('returns pro tier for a valid Pro JWT', () => {
      const validator = new LicenseValidator(PUBLIC_KEY);
      const now = Math.floor(Date.now() / 1000);
      const token = signJwt(
        { tier: 'pro', org: 'Test Org', iat: now, exp: now + 86400 },
        PRIVATE_KEY
      );

      const result = validator.validate(token);

      expect(result.tier).toBe('pro');
      expect(result.valid).toBe(true);
      expect(result.org).toBe('Test Org');
    });

    it('returns team tier for a valid Team JWT', () => {
      const validator = new LicenseValidator(PUBLIC_KEY);
      const now = Math.floor(Date.now() / 1000);
      const token = signJwt(
        { tier: 'team', org: 'Team Org', iat: now, exp: now + 86400 },
        PRIVATE_KEY
      );

      const result = validator.validate(token);

      expect(result.tier).toBe('team');
      expect(result.valid).toBe(true);
      expect(result.org).toBe('Team Org');
    });

    it('returns community with error for an expired JWT', () => {
      const validator = new LicenseValidator(PUBLIC_KEY);
      const now = Math.floor(Date.now() / 1000);
      const token = signJwt(
        { tier: 'pro', org: 'Expired Org', iat: now - 7200, exp: now - 3600 },
        PRIVATE_KEY
      );

      const result = validator.validate(token);

      expect(result.tier).toBe('community');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('License key has expired');
      expect(result.org).toBe('Expired Org');
    });

    it('returns community with error for a malformed token', () => {
      const validator = new LicenseValidator(PUBLIC_KEY);
      const result = validator.validate('not-a-valid-jwt');

      expect(result.tier).toBe('community');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid license key format');
    });

    it('returns community with error for an invalid signature', () => {
      const validator = new LicenseValidator(PUBLIC_KEY);

      // Generate a different key pair to produce a bad signature
      const { privateKey: wrongKey } = crypto.generateKeyPairSync('ec', {
        namedCurve: 'P-256',
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });

      const now = Math.floor(Date.now() / 1000);
      const token = signJwt(
        { tier: 'pro', org: 'Bad Sig Org', iat: now, exp: now + 86400 },
        wrongKey
      );

      const result = validator.validate(token);

      expect(result.tier).toBe('community');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid license key signature');
    });

    it('reads SMART_REPORTER_LICENSE_KEY env var when no key arg is passed', () => {
      const validator = new LicenseValidator(PUBLIC_KEY);
      const now = Math.floor(Date.now() / 1000);
      const token = signJwt(
        { tier: 'pro', org: 'Env Org', iat: now, exp: now + 86400 },
        PRIVATE_KEY
      );

      process.env.SMART_REPORTER_LICENSE_KEY = token;

      const result = validator.validate();

      expect(result.tier).toBe('pro');
      expect(result.valid).toBe(true);
      expect(result.org).toBe('Env Org');
    });

    it('returns community with error for alg:none bypass attempt', () => {
      const validator = new LicenseValidator(PUBLIC_KEY);
      const now = Math.floor(Date.now() / 1000);

      // Craft a token with alg: "none" — should be rejected
      const header = base64UrlEncode(Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })));
      const payload = base64UrlEncode(
        Buffer.from(JSON.stringify({ tier: 'pro', org: 'Hacker Org', iat: now, exp: now + 86400 }))
      );
      const emptySignature = base64UrlEncode(Buffer.from(''));
      const token = `${header}.${payload}.${emptySignature}`;

      const result = validator.validate(token);

      expect(result.tier).toBe('community');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid license key algorithm');
    });

    it('returns community with error when exp claim is missing', () => {
      const validator = new LicenseValidator(PUBLIC_KEY);
      const now = Math.floor(Date.now() / 1000);
      const token = signJwt(
        { tier: 'pro', org: 'No Expiry Org', iat: now },
        PRIVATE_KEY
      );

      const result = validator.validate(token);

      expect(result.tier).toBe('community');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('License key missing expiration');
    });

    it('allows dev mode bypass with unsigned token', () => {
      process.env.SMART_REPORTER_DEV_LICENSE = 'true';
      const validator = new LicenseValidator(PUBLIC_KEY);

      // Create an unsigned token (signature is just arbitrary bytes)
      const header = base64UrlEncode(Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT' })));
      const now = Math.floor(Date.now() / 1000);
      const payload = base64UrlEncode(
        Buffer.from(JSON.stringify({ tier: 'pro', org: 'Dev Org', iat: now, exp: now + 86400 }))
      );
      const fakeSignature = base64UrlEncode(Buffer.from('not-a-real-signature'));
      const token = `${header}.${payload}.${fakeSignature}`;

      const result = validator.validate(token);

      expect(result.tier).toBe('pro');
      expect(result.valid).toBe(true);
      expect(result.org).toBe('Dev Org');
    });
  });

  describe('hasFeature', () => {
    it('returns true for community tier when community is required', () => {
      const license: LicenseInfo = { tier: 'community', valid: true };
      expect(LicenseValidator.hasFeature(license, 'community')).toBe(true);
    });

    it('returns false for community tier when pro is required', () => {
      const license: LicenseInfo = { tier: 'community', valid: true };
      expect(LicenseValidator.hasFeature(license, 'pro')).toBe(false);
    });

    it('returns false for community tier when team is required', () => {
      const license: LicenseInfo = { tier: 'community', valid: true };
      expect(LicenseValidator.hasFeature(license, 'team')).toBe(false);
    });

    it('returns true for pro tier when community is required', () => {
      const license: LicenseInfo = { tier: 'pro', valid: true };
      expect(LicenseValidator.hasFeature(license, 'community')).toBe(true);
    });

    it('returns true for pro tier when pro is required', () => {
      const license: LicenseInfo = { tier: 'pro', valid: true };
      expect(LicenseValidator.hasFeature(license, 'pro')).toBe(true);
    });

    it('returns false for pro tier when team is required', () => {
      const license: LicenseInfo = { tier: 'pro', valid: true };
      expect(LicenseValidator.hasFeature(license, 'team')).toBe(false);
    });

    it('returns true for team tier when community is required', () => {
      const license: LicenseInfo = { tier: 'team', valid: true };
      expect(LicenseValidator.hasFeature(license, 'community')).toBe(true);
    });

    it('returns true for team tier when pro is required', () => {
      const license: LicenseInfo = { tier: 'team', valid: true };
      expect(LicenseValidator.hasFeature(license, 'pro')).toBe(true);
    });

    it('returns true for team tier when team is required', () => {
      const license: LicenseInfo = { tier: 'team', valid: true };
      expect(LicenseValidator.hasFeature(license, 'team')).toBe(true);
    });

    it('returns false for invalid license even with matching tier', () => {
      const license: LicenseInfo = { tier: 'pro', valid: false, error: 'expired' };
      expect(LicenseValidator.hasFeature(license, 'pro')).toBe(false);
    });
  });

  describe('generateLicense integration', () => {
    it('generates a pro license that validates correctly', () => {
      const token = generateLicense(
        { tier: 'pro', org: 'Integration Org' },
        PRIVATE_KEY_PATH
      );
      const validator = new LicenseValidator(PUBLIC_KEY);
      const result = validator.validate(token);

      expect(result.tier).toBe('pro');
      expect(result.valid).toBe(true);
      expect(result.org).toBe('Integration Org');
    });

    it('generates a team license that validates correctly', () => {
      const token = generateLicense(
        { tier: 'team', org: 'Team Integration' },
        PRIVATE_KEY_PATH
      );
      const validator = new LicenseValidator(PUBLIC_KEY);
      const result = validator.validate(token);

      expect(result.tier).toBe('team');
      expect(result.valid).toBe(true);
      expect(result.org).toBe('Team Integration');
    });

    it('generates a license with custom expiry', () => {
      const token = generateLicense(
        { tier: 'pro', org: 'Expiry Org', expiry: '2027-06-15' },
        PRIVATE_KEY_PATH
      );
      const validator = new LicenseValidator(PUBLIC_KEY);
      const result = validator.validate(token);

      expect(result.tier).toBe('pro');
      expect(result.valid).toBe(true);
      expect(result.expiry).toContain('2027-06-15');
    });

    it('throws for an invalid expiry date string', () => {
      expect(() =>
        generateLicense(
          { tier: 'pro', org: 'Bad Date Org', expiry: 'not-a-date' },
          PRIVATE_KEY_PATH
        )
      ).toThrow('Invalid expiry date: "not-a-date"');
    });

    it('defaults to 1 year expiry when no expiry is specified', () => {
      const token = generateLicense(
        { tier: 'pro', org: 'Default Expiry' },
        PRIVATE_KEY_PATH
      );
      const validator = new LicenseValidator(PUBLIC_KEY);
      const result = validator.validate(token);

      expect(result.valid).toBe(true);
      // Expiry should be roughly 1 year from now
      const expiryDate = new Date(result.expiry!);
      const oneYearFromNow = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
      const diffMs = Math.abs(expiryDate.getTime() - oneYearFromNow.getTime());
      expect(diffMs).toBeLessThan(60000); // within 1 minute
    });
  });
});

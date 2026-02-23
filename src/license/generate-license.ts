#!/usr/bin/env node

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

interface LicenseOptions {
  tier: 'pro' | 'team';
  org: string;
  expiry?: string;
}

function base64UrlEncode(data: Buffer): string {
  return data.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function generateLicense(options: LicenseOptions, privateKeyPath: string): string {
  const privateKey = fs.readFileSync(privateKeyPath, 'utf-8');
  const now = Math.floor(Date.now() / 1000);

  let exp: number;
  if (options.expiry) {
    const parsedTime = new Date(options.expiry).getTime();
    if (Number.isNaN(parsedTime)) {
      throw new Error(`Invalid expiry date: "${options.expiry}"`);
    }
    exp = Math.floor(parsedTime / 1000);
  } else {
    // Default: 1 year from now
    exp = now + 365 * 24 * 60 * 60;
  }

  const header = { alg: 'ES256', typ: 'JWT' };
  const payload = {
    tier: options.tier,
    org: options.org,
    iat: now,
    exp,
  };

  const headerB64 = base64UrlEncode(Buffer.from(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(Buffer.from(JSON.stringify(payload)));
  const signatureInput = `${headerB64}.${payloadB64}`;

  const sign = crypto.createSign('SHA256');
  sign.update(signatureInput);
  const signature = sign.sign(privateKey);

  return `${signatureInput}.${base64UrlEncode(signature)}`;
}

function parseArgs(args: string[]): LicenseOptions {
  let tier: string | undefined;
  let org: string | undefined;
  let expiry: string | undefined;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--tier':
        tier = args[++i];
        break;
      case '--org':
        org = args[++i];
        break;
      case '--expiry':
        expiry = args[++i];
        break;
    }
  }

  if (!tier || !['pro', 'team'].includes(tier)) {
    console.error('Error: --tier must be "pro" or "team"');
    process.exit(1);
  }

  if (!org) {
    console.error('Error: --org is required');
    process.exit(1);
  }

  return { tier: tier as 'pro' | 'team', org, expiry };
}

// Only run CLI when executed directly (not imported)
if (require.main === module) {
  const args = process.argv.slice(2);
  const options = parseArgs(args);
  const privateKeyPath = path.join(__dirname, '../../keys/private.pem');

  if (!fs.existsSync(privateKeyPath)) {
    console.error(`Error: Private key not found at ${privateKeyPath}`);
    process.exit(1);
  }

  try {
    const token = generateLicense(options, privateKeyPath);
    console.log(token);
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }
}

import * as fs from 'fs';
import type { QuarantineFile } from '../types';
import { isExpired } from './quarantine-generator';

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function getQuarantinedPattern(quarantineFile?: string): RegExp | undefined {
  const filePath = quarantineFile ?? '.smart-quarantine.json';

  if (!fs.existsSync(filePath)) {
    return undefined;
  }

  const data: QuarantineFile = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

  // An entry past its expiresAt no longer excludes its test: the run reports the
  // expiry and the noExpiredQuarantine gate flags it, so the test must run again.
  const active = (data.entries ?? []).filter(e => !isExpired(e, Date.now()));

  if (active.length === 0) {
    return undefined;
  }

  const titles = active.map(e => escapeRegExp(e.title));
  return new RegExp(titles.join('|'));
}

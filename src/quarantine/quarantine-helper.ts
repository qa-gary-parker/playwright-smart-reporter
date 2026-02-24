import * as fs from 'fs';
import type { QuarantineFile } from '../types';

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function getQuarantinedPattern(quarantineFile?: string): RegExp | undefined {
  const filePath = quarantineFile ?? '.smart-quarantine.json';

  if (!fs.existsSync(filePath)) {
    return undefined;
  }

  const data: QuarantineFile = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

  if (!data.entries || data.entries.length === 0) {
    return undefined;
  }

  const titles = data.entries.map(e => escapeRegExp(e.title));
  return new RegExp(titles.join('|'));
}

import * as fs from 'fs';
import type { QuarantineFile } from '../types';

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Playwright matches grep/grepInvert against the test's full title path (file,
// describe blocks, title, tags), so anchor each entry to its own file and the
// end of its title path. A bare title substring would exclude every test, in
// any file, whose path merely contains it.
function entryPattern(e: { title: string; file?: string }): string {
  const title = escapeRegExp(e.title);
  const anchored = `(?:^|\\s)${title}(?:\\s+@[\\w-]+)*$`;
  return e.file ? `${escapeRegExp(e.file)}.*${anchored}` : anchored;
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

  return new RegExp(data.entries.map(entryPattern).join('|'));
}

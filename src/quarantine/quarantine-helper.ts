import * as fs from 'fs';
import * as path from 'path';
import type { QuarantineFile } from '../types';

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The reporter writes .smart-quarantine.json under Playwright's rootDir (the
// testDir), while this helper typically runs from the project root. When no
// explicit path is given and the file is not in the current directory, probe
// one level of subdirectories (skipping node_modules, .git and dist) so the
// default scaffold (testDir: './tests') is found too.
function findQuarantineFile(): string | undefined {
  if (fs.existsSync('.smart-quarantine.json')) {
    return '.smart-quarantine.json';
  }
  const skip = new Set(['node_modules', '.git', 'dist']);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync('.', { withFileTypes: true });
  } catch {
    return undefined;
  }
  const dirs = entries
    .filter(e => e.isDirectory() && !skip.has(e.name) && !e.name.startsWith('.'))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const dir of dirs) {
    const candidate = path.join(dir.name, '.smart-quarantine.json');
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export function getQuarantinedPattern(quarantineFile?: string): RegExp | undefined {
  const filePath = quarantineFile ?? findQuarantineFile();

  if (!filePath || !fs.existsSync(filePath)) {
    return undefined;
  }

  const data: QuarantineFile = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

  if (!data.entries || data.entries.length === 0) {
    return undefined;
  }

  const titles = data.entries.map(e => escapeRegExp(e.title));
  return new RegExp(titles.join('|'));
}

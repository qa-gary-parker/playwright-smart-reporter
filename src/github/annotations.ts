import * as path from 'path';
import type { JsonExportData, JsonTestEntry } from '../generators/json-exporter';
import { parseError } from '../utils/error-stack';

// GitHub shows at most 10 error annotations per step and drops the rest.
export const MAX_ANNOTATIONS = 10;

export interface FailureLocation {
  file: string;
  line?: number;
  column?: number;
}

export function isFailure(t: JsonTestEntry): boolean {
  return t.outcome === 'unexpected' && (t.status === 'failed' || t.status === 'timedOut');
}

export function testLabel(t: JsonTestEntry): string {
  return t.project ? `${t.title} [${t.project}]` : t.title;
}

const toPosix = (p: string) => p.replace(/\\/g, '/');

function repoPath(file: string, rootDir: string | undefined, workspace: string): string {
  const abs = path.isAbsolute(file) ? file : rootDir ? path.resolve(rootDir, file) : undefined;
  return toPosix(abs ? path.relative(workspace, abs) : file);
}

/**
 * Where the failure happened, as a workspace-relative path: Playwright's error location first,
 * then the first stack frame inside the test's own spec file, then the test declaration.
 */
export function failureLocation(t: JsonTestEntry, rootDir: string | undefined, workspace: string): FailureLocation {
  if (t.errorLocation) {
    return { file: repoPath(t.errorLocation.file, rootDir, workspace), line: t.errorLocation.line, column: t.errorLocation.column };
  }
  const spec = toPosix(t.file).replace(/^(\.\.?\/)+/, '');
  const frame = t.error
    ? parseError(t.error).frames.find((f) => {
        const file = toPosix(f.file);
        return file === spec || file.endsWith(`/${spec}`);
      })
    : undefined;
  if (frame) return { file: repoPath(frame.file, rootDir, workspace), line: frame.line, column: frame.column };
  return { file: repoPath(t.file, rootDir, workspace), line: t.line, column: t.column };
}

// Mirrors @actions/core command escaping.
const escapeData = (s: string) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escapeProperty = (s: string) => escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');

export function formatAnnotation(loc: FailureLocation, title: string, message: string): string {
  const props = [`file=${escapeProperty(loc.file)}`];
  if (loc.line !== undefined) props.push(`line=${loc.line}`);
  if (loc.column !== undefined) props.push(`col=${loc.column}`);
  props.push(`title=${escapeProperty(title)}`);
  return `::error ${props.join(',')}::${escapeData(message)}`;
}

export function buildAnnotations(data: JsonExportData, workspace: string): { lines: string[]; omitted: number } {
  const failures = data.tests.filter(isFailure);
  const lines = failures.slice(0, MAX_ANNOTATIONS).map((t) => {
    const message = (t.error && parseError(t.error).message) || `Test ${t.status}`;
    return formatAnnotation(failureLocation(t, data.metadata.rootDir, workspace), testLabel(t), message);
  });
  return { lines, omitted: Math.max(0, failures.length - MAX_ANNOTATIONS) };
}

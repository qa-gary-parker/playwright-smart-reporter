import type { FullConfig, TestCase, TestError, TestResult } from '@playwright/test/reporter';
import * as fs from 'fs';
import * as path from 'path';

// Mirrors Playwright HTML reporter "Copy prompt" structure (see playwright-core HTML report bundle).
const PLAYWRIGHT_COPY_PROMPT_INSTRUCTIONS = `
# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.
`.trimStart();

function safeRelativePath(rootDir: string, filePath: string): string {
  const rel = path.relative(rootDir, filePath);
  if (rel.startsWith('..')) return filePath;
  return rel;
}

function chunkToString(chunk: string | Buffer): string {
  return typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

function readTextAttachment(
  config: FullConfig,
  result: TestResult,
  name: string,
  maxChars: number = 80_000
): string | undefined {
  const rootDir = config.rootDir;
  const attachment = result.attachments.find((a) => a.name === name);
  if (!attachment) return undefined;

  try {
    let content = '';
    if (attachment.body) content = attachment.body.toString('utf-8');
    else if (attachment.path) content = fs.readFileSync(attachment.path, 'utf-8');
    if (!content.trim()) return undefined;
    if (content.length > maxChars) return content.slice(0, maxChars) + '\n…(truncated)…';
    return content;
  } catch {
    if (attachment.path) return `Could not read ${name} from: ${safeRelativePath(rootDir, attachment.path)}`;
    return `Could not read ${name}.`;
  }
}

function resultStdoutText(config: FullConfig, result: TestResult): string | undefined {
  const fromAttachment = readTextAttachment(config, result, 'stdout', 50_000);
  if (fromAttachment) return fromAttachment;
  const text = result.stdout.map(chunkToString).join('');
  return text.trim() ? text : undefined;
}

function resultStderrText(config: FullConfig, result: TestResult): string | undefined {
  const fromAttachment = readTextAttachment(config, result, 'stderr', 50_000);
  if (fromAttachment) return fromAttachment;
  const text = result.stderr.map(chunkToString).join('');
  return text.trim() ? text : undefined;
}

function formatNameForCopyPrompt(test: TestCase): string {
  const parts = test.titlePath().filter(Boolean);
  const prefix = parts.slice(0, -1).join(' >> ');
  return prefix ? `${prefix} >> ${test.title}` : test.title;
}

function formatTestError(error: TestError): string {
  const parts: string[] = [];
  if (error.message) parts.push(error.message);
  else if (error.value) parts.push(error.value);
  else parts.push('Unknown error');

  if (error.stack && error.stack !== error.message) parts.push(error.stack);
  if (error.snippet) parts.push(error.snippet);
  if (error.location?.file) parts.push(`at ${error.location.file}:${error.location.line}:${error.location.column}`);
  return parts.join('\n');
}

function pickCopyPromptErrors(formattedErrors: string[]): string[] {
  // Matches Playwright logic: keep multiline errors, and keep one-line errors
  // that are not included as a substring of any other error text.
  const oneLine = new Set(formattedErrors.filter((m) => m && !m.includes('\n')));
  for (const error of formattedErrors) {
    for (const candidate of oneLine.keys()) {
      if (error.includes(candidate)) oneLine.delete(candidate);
    }
  }
  return formattedErrors.filter((m) => m && (m.includes('\n') || oneLine.has(m)));
}

function buildCodeFrame(
  config: FullConfig,
  filePath: string,
  line: number,
  column: number,
  context: number = 2
): string | undefined {
  try {
    const absPath = path.isAbsolute(filePath) ? filePath : path.join(config.rootDir, filePath);
    const content = fs.readFileSync(absPath, 'utf-8');
    const lines = content.split(/\r?\n/);
    const idx = Math.max(0, line - 1);
    const start = Math.max(0, idx - context);
    const end = Math.min(lines.length - 1, idx + context);
    const width = String(end + 1).length;
    const out: string[] = [];

    for (let i = start; i <= end; i++) {
      const lineNo = String(i + 1).padStart(width, ' ');
      const marker = i === idx ? '>' : ' ';
      out.push(`${marker} ${lineNo} | ${lines[i] ?? ''}`);
      if (i === idx) {
        const caretPos = Math.max(0, column - 1);
        out.push(`  ${' '.repeat(width)} | ${' '.repeat(caretPos)}^`);
      }
    }

    return out.join('\n');
  } catch {
    return undefined;
  }
}

export function buildPlaywrightStyleAiPrompt(params: {
  config: FullConfig;
  test: TestCase;
  result: TestResult;
}): string {
  const { config, test, result } = params;

  const testFile = safeRelativePath(config.rootDir, test.location.file);
  const testInfo = [
    `- Name: ${formatNameForCopyPrompt(test)}`,
    `- Location: ${testFile}:${test.location.line}:${test.location.column}`,
  ].join('\n');

  const allErrors = (result.errors ?? []).map(formatTestError);
  const errorsForPrompt = pickCopyPromptErrors(allErrors);
  if (!errorsForPrompt.length) return '';

  const lines: string[] = [PLAYWRIGHT_COPY_PROMPT_INSTRUCTIONS, '# Test info', '', testInfo];

  const stdout = resultStdoutText(config, result);
  if (stdout) lines.push('', '# Stdout', '', '```', stripAnsi(stdout), '```');
  const stderr = resultStderrText(config, result);
  if (stderr) lines.push('', '# Stderr', '', '```', stripAnsi(stderr), '```');

  lines.push('', '# Error details');
  for (const errorText of errorsForPrompt) lines.push('', '```', stripAnsi(errorText), '```');

  // This is where Playwright includes the page snapshot for AI ("aria snapshot") as markdown:
  // it attaches error-context.md with "# Page snapshot" and a ```yaml block.
  const errorContext = readTextAttachment(config, result, 'error-context', 120_000);
  if (errorContext) lines.push('', errorContext);

  const lastErrorLoc = result.errors?.[result.errors.length - 1]?.location;
  const frame =
    lastErrorLoc?.file && lastErrorLoc.line && lastErrorLoc.column
      ? buildCodeFrame(config, lastErrorLoc.file, lastErrorLoc.line, lastErrorLoc.column)
      : buildCodeFrame(config, test.location.file, test.location.line, test.location.column);
  if (frame) lines.push('', '# Test source', '', '```ts', frame, '```');

  const prompt = lines.join('\n');
  return prompt.length > 200_000 ? prompt.slice(0, 200_000) + '\n…(truncated)…' : prompt;
}


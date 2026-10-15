import { fileURLToPath } from 'url';

export interface StackFrame {
  file: string;
  line: number;
  column: number;
}

const FRAME_IN_PARENS = /\((.+):(\d+):(\d+)\)$/;
const BARE_FRAME = /^(.+):(\d+):(\d+)$/;

function parseFrame(line: string): StackFrame | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith('at ')) return undefined;
  const rest = trimmed.slice(3).replace(/^async /, '');
  const m = FRAME_IN_PARENS.exec(rest) ?? BARE_FRAME.exec(rest);
  if (!m) return undefined;
  let file = m[1];
  if (file.startsWith('node:') || file.startsWith('<')) return undefined;
  if (file.startsWith('file://')) {
    try {
      file = fileURLToPath(file);
    } catch {
      return undefined;
    }
  }
  return { file, line: Number(m[2]), column: Number(m[3]) };
}

/** Splits a V8-style error string (message followed by `    at ...` frames) into its message and parsed frames. */
export function parseError(error: string): { message: string; frames: StackFrame[] } {
  const lines = error.split(/\r?\n/);
  const firstFrame = lines.findIndex((l) => parseFrame(l) !== undefined);
  const messageLines = firstFrame === -1 ? lines : lines.slice(0, firstFrame);
  const frames = firstFrame === -1
    ? []
    : lines.slice(firstFrame).map(parseFrame).filter((f): f is StackFrame => f !== undefined);
  return { message: messageLines.join('\n').trim(), frames };
}

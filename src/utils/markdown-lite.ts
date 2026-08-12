import { escapeHtml } from './sanitizers';

function normalizeMarkdown(input: string): string {
  let text = input.replace(/\r\n/g, '\n');
  // If headings were flattened by HTML whitespace collapsing, this helps a bit.
  text = text.replace(/([.!?])\s+(#{1,6}\s+)/g, '$1\n\n$2');
  return text.trim();
}

function escapeHtmlAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;');
}

function renderEmphasis(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Underscore italics only at word boundaries, so snake_case_names survive.
    .replace(/(?<!\w)_(.+?)_(?!\w)/g, '<em>$1</em>');
}

function renderInline(text: string): string {
  // Split on backticks first so emphasis markers inside inline code stay literal.
  let out = '';
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf('`', i);
    const end = start === -1 ? -1 : text.indexOf('`', start + 1);
    if (end === -1) {
      out += renderEmphasis(text.slice(i));
      break;
    }
    out += renderEmphasis(text.slice(i, start));
    out += `<code class="ai-inline-code">${escapeHtml(text.slice(start + 1, end))}</code>`;
    i = end + 1;
  }
  return out;
}

function renderParagraph(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  return `<p>${renderInline(trimmed)}</p>`;
}

function renderHeading(line: string): string | null {
  const match = line.match(/^(#{1,6})\s+(.*)$/);
  if (!match) return null;
  const level = Math.min(6, match[1].length);
  const content = match[2].trim();
  const tag = level <= 2 ? 'h4' : level === 3 ? 'h5' : 'h6';
  return `<${tag} class="ai-heading ai-h${level}">${renderInline(content)}</${tag}>`;
}

function renderList(lines: string[], startIndex: number): { html: string; nextIndex: number } | null {
  const bullet = (line: string) => line.match(/^\s*[-*]\s+(.*)$/);
  const numbered = (line: string) => line.match(/^\s*\d+\.\s+(.*)$/);

  const first = lines[startIndex] ?? '';
  const isBullet = bullet(first);
  const isNumbered = numbered(first);
  if (!isBullet && !isNumbered) return null;

  const tag = isNumbered ? 'ol' : 'ul';
  const items: string[] = [];
  let i = startIndex;
  for (; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const m = isNumbered ? numbered(line) : bullet(line);
    if (!m) break;
    items.push(`<li>${renderInline(m[1].trim())}</li>`);
  }
  return { html: `<${tag} class="ai-list">${items.join('')}</${tag}>`, nextIndex: i };
}

function renderCodeBlock(code: string, language: string | undefined): string {
  const lang = (language || '').trim();
  const className = lang ? `language-${lang.replace(/[^a-zA-Z0-9_-]/g, '')}` : '';
  const escapedCode = escapeHtml(code.replace(/\n$/, ''));
  const codeId = `code-${Math.random().toString(36).substring(2, 9)}`;

  return (
    `<div class="ai-code-block">` +
    `<div class="ai-code-header">` +
    `<span class="ai-code-lang">${lang ? escapeHtml(lang) : 'code'}</span>` +
    `<button class="copy-btn" onclick="copyCode('${codeId}', this)">Copy</button>` +
    `</div>` +
    `<pre><code id="${codeId}" class="${escapeHtmlAttr(className)}">${escapedCode}</code></pre>` +
    `</div>`
  );
}

export function renderMarkdownLite(input: string): string {
  const md = normalizeMarkdown(input);
  if (!md) return '';

  // Split into fenced code blocks first.
  const parts: Array<{ type: 'text'; value: string } | { type: 'code'; code: string; lang?: string }> = [];
  const fence = /```([^\n]*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(md))) {
    if (match.index > lastIndex) parts.push({ type: 'text', value: md.slice(lastIndex, match.index) });
    parts.push({ type: 'code', lang: match[1]?.trim() || undefined, code: match[2] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < md.length) parts.push({ type: 'text', value: md.slice(lastIndex) });

  const out: string[] = [];
  for (const part of parts) {
    if (part.type === 'code') {
      out.push(renderCodeBlock(part.code, part.lang));
      continue;
    }

    const lines = part.value.split('\n');
    let paragraphBuf: string[] = [];
    const flushParagraph = () => {
      const html = renderParagraph(paragraphBuf.join(' ').replace(/\s+/g, ' '));
      if (html) out.push(html);
      paragraphBuf = [];
    };

    for (let i = 0; i < lines.length; ) {
      const line = lines[i] ?? '';
      const trimmed = line.trim();

      if (!trimmed) {
        flushParagraph();
        i++;
        continue;
      }

      const heading = renderHeading(trimmed);
      if (heading) {
        flushParagraph();
        out.push(heading);
        i++;
        continue;
      }

      const list = renderList(lines, i);
      if (list) {
        flushParagraph();
        out.push(list.html);
        i = list.nextIndex;
        continue;
      }

      paragraphBuf.push(trimmed);
      i++;
    }
    flushParagraph();
  }

  return out.join('');
}


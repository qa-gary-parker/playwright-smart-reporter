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

function renderInline(text: string): string {
  // Minimal inline code support using backticks.
  let out = '';
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf('`', i);
    if (start === -1) {
      out += escapeHtml(text.slice(i));
      break;
    }
    const end = text.indexOf('`', start + 1);
    if (end === -1) {
      out += escapeHtml(text.slice(i));
      break;
    }
    out += escapeHtml(text.slice(i, start));
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
  const langBadge = lang ? `<div class="ai-code-lang">${escapeHtml(lang)}</div>` : '';
  return (
    `<div class="ai-code-block">` +
    langBadge +
    `<pre><code class="${escapeHtmlAttr(className)}">${escapeHtml(code.replace(/\n$/, ''))}</code></pre>` +
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


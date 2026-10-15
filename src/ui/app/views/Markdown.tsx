import type { ComponentChildren } from 'preact';

// Builds nodes instead of HTML so AI output can never inject markup.
function inline(text: string): ComponentChildren[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 1) return <code>{part.slice(1, -1)}</code>;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 3) return <strong>{part.slice(2, -2)}</strong>;
    return part;
  });
}

function blocks(text: string): ComponentChildren[] {
  const out: ComponentChildren[] = [];
  const paragraphs = text.split(/\n{2,}/);
  for (const para of paragraphs) {
    const lines = para.split('\n').filter((l) => l.trim());
    if (lines.length === 0) continue;
    if (lines.every((l) => /^\s*([-*]|\d+\.)\s+/.test(l))) {
      const ordered = /^\s*\d+\./.test(lines[0]);
      const items = lines.map((l) => <li>{inline(l.replace(/^\s*([-*]|\d+\.)\s+/, ''))}</li>);
      out.push(ordered ? <ol>{items}</ol> : <ul>{items}</ul>);
    } else if (/^#{1,6}\s/.test(lines[0])) {
      out.push(<p class="md__heading">{inline(lines[0].replace(/^#+\s*/, ''))}</p>);
      if (lines.length > 1) out.push(<p>{inline(lines.slice(1).join(' '))}</p>);
    } else {
      out.push(<p>{inline(lines.join(' '))}</p>);
    }
  }
  return out;
}

export function Markdown({ text }: { text: string }) {
  const parts = text.split(/```[\w-]*\n?([\s\S]*?)```/g);
  return (
    <div class="md">
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <pre class="md__code" tabIndex={0}>
            <code>{part.replace(/\n$/, '')}</code>
          </pre>
        ) : (
          blocks(part)
        ),
      )}
    </div>
  );
}

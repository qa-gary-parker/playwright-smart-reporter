export interface CodeLine {
  n: number;
  text: string;
}

export function CodeFrame({
  lines,
  highlight,
  column,
  file,
}: {
  lines: CodeLine[];
  highlight?: number;
  column?: number;
  file?: string;
}) {
  return (
    <figure class="frame">
      {file && <figcaption class="frame__file">{file}</figcaption>}
      <pre class="frame__code" tabIndex={0} aria-label={file ? `Source of ${file}` : 'Source'}>
        <code>
          {lines.map((l) => (
            <>
              <span class="frame__line" data-hl={l.n === highlight ? '' : undefined}>
                <span class="frame__n">{l.n}</span>
                <span class="frame__t">{l.text || ' '}</span>
              </span>
              {l.n === highlight && column !== undefined && (
                <span class="frame__line frame__caret" aria-hidden="true">
                  <span class="frame__n" />
                  <span class="frame__t">{' '.repeat(Math.max(0, column - 1))}^</span>
                </span>
              )}
            </>
          ))}
        </code>
      </pre>
    </figure>
  );
}

export function Diff({ expected, received }: { expected: string; received: string }) {
  return (
    <div class="diff">
      <div class="diff__row diff__row--exp">
        <span class="diff__sign">-</span>
        <span class="diff__label">Expected</span>
        <code class="diff__value">{expected}</code>
      </div>
      <div class="diff__row diff__row--rec">
        <span class="diff__sign">+</span>
        <span class="diff__label">Received</span>
        <code class="diff__value">{received}</code>
      </div>
    </div>
  );
}

export function ErrorMessage({ message }: { message: string }) {
  const [head, ...rest] = message.split('\n');
  return (
    <pre class="error-text">
      <strong class="error-text__head">{head}</strong>
      {rest.length > 0 && '\n' + rest.join('\n')}
    </pre>
  );
}

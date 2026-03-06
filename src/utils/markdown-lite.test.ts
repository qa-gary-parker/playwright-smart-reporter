import { describe, it, expect } from 'vitest';
import { renderMarkdownLite } from './markdown-lite';

// ---------------------------------------------------------------------------
// Inline: Bold
// ---------------------------------------------------------------------------
describe('renderMarkdownLite – bold', () => {
  it('renders **text** as <strong>', () => {
    expect(renderMarkdownLite('**bold**')).toBe('<p><strong>bold</strong></p>');
  });

  it('renders __text__ as <strong>', () => {
    expect(renderMarkdownLite('__bold__')).toBe('<p><strong>bold</strong></p>');
  });

  it('renders multiple bold spans on the same line', () => {
    const result = renderMarkdownLite('**a** and **b**');
    expect(result).toBe('<p><strong>a</strong> and <strong>b</strong></p>');
  });

  it('does not process a lone ** with no closing marker', () => {
    // no closing marker → treated as literal asterisks
    const result = renderMarkdownLite('**unclosed');
    expect(result).toContain('**unclosed');
    expect(result).not.toContain('<strong>');
  });
});

// ---------------------------------------------------------------------------
// Inline: Italic
// ---------------------------------------------------------------------------
describe('renderMarkdownLite – italic', () => {
  it('renders *text* as <em>', () => {
    expect(renderMarkdownLite('*italic*')).toBe('<p><em>italic</em></p>');
  });

  it('renders _text_ as <em> when not inside a word', () => {
    expect(renderMarkdownLite('_italic_')).toBe('<p><em>italic</em></p>');
  });

  it('does NOT render _text_ as italic when adjacent to word chars (snake_case)', () => {
    const result = renderMarkdownLite('snake_case_var');
    expect(result).not.toContain('<em>');
    expect(result).toContain('snake_case_var');
  });

  it('renders multiple italic spans on the same line', () => {
    const result = renderMarkdownLite('*a* and *b*');
    expect(result).toBe('<p><em>a</em> and <em>b</em></p>');
  });
});

// ---------------------------------------------------------------------------
// Inline: Mixed bold + italic
// ---------------------------------------------------------------------------
describe('renderMarkdownLite – mixed bold and italic', () => {
  it('handles bold and italic on the same line', () => {
    const result = renderMarkdownLite('**bold** and *italic*');
    expect(result).toBe('<p><strong>bold</strong> and <em>italic</em></p>');
  });

  it('handles underscore variants together', () => {
    const result = renderMarkdownLite('__bold__ and _italic_');
    expect(result).toBe('<p><strong>bold</strong> and <em>italic</em></p>');
  });
});

// ---------------------------------------------------------------------------
// Inline: Code
// ---------------------------------------------------------------------------
describe('renderMarkdownLite – inline code', () => {
  it('renders `code` with the ai-inline-code class', () => {
    expect(renderMarkdownLite('`code`')).toBe('<p><code class="ai-inline-code">code</code></p>');
  });

  it('does NOT process bold markers inside inline code', () => {
    const result = renderMarkdownLite('`**not bold**`');
    expect(result).toContain('**not bold**');
    expect(result).not.toContain('<strong>');
  });

  it('does NOT process italic markers inside inline code', () => {
    const result = renderMarkdownLite('`*not italic*`');
    expect(result).toContain('*not italic*');
    expect(result).not.toContain('<em>');
  });

  it('HTML-escapes content inside inline code', () => {
    const result = renderMarkdownLite('`a < b`');
    expect(result).toContain('&lt;');
    expect(result).not.toContain('<b>');
  });

  it('handles bold with inline code in the same paragraph', () => {
    const result = renderMarkdownLite('Use **bold** and `code` together');
    expect(result).toContain('<strong>bold</strong>');
    expect(result).toContain('<code class="ai-inline-code">code</code>');
    expect(result).toMatch(/^<p>.*<\/p>$/);
  });
});

// ---------------------------------------------------------------------------
// XSS prevention
// ---------------------------------------------------------------------------
describe('renderMarkdownLite – XSS prevention', () => {
  it('escapes <script> tags inside bold markers', () => {
    const result = renderMarkdownLite('**<script>alert(1)</script>**');
    expect(result).toContain('<strong>');
    expect(result).not.toContain('<script>');
    expect(result).toContain('&lt;script&gt;');
  });

  it('escapes raw HTML in plain text', () => {
    const result = renderMarkdownLite('<img src=x onerror=alert(1)>');
    expect(result).not.toContain('<img');
    expect(result).toContain('&lt;img');
  });

  it('escapes HTML in headings', () => {
    const result = renderMarkdownLite('# <b>Title</b>');
    expect(result).not.toContain('<b>');
    expect(result).toContain('&lt;b&gt;');
  });

  it('escapes HTML in list items', () => {
    const result = renderMarkdownLite('- <script>x</script>');
    expect(result).not.toContain('<script>');
    expect(result).toContain('&lt;script&gt;');
  });

  it('escapes ampersands', () => {
    const result = renderMarkdownLite('A & B');
    expect(result).toContain('&amp;');
  });

  it('escapes single quotes', () => {
    const result = renderMarkdownLite("it's");
    expect(result).toContain('&#039;');
  });
});

// ---------------------------------------------------------------------------
// Headings
// ---------------------------------------------------------------------------
describe('renderMarkdownLite – headings', () => {
  it('renders # as h4 with class ai-h1', () => {
    const result = renderMarkdownLite('# Heading One');
    expect(result).toBe('<h4 class="ai-heading ai-h1">Heading One</h4>');
  });

  it('renders ## as h4 with class ai-h2', () => {
    const result = renderMarkdownLite('## Heading Two');
    expect(result).toBe('<h4 class="ai-heading ai-h2">Heading Two</h4>');
  });

  it('renders ### as h5 with class ai-h3', () => {
    const result = renderMarkdownLite('### Heading Three');
    expect(result).toBe('<h5 class="ai-heading ai-h3">Heading Three</h5>');
  });

  it('renders #### as h6 with class ai-h4', () => {
    const result = renderMarkdownLite('#### Heading Four');
    expect(result).toBe('<h6 class="ai-heading ai-h4">Heading Four</h6>');
  });

  it('renders inline bold inside a heading', () => {
    const result = renderMarkdownLite('# **bold** title');
    expect(result).toContain('<strong>bold</strong>');
    expect(result).toMatch(/^<h4/);
  });

  it('does not treat # without a space as a heading', () => {
    const result = renderMarkdownLite('#NoSpace');
    expect(result).not.toContain('<h');
    expect(result).toContain('#NoSpace');
  });
});

// ---------------------------------------------------------------------------
// Bullet lists
// ---------------------------------------------------------------------------
describe('renderMarkdownLite – bullet lists', () => {
  it('renders a single - item as ul/li', () => {
    const result = renderMarkdownLite('- item');
    expect(result).toBe('<ul class="ai-list"><li>item</li></ul>');
  });

  it('renders multiple - items as a single ul', () => {
    const result = renderMarkdownLite('- one\n- two\n- three');
    expect(result).toBe('<ul class="ai-list"><li>one</li><li>two</li><li>three</li></ul>');
  });

  it('renders * bullets as ul/li', () => {
    const result = renderMarkdownLite('* item');
    expect(result).toBe('<ul class="ai-list"><li>item</li></ul>');
  });

  it('applies inline formatting inside list items', () => {
    const result = renderMarkdownLite('- **bold** item');
    expect(result).toContain('<strong>bold</strong>');
    expect(result).toContain('<li>');
  });
});

// ---------------------------------------------------------------------------
// Numbered lists
// ---------------------------------------------------------------------------
describe('renderMarkdownLite – numbered lists', () => {
  it('renders a single numbered item as ol/li', () => {
    const result = renderMarkdownLite('1. item');
    expect(result).toBe('<ol class="ai-list"><li>item</li></ol>');
  });

  it('renders multiple numbered items as a single ol', () => {
    const result = renderMarkdownLite('1. first\n2. second\n3. third');
    expect(result).toBe('<ol class="ai-list"><li>first</li><li>second</li><li>third</li></ol>');
  });

  it('applies inline formatting inside numbered list items', () => {
    const result = renderMarkdownLite('1. `code` item');
    expect(result).toContain('<code class="ai-inline-code">code</code>');
    expect(result).toContain('<li>');
  });
});

// ---------------------------------------------------------------------------
// Fenced code blocks
// ---------------------------------------------------------------------------
describe('renderMarkdownLite – fenced code blocks', () => {
  it('renders a fenced block wrapped in ai-code-block div', () => {
    const result = renderMarkdownLite('```\nconsole.log("hi")\n```');
    expect(result).toContain('<div class="ai-code-block">');
    expect(result).toContain('<pre><code');
    expect(result).toContain('console.log(&quot;hi&quot;)');
  });

  it('includes the language label when specified', () => {
    const result = renderMarkdownLite('```typescript\nconst x = 1;\n```');
    expect(result).toContain('<span class="ai-code-lang">typescript</span>');
    expect(result).toContain('class="language-typescript"');
  });

  it('shows "code" as label when no language is given', () => {
    const result = renderMarkdownLite('```\nfoo\n```');
    expect(result).toContain('<span class="ai-code-lang">code</span>');
  });

  it('strips dangerous chars from language identifier to prevent injection', () => {
    const result = renderMarkdownLite('```js"><script>alert(1)</script>\ncode\n```');
    expect(result).not.toContain('<script>');
    // language class should only contain safe chars
    const classMatch = result.match(/class="language-([^"]+)"/);
    if (classMatch) {
      expect(classMatch[1]).toMatch(/^[a-zA-Z0-9_-]+$/);
    }
  });

  it('HTML-escapes code block content', () => {
    const result = renderMarkdownLite('```\n<div>html</div>\n```');
    expect(result).toContain('&lt;div&gt;');
    expect(result).not.toContain('<div>html</div>');
  });

  it('does NOT apply bold/italic inside a fenced code block', () => {
    const result = renderMarkdownLite('```\n**not bold**\n```');
    // The asterisks should be literal (escaped as-is since they are not HTML special)
    expect(result).not.toContain('<strong>');
    expect(result).toContain('**not bold**');
  });

  it('includes a copy button', () => {
    const result = renderMarkdownLite('```\ncode\n```');
    expect(result).toContain('<button class="copy-btn"');
    expect(result).toContain('Copy</button>');
  });
});

// ---------------------------------------------------------------------------
// Paragraphs
// ---------------------------------------------------------------------------
describe('renderMarkdownLite – paragraphs', () => {
  it('wraps plain text in a <p> tag', () => {
    expect(renderMarkdownLite('Hello world')).toBe('<p>Hello world</p>');
  });

  it('produces separate <p> tags for blocks separated by blank lines', () => {
    const result = renderMarkdownLite('First paragraph\n\nSecond paragraph');
    expect(result).toContain('<p>First paragraph</p>');
    expect(result).toContain('<p>Second paragraph</p>');
    expect(result.match(/<p>/g)?.length).toBe(2);
  });

  it('collapses consecutive non-blank lines into one paragraph', () => {
    const result = renderMarkdownLite('line one\nline two\nline three');
    expect(result.match(/<p>/g)?.length).toBe(1);
    expect(result).toContain('line one');
    expect(result).toContain('line two');
  });
});

// ---------------------------------------------------------------------------
// Empty / whitespace input
// ---------------------------------------------------------------------------
describe('renderMarkdownLite – empty input', () => {
  it('returns empty string for empty input', () => {
    expect(renderMarkdownLite('')).toBe('');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(renderMarkdownLite('   ')).toBe('');
  });

  it('returns empty string for newlines only', () => {
    expect(renderMarkdownLite('\n\n\n')).toBe('');
  });

  it('normalises CRLF line endings', () => {
    const result = renderMarkdownLite('# Title\r\n\r\nParagraph');
    expect(result).toContain('<h4');
    expect(result).toContain('<p>Paragraph</p>');
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------
describe('renderMarkdownLite – edge cases', () => {
  it('handles a heading immediately followed by a paragraph', () => {
    const result = renderMarkdownLite('# Title\nsome text');
    expect(result).toContain('<h4');
    expect(result).toContain('<p>some text</p>');
  });

  it('handles a list immediately following a heading', () => {
    const result = renderMarkdownLite('# Header\n- item one\n- item two');
    expect(result).toContain('<h4');
    expect(result).toContain('<ul class="ai-list">');
    expect(result).toContain('<li>item one</li>');
  });

  it('handles fenced code block mixed with surrounding prose', () => {
    const result = renderMarkdownLite('Before\n\n```\ncode\n```\n\nAfter');
    expect(result).toContain('<p>Before</p>');
    expect(result).toContain('<div class="ai-code-block">');
    expect(result).toContain('<p>After</p>');
  });

  it('handles bold text that contains HTML-special characters', () => {
    const result = renderMarkdownLite('**a & b**');
    expect(result).toContain('<strong>');
    expect(result).toContain('&amp;');
    expect(result).not.toContain('<strong>a & b</strong>');
  });

  it('renders unicode content without corruption', () => {
    const result = renderMarkdownLite('**Héllo** _wörld_');
    expect(result).toContain('<strong>Héllo</strong>');
    expect(result).toContain('<em>wörld</em>');
  });

  it('handles very long plain text without truncation', () => {
    const long = 'word '.repeat(1000).trim();
    const result = renderMarkdownLite(long);
    expect(result).toMatch(/^<p>/);
    expect(result).toMatch(/<\/p>$/);
  });
});

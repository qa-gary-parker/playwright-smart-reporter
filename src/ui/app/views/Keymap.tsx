import { Dialog, Kbd } from '../../components';
import { keymapOpen } from '../store';

export const KEYMAP: Array<[string, Array<[string[], string]>]> = [
  [
    'Navigate',
    [
      [['j', 'k'], 'Next or previous test'],
      [['↵'], 'Open test'],
      [['[', ']'], 'Previous or next failure'],
      [['f'], 'Next failure'],
      [['n'], 'Next flaky test'],
      [['Esc'], 'Close, or back to the list'],
    ],
  ],
  [
    'Go to',
    [
      [['g f'], 'Failures'],
      [['g l'], 'Flaky'],
      [['g i'], 'Insights'],
      [['g h'], 'History'],
      [['1', '5'], 'Failures, All tests, Insights, History, Gallery'],
    ],
  ],
  [
    'Actions',
    [
      [['⌘K'], 'Command palette'],
      [['/'], 'Filter tests'],
      [['c'], 'Copy failure summary'],
      [['e'], 'Summary card'],
      [['⌘B'], 'Toggle sidebar'],
      [['?'], 'Keyboard shortcuts'],
    ],
  ],
];

export function Keymap() {
  return (
    <Dialog open={keymapOpen.value} onClose={() => (keymapOpen.value = false)} title="Keyboard shortcuts" size="lg">
      <div class="keymap">
        {KEYMAP.map(([title, keys]) => (
          <section>
            <h3 class="keymap__title">{title}</h3>
            <dl class="keymap__list">
              {keys.map(([combo, label]) => (
                <>
                  <dt>
                    {combo.map((k, i) => (
                      <>
                        {i > 0 && <span class="faint">{combo.length === 2 && label.includes(',') ? ' – ' : ' / '}</span>}
                        {k.split(' ').map((part) => (
                          <Kbd>{part}</Kbd>
                        ))}
                      </>
                    ))}
                  </dt>
                  <dd>{label}</dd>
                </>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}

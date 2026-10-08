import { render } from 'preact';
import { App } from './App';
import { onKeyDown } from './keys';
import { QUEUES } from './queues';
import { applyTheme, data, navigate, theme } from './store';

const root = document.getElementById('app');
if (root && data.value) {
  applyTheme(theme.value, false);
  // With no deep link, open on failures; a green run opens on Flaky, or All tests when nothing is flaky.
  if (!location.hash) {
    const has = (q: keyof typeof QUEUES) => data.value.tests.some(QUEUES[q].includes);
    const queue = has('failures') ? 'failures' : has('flaky') ? 'flaky' : 'all';
    if (queue !== 'failures') navigate({ view: 'queue', queue, q: '' }, true);
  }
  window.addEventListener('keydown', onKeyDown);
  render(<App />, root);
} else if (root) {
  root.textContent = 'Smart Reporter: report data is missing. If the report uses a separate data file, keep it next to the HTML file.';
}

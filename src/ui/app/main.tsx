import { render } from 'preact';
import { App } from './App';
import { onKeyDown } from './keys';
import { applyTheme, data, navigate, theme } from './store';

const root = document.getElementById('app');
if (root && data.value) {
  applyTheme(theme.value, false);
  // With no deep link, open on the Insights dashboard. CI links to a failed run point at #/q/failures.
  if (!location.hash) navigate({ view: 'insights' }, true);
  window.addEventListener('keydown', onKeyDown);
  render(<App />, root);
} else if (root) {
  root.textContent = 'Smart Reporter: report data is missing. If the report uses a separate data file, keep it next to the HTML file.';
}

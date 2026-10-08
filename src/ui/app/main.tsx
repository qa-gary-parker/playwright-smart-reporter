import { render } from 'preact';
import { App } from './App';
import { onKeyDown } from './keys';
import { applyTheme, data, theme } from './store';

const root = document.getElementById('app');
if (root && data.value) {
  applyTheme(theme.value, false);
  window.addEventListener('keydown', onKeyDown);
  render(<App />, root);
} else if (root) {
  root.textContent = 'Smart Reporter: report data is missing. If the report uses a separate data file, keep it next to the HTML file.';
}

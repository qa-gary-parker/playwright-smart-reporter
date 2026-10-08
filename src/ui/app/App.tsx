import { signal } from '@preact/signals';
import { Toast } from '../components';
import { route, toast } from './store';
import { SummaryDialog } from './views/Exports';
import { Gallery } from './views/Gallery';
import { History } from './views/History';
import { Insights } from './views/Insights';
import { Keymap } from './views/Keymap';
import { Live } from './views/Live';
import { Palette } from './views/Palette';
import { QueueView } from './views/QueueView';
import { Frame } from './views/Shell';

const narrowQuery = window.matchMedia('(max-width: 899px)');
const narrow = signal(narrowQuery.matches);
narrowQuery.addEventListener('change', (e) => (narrow.value = e.matches));

export function App() {
  const r = route.value;
  return (
    <>
      <Frame>
        {r.view === 'queue' && <QueueView narrow={narrow.value} />}
        {r.view === 'insights' && <Insights />}
        {r.view === 'history' && <History tab={r.tab} />}
        {r.view === 'gallery' && <Gallery />}
        {r.view === 'live' && <Live />}
      </Frame>
      <Palette />
      <Keymap />
      <SummaryDialog />
      {toast.value && <Toast message={toast.value} onDone={() => (toast.value = null)} />}
    </>
  );
}

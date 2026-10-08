import { useMemo, useState } from 'preact/hooks';
import { EmptyState, Icon, StatusGlyph, Tabs } from '../../components';
import { displayStatus, type ReportTest } from '../data';
import { formatRoute } from '../router';
import { data, runTests } from '../store';
import { Lightbox, type MediaItem } from './Lightbox';

type Kind = 'all' | 'image' | 'video' | 'trace';
interface Tile {
  kind: 'image' | 'video' | 'trace';
  src: string;
  test: ReportTest;
}

export function Gallery() {
  const [kind, setKind] = useState<Kind>('all');
  const [index, setIndex] = useState<number | null>(null);
  const tiles = useMemo<Tile[]>(
    () =>
      runTests.value.flatMap((test) => [
        ...(test.attachments?.screenshots ?? []).map((src) => ({ kind: 'image' as const, src, test })),
        ...(test.attachments?.videos ?? []).map((src) => ({ kind: 'video' as const, src, test })),
        ...(test.attachments?.traces ?? []).map((src) => ({ kind: 'trace' as const, src, test })),
      ]),
    [runTests.value],
  );
  const shown = tiles.filter((t) => kind === 'all' || t.kind === kind);
  const media: MediaItem[] = shown.filter((t) => t.kind !== 'trace').map((t) => ({ kind: t.kind as 'image' | 'video', src: t.src, caption: t.test.title }));
  const count = (k: Tile['kind']) => tiles.filter((t) => t.kind === k).length;
  const traceViewer = data.value.config.features.traceViewer && !!window.openTraceModal;

  return (
    <div class="page">
      <header class="page__head">
        <h1 class="page__title">Gallery</h1>
        <span class="faint">{tiles.length} attachments</span>
      </header>
      <Tabs
        label="Attachment type"
        value={kind}
        onChange={(k) => setKind(k as Kind)}
        tabs={[
          { id: 'all', label: 'All', count: tiles.length },
          { id: 'image', label: 'Screenshots', count: count('image') },
          { id: 'video', label: 'Videos', count: count('video') },
          { id: 'trace', label: 'Traces', count: count('trace') },
        ]}
      />
      {shown.length === 0 ? (
        <EmptyState title="No attachments" icon="image">
          Screenshots, videos, and traces from this run appear here.
        </EmptyState>
      ) : (
        <ul class="gallery">
          {shown.map((tile) => {
            const mediaIndex = media.findIndex((m) => m.src === tile.src);
            return (
              <li class="gallery__tile">
                {tile.kind === 'trace' ? (
                  <button type="button" class="gallery__media gallery__media--icon" disabled={!traceViewer} onClick={() => window.openTraceModal?.(tile.src)} aria-label={`Open trace for ${tile.test.title}`}>
                    <Icon name="route" size={24} />
                  </button>
                ) : (
                  <button type="button" class="gallery__media" onClick={() => setIndex(mediaIndex)} aria-label={`Open ${tile.kind === 'image' ? 'screenshot' : 'video'} for ${tile.test.title}`}>
                    {tile.kind === 'image' ? <img src={tile.src} alt="" loading="lazy" /> : <Icon name="film" size={24} />}
                  </button>
                )}
                <a class="gallery__caption" href={formatRoute({ view: 'queue', queue: 'all', q: '', test: tile.test.testId })}>
                  <StatusGlyph status={displayStatus(tile.test)} size={12} />
                  <span>{tile.test.title}</span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
      <Lightbox items={media} index={index} onIndex={setIndex} onClose={() => setIndex(null)} />
    </div>
  );
}

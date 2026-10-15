import { useEffect } from 'preact/hooks';
import { Dialog, IconButton } from '../../components';

export interface MediaItem {
  kind: 'image' | 'video';
  src: string;
  caption: string;
}

export function Lightbox({ items, index, onIndex, onClose }: { items: MediaItem[]; index: number | null; onIndex: (i: number) => void; onClose: () => void }) {
  const open = index !== null && items[index] !== undefined;
  const item = open ? items[index] : undefined;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') onIndex((index! + 1) % items.length);
      if (e.key === 'ArrowLeft') onIndex((index! - 1 + items.length) % items.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, index, items.length]);

  return (
    <Dialog open={open} onClose={onClose} title={item?.caption ?? 'Attachment'} size="lg">
      {item && (
        <div class="lightbox">
          {item.kind === 'image' ? <img class="lightbox__media" src={item.src} alt={item.caption} /> : <video class="lightbox__media" src={item.src} controls />}
          {items.length > 1 && (
            <div class="lightbox__nav">
              <IconButton icon="chevron-left" label="Previous (←)" onClick={() => onIndex((index! - 1 + items.length) % items.length)} />
              <span class="faint">
                {index! + 1} of {items.length}
              </span>
              <IconButton icon="chevron-right" label="Next (→)" onClick={() => onIndex((index! + 1) % items.length)} />
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

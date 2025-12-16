/**
 * Gallery Generator - NEW feature for attachment gallery
 * Displays all screenshots, videos, and traces in a grid view with lightbox
 */

import type { TestResultData, GalleryItem } from '../types';
import { escapeHtml, sanitizeId } from '../utils';

/**
 * Generate gallery view of all attachments
 */
export function generateGallery(results: TestResultData[]): string {
  const galleryItems = collectGalleryItems(results);

  if (galleryItems.length === 0) {
    return '';
  }

  const screenshots = galleryItems.filter(item => item.dataUri);
  const videos = galleryItems.filter(item => item.videoPath);
  const traces = galleryItems.filter(item => item.tracePath);

  return `
    <div class="gallery-section">
      <div class="gallery-header">
        <div class="gallery-title">🖼️ Attachments Gallery</div>
        <div class="gallery-filters">
          <button class="gallery-filter-btn active" data-type="all" onclick="filterGallery('all')">
            All (${galleryItems.length})
          </button>
          ${screenshots.length > 0 ? `
            <button class="gallery-filter-btn" data-type="screenshots" onclick="filterGallery('screenshots')">
              📸 Screenshots (${screenshots.length})
            </button>
          ` : ''}
          ${videos.length > 0 ? `
            <button class="gallery-filter-btn" data-type="videos" onclick="filterGallery('videos')">
              🎬 Videos (${videos.length})
            </button>
          ` : ''}
          ${traces.length > 0 ? `
            <button class="gallery-filter-btn" data-type="traces" onclick="filterGallery('traces')">
              🔍 Traces (${traces.length})
            </button>
          ` : ''}
        </div>
      </div>
      <div class="gallery-grid">
        ${galleryItems.map(item => generateGalleryItem(item)).join('')}
      </div>
    </div>

    <!-- Lightbox Modal -->
    <div id="lightbox" class="lightbox" onclick="closeLightbox()">
      <span class="lightbox-close">&times;</span>
      <div class="lightbox-content" onclick="event.stopPropagation()">
        <img id="lightbox-img" class="lightbox-img" src="" alt=""/>
        <div class="lightbox-info">
          <div class="lightbox-test-title" id="lightbox-title"></div>
          <div class="lightbox-status" id="lightbox-status"></div>
        </div>
        <div class="lightbox-nav">
          <button class="lightbox-prev" onclick="navigateLightbox(-1)">❮</button>
          <button class="lightbox-next" onclick="navigateLightbox(1)">❯</button>
        </div>
      </div>
    </div>
  `;
}

/**
 * Generate a single gallery item
 */
function generateGalleryItem(item: GalleryItem): string {
  const itemId = sanitizeId(item.id);
  const statusClass = item.status === 'passed' ? 'passed' : item.status === 'skipped' ? 'skipped' : 'failed';

  // Screenshot
  if (item.dataUri) {
    return `
      <div class="gallery-item" data-type="screenshots" data-id="${itemId}" onclick="openLightbox('${itemId}')">
        <div class="gallery-item-preview">
          <img src="${item.dataUri}" alt="${escapeHtml(item.testTitle)}" loading="lazy"/>
          <div class="gallery-item-overlay">
            <span class="gallery-item-icon">📸</span>
          </div>
        </div>
        <div class="gallery-item-info">
          <div class="gallery-item-title" title="${escapeHtml(item.testTitle)}">${escapeHtml(item.testTitle)}</div>
          <div class="gallery-item-status ${statusClass}">${item.status}</div>
        </div>
      </div>
    `;
  }

  // Video
  if (item.videoPath) {
    return `
      <div class="gallery-item" data-type="videos" data-id="${itemId}">
        <div class="gallery-item-preview video-preview">
          <div class="gallery-item-overlay">
            <span class="gallery-item-icon">🎬</span>
          </div>
        </div>
        <div class="gallery-item-info">
          <div class="gallery-item-title" title="${escapeHtml(item.testTitle)}">${escapeHtml(item.testTitle)}</div>
          <div class="gallery-item-status ${statusClass}">${item.status}</div>
          <a href="file://${item.videoPath}" class="gallery-item-link" target="_blank" onclick="event.stopPropagation()">
            Open Video
          </a>
        </div>
      </div>
    `;
  }

  // Trace
  if (item.tracePath) {
    return `
      <div class="gallery-item trace-item" data-type="traces" data-id="${itemId}">
        <div class="gallery-item-preview trace-preview">
          <div class="gallery-item-overlay">
            <div class="trace-icon-wrapper">
              <span class="trace-file-icon">📊</span>
              <span class="trace-file-type">.zip</span>
            </div>
          </div>
        </div>
        <div class="gallery-item-info">
          <div class="gallery-item-title" title="${escapeHtml(item.testTitle)}">${escapeHtml(item.testTitle)}</div>
          <div class="gallery-item-status ${statusClass}">${item.status}</div>
          <a href="${item.tracePath}" class="gallery-trace-download" download onclick="event.stopPropagation()">
            <span class="download-icon">⬇</span>
            <span>Download Trace</span>
          </a>
        </div>
      </div>
    `;
  }

  return '';
}

/**
 * Collect all gallery items from test results
 */
function collectGalleryItems(results: TestResultData[]): GalleryItem[] {
  const items: GalleryItem[] = [];

  for (const test of results) {
    // Use new attachments format if available, otherwise fall back to legacy properties
    if (test.attachments) {
      // New format - use attachments object
      test.attachments.screenshots.forEach((screenshot, idx) => {
        items.push({
          id: `${test.testId}-screenshot-${idx}`,
          testTitle: test.title,
          testId: test.testId,
          status: test.status,
          dataUri: screenshot
        });
      });

      test.attachments.videos.forEach((video, idx) => {
        items.push({
          id: `${test.testId}-video-${idx}`,
          testTitle: test.title,
          testId: test.testId,
          status: test.status,
          videoPath: video
        });
      });

      test.attachments.traces.forEach((trace, idx) => {
        items.push({
          id: `${test.testId}-trace-${idx}`,
          testTitle: test.title,
          testId: test.testId,
          status: test.status,
          tracePath: trace
        });
      });
    } else {
      // Legacy format - use individual properties
      if (test.screenshot) {
        items.push({
          id: `${test.testId}-screenshot`,
          testTitle: test.title,
          testId: test.testId,
          status: test.status,
          dataUri: test.screenshot
        });
      }

      if (test.videoPath) {
        items.push({
          id: `${test.testId}-video`,
          testTitle: test.title,
          testId: test.testId,
          status: test.status,
          videoPath: test.videoPath
        });
      }

      if (test.tracePath) {
        items.push({
          id: `${test.testId}-trace`,
          testTitle: test.title,
          testId: test.testId,
          status: test.status,
          tracePath: test.tracePath
        });
      }
    }
  }

  return items;
}

/**
 * Generate JavaScript for gallery functionality
 */
export function generateGalleryScript(): string {
  return `
    let currentLightboxIndex = 0;
    let lightboxItems = [];

    function filterGallery(type) {
      // Update filter buttons
      document.querySelectorAll('.gallery-filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.type === type);
      });

      // Filter gallery items
      document.querySelectorAll('.gallery-item').forEach(item => {
        const itemType = item.dataset.type;
        item.style.display = (type === 'all' || itemType === type) ? 'block' : 'none';
      });
    }

    function openLightbox(itemId) {
      const lightbox = document.getElementById('lightbox');
      const img = document.getElementById('lightbox-img');
      const title = document.getElementById('lightbox-title');
      const status = document.getElementById('lightbox-status');

      // Build array of all visible gallery items (screenshots and traces)
      lightboxItems = Array.from(document.querySelectorAll('.gallery-item'))
        .filter(item => item.style.display !== 'none');

      currentLightboxIndex = lightboxItems.findIndex(item => item.dataset.id === itemId);

      if (currentLightboxIndex >= 0) {
        const currentItem = lightboxItems[currentLightboxIndex];
        const imgSrc = currentItem.querySelector('img').src;
        const testTitle = currentItem.querySelector('.gallery-item-title').textContent;
        const testStatus = currentItem.querySelector('.gallery-item-status').textContent;

        img.src = imgSrc;
        title.textContent = testTitle;
        status.textContent = testStatus;
        status.className = 'lightbox-status ' + currentItem.querySelector('.gallery-item-status').className.split(' ')[1];

        lightbox.style.display = 'flex';
      }
    }

    function closeLightbox() {
      document.getElementById('lightbox').style.display = 'none';
    }

    function navigateLightbox(direction) {
      currentLightboxIndex += direction;

      if (currentLightboxIndex < 0) {
        currentLightboxIndex = lightboxItems.length - 1;
      } else if (currentLightboxIndex >= lightboxItems.length) {
        currentLightboxIndex = 0;
      }

      const currentItem = lightboxItems[currentLightboxIndex];
      openLightbox(currentItem.dataset.id);
    }

    // Keyboard navigation for lightbox
    document.addEventListener('keydown', (e) => {
      const lightbox = document.getElementById('lightbox');
      if (lightbox.style.display === 'flex') {
        if (e.key === 'Escape') closeLightbox();
        if (e.key === 'ArrowLeft') navigateLightbox(-1);
        if (e.key === 'ArrowRight') navigateLightbox(1);
      }
    });
  `;
}

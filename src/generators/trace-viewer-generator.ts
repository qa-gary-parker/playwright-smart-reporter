/**
 * Embedded Trace Viewer Generator
 * Builds a comprehensive trace viewer that matches Playwright's native viewer
 * Features: Timeline, Before/After snapshots, Console, Source, Network waterfall, Metadata
 */

import { JSZIP_SOURCE } from '../vendors/jszip-source';

/**
 * Generate the inlined JSZip script
 * This must be included before generateTraceViewerScript() in the HTML
 */
export function generateJSZipScript(): string {
  return `
    // JSZip v3.10.1 - inlined for self-contained reports
    ${JSZIP_SOURCE}
  `;
}

/**
 * Generate the embedded trace viewer HTML and styles
 */
export function generateTraceViewerHtml(): string {
  return `
  <div id="traceViewerModal" class="trace-modal" onclick="if(event.target === this) closeTraceModal()">
    <div class="trace-modal-content">
      <div class="trace-modal-header">
        <h3 class="trace-modal-title">
          <span class="trace-modal-icon">📊</span>
          <span id="traceViewerTitle">Trace Viewer</span>
        </h3>
        <div class="trace-header-controls">
          <button class="trace-btn trace-btn-small trace-btn-secondary" onclick="toggleFullscreen()" title="Toggle fullscreen">
            <span id="fullscreenIcon">⛶</span>
          </button>
          <button class="trace-modal-close" onclick="closeTraceModal()" aria-label="Close">&times;</button>
        </div>
      </div>
      <div class="trace-modal-body">
        <!-- Loading State -->
        <div id="traceLoading" class="trace-loading">
          <div class="trace-loading-spinner"></div>
          <p>Loading trace...</p>
        </div>

        <!-- Error State -->
        <div id="traceError" class="trace-error" style="display: none;">
          <div class="trace-error-icon">⚠️</div>
          <p id="traceErrorMessage">Failed to load trace</p>
          <div class="trace-error-actions">
            <button onclick="document.getElementById('traceFileInput').click()" class="trace-btn">
              📁 Load from file
            </button>
            <button id="traceCopyCmd" class="trace-btn trace-btn-secondary">
              📋 Copy CLI command
            </button>
          </div>
          <input type="file" id="traceFileInput" accept=".zip" style="display: none;" onchange="loadTraceFromFile(this.files[0])">
        </div>

        <!-- Trace Content -->
        <div id="traceContent" class="trace-content" style="display: none;">
          <!-- Timeline Filmstrip with Slider -->
          <div id="traceTimeline" class="trace-timeline">
            <div class="trace-timeline-scroll" id="traceTimelineScroll">
              <!-- Thumbnails inserted by JS -->
            </div>
            <div class="trace-timeline-slider-track" id="traceSliderTrack">
              <div class="trace-timeline-slider-thumb" id="traceSliderThumb"></div>
              <div class="trace-timeline-slider-progress" id="traceSliderProgress"></div>
            </div>
            <!-- Hover magnification preview -->
            <div class="trace-timeline-magnifier" id="traceTimelineMagnifier" style="display: none;">
              <img id="traceMagnifierImg" src="" alt="Preview" />
              <div class="trace-magnifier-time" id="traceMagnifierTime"></div>
            </div>
          </div>

          <div class="trace-layout">
            <!-- Actions Panel -->
            <div class="trace-actions-panel" id="traceActionsPanel">
              <div class="trace-actions-header">
                <span>Actions</span>
                <span id="traceActionCount" class="trace-count"></span>
              </div>
              <!-- Action Search -->
              <div class="trace-search-wrapper">
                <input type="text" id="traceActionSearch" class="trace-search-input" placeholder="Filter actions..." oninput="filterTraceActions(this.value)">
                <button class="trace-search-clear" id="traceSearchClear" onclick="clearActionSearch()" style="display: none;">&times;</button>
              </div>
              <div id="traceActionsList" class="trace-actions-list"></div>
            </div>

            <!-- Resizer -->
            <div class="trace-resizer" id="traceResizer"></div>

            <!-- Main View -->
            <div class="trace-main-panel">
              <!-- Screenshot/Preview with Before/After controls -->
              <div class="trace-screenshot-panel">
                <div class="trace-snapshot-controls" id="traceSnapshotControls" style="display: none;">
                  <button class="trace-snapshot-btn active" data-snapshot="after" onclick="switchSnapshot('after')">
                    After
                  </button>
                  <button class="trace-snapshot-btn" data-snapshot="before" onclick="switchSnapshot('before')">
                    Before
                  </button>
                  <span class="trace-snapshot-hint">Press B/A keys</span>
                </div>
                <div class="trace-screenshot-container" id="traceScreenshotContainer">
                  <img id="traceScreenshot" class="trace-screenshot" src="" alt="Action screenshot" />
                  <!-- Click position indicator -->
                  <div id="traceClickIndicator" class="trace-click-indicator" style="display: none;">
                    <div class="trace-click-dot"></div>
                    <div class="trace-click-ripple"></div>
                  </div>
                  <div id="traceNoScreenshot" class="trace-no-screenshot">
                    <span>No screenshot for this action</span>
                  </div>
                </div>
              </div>

              <!-- Details Tabs -->
              <div class="trace-details-panel">
                <div class="trace-tabs">
                  <button class="trace-tab active" data-tab="details" onclick="switchTraceTab('details')">Details</button>
                  <button class="trace-tab" data-tab="console" onclick="switchTraceTab('console')">
                    Console
                    <span id="traceConsoleCount" class="trace-tab-badge" style="display: none;"></span>
                  </button>
                  <button class="trace-tab" data-tab="source" onclick="switchTraceTab('source')">Source</button>
                  <button class="trace-tab" data-tab="network" onclick="switchTraceTab('network')">Network</button>
                  <button class="trace-tab" data-tab="metadata" onclick="switchTraceTab('metadata')">Metadata</button>
                  <button class="trace-tab" data-tab="errors" onclick="switchTraceTab('errors')">
                    Errors
                    <span id="traceErrorCount" class="trace-tab-badge trace-tab-badge-error" style="display: none;"></span>
                  </button>
                  <button class="trace-tab" data-tab="attachments" onclick="switchTraceTab('attachments')">
                    Attachments
                    <span id="traceAttachmentCount" class="trace-tab-badge" style="display: none;"></span>
                  </button>
                </div>
                <div class="trace-tab-content">
                  <div id="traceTabDetails" class="trace-tab-pane active">
                    <div id="traceDetailsContent"></div>
                  </div>
                  <div id="traceTabConsole" class="trace-tab-pane">
                    <div class="trace-console-controls">
                      <button class="trace-console-filter active" data-level="all" onclick="filterConsole('all')">All</button>
                      <button class="trace-console-filter" data-level="error" onclick="filterConsole('error')">Errors</button>
                      <button class="trace-console-filter" data-level="warning" onclick="filterConsole('warning')">Warnings</button>
                      <button class="trace-console-filter" data-level="log" onclick="filterConsole('log')">Info</button>
                    </div>
                    <div id="traceConsoleContent"></div>
                  </div>
                  <div id="traceTabSource" class="trace-tab-pane">
                    <div id="traceSourceContent"></div>
                  </div>
                  <div id="traceTabNetwork" class="trace-tab-pane">
                    <div class="trace-network-controls">
                      <input type="text" id="traceNetworkSearch" class="trace-network-search" placeholder="Filter by URL..." oninput="filterNetwork(this.value)">
                      <div class="trace-network-filters">
                        <button class="trace-network-filter active" data-type="all" onclick="filterNetworkType('all')">All</button>
                        <button class="trace-network-filter" data-type="xhr" onclick="filterNetworkType('xhr')">XHR</button>
                        <button class="trace-network-filter" data-type="doc" onclick="filterNetworkType('doc')">Doc</button>
                        <button class="trace-network-filter" data-type="css" onclick="filterNetworkType('css')">CSS</button>
                        <button class="trace-network-filter" data-type="js" onclick="filterNetworkType('js')">JS</button>
                        <button class="trace-network-filter" data-type="img" onclick="filterNetworkType('img')">Img</button>
                      </div>
                    </div>
                    <div id="traceNetworkContent"></div>
                  </div>
                  <div id="traceTabMetadata" class="trace-tab-pane">
                    <div id="traceMetadataContent"></div>
                  </div>
                  <div id="traceTabErrors" class="trace-tab-pane">
                    <div id="traceErrorsContent"></div>
                  </div>
                  <div id="traceTabAttachments" class="trace-tab-pane">
                    <div id="traceAttachmentsContent"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
  `;
}

/**
 * Generate trace viewer styles
 */
export function generateTraceViewerStyles(monoFont: string): string {
  return `
    /* Trace Viewer Modal */
    .trace-modal {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.9);
      z-index: 10000;
      justify-content: center;
      align-items: center;
      padding: 1rem;
    }

    .trace-modal.fullscreen {
      padding: 0;
    }

    .trace-modal.fullscreen .trace-modal-content {
      width: 100%;
      height: 100%;
      max-width: none;
      border-radius: 0;
    }

    .trace-modal-content {
      background: var(--bg-primary);
      border-radius: 12px;
      width: 95%;
      height: 92%;
      max-width: 1600px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      box-shadow: 0 25px 50px rgba(0, 0, 0, 0.5);
    }

    .trace-modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.75rem 1rem;
      background: var(--bg-card);
      border-bottom: 1px solid var(--border-subtle);
    }

    .trace-modal-title {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 1rem;
      font-weight: 600;
      color: var(--text-primary);
      margin: 0;
    }

    .trace-modal-icon {
      font-size: 1.2rem;
    }

    .trace-header-controls {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .trace-modal-close {
      background: none;
      border: none;
      font-size: 1.5rem;
      color: var(--text-muted);
      cursor: pointer;
      padding: 0.25rem 0.5rem;
      line-height: 1;
      transition: color 0.2s;
      border-radius: 4px;
    }

    .trace-modal-close:hover {
      color: var(--accent-red);
      background: rgba(255, 100, 100, 0.1);
    }

    .trace-modal-body {
      flex: 1;
      overflow: hidden;
      position: relative;
    }

    /* Loading State */
    .trace-loading {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      gap: 1rem;
      color: var(--text-muted);
    }

    .trace-loading-spinner {
      width: 40px;
      height: 40px;
      border: 3px solid var(--border-subtle);
      border-top-color: var(--accent-blue);
      border-radius: 50%;
      animation: trace-spin 1s linear infinite;
    }

    @keyframes trace-spin {
      to { transform: rotate(360deg); }
    }

    /* Error State */
    .trace-error {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      gap: 1rem;
      padding: 2rem;
      text-align: center;
    }

    .trace-error-icon {
      font-size: 3rem;
    }

    .trace-error p {
      color: var(--text-secondary);
      margin: 0;
    }

    .trace-error-actions {
      display: flex;
      gap: 0.75rem;
      margin-top: 1rem;
    }

    .trace-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.6rem 1.2rem;
      background: var(--accent-blue);
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 0.85rem;
      cursor: pointer;
      transition: all 0.2s;
    }

    .trace-btn:hover {
      background: var(--accent-blue-hover, #0095e0);
      transform: translateY(-1px);
    }

    .trace-btn-small {
      padding: 0.35rem 0.6rem;
      font-size: 0.8rem;
    }

    .trace-btn-secondary {
      background: var(--bg-card);
      color: var(--text-primary);
      border: 1px solid var(--border-subtle);
    }

    .trace-btn-secondary:hover {
      background: var(--bg-card-hover);
      border-color: var(--accent-blue);
    }

    /* Timeline Filmstrip */
    .trace-timeline {
      background: var(--bg-card);
      border-bottom: 1px solid var(--border-subtle);
      padding: 0.5rem;
      height: 72px;
      overflow: hidden;
    }

    .trace-timeline-scroll {
      display: flex;
      gap: 4px;
      overflow-x: auto;
      height: 100%;
      align-items: center;
      padding: 0 0.5rem;
      scroll-behavior: smooth;
    }

    .trace-timeline-scroll::-webkit-scrollbar {
      height: 6px;
    }

    .trace-timeline-scroll::-webkit-scrollbar-thumb {
      background: var(--border-subtle);
      border-radius: 3px;
    }

    .trace-timeline-thumb {
      flex-shrink: 0;
      width: 80px;
      height: 56px;
      border-radius: 4px;
      overflow: hidden;
      cursor: pointer;
      border: 3px solid transparent;
      transition: all 0.2s ease;
      position: relative;
      background: #1a1a2e;
      opacity: 0.6;
    }

    .trace-timeline-thumb:hover {
      border-color: var(--accent-blue);
      transform: scale(1.08);
      opacity: 0.9;
    }

    .trace-timeline-thumb.active {
      border-color: #00d4ff;
      box-shadow: 0 0 0 3px rgba(0, 212, 255, 0.4), 0 0 20px rgba(0, 212, 255, 0.3);
      transform: scale(1.1);
      opacity: 1;
      z-index: 10;
    }

    .trace-timeline-thumb.active::before {
      content: '';
      position: absolute;
      top: -3px;
      left: -3px;
      right: -3px;
      bottom: -3px;
      border: 2px solid #00d4ff;
      border-radius: 6px;
      animation: timeline-pulse 1.5s ease-in-out infinite;
    }

    @keyframes timeline-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    .trace-timeline-thumb.has-error {
      border-color: var(--accent-red);
    }

    .trace-timeline-thumb.has-error.active {
      border-color: var(--accent-red);
      box-shadow: 0 0 0 3px rgba(255, 107, 107, 0.4), 0 0 20px rgba(255, 107, 107, 0.3);
    }

    .trace-timeline-thumb.has-error::after {
      content: '●';
      position: absolute;
      top: 2px;
      right: 4px;
      color: var(--accent-red);
      font-size: 0.7rem;
      text-shadow: 0 0 4px var(--accent-red);
    }

    .trace-timeline-thumb img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .trace-timeline-placeholder {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--text-muted);
      font-size: 0.6rem;
    }

    /* Timeline Slider */
    .trace-timeline-slider-track {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      height: 4px;
      background: var(--border-subtle);
      cursor: pointer;
    }

    .trace-timeline-slider-progress {
      position: absolute;
      left: 0;
      top: 0;
      height: 100%;
      background: var(--accent-blue);
      pointer-events: none;
      width: 0%;
    }

    .trace-timeline-slider-thumb {
      position: absolute;
      top: 50%;
      transform: translate(-50%, -50%);
      width: 12px;
      height: 12px;
      background: var(--accent-blue);
      border: 2px solid white;
      border-radius: 50%;
      cursor: grab;
      z-index: 2;
      left: 0%;
    }

    .trace-timeline-slider-thumb:active {
      cursor: grabbing;
      transform: translate(-50%, -50%) scale(1.2);
    }

    /* Timeline Magnifier */
    .trace-timeline-magnifier {
      position: absolute;
      bottom: 100%;
      left: 50%;
      transform: translateX(-50%);
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      padding: 4px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      z-index: 100;
      pointer-events: none;
    }

    .trace-timeline-magnifier img {
      width: 200px;
      height: 140px;
      object-fit: contain;
      border-radius: 4px;
    }

    .trace-magnifier-time {
      text-align: center;
      font-size: 0.65rem;
      color: var(--text-muted);
      margin-top: 4px;
    }

    /* Click Position Indicator */
    .trace-click-indicator {
      position: absolute;
      pointer-events: none;
      z-index: 10;
    }

    .trace-click-dot {
      width: 12px;
      height: 12px;
      background: rgba(255, 0, 0, 0.8);
      border: 2px solid white;
      border-radius: 50%;
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    }

    .trace-click-ripple {
      width: 30px;
      height: 30px;
      border: 2px solid rgba(255, 0, 0, 0.5);
      border-radius: 50%;
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      animation: trace-click-ripple 1.5s ease-out infinite;
    }

    @keyframes trace-click-ripple {
      0% {
        width: 12px;
        height: 12px;
        opacity: 1;
      }
      100% {
        width: 40px;
        height: 40px;
        opacity: 0;
      }
    }

    /* Trace Content Layout */
    .trace-content {
      height: 100%;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    .trace-layout {
      display: flex;
      flex: 1;
      overflow: hidden;
    }

    /* Actions Panel */
    .trace-actions-panel {
      width: 280px;
      min-width: 200px;
      max-width: 400px;
      border-right: 1px solid var(--border-subtle);
      display: flex;
      flex-direction: column;
      background: var(--bg-secondary);
    }

    .trace-actions-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.75rem 1rem;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      background: var(--bg-card);
      border-bottom: 1px solid var(--border-subtle);
    }

    .trace-count {
      background: var(--bg-primary);
      padding: 0.2rem 0.5rem;
      border-radius: 10px;
      font-size: 0.7rem;
    }

    /* Action Search */
    .trace-search-wrapper {
      position: relative;
      padding: 0.5rem;
      background: var(--bg-card);
      border-bottom: 1px solid var(--border-subtle);
    }

    .trace-search-input {
      width: 100%;
      padding: 0.5rem 2rem 0.5rem 0.75rem;
      background: var(--bg-primary);
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      color: var(--text-primary);
      font-size: 0.8rem;
      outline: none;
    }

    .trace-search-input:focus {
      border-color: var(--accent-blue);
    }

    .trace-search-clear {
      position: absolute;
      right: 0.75rem;
      top: 50%;
      transform: translateY(-50%);
      background: none;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      font-size: 1rem;
      padding: 0.25rem;
    }

    .trace-search-clear:hover {
      color: var(--text-primary);
    }

    .trace-actions-list {
      flex: 1;
      overflow-y: auto;
      padding: 0.5rem;
    }

    .trace-action-item {
      display: flex;
      align-items: flex-start;
      gap: 0.75rem;
      padding: 0.6rem 0.75rem;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.15s;
      margin-bottom: 0.25rem;
    }

    .trace-action-item:hover {
      background: var(--bg-card-hover);
    }

    .trace-action-item.active {
      background: var(--accent-blue);
      color: white;
    }

    .trace-action-item.active .trace-action-time,
    .trace-action-item.active .trace-action-selector {
      color: rgba(255, 255, 255, 0.8);
    }

    .trace-action-item.has-error {
      border-left: 3px solid var(--accent-red);
    }

    .trace-action-item.filtered-out {
      display: none;
    }

    .trace-action-icon {
      font-size: 1rem;
      flex-shrink: 0;
      width: 24px;
      text-align: center;
    }

    .trace-action-info {
      flex: 1;
      min-width: 0;
    }

    .trace-action-name {
      font-size: 0.8rem;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .trace-action-name mark {
      background: rgba(255, 200, 50, 0.4);
      color: inherit;
      padding: 0 2px;
      border-radius: 2px;
    }

    .trace-action-selector {
      font-family: ${monoFont};
      font-size: 0.7rem;
      color: var(--text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-top: 0.15rem;
    }

    .trace-action-time {
      font-family: ${monoFont};
      font-size: 0.65rem;
      color: var(--text-muted);
      flex-shrink: 0;
    }

    .trace-action-duration-bar {
      height: 3px;
      background: var(--accent-blue);
      border-radius: 2px;
      margin-top: 4px;
      opacity: 0.5;
    }

    .trace-action-item.active .trace-action-duration-bar {
      background: rgba(255, 255, 255, 0.5);
    }

    /* Resizer */
    .trace-resizer {
      width: 4px;
      background: var(--border-subtle);
      cursor: col-resize;
      transition: background 0.2s;
    }

    .trace-resizer:hover,
    .trace-resizer.active {
      background: var(--accent-blue);
    }

    /* Main Panel */
    .trace-main-panel {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      min-width: 0;
    }

    /* Screenshot Panel */
    .trace-screenshot-panel {
      flex: 0 0 45%;
      min-height: 150px;
      max-height: 50%;
      background: #1a1a2e;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      position: relative;
    }

    .trace-snapshot-controls {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 1rem;
      background: rgba(0, 0, 0, 0.5);
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      z-index: 10;
    }

    .trace-snapshot-btn {
      padding: 0.35rem 0.75rem;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 4px;
      color: rgba(255, 255, 255, 0.7);
      font-size: 0.75rem;
      cursor: pointer;
      transition: all 0.15s;
    }

    .trace-snapshot-btn:hover {
      background: rgba(255, 255, 255, 0.2);
    }

    .trace-snapshot-btn.active {
      background: var(--accent-blue);
      border-color: var(--accent-blue);
      color: white;
    }

    .trace-snapshot-hint {
      margin-left: auto;
      font-size: 0.65rem;
      color: rgba(255, 255, 255, 0.4);
    }

    .trace-screenshot-container {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      padding: 1rem;
    }

    .trace-screenshot {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      border-radius: 4px;
    }

    .trace-screenshot.before-snapshot {
      border: 2px solid #f0ad4e;
    }

    .trace-screenshot.after-snapshot {
      border: 2px solid #5cb85c;
    }

    .trace-no-screenshot {
      color: var(--text-muted);
      font-size: 0.85rem;
    }

    /* Details Panel */
    .trace-details-panel {
      flex: 1;
      min-height: 200px;
      border-top: 1px solid var(--border-subtle);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      background: var(--bg-primary);
    }

    .trace-tabs {
      display: flex;
      gap: 0;
      background: var(--bg-card);
      border-bottom: 1px solid var(--border-subtle);
      padding: 0 0.5rem;
      flex-wrap: wrap;
    }

    .trace-tab {
      padding: 0.6rem 1rem;
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      color: var(--text-muted);
      font-size: 0.8rem;
      cursor: pointer;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }

    .trace-tab:hover {
      color: var(--text-primary);
    }

    .trace-tab.active {
      color: var(--accent-blue);
      border-bottom-color: var(--accent-blue);
    }

    .trace-tab-badge {
      background: var(--accent-blue);
      color: white;
      font-size: 0.65rem;
      padding: 0.1rem 0.4rem;
      border-radius: 8px;
      min-width: 18px;
      text-align: center;
    }

    .trace-tab-badge-error {
      background: var(--accent-red);
    }

    .trace-tab-content {
      flex: 1;
      overflow: hidden;
    }

    .trace-tab-pane {
      display: none;
      height: 100%;
      overflow-y: auto;
      padding: 1rem;
    }

    .trace-tab-pane.active {
      display: block;
    }

    /* Details Content */
    .trace-detail-row {
      display: flex;
      gap: 1rem;
      padding: 0.4rem 0;
      border-bottom: 1px solid var(--border-subtle);
      font-size: 0.8rem;
    }

    .trace-detail-row:last-child {
      border-bottom: none;
    }

    .trace-detail-label {
      color: var(--text-muted);
      width: 100px;
      flex-shrink: 0;
    }

    .trace-detail-value {
      color: var(--text-primary);
      font-family: ${monoFont};
      word-break: break-all;
    }

    /* Console Tab */
    .trace-console-controls {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 0.75rem;
      flex-wrap: wrap;
    }

    .trace-console-filter {
      padding: 0.3rem 0.6rem;
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 4px;
      color: var(--text-muted);
      font-size: 0.7rem;
      cursor: pointer;
      transition: all 0.15s;
    }

    .trace-console-filter:hover {
      border-color: var(--accent-blue);
    }

    .trace-console-filter.active {
      background: var(--accent-blue);
      border-color: var(--accent-blue);
      color: white;
    }

    .trace-console-item {
      display: flex;
      gap: 0.75rem;
      padding: 0.5rem;
      font-size: 0.75rem;
      border-bottom: 1px solid var(--border-subtle);
      border-radius: 4px;
      margin-bottom: 0.25rem;
    }

    .trace-console-item.log {
      background: transparent;
    }

    .trace-console-item.info {
      background: rgba(0, 169, 255, 0.05);
      border-left: 3px solid var(--accent-blue);
    }

    .trace-console-item.warning {
      background: rgba(255, 193, 7, 0.1);
      border-left: 3px solid #ffc107;
    }

    .trace-console-item.error {
      background: rgba(255, 100, 100, 0.1);
      border-left: 3px solid var(--accent-red);
    }

    .trace-console-item.debug {
      opacity: 0.6;
    }

    .trace-console-item.filtered-out {
      display: none;
    }

    .trace-console-icon {
      flex-shrink: 0;
      width: 16px;
      text-align: center;
    }

    .trace-console-time {
      font-family: ${monoFont};
      color: var(--text-muted);
      flex-shrink: 0;
      min-width: 50px;
    }

    .trace-console-message {
      font-family: ${monoFont};
      color: var(--text-primary);
      word-break: break-word;
      flex: 1;
    }

    .trace-console-location {
      font-family: ${monoFont};
      color: var(--text-muted);
      font-size: 0.65rem;
      flex-shrink: 0;
    }

    /* Source Tab */
    .trace-source-section {
      margin-bottom: 1.5rem;
    }

    .trace-source-title {
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.5rem;
    }

    .trace-source-location {
      font-family: ${monoFont};
      font-size: 0.8rem;
      color: var(--text-primary);
      padding: 0.75rem;
      background: var(--bg-card);
      border-radius: 6px;
      border-left: 3px solid var(--accent-blue);
    }

    .trace-stack-frame {
      font-family: ${monoFont};
      font-size: 0.75rem;
      padding: 0.4rem 0.75rem;
      border-bottom: 1px solid var(--border-subtle);
      color: var(--text-secondary);
    }

    .trace-stack-frame:last-child {
      border-bottom: none;
    }

    .trace-stack-frame.user-code {
      color: var(--text-primary);
      background: var(--bg-card);
    }

    .trace-stack-file {
      color: var(--accent-blue);
    }

    .trace-stack-line {
      color: var(--accent-green);
    }

    /* Network Tab */
    .trace-network-controls {
      margin-bottom: 0.75rem;
    }

    .trace-network-search {
      width: 100%;
      padding: 0.5rem 0.75rem;
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      color: var(--text-primary);
      font-size: 0.8rem;
      outline: none;
      margin-bottom: 0.5rem;
    }

    .trace-network-search:focus {
      border-color: var(--accent-blue);
    }

    .trace-network-filters {
      display: flex;
      gap: 0.25rem;
      flex-wrap: wrap;
    }

    .trace-network-filter {
      padding: 0.25rem 0.5rem;
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 4px;
      color: var(--text-muted);
      font-size: 0.65rem;
      cursor: pointer;
      transition: all 0.15s;
    }

    .trace-network-filter:hover {
      border-color: var(--accent-blue);
    }

    .trace-network-filter.active {
      background: var(--accent-blue);
      border-color: var(--accent-blue);
      color: white;
    }

    .trace-network-list {
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      overflow: hidden;
    }

    .trace-network-header {
      display: grid;
      grid-template-columns: 60px 1fr 200px 50px 60px;
      gap: 0.5rem;
      padding: 0.5rem 0.75rem;
      background: var(--bg-card);
      font-size: 0.7rem;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      border-bottom: 1px solid var(--border-subtle);
    }

    .trace-network-header-cell {
      cursor: pointer;
      user-select: none;
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }

    .trace-network-header-cell:hover {
      color: var(--text-primary);
    }

    .trace-network-header-cell.sorted {
      color: var(--accent-blue);
    }

    .trace-network-sort-icon {
      font-size: 0.5rem;
      opacity: 0.5;
    }

    .trace-network-header-cell.sorted .trace-network-sort-icon {
      opacity: 1;
    }

    .trace-network-item {
      display: grid;
      grid-template-columns: 60px 1fr 200px 50px 60px;
      gap: 0.5rem;
      padding: 0.5rem 0.75rem;
      font-size: 0.75rem;
      border-bottom: 1px solid var(--border-subtle);
      align-items: center;
      cursor: pointer;
      transition: background 0.15s;
    }

    .trace-network-item:hover {
      background: var(--bg-card-hover);
    }

    .trace-network-item:last-child {
      border-bottom: none;
    }

    .trace-network-item.filtered-out {
      display: none;
    }

    .trace-network-item.expanded {
      background: var(--bg-card);
    }

    .trace-network-method {
      font-family: ${monoFont};
      font-weight: 600;
      color: var(--accent-blue);
    }

    .trace-network-method.post { color: #4caf50; }
    .trace-network-method.put { color: #ff9800; }
    .trace-network-method.delete { color: #f44336; }
    .trace-network-method.patch { color: #9c27b0; }

    .trace-network-url {
      font-family: ${monoFont};
      color: var(--text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .trace-network-waterfall {
      height: 16px;
      display: flex;
      align-items: center;
      position: relative;
    }

    .trace-waterfall-bar {
      height: 8px;
      border-radius: 2px;
      position: absolute;
      min-width: 2px;
    }

    .trace-waterfall-dns { background: #8bc34a; }
    .trace-waterfall-connect { background: #ff9800; }
    .trace-waterfall-ssl { background: #9c27b0; }
    .trace-waterfall-wait { background: #2196f3; }
    .trace-waterfall-receive { background: #00bcd4; }

    .trace-network-status {
      font-family: ${monoFont};
      text-align: center;
      padding: 0.15rem 0.4rem;
      border-radius: 4px;
      font-size: 0.7rem;
    }

    .trace-network-status.success {
      background: rgba(0, 200, 100, 0.2);
      color: var(--accent-green);
    }

    .trace-network-status.redirect {
      background: rgba(255, 193, 7, 0.2);
      color: #ffc107;
    }

    .trace-network-status.error {
      background: rgba(255, 100, 100, 0.2);
      color: var(--accent-red);
    }

    .trace-network-time {
      font-family: ${monoFont};
      color: var(--text-muted);
      text-align: right;
    }

    /* Network Details (expanded) */
    .trace-network-details {
      grid-column: 1 / -1;
      padding: 0.75rem;
      background: var(--bg-secondary);
      border-top: 1px solid var(--border-subtle);
      display: none;
    }

    .trace-network-item.expanded .trace-network-details {
      display: block;
    }

    .trace-network-details-section {
      margin-bottom: 1rem;
    }

    .trace-network-details-section:last-child {
      margin-bottom: 0;
    }

    .trace-network-details-title {
      font-size: 0.7rem;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      margin-bottom: 0.5rem;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .trace-network-details-title::before {
      content: '▶';
      font-size: 0.5rem;
      transition: transform 0.15s;
    }

    .trace-network-details-section.expanded .trace-network-details-title::before {
      transform: rotate(90deg);
    }

    .trace-network-details-content {
      display: none;
      font-family: ${monoFont};
      font-size: 0.75rem;
      background: var(--bg-primary);
      border-radius: 4px;
      padding: 0.5rem;
      max-height: 200px;
      overflow-y: auto;
    }

    .trace-network-details-section.expanded .trace-network-details-content {
      display: block;
    }

    .trace-header-row {
      display: flex;
      padding: 0.2rem 0;
      border-bottom: 1px solid var(--border-subtle);
    }

    .trace-header-row:last-child {
      border-bottom: none;
    }

    .trace-header-name {
      color: var(--accent-blue);
      min-width: 180px;
      flex-shrink: 0;
    }

    .trace-header-value {
      color: var(--text-primary);
      word-break: break-all;
    }

    .trace-request-body {
      white-space: pre-wrap;
      word-break: break-all;
      color: var(--text-primary);
    }

    /* Metadata Tab */
    .trace-metadata-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
      gap: 1rem;
    }

    .trace-metadata-card {
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      padding: 1rem;
    }

    .trace-metadata-card-title {
      font-size: 0.7rem;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.75rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .trace-metadata-row {
      display: flex;
      justify-content: space-between;
      padding: 0.35rem 0;
      border-bottom: 1px solid var(--border-subtle);
      font-size: 0.8rem;
    }

    .trace-metadata-row:last-child {
      border-bottom: none;
    }

    .trace-metadata-label {
      color: var(--text-muted);
    }

    .trace-metadata-value {
      color: var(--text-primary);
      font-family: ${monoFont};
      text-align: right;
    }

    /* Errors Tab */
    .trace-error-item {
      background: rgba(255, 100, 100, 0.1);
      border: 1px solid rgba(255, 100, 100, 0.3);
      border-radius: 6px;
      padding: 0.75rem;
      margin-bottom: 0.75rem;
    }

    .trace-error-action {
      font-size: 0.75rem;
      color: var(--text-muted);
      margin-bottom: 0.5rem;
    }

    .trace-error-name {
      font-weight: 600;
      color: var(--accent-red);
      font-size: 0.85rem;
      margin-bottom: 0.5rem;
    }

    .trace-error-message {
      font-family: ${monoFont};
      font-size: 0.8rem;
      color: var(--text-primary);
      white-space: pre-wrap;
      word-break: break-word;
    }

    .trace-empty {
      color: var(--text-muted);
      font-size: 0.85rem;
      text-align: center;
      padding: 2rem;
    }

    /* Waterfall legend */
    .trace-waterfall-legend {
      display: flex;
      gap: 1rem;
      padding: 0.5rem 0.75rem;
      background: var(--bg-card);
      border-top: 1px solid var(--border-subtle);
      font-size: 0.65rem;
      color: var(--text-muted);
    }

    .trace-waterfall-legend-item {
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }

    .trace-waterfall-legend-color {
      width: 12px;
      height: 8px;
      border-radius: 2px;
    }

    /* Attachments Tab */
    .trace-attachments-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 1rem;
    }

    .trace-attachment-card {
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      overflow: hidden;
      transition: all 0.15s;
    }

    .trace-attachment-card:hover {
      border-color: var(--accent-blue);
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }

    .trace-attachment-preview {
      height: 120px;
      background: #1a1a2e;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }

    .trace-attachment-preview img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }

    .trace-attachment-preview-icon {
      font-size: 2.5rem;
      opacity: 0.5;
    }

    .trace-attachment-info {
      padding: 0.75rem;
    }

    .trace-attachment-name {
      font-size: 0.8rem;
      font-weight: 500;
      color: var(--text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-bottom: 0.25rem;
    }

    .trace-attachment-meta {
      font-size: 0.7rem;
      color: var(--text-muted);
    }

    .trace-attachment-actions {
      display: flex;
      gap: 0.5rem;
      margin-top: 0.5rem;
    }

    .trace-attachment-btn {
      flex: 1;
      padding: 0.35rem 0.5rem;
      background: var(--bg-primary);
      border: 1px solid var(--border-subtle);
      border-radius: 4px;
      color: var(--text-secondary);
      font-size: 0.7rem;
      cursor: pointer;
      text-align: center;
      transition: all 0.15s;
    }

    .trace-attachment-btn:hover {
      background: var(--accent-blue);
      border-color: var(--accent-blue);
      color: white;
    }

    /* Image comparison slider */
    .trace-image-compare {
      position: relative;
      overflow: hidden;
      border-radius: 6px;
    }

    .trace-image-compare img {
      display: block;
      width: 100%;
    }

    .trace-image-compare-overlay {
      position: absolute;
      top: 0;
      left: 0;
      bottom: 0;
      width: 50%;
      overflow: hidden;
      border-right: 2px solid var(--accent-blue);
    }

    .trace-image-compare-overlay img {
      position: absolute;
      top: 0;
      left: 0;
      width: 200%;
    }

    .trace-image-compare-slider {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 4px;
      background: var(--accent-blue);
      cursor: ew-resize;
      left: 50%;
      transform: translateX(-50%);
    }

    .trace-image-compare-slider::before {
      content: '⟷';
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: var(--accent-blue);
      color: white;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.7rem;
    }
  `;
}

/**
 * Generate trace viewer JavaScript
 */
export function generateTraceViewerScript(): string {
  return `
    // Trace Viewer State
    let traceData = null;
    let traceResources = {};
    let traceScreenshots = new Map();
    let traceAttachments = [];
    let currentActionIndex = 0;
    let currentTracePath = '';
    let currentSnapshotMode = 'after';
    let currentConsoleFilter = 'all';
    let currentNetworkFilter = '';
    let currentNetworkType = 'all';
    let actionSearchTerm = '';
    let maxActionDuration = 0;

    // JSZip is inlined below - no CDN required
    let JSZip = null;

    function initJSZip() {
      if (JSZip) return;
      if (window.JSZip) {
        JSZip = window.JSZip;
        return;
      }
    }

    async function loadJSZip() {
      if (JSZip) return JSZip;
      if (window.JSZip) {
        JSZip = window.JSZip;
        return JSZip;
      }
      throw new Error('JSZip not available');
    }

    function viewTraceFromEl(el) {
      const tracePath = el.dataset.trace;
      if (tracePath) {
        openTraceModal(tracePath);
      }
      return false;
    }

    async function openTraceModal(tracePath) {
      const modal = document.getElementById('traceViewerModal');
      if (!modal) return;

      currentTracePath = tracePath;
      modal.style.display = 'flex';
      document.body.style.overflow = 'hidden';

      // Update title
      const title = document.getElementById('traceViewerTitle');
      if (title) {
        const fileName = tracePath.split(/[\\\\/]/).pop() || 'Trace';
        title.textContent = fileName;
      }

      // Show loading
      showTraceState('loading');

      // Set up copy command button
      const copyCmd = document.getElementById('traceCopyCmd');
      if (copyCmd) {
        copyCmd.onclick = () => {
          const cmd = 'npx playwright show-trace "' + tracePath + '"';
          navigator.clipboard.writeText(cmd).then(() => {
            copyCmd.textContent = '✓ Copied!';
            setTimeout(() => { copyCmd.textContent = '📋 Copy CLI command'; }, 2000);
          }).catch(() => {
            window.prompt('Run this command:', cmd);
          });
        };
      }

      try {
        console.log('[TraceViewer] Loading JSZip...');
        await loadJSZip();
        console.log('[TraceViewer] JSZip loaded, fetching trace:', tracePath);

        // Fetch the trace file
        const response = await fetch(tracePath);
        console.log('[TraceViewer] Fetch response:', response.status, response.statusText);
        if (!response.ok) throw new Error('Failed to fetch trace: ' + response.status + ' ' + response.statusText);

        const blob = await response.blob();
        console.log('[TraceViewer] Blob size:', blob.size);
        await loadTraceFromBlob(blob);
        console.log('[TraceViewer] Trace loaded successfully');
      } catch (err) {
        console.error('[TraceViewer] Error:', err);
        showTraceError(err.message || 'Failed to load trace');
      }
    }

    async function loadTraceFromFile(file) {
      if (!file) return;
      showTraceState('loading');
      try {
        await loadJSZip();
        await loadTraceFromBlob(file);
      } catch (err) {
        showTraceError(err.message || 'Failed to load trace file');
      }
    }

    async function loadTraceFromBlob(blob) {
      const zip = await JSZip.loadAsync(blob);

      // Find and parse trace file
      let traceContent = null;
      for (const fileName of Object.keys(zip.files)) {
        if (fileName.endsWith('-trace.trace') || fileName === 'trace.trace') {
          traceContent = await zip.files[fileName].async('string');
          break;
        }
      }

      if (!traceContent) {
        if (zip.files['0-trace.trace']) {
          traceContent = await zip.files['0-trace.trace'].async('string');
        }
      }

      if (!traceContent) {
        throw new Error('No trace data found in ZIP');
      }

      // Parse NDJSON trace
      const events = traceContent.trim().split('\\n').map(line => {
        try { return JSON.parse(line); } catch { return null; }
      }).filter(Boolean);

      // Extract resources (screenshots)
      traceResources = {};
      traceScreenshots = new Map();
      for (const fileName of Object.keys(zip.files)) {
        if (fileName.startsWith('resources/')) {
          const key = fileName.split('/').pop();
          if (fileName.endsWith('.jpeg') || fileName.endsWith('.png')) {
            const data = await zip.files[fileName].async('base64');
            const ext = fileName.endsWith('.png') ? 'png' : 'jpeg';
            traceResources[key] = 'data:image/' + ext + ';base64,' + data;
          }
        }
      }

      // Parse stack traces if available
      // Format: {"files":["path1.ts"], "stacks":[[callId, [[fileIdx, line, col, func]]]]}
      let stackData = { files: [], stacks: [] };
      if (zip.files['0-trace.stacks']) {
        try {
          const stackContent = await zip.files['0-trace.stacks'].async('string');
          stackData = JSON.parse(stackContent);
        } catch (e) {
          console.warn('[TraceViewer] Failed to parse stacks:', e);
        }
      }

      // Parse network data if available
      // Format: NDJSON with {"type":"resource-snapshot","snapshot":{...HAR entry...}}
      let networkData = [];
      if (zip.files['0-trace.network']) {
        try {
          const networkContent = await zip.files['0-trace.network'].async('string');
          const lines = networkContent.trim().split('\\n');
          for (const line of lines) {
            try {
              const entry = JSON.parse(line);
              if (entry.type === 'resource-snapshot' && entry.snapshot) {
                const snap = entry.snapshot;
                const req = snap.request || {};
                const res = snap.response || {};
                const timings = snap.timings || {};
                networkData.push({
                  method: req.method || 'GET',
                  url: req.url || '',
                  status: res.status || 0,
                  statusText: res.statusText || '',
                  time: snap.time || 0,
                  startedDateTime: snap.startedDateTime,
                  timings: {
                    dns: Math.max(0, timings.dns || 0),
                    connect: Math.max(0, timings.connect || 0),
                    ssl: Math.max(0, timings.ssl || 0),
                    wait: Math.max(0, timings.wait || 0),
                    receive: Math.max(0, timings.receive || 0)
                  },
                  requestHeaders: req.headers || [],
                  responseHeaders: res.headers || [],
                  requestBody: req.postData?.text || null,
                  responseSize: res.content?.size || res.bodySize || 0,
                  mimeType: res.content?.mimeType || ''
                });
              }
            } catch {}
          }
        } catch (e) {
          console.warn('[TraceViewer] Failed to parse network data:', e);
        }
      }

      // Process trace data
      traceData = processTraceEvents(events, networkData, stackData);

      // Render
      renderTraceViewer();
      showTraceState('content');
    }

    function processTraceEvents(events, networkData, stackData) {
      const actions = [];
      const logs = [];
      const errors = [];
      const consoleEntries = [];
      const screenshots = new Map();
      let contextInfo = null;
      let metadata = {
        browserName: 'Unknown',
        browserVersion: '',
        viewport: { width: 0, height: 0 },
        platform: 'Unknown',
        locale: '',
        testName: '',
        testFile: '',
        duration: 0
      };

      // Build stack map by callId number
      // Format: stackData = {files: ["path.ts"], stacks: [[callIdNum, [[fileIdx, line, col, func]]]]}
      const stackMap = new Map();
      const stackFiles = stackData.files || [];
      for (const [callIdNum, frames] of (stackData.stacks || [])) {
        // Convert compact frame format to objects
        const frameObjects = (frames || []).map(f => ({
          file: stackFiles[f[0]] || 'unknown',
          line: f[1] || 0,
          column: f[2] || 0,
          function: f[3] || ''
        }));
        stackMap.set(callIdNum, frameObjects);
      }

      // First pass: collect screenshots and context info
      for (const event of events) {
        if (event.type === 'screencast-frame') {
          screenshots.set(event.timestamp, {
            sha1: event.sha1,
            timestamp: event.timestamp
          });
          traceScreenshots.set(event.timestamp, event.sha1);
        }
        if (event.type === 'context-options') {
          contextInfo = event;
          if (event.browserName) metadata.browserName = event.browserName;
          if (event.browserVersion) metadata.browserVersion = event.browserVersion;
          if (event.viewport) metadata.viewport = event.viewport;
          if (event.platform) metadata.platform = event.platform;
          if (event.locale) metadata.locale = event.locale;
        }
        if (event.type === 'stdio') {
          consoleEntries.push({
            type: event.messageType || 'log',
            text: event.text || '',
            timestamp: event.timestamp || 0,
            location: event.location || ''
          });
        }
        if (event.type === 'console') {
          consoleEntries.push({
            type: event.messageType || 'log',
            text: event.text || (event.args ? event.args.map(a => a.preview || a.value || '').join(' ') : ''),
            timestamp: event.timestamp || 0,
            location: event.location ? event.location.url + ':' + event.location.lineNumber : ''
          });
        }
      }

      // Second pass: build actions
      const beforeEvents = new Map();
      let startTime = Infinity;
      let endTime = 0;

      for (const event of events) {
        if (event.type === 'before') {
          beforeEvents.set(event.callId, event);
          if (event.startTime < startTime) startTime = event.startTime;
        }
        if (event.type === 'after') {
          const before = beforeEvents.get(event.callId);
          if (before) {
            if (event.endTime > endTime) endTime = event.endTime;

            const action = {
              callId: event.callId,
              class: before.class,
              method: before.method,
              params: before.params,
              startTime: before.startTime,
              endTime: event.endTime,
              duration: Math.round(event.endTime - before.startTime),
              result: event.result,
              error: event.error,
              title: before.title || (before.class + '.' + before.method),
              beforeSnapshot: before.beforeSnapshot,
              afterSnapshot: event.afterSnapshot,
              // callId is like "call@23" - extract the number to match stackMap
              stack: stackMap.get(parseInt(event.callId.split('@')[1]) || 0) || [],
              point: event.point
            };

            // Find screenshots for before/after the action
            // Before: latest screenshot taken before the action started
            // After: first screenshot taken after the action completed
            let closestBeforeScreenshot = null;
            let closestAfterScreenshot = null;
            let closestBeforeTime = -Infinity;

            const sortedScreenshots = Array.from(screenshots.entries()).sort((a, b) => a[0] - b[0]);

            for (const [ts, data] of sortedScreenshots) {
              // Before: latest screenshot before action started
              if (ts < before.startTime) {
                if (ts > closestBeforeTime) {
                  closestBeforeTime = ts;
                  closestBeforeScreenshot = data.sha1;
                }
              }
              // After: first screenshot at or after action END time (when action completed)
              if (ts >= event.endTime && !closestAfterScreenshot) {
                closestAfterScreenshot = data.sha1;
              }
            }

            // If we still don't have an after screenshot, use the last screenshot before
            if (!closestAfterScreenshot && closestBeforeScreenshot) {
              closestAfterScreenshot = closestBeforeScreenshot;
            }

            // If we don't have a before screenshot, use the first after screenshot
            if (!closestBeforeScreenshot && closestAfterScreenshot) {
              closestBeforeScreenshot = closestAfterScreenshot;
            }

            action.beforeScreenshot = closestBeforeScreenshot;
            action.afterScreenshot = closestAfterScreenshot;
            action.screenshot = closestAfterScreenshot || closestBeforeScreenshot;

            actions.push(action);

            if (event.error) {
              errors.push({
                action: action.title,
                name: event.error.name || 'Error',
                message: event.error.message || 'Unknown error',
                stack: event.error.stack || ''
              });
            }
          }
        }
        if (event.type === 'log') {
          logs.push({
            time: event.time,
            message: event.message
          });
        }
      }

      // Calculate metadata duration
      metadata.duration = endTime - startTime;

      // Calculate max duration for relative bars
      maxActionDuration = Math.max(...actions.map(a => a.duration), 1);

      // Sort console entries by timestamp
      consoleEntries.sort((a, b) => a.timestamp - b.timestamp);

      return {
        actions,
        logs,
        errors,
        network: networkData,
        console: consoleEntries,
        metadata,
        contextInfo,
        startTime,
        endTime
      };
    }

    function renderTraceViewer() {
      if (!traceData) return;

      // Render timeline
      renderTimeline();

      // Render actions list
      renderActionsList();

      // Update count
      const countEl = document.getElementById('traceActionCount');
      if (countEl) countEl.textContent = traceData.actions.length;

      // Select first action
      if (traceData.actions.length > 0) {
        selectTraceAction(0);
      }

      // Render static tabs
      renderErrorsTab();
      renderMetadataTab();
      renderNetworkTab();
      renderConsoleTab();
      renderAttachmentsTab();

      // Update badges
      updateTabBadges();

      // Set up panel resizing
      setupPanelResizer();

      // Set up timeline slider
      setupTimelineSlider();

      // Set up timeline hover magnification
      setupTimelineMagnifier();
    }

    function renderTimeline() {
      const container = document.getElementById('traceTimelineScroll');
      if (!container || !traceData) return;

      // Get all unique screenshots in order
      const screenshotTimes = Array.from(traceScreenshots.keys()).sort((a, b) => a - b);

      // Sample if too many (show ~20-30 thumbnails)
      let sampled = screenshotTimes;
      if (screenshotTimes.length > 30) {
        const step = Math.ceil(screenshotTimes.length / 30);
        sampled = screenshotTimes.filter((_, i) => i % step === 0);
      }

      // Find which actions have errors
      const errorActionIndices = new Set(
        traceData.actions.map((a, i) => a.error ? i : -1).filter(i => i >= 0)
      );

      // Create thumbnail for each screenshot
      container.innerHTML = sampled.map((ts, idx) => {
        const sha1 = traceScreenshots.get(ts);
        const src = traceResources[sha1] || '';

        // Find closest action to this timestamp
        let closestActionIdx = 0;
        let closestDiff = Infinity;
        for (let i = 0; i < traceData.actions.length; i++) {
          const diff = Math.abs(traceData.actions[i].startTime - ts);
          if (diff < closestDiff) {
            closestDiff = diff;
            closestActionIdx = i;
          }
        }

        const hasError = errorActionIndices.has(closestActionIdx);

        return \`
          <div class="trace-timeline-thumb \${hasError ? 'has-error' : ''}"
               data-index="\${closestActionIdx}"
               data-timestamp="\${ts}"
               onclick="jumpToTimelineFrame(\${closestActionIdx}, \${idx})">
            \${src ? \`<img src="\${src}" alt="Frame">\` : '<div class="trace-timeline-placeholder">No img</div>'}
          </div>
        \`;
      }).join('');
    }

    function jumpToTimelineFrame(actionIndex, thumbIndex) {
      selectTraceAction(actionIndex);

      // Update active state on timeline
      document.querySelectorAll('.trace-timeline-thumb').forEach((el, i) => {
        el.classList.toggle('active', i === thumbIndex);
      });
    }

    function renderActionsList() {
      const actionsList = document.getElementById('traceActionsList');
      if (!actionsList || !traceData) return;

      actionsList.innerHTML = traceData.actions.map((action, idx) => {
        const icon = getActionIcon(action.method);
        const selector = action.params?.selector || action.params?.url || '';
        const hasError = !!action.error;
        const durationPercent = (action.duration / maxActionDuration) * 100;

        return \`
          <div class="trace-action-item \${idx === 0 ? 'active' : ''} \${hasError ? 'has-error' : ''}"
               onclick="selectTraceAction(\${idx})" data-index="\${idx}">
            <span class="trace-action-icon">\${icon}</span>
            <div class="trace-action-info">
              <div class="trace-action-name">\${escapeHtmlTrace(action.title || action.method)}</div>
              \${selector ? \`<div class="trace-action-selector">\${escapeHtmlTrace(selector.substring(0, 50))}</div>\` : ''}
              <div class="trace-action-duration-bar" style="width: \${durationPercent}%"></div>
            </div>
            <span class="trace-action-time">\${action.duration}ms</span>
          </div>
        \`;
      }).join('');
    }

    function selectTraceAction(index) {
      if (!traceData || index >= traceData.actions.length) return;

      currentActionIndex = index;
      const action = traceData.actions[index];

      // Update active state in actions list
      document.querySelectorAll('.trace-action-item').forEach((el, i) => {
        el.classList.toggle('active', i === index);
      });

      // Scroll action into view
      const activeItem = document.querySelector('.trace-action-item.active');
      if (activeItem) {
        activeItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }

      // Update timeline active state
      const timelineThumbs = document.querySelectorAll('.trace-timeline-thumb');
      let closestThumbIdx = 0;
      let closestDiff = Infinity;
      timelineThumbs.forEach((thumb, i) => {
        const thumbActionIdx = parseInt(thumb.dataset.index) || 0;
        const diff = Math.abs(thumbActionIdx - index);
        if (diff < closestDiff) {
          closestDiff = diff;
          closestThumbIdx = i;
        }
      });
      timelineThumbs.forEach((el, i) => {
        el.classList.toggle('active', i === closestThumbIdx);
      });

      // Scroll timeline to active thumb
      const activeThumb = document.querySelector('.trace-timeline-thumb.active');
      if (activeThumb) {
        activeThumb.scrollIntoView({ block: 'nearest', behavior: 'smooth', inline: 'center' });
      }

      // Update snapshot controls visibility - show if action has any screenshot
      const snapshotControls = document.getElementById('traceSnapshotControls');
      if (snapshotControls) {
        const hasScreenshots = action.beforeScreenshot || action.afterScreenshot || action.screenshot;
        snapshotControls.style.display = hasScreenshots ? 'flex' : 'none';

        // Update button states to show which snapshots are available
        const beforeBtn = snapshotControls.querySelector('[data-snapshot="before"]');
        const afterBtn = snapshotControls.querySelector('[data-snapshot="after"]');
        if (beforeBtn) {
          beforeBtn.disabled = !action.beforeScreenshot;
          beforeBtn.style.opacity = action.beforeScreenshot ? '1' : '0.5';
        }
        if (afterBtn) {
          afterBtn.disabled = !action.afterScreenshot && !action.screenshot;
          afterBtn.style.opacity = (action.afterScreenshot || action.screenshot) ? '1' : '0.5';
        }
      }

      // Update screenshot
      updateScreenshot(action);

      // Update details tab
      updateDetailsTab(action);

      // Update source tab
      updateSourceTab(action);

      // Update logs for this action's timeframe
      updateLogsForAction(action);

      // Update timeline slider position
      updateTimelineSlider(index);

      // Show click position indicator if action has point data
      showClickPosition(action);
    }

    function updateScreenshot(action) {
      const screenshotEl = document.getElementById('traceScreenshot');
      const noScreenshotEl = document.getElementById('traceNoScreenshot');

      // Determine which screenshot to show based on mode
      let screenshot = currentSnapshotMode === 'before' ? action.beforeScreenshot : action.afterScreenshot;
      if (!screenshot) screenshot = action.screenshot;

      // If no screenshot for this action, find the nearest one from other actions
      if (!screenshot || !traceResources[screenshot]) {
        screenshot = findNearestScreenshot(action);
      }

      if (screenshot && traceResources[screenshot]) {
        screenshotEl.src = traceResources[screenshot];
        screenshotEl.style.display = 'block';
        noScreenshotEl.style.display = 'none';

        // Update snapshot visual indicator
        screenshotEl.classList.remove('before-snapshot', 'after-snapshot');
        if (currentSnapshotMode === 'before' && action.beforeScreenshot) {
          screenshotEl.classList.add('before-snapshot');
        } else if (currentSnapshotMode === 'after' && action.afterScreenshot) {
          screenshotEl.classList.add('after-snapshot');
        }
      } else {
        screenshotEl.style.display = 'none';
        noScreenshotEl.style.display = 'flex';
      }
    }

    function findNearestScreenshot(targetAction) {
      if (!traceData || !traceData.actions) return null;

      const targetTime = targetAction.startTime || 0;
      let nearestScreenshot = null;
      let nearestDiff = Infinity;

      // Search through all actions to find the nearest screenshot
      for (const action of traceData.actions) {
        const candidates = [action.screenshot, action.afterScreenshot, action.beforeScreenshot];
        for (const screenshot of candidates) {
          if (screenshot && traceResources[screenshot]) {
            const actionTime = action.startTime || 0;
            const diff = Math.abs(actionTime - targetTime);
            if (diff < nearestDiff) {
              nearestDiff = diff;
              nearestScreenshot = screenshot;
            }
          }
        }
      }

      return nearestScreenshot;
    }

    function switchSnapshot(mode) {
      currentSnapshotMode = mode;

      // Update button states
      document.querySelectorAll('.trace-snapshot-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.snapshot === mode);
      });

      // Update screenshot
      if (traceData && traceData.actions[currentActionIndex]) {
        updateScreenshot(traceData.actions[currentActionIndex]);
      }
    }

    function updateDetailsTab(action) {
      const detailsContent = document.getElementById('traceDetailsContent');
      if (!detailsContent) return;

      let html = \`
        <div class="trace-detail-row">
          <span class="trace-detail-label">Action</span>
          <span class="trace-detail-value">\${escapeHtmlTrace(action.class + '.' + action.method)}</span>
        </div>
        <div class="trace-detail-row">
          <span class="trace-detail-label">Duration</span>
          <span class="trace-detail-value">\${action.duration}ms</span>
        </div>
      \`;

      if (action.params) {
        for (const [key, value] of Object.entries(action.params)) {
          if (value !== null && value !== undefined) {
            const displayValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
            html += \`
              <div class="trace-detail-row">
                <span class="trace-detail-label">\${escapeHtmlTrace(key)}</span>
                <span class="trace-detail-value">\${escapeHtmlTrace(displayValue.substring(0, 300))}</span>
              </div>
            \`;
          }
        }
      }

      if (action.result && typeof action.result === 'object') {
        html += \`
          <div class="trace-detail-row">
            <span class="trace-detail-label">Result</span>
            <span class="trace-detail-value">\${escapeHtmlTrace(JSON.stringify(action.result).substring(0, 200))}</span>
          </div>
        \`;
      }

      if (action.error) {
        html += \`
          <div class="trace-detail-row">
            <span class="trace-detail-label">Error</span>
            <span class="trace-detail-value" style="color: var(--accent-red)">\${escapeHtmlTrace(action.error.message)}</span>
          </div>
        \`;
      }

      detailsContent.innerHTML = html;
    }

    function updateSourceTab(action) {
      const sourceContent = document.getElementById('traceSourceContent');
      if (!sourceContent) return;

      if (!action.stack || action.stack.length === 0) {
        sourceContent.innerHTML = '<div class="trace-empty">No source information available</div>';
        return;
      }

      // Find user code frames (not from node_modules)
      const userFrames = action.stack.filter(f =>
        f.file && !f.file.includes('node_modules') && !f.file.includes('internal/')
      );
      const internalFrames = action.stack.filter(f =>
        !f.file || f.file.includes('node_modules') || f.file.includes('internal/')
      );

      let html = '';

      if (userFrames.length > 0) {
        html += \`
          <div class="trace-source-section">
            <div class="trace-source-title">📍 Test Code</div>
            <div class="trace-source-location">
              \${userFrames.map(f => \`
                <div class="trace-stack-frame user-code">
                  at <span class="trace-stack-file">\${escapeHtmlTrace(f.file || 'unknown')}</span>:<span class="trace-stack-line">\${f.line || 0}</span>:\${f.column || 0}
                  \${f.function ? ' (' + escapeHtmlTrace(f.function) + ')' : ''}
                </div>
              \`).join('')}
            </div>
          </div>
        \`;
      }

      if (internalFrames.length > 0) {
        html += \`
          <div class="trace-source-section">
            <div class="trace-source-title">📚 Framework Stack</div>
            <div style="max-height: 150px; overflow-y: auto;">
              \${internalFrames.slice(0, 10).map(f => \`
                <div class="trace-stack-frame">
                  at \${escapeHtmlTrace(f.file || 'unknown')}:\${f.line || 0}
                </div>
              \`).join('')}
              \${internalFrames.length > 10 ? '<div class="trace-stack-frame">... ' + (internalFrames.length - 10) + ' more frames</div>' : ''}
            </div>
          </div>
        \`;
      }

      sourceContent.innerHTML = html || '<div class="trace-empty">No source information available</div>';
    }

    function updateLogsForAction(action) {
      const logsContent = document.getElementById('traceLogsContent');
      if (!logsContent || !traceData) return;

      const actionLogs = traceData.logs.filter(log =>
        log.time >= action.startTime && log.time <= action.endTime
      );

      if (actionLogs.length === 0) {
        logsContent.innerHTML = '<div class="trace-empty">No logs for this action</div>';
      } else {
        logsContent.innerHTML = actionLogs.map(log => \`
          <div class="trace-log-item">
            <span class="trace-log-time">\${Math.round(log.time - action.startTime)}ms</span>
            <span class="trace-log-message">\${escapeHtmlTrace(log.message)}</span>
          </div>
        \`).join('');
      }
    }

    function renderConsoleTab() {
      const consoleContent = document.getElementById('traceConsoleContent');
      if (!consoleContent || !traceData) return;

      if (traceData.console.length === 0) {
        consoleContent.innerHTML = '<div class="trace-empty">No console output</div>';
        return;
      }

      const baseTime = traceData.startTime || 0;

      consoleContent.innerHTML = traceData.console.map(entry => {
        const icon = getConsoleIcon(entry.type);
        const relTime = Math.round(entry.timestamp - baseTime);
        return \`
          <div class="trace-console-item \${entry.type}" data-level="\${entry.type}">
            <span class="trace-console-icon">\${icon}</span>
            <span class="trace-console-time">\${relTime}ms</span>
            <span class="trace-console-message">\${escapeHtmlTrace(entry.text)}</span>
            \${entry.location ? \`<span class="trace-console-location">\${escapeHtmlTrace(entry.location)}</span>\` : ''}
          </div>
        \`;
      }).join('');
    }

    function getConsoleIcon(type) {
      const icons = {
        'log': '📝',
        'info': 'ℹ️',
        'warning': '⚠️',
        'warn': '⚠️',
        'error': '❌',
        'debug': '🔍'
      };
      return icons[type] || '📝';
    }

    function filterConsole(level) {
      currentConsoleFilter = level;

      // Update filter buttons
      document.querySelectorAll('.trace-console-filter').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.level === level);
      });

      // Filter items
      document.querySelectorAll('.trace-console-item').forEach(item => {
        const itemLevel = item.dataset.level;
        let show = level === 'all';
        if (!show) {
          if (level === 'error') show = itemLevel === 'error';
          else if (level === 'warning') show = itemLevel === 'warning' || itemLevel === 'warn';
          else if (level === 'log') show = itemLevel === 'log' || itemLevel === 'info' || itemLevel === 'debug';
        }
        item.classList.toggle('filtered-out', !show);
      });
    }

    function renderNetworkTab() {
      const networkContent = document.getElementById('traceNetworkContent');
      if (!networkContent || !traceData) return;

      const sortedNetwork = getSortedNetworkData();

      if (sortedNetwork.length === 0) {
        networkContent.innerHTML = '<div class="trace-empty">No network requests captured</div>';
        return;
      }

      // Calculate max time for waterfall scaling
      const maxTime = Math.max(...sortedNetwork.map(r => r.time || 0), 1);

      let html = \`
        <div class="trace-network-list">
          <div class="trace-network-header">
            <span class="trace-network-header-cell" data-column="method" onclick="sortNetworkBy('method')">
              Method <span class="trace-network-sort-icon">▼</span>
            </span>
            <span class="trace-network-header-cell" data-column="url" onclick="sortNetworkBy('url')">
              URL <span class="trace-network-sort-icon">▼</span>
            </span>
            <span>Waterfall</span>
            <span class="trace-network-header-cell" data-column="status" onclick="sortNetworkBy('status')">
              Status <span class="trace-network-sort-icon">▼</span>
            </span>
            <span class="trace-network-header-cell" data-column="time" onclick="sortNetworkBy('time')">
              Time <span class="trace-network-sort-icon">▼</span>
            </span>
          </div>
      \`;

      html += sortedNetwork.slice(0, 100).map((req, idx) => {
        const isError = req.status >= 400;
        const isRedirect = req.status >= 300 && req.status < 400;
        const statusClass = isError ? 'error' : (isRedirect ? 'redirect' : 'success');
        const methodClass = req.method.toLowerCase();
        const resourceType = getResourceType(req.url, req.mimeType);

        // Calculate waterfall bars
        const totalTime = req.time || 1;
        const timings = req.timings || {};
        const waterfallHtml = renderWaterfallBars(timings, totalTime, maxTime);

        return \`
          <div class="trace-network-item" data-type="\${resourceType}" data-url="\${escapeHtmlTrace(req.url)}" onclick="toggleNetworkDetails(\${idx})">
            <span class="trace-network-method \${methodClass}">\${req.method}</span>
            <span class="trace-network-url" title="\${escapeHtmlTrace(req.url)}">\${escapeHtmlTrace(getUrlPath(req.url))}</span>
            <div class="trace-network-waterfall">\${waterfallHtml}</div>
            <span class="trace-network-status \${statusClass}">\${req.status}</span>
            <span class="trace-network-time">\${Math.round(req.time || 0)}ms</span>
            <div class="trace-network-details" id="networkDetails\${idx}">
              \${renderNetworkDetails(req)}
            </div>
          </div>
        \`;
      }).join('');

      html += '</div>';

      // Add waterfall legend
      html += \`
        <div class="trace-waterfall-legend">
          <div class="trace-waterfall-legend-item">
            <span class="trace-waterfall-legend-color trace-waterfall-dns"></span> DNS
          </div>
          <div class="trace-waterfall-legend-item">
            <span class="trace-waterfall-legend-color trace-waterfall-connect"></span> Connect
          </div>
          <div class="trace-waterfall-legend-item">
            <span class="trace-waterfall-legend-color trace-waterfall-ssl"></span> SSL
          </div>
          <div class="trace-waterfall-legend-item">
            <span class="trace-waterfall-legend-color trace-waterfall-wait"></span> Wait
          </div>
          <div class="trace-waterfall-legend-item">
            <span class="trace-waterfall-legend-color trace-waterfall-receive"></span> Receive
          </div>
        </div>
      \`;

      networkContent.innerHTML = html;
    }

    function renderWaterfallBars(timings, totalTime, maxTime) {
      if (!timings || totalTime === 0) return '';

      const scale = 180 / maxTime; // 180px max width
      let offset = 0;
      let html = '';

      const phases = [
        { key: 'dns', cls: 'dns' },
        { key: 'connect', cls: 'connect' },
        { key: 'ssl', cls: 'ssl' },
        { key: 'wait', cls: 'wait' },
        { key: 'receive', cls: 'receive' }
      ];

      for (const phase of phases) {
        const duration = timings[phase.key] || 0;
        if (duration > 0) {
          const width = Math.max(2, duration * scale);
          html += \`<div class="trace-waterfall-bar trace-waterfall-\${phase.cls}" style="left: \${offset}px; width: \${width}px;"></div>\`;
          offset += width;
        }
      }

      return html;
    }

    function renderNetworkDetails(req) {
      let html = '';

      // Request Headers
      if (req.requestHeaders && req.requestHeaders.length > 0) {
        html += \`
          <div class="trace-network-details-section" onclick="event.stopPropagation(); toggleDetailsSection(this)">
            <div class="trace-network-details-title">Request Headers (\${req.requestHeaders.length})</div>
            <div class="trace-network-details-content">
              \${req.requestHeaders.map(h => \`
                <div class="trace-header-row">
                  <span class="trace-header-name">\${escapeHtmlTrace(h.name)}</span>
                  <span class="trace-header-value">\${escapeHtmlTrace(h.value)}</span>
                </div>
              \`).join('')}
            </div>
          </div>
        \`;
      }

      // Response Headers
      if (req.responseHeaders && req.responseHeaders.length > 0) {
        html += \`
          <div class="trace-network-details-section" onclick="event.stopPropagation(); toggleDetailsSection(this)">
            <div class="trace-network-details-title">Response Headers (\${req.responseHeaders.length})</div>
            <div class="trace-network-details-content">
              \${req.responseHeaders.map(h => \`
                <div class="trace-header-row">
                  <span class="trace-header-name">\${escapeHtmlTrace(h.name)}</span>
                  <span class="trace-header-value">\${escapeHtmlTrace(h.value)}</span>
                </div>
              \`).join('')}
            </div>
          </div>
        \`;
      }

      // Request Body
      if (req.requestBody) {
        html += \`
          <div class="trace-network-details-section" onclick="event.stopPropagation(); toggleDetailsSection(this)">
            <div class="trace-network-details-title">Request Body</div>
            <div class="trace-network-details-content">
              <pre class="trace-request-body">\${escapeHtmlTrace(formatBody(req.requestBody))}</pre>
            </div>
          </div>
        \`;
      }

      // Timing breakdown
      if (req.timings) {
        const t = req.timings;
        html += \`
          <div class="trace-network-details-section expanded" onclick="event.stopPropagation(); toggleDetailsSection(this)">
            <div class="trace-network-details-title">Timing</div>
            <div class="trace-network-details-content">
              <div class="trace-header-row"><span class="trace-header-name">DNS</span><span class="trace-header-value">\${t.dns.toFixed(1)}ms</span></div>
              <div class="trace-header-row"><span class="trace-header-name">Connect</span><span class="trace-header-value">\${t.connect.toFixed(1)}ms</span></div>
              <div class="trace-header-row"><span class="trace-header-name">SSL</span><span class="trace-header-value">\${t.ssl.toFixed(1)}ms</span></div>
              <div class="trace-header-row"><span class="trace-header-name">Wait (TTFB)</span><span class="trace-header-value">\${t.wait.toFixed(1)}ms</span></div>
              <div class="trace-header-row"><span class="trace-header-name">Receive</span><span class="trace-header-value">\${t.receive.toFixed(1)}ms</span></div>
            </div>
          </div>
        \`;
      }

      return html;
    }

    function toggleNetworkDetails(idx) {
      const item = document.querySelectorAll('.trace-network-item')[idx];
      if (item) {
        item.classList.toggle('expanded');
      }
    }

    function toggleDetailsSection(section) {
      section.classList.toggle('expanded');
    }

    function formatBody(body) {
      if (!body) return '';
      try {
        const parsed = JSON.parse(body);
        return JSON.stringify(parsed, null, 2);
      } catch {
        return body;
      }
    }

    function getResourceType(url, mimeType) {
      if (mimeType) {
        if (mimeType.includes('javascript')) return 'js';
        if (mimeType.includes('css')) return 'css';
        if (mimeType.includes('image')) return 'img';
        if (mimeType.includes('html')) return 'doc';
        if (mimeType.includes('json') || mimeType.includes('xml')) return 'xhr';
      }
      const ext = url.split('?')[0].split('.').pop()?.toLowerCase() || '';
      if (['js', 'mjs'].includes(ext)) return 'js';
      if (['css'].includes(ext)) return 'css';
      if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'webp'].includes(ext)) return 'img';
      if (['html', 'htm'].includes(ext)) return 'doc';
      return 'xhr';
    }

    function getUrlPath(url) {
      try {
        const u = new URL(url);
        return u.pathname + u.search;
      } catch {
        return url;
      }
    }

    function filterNetwork(searchTerm) {
      currentNetworkFilter = searchTerm.toLowerCase();
      applyNetworkFilters();
    }

    function filterNetworkType(type) {
      currentNetworkType = type;

      // Update filter buttons
      document.querySelectorAll('.trace-network-filter').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.type === type);
      });

      applyNetworkFilters();
    }

    function applyNetworkFilters() {
      document.querySelectorAll('.trace-network-item').forEach(item => {
        const url = (item.dataset.url || '').toLowerCase();
        const type = item.dataset.type || 'xhr';

        const matchesSearch = !currentNetworkFilter || url.includes(currentNetworkFilter);
        const matchesType = currentNetworkType === 'all' || type === currentNetworkType;

        item.classList.toggle('filtered-out', !matchesSearch || !matchesType);
      });
    }

    function renderMetadataTab() {
      const metadataContent = document.getElementById('traceMetadataContent');
      if (!metadataContent || !traceData) return;

      const m = traceData.metadata;
      const ctx = traceData.contextInfo || {};

      metadataContent.innerHTML = \`
        <div class="trace-metadata-grid">
          <div class="trace-metadata-card">
            <div class="trace-metadata-card-title">🌐 Browser</div>
            <div class="trace-metadata-row">
              <span class="trace-metadata-label">Name</span>
              <span class="trace-metadata-value">\${escapeHtmlTrace(m.browserName)}</span>
            </div>
            \${m.browserVersion ? \`
              <div class="trace-metadata-row">
                <span class="trace-metadata-label">Version</span>
                <span class="trace-metadata-value">\${escapeHtmlTrace(m.browserVersion)}</span>
              </div>
            \` : ''}
            \${ctx.channel ? \`
              <div class="trace-metadata-row">
                <span class="trace-metadata-label">Channel</span>
                <span class="trace-metadata-value">\${escapeHtmlTrace(ctx.channel)}</span>
              </div>
            \` : ''}
          </div>

          <div class="trace-metadata-card">
            <div class="trace-metadata-card-title">📐 Viewport</div>
            <div class="trace-metadata-row">
              <span class="trace-metadata-label">Width</span>
              <span class="trace-metadata-value">\${m.viewport.width || 'auto'}px</span>
            </div>
            <div class="trace-metadata-row">
              <span class="trace-metadata-label">Height</span>
              <span class="trace-metadata-value">\${m.viewport.height || 'auto'}px</span>
            </div>
            \${ctx.deviceScaleFactor ? \`
              <div class="trace-metadata-row">
                <span class="trace-metadata-label">Scale</span>
                <span class="trace-metadata-value">\${ctx.deviceScaleFactor}x</span>
              </div>
            \` : ''}
          </div>

          <div class="trace-metadata-card">
            <div class="trace-metadata-card-title">💻 Platform</div>
            <div class="trace-metadata-row">
              <span class="trace-metadata-label">OS</span>
              <span class="trace-metadata-value">\${escapeHtmlTrace(m.platform)}</span>
            </div>
            \${m.locale ? \`
              <div class="trace-metadata-row">
                <span class="trace-metadata-label">Locale</span>
                <span class="trace-metadata-value">\${escapeHtmlTrace(m.locale)}</span>
              </div>
            \` : ''}
            \${ctx.timezoneId ? \`
              <div class="trace-metadata-row">
                <span class="trace-metadata-label">Timezone</span>
                <span class="trace-metadata-value">\${escapeHtmlTrace(ctx.timezoneId)}</span>
              </div>
            \` : ''}
          </div>

          <div class="trace-metadata-card">
            <div class="trace-metadata-card-title">⏱️ Timing</div>
            <div class="trace-metadata-row">
              <span class="trace-metadata-label">Duration</span>
              <span class="trace-metadata-value">\${(m.duration / 1000).toFixed(2)}s</span>
            </div>
            <div class="trace-metadata-row">
              <span class="trace-metadata-label">Actions</span>
              <span class="trace-metadata-value">\${traceData.actions.length}</span>
            </div>
            <div class="trace-metadata-row">
              <span class="trace-metadata-label">Network</span>
              <span class="trace-metadata-value">\${traceData.network.length} requests</span>
            </div>
          </div>
        </div>
      \`;
    }

    function renderErrorsTab() {
      const errorsContent = document.getElementById('traceErrorsContent');
      if (!errorsContent || !traceData) return;

      if (traceData.errors.length === 0) {
        errorsContent.innerHTML = '<div class="trace-empty">No errors</div>';
      } else {
        errorsContent.innerHTML = traceData.errors.map(err => \`
          <div class="trace-error-item">
            <div class="trace-error-action">Action: \${escapeHtmlTrace(err.action)}</div>
            <div class="trace-error-name">\${escapeHtmlTrace(err.name)}</div>
            <div class="trace-error-message">\${escapeHtmlTrace(err.message)}</div>
          </div>
        \`).join('');
      }
    }

    function updateTabBadges() {
      // Console badge
      const consoleBadge = document.getElementById('traceConsoleCount');
      if (consoleBadge && traceData) {
        const errorCount = traceData.console.filter(c => c.type === 'error').length;
        if (errorCount > 0) {
          consoleBadge.textContent = errorCount;
          consoleBadge.style.display = 'inline-block';
        } else {
          consoleBadge.style.display = 'none';
        }
      }

      // Error badge
      const errorBadge = document.getElementById('traceErrorCount');
      if (errorBadge && traceData) {
        if (traceData.errors.length > 0) {
          errorBadge.textContent = traceData.errors.length;
          errorBadge.style.display = 'inline-block';
        } else {
          errorBadge.style.display = 'none';
        }
      }
    }

    function filterTraceActions(searchTerm) {
      actionSearchTerm = searchTerm.toLowerCase();

      // Show/hide clear button
      const clearBtn = document.getElementById('traceSearchClear');
      if (clearBtn) {
        clearBtn.style.display = searchTerm ? 'block' : 'none';
      }

      // Filter and highlight actions
      document.querySelectorAll('.trace-action-item').forEach(item => {
        const index = parseInt(item.dataset.index);
        const action = traceData?.actions[index];
        if (!action) return;

        const title = (action.title || action.method || '').toLowerCase();
        const selector = (action.params?.selector || action.params?.url || '').toLowerCase();
        const matches = !searchTerm || title.includes(actionSearchTerm) || selector.includes(actionSearchTerm);

        item.classList.toggle('filtered-out', !matches);

        // Highlight matching text
        const nameEl = item.querySelector('.trace-action-name');
        if (nameEl && action) {
          const originalText = action.title || action.method;
          if (searchTerm && matches) {
            const regex = new RegExp('(' + escapeRegex(searchTerm) + ')', 'gi');
            nameEl.innerHTML = escapeHtmlTrace(originalText).replace(regex, '<mark>$1</mark>');
          } else {
            nameEl.textContent = originalText;
          }
        }
      });
    }

    function clearActionSearch() {
      const input = document.getElementById('traceActionSearch');
      if (input) {
        input.value = '';
        filterTraceActions('');
      }
    }

    function escapeRegex(str) {
      return str.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
    }

    function setupPanelResizer() {
      const resizer = document.getElementById('traceResizer');
      const actionsPanel = document.getElementById('traceActionsPanel');
      if (!resizer || !actionsPanel) return;

      let isResizing = false;
      let startX = 0;
      let startWidth = 0;

      resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX;
        startWidth = actionsPanel.offsetWidth;
        resizer.classList.add('active');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
      });

      document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        const diff = e.clientX - startX;
        const newWidth = Math.min(Math.max(startWidth + diff, 200), 400);
        actionsPanel.style.width = newWidth + 'px';
      });

      document.addEventListener('mouseup', () => {
        if (isResizing) {
          isResizing = false;
          resizer.classList.remove('active');
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
        }
      });
    }

    function getActionIcon(method) {
      const icons = {
        'goto': '🌐',
        'click': '👆',
        'dblclick': '👆',
        'fill': '⌨️',
        'type': '⌨️',
        'press': '⌨️',
        'check': '☑️',
        'uncheck': '☐',
        'selectOption': '📋',
        'hover': '🖱️',
        'focus': '🎯',
        'blur': '💨',
        'screenshot': '📸',
        'evaluate': '⚙️',
        'evaluateHandle': '⚙️',
        'waitForSelector': '⏳',
        'waitForTimeout': '⏱️',
        'waitForLoadState': '⏳',
        'waitForNavigation': '⏳',
        'waitForURL': '⏳',
        'waitForFunction': '⏳',
        'expect': '✓',
        'toBeVisible': '👁️',
        'toHaveText': '📝',
        'toHaveValue': '📝',
        'toBeChecked': '☑️',
        'toBeEnabled': '✓',
        'toBeDisabled': '⛔',
        'toHaveAttribute': '🏷️',
        'toHaveClass': '🎨',
        'toHaveCount': '#️⃣',
        'toContainText': '📝',
        'newPage': '📄',
        'newContext': '🆕',
        'close': '❌',
        'setContent': '📄',
        'setViewportSize': '📐',
        'route': '🛣️',
        'unroute': '🛣️',
        'request': '📡',
        'fetch': '📡'
      };
      return icons[method] || '▶️';
    }

    function switchTraceTab(tabName) {
      document.querySelectorAll('.trace-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabName);
      });
      document.querySelectorAll('.trace-tab-pane').forEach(pane => {
        pane.classList.toggle('active', pane.id === 'traceTab' + tabName.charAt(0).toUpperCase() + tabName.slice(1));
      });
    }

    function showTraceState(state) {
      const loading = document.getElementById('traceLoading');
      const error = document.getElementById('traceError');
      const content = document.getElementById('traceContent');

      if (loading) loading.style.display = state === 'loading' ? 'flex' : 'none';
      if (error) error.style.display = state === 'error' ? 'flex' : 'none';
      if (content) content.style.display = state === 'content' ? 'flex' : 'none';
    }

    function showTraceError(message) {
      showTraceState('error');
      const msgEl = document.getElementById('traceErrorMessage');
      if (msgEl) msgEl.textContent = message;
    }

    function closeTraceModal() {
      const modal = document.getElementById('traceViewerModal');
      if (modal) {
        modal.style.display = 'none';
        modal.classList.remove('fullscreen');
        document.body.style.overflow = '';
      }
      traceData = null;
      traceResources = {};
      traceScreenshots = new Map();
      currentActionIndex = 0;
      currentSnapshotMode = 'after';
      actionSearchTerm = '';
    }

    function toggleFullscreen() {
      const modal = document.getElementById('traceViewerModal');
      const icon = document.getElementById('fullscreenIcon');
      if (modal) {
        modal.classList.toggle('fullscreen');
        if (icon) {
          icon.textContent = modal.classList.contains('fullscreen') ? '⛶' : '⛶';
        }
      }
    }

    function escapeHtmlTrace(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    // Timeline slider functionality
    function setupTimelineSlider() {
      const track = document.getElementById('traceSliderTrack');
      const thumb = document.getElementById('traceSliderThumb');
      const progress = document.getElementById('traceSliderProgress');
      if (!track || !thumb || !progress || !traceData) return;

      let isDragging = false;

      function updateSliderPosition(percent) {
        const clampedPercent = Math.max(0, Math.min(100, percent));
        thumb.style.left = clampedPercent + '%';
        progress.style.width = clampedPercent + '%';

        // Find closest action to this time position
        if (traceData.actions.length > 0) {
          const actionIndex = Math.round((clampedPercent / 100) * (traceData.actions.length - 1));
          selectTraceAction(actionIndex);
        }
      }

      function handleSliderInteraction(e) {
        const rect = track.getBoundingClientRect();
        const percent = ((e.clientX - rect.left) / rect.width) * 100;
        updateSliderPosition(percent);
      }

      track.addEventListener('click', handleSliderInteraction);

      thumb.addEventListener('mousedown', (e) => {
        isDragging = true;
        document.body.style.cursor = 'grabbing';
        document.body.style.userSelect = 'none';
      });

      document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        handleSliderInteraction(e);
      });

      document.addEventListener('mouseup', () => {
        if (isDragging) {
          isDragging = false;
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
        }
      });
    }

    function updateTimelineSlider(actionIndex) {
      const thumb = document.getElementById('traceSliderThumb');
      const progress = document.getElementById('traceSliderProgress');
      if (!thumb || !progress || !traceData || traceData.actions.length === 0) return;

      const percent = (actionIndex / (traceData.actions.length - 1)) * 100;
      thumb.style.left = percent + '%';
      progress.style.width = percent + '%';
    }

    // Timeline hover magnification
    function setupTimelineMagnifier() {
      const scroll = document.getElementById('traceTimelineScroll');
      const magnifier = document.getElementById('traceTimelineMagnifier');
      const magnifierImg = document.getElementById('traceMagnifierImg');
      const magnifierTime = document.getElementById('traceMagnifierTime');
      if (!scroll || !magnifier) return;

      scroll.addEventListener('mousemove', (e) => {
        const thumb = e.target.closest('.trace-timeline-thumb');
        if (!thumb) {
          magnifier.style.display = 'none';
          return;
        }

        const img = thumb.querySelector('img');
        if (!img || !img.src) {
          magnifier.style.display = 'none';
          return;
        }

        magnifierImg.src = img.src;
        const timestamp = parseInt(thumb.dataset.timestamp) || 0;
        const baseTime = traceData?.startTime || 0;
        magnifierTime.textContent = Math.round(timestamp - baseTime) + 'ms';

        // Position magnifier
        const thumbRect = thumb.getBoundingClientRect();
        const scrollRect = scroll.getBoundingClientRect();
        magnifier.style.left = (thumbRect.left - scrollRect.left + thumbRect.width / 2) + 'px';
        magnifier.style.display = 'block';
      });

      scroll.addEventListener('mouseleave', () => {
        magnifier.style.display = 'none';
      });
    }

    // Click position indicator
    function showClickPosition(action) {
      const indicator = document.getElementById('traceClickIndicator');
      const container = document.getElementById('traceScreenshotContainer');
      const screenshot = document.getElementById('traceScreenshot');

      if (!indicator || !container || !screenshot) return;

      // Check if this is a click action with point data
      const isClickAction = ['click', 'dblclick', 'hover', 'tap'].includes(action.method);
      const hasPoint = action.point && typeof action.point.x === 'number' && typeof action.point.y === 'number';

      if (!isClickAction || !hasPoint) {
        indicator.style.display = 'none';
        return;
      }

      // Wait for image to load to get correct dimensions
      if (!screenshot.complete || screenshot.naturalWidth === 0) {
        screenshot.onload = () => showClickPosition(action);
        return;
      }

      // Calculate position relative to displayed image
      const imgRect = screenshot.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();

      // Scale factor between original viewport and displayed image
      const scaleX = imgRect.width / (traceData?.metadata?.viewport?.width || 1280);
      const scaleY = imgRect.height / (traceData?.metadata?.viewport?.height || 720);

      const x = (imgRect.left - containerRect.left) + (action.point.x * scaleX);
      const y = (imgRect.top - containerRect.top) + (action.point.y * scaleY);

      indicator.style.left = x + 'px';
      indicator.style.top = y + 'px';
      indicator.style.display = 'block';
    }

    // Attachments tab
    function renderAttachmentsTab() {
      const content = document.getElementById('traceAttachmentsContent');
      if (!content || !traceData) return;

      // Collect all resources that look like attachments (store globally for preview)
      traceAttachments = [];

      // Add screenshots as attachments
      for (const [key, dataUri] of Object.entries(traceResources)) {
        if (key.endsWith('.jpeg') || key.endsWith('.png')) {
          traceAttachments.push({
            name: key,
            type: 'image',
            dataUri: dataUri
          });
        }
      }

      if (traceAttachments.length === 0) {
        content.innerHTML = '<div class="trace-empty">No attachments in this trace</div>';
        return;
      }

      content.innerHTML = \`
        <div class="trace-attachments-grid">
          \${traceAttachments.slice(0, 20).map((att, idx) => \`
            <div class="trace-attachment-card">
              <div class="trace-attachment-preview">
                \${att.type === 'image' ? \`<img src="\${att.dataUri}" alt="\${escapeHtmlTrace(att.name)}" onclick="openAttachmentPreview(\${idx})">\` : \`<span class="trace-attachment-preview-icon">📎</span>\`}
              </div>
              <div class="trace-attachment-info">
                <div class="trace-attachment-name" title="\${escapeHtmlTrace(att.name)}">\${escapeHtmlTrace(att.name)}</div>
                <div class="trace-attachment-meta">\${att.type}</div>
              </div>
            </div>
          \`).join('')}
        </div>
        \${traceAttachments.length > 20 ? '<p class="trace-empty">Showing first 20 of ' + traceAttachments.length + ' attachments</p>' : ''}
      \`;

      // Update badge
      const badge = document.getElementById('traceAttachmentCount');
      if (badge && traceAttachments.length > 0) {
        badge.textContent = traceAttachments.length;
        badge.style.display = 'inline-block';
      }
    }

    // Open attachment in fullscreen preview modal
    function openAttachmentPreview(index) {
      if (!traceAttachments[index]) return;

      const att = traceAttachments[index];

      // Create or reuse modal
      let modal = document.getElementById('attachmentPreviewModal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'attachmentPreviewModal';
        modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.9);z-index:10000;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;';
        modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };
        document.body.appendChild(modal);
      }

      modal.innerHTML = \`
        <div style="color:#fff;margin-bottom:10px;font-size:14px;">\${escapeHtmlTrace(att.name)} (\${index + 1}/\${traceAttachments.length})</div>
        <img src="\${att.dataUri}" style="max-width:90vw;max-height:80vh;object-fit:contain;border-radius:8px;" alt="\${escapeHtmlTrace(att.name)}">
        <div style="margin-top:15px;display:flex;gap:10px;">
          <button onclick="openAttachmentPreview(\${Math.max(0, index - 1)})" style="padding:8px 16px;background:#333;color:#fff;border:none;border-radius:4px;cursor:pointer;" \${index === 0 ? 'disabled style="opacity:0.5;padding:8px 16px;background:#333;color:#fff;border:none;border-radius:4px;"' : ''}>← Previous</button>
          <button onclick="document.getElementById('attachmentPreviewModal').style.display='none'" style="padding:8px 16px;background:#666;color:#fff;border:none;border-radius:4px;cursor:pointer;">Close (Esc)</button>
          <button onclick="openAttachmentPreview(\${Math.min(traceAttachments.length - 1, index + 1)})" style="padding:8px 16px;background:#333;color:#fff;border:none;border-radius:4px;cursor:pointer;" \${index === traceAttachments.length - 1 ? 'disabled style="opacity:0.5;padding:8px 16px;background:#333;color:#fff;border:none;border-radius:4px;"' : ''}>Next →</button>
        </div>
      \`;
      modal.style.display = 'flex';

      // Add keyboard navigation
      const keyHandler = (e) => {
        if (modal.style.display !== 'flex') {
          document.removeEventListener('keydown', keyHandler);
          return;
        }
        if (e.key === 'Escape') modal.style.display = 'none';
        if (e.key === 'ArrowLeft' && index > 0) openAttachmentPreview(index - 1);
        if (e.key === 'ArrowRight' && index < traceAttachments.length - 1) openAttachmentPreview(index + 1);
      };
      document.addEventListener('keydown', keyHandler);
    }

    // Sortable network columns
    let networkSortColumn = null;
    let networkSortAsc = true;

    function sortNetworkBy(column) {
      if (networkSortColumn === column) {
        networkSortAsc = !networkSortAsc;
      } else {
        networkSortColumn = column;
        networkSortAsc = true;
      }

      // Update header styles
      document.querySelectorAll('.trace-network-header-cell').forEach(cell => {
        const isActive = cell.dataset.column === column;
        cell.classList.toggle('sorted', isActive);
        const icon = cell.querySelector('.trace-network-sort-icon');
        if (icon) {
          icon.textContent = isActive ? (networkSortAsc ? '▲' : '▼') : '▼';
        }
      });

      // Re-render with current sort settings (sorting done in renderNetworkTab)
      if (traceData && traceData.network) {
        renderNetworkTab();
      }
    }

    // Get sorted network data without mutating original
    function getSortedNetworkData() {
      if (!traceData || !traceData.network) return [];

      // Create a shallow copy to avoid mutating original order
      const networkCopy = [...traceData.network];

      if (!networkSortColumn) return networkCopy;

      return networkCopy.sort((a, b) => {
        let aVal, bVal;
        switch (networkSortColumn) {
          case 'method': aVal = a.method || ''; bVal = b.method || ''; break;
          case 'url': aVal = a.url || ''; bVal = b.url || ''; break;
          case 'status': aVal = a.status || 0; bVal = b.status || 0; break;
          case 'time': aVal = a.time || 0; bVal = b.time || 0; break;
          default: return 0;
        }
        if (typeof aVal === 'string') {
          return networkSortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        }
        return networkSortAsc ? aVal - bVal : bVal - aVal;
      });
    }

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
      const modal = document.getElementById('traceViewerModal');
      if (modal && modal.style.display === 'flex') {
        if (e.key === 'Escape') closeTraceModal();
        if (e.key === 'ArrowUp' && traceData) {
          e.preventDefault();
          // Find previous visible action
          let prev = currentActionIndex - 1;
          while (prev >= 0) {
            const item = document.querySelector(\`.trace-action-item[data-index="\${prev}"]\`);
            if (item && !item.classList.contains('filtered-out')) break;
            prev--;
          }
          if (prev >= 0) selectTraceAction(prev);
        }
        if (e.key === 'ArrowDown' && traceData) {
          e.preventDefault();
          // Find next visible action
          let next = currentActionIndex + 1;
          while (next < traceData.actions.length) {
            const item = document.querySelector(\`.trace-action-item[data-index="\${next}"]\`);
            if (item && !item.classList.contains('filtered-out')) break;
            next++;
          }
          if (next < traceData.actions.length) selectTraceAction(next);
        }
        // Before/After snapshot shortcuts
        if (e.key === 'b' || e.key === 'B') {
          e.preventDefault();
          switchSnapshot('before');
        }
        if (e.key === 'a' || e.key === 'A') {
          e.preventDefault();
          switchSnapshot('after');
        }
        // Tab switching with number keys
        if (e.key === '1') switchTraceTab('details');
        if (e.key === '2') switchTraceTab('console');
        if (e.key === '3') switchTraceTab('source');
        if (e.key === '4') switchTraceTab('network');
        if (e.key === '5') switchTraceTab('metadata');
        if (e.key === '6') switchTraceTab('errors');
        // Fullscreen toggle
        if (e.key === 'f' || e.key === 'F') {
          e.preventDefault();
          toggleFullscreen();
        }
      }
    });
  `;
}

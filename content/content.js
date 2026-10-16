/**
 * SmoothFlow - Cinematic Scroll & Cursor Studio
 * Content Script Engine (Matching Exact 2-Column Pro Studio UI)
 */

(() => {
  if (window.__SMOOTHFLOW_INITIALIZED__) {
    const oldRoot = document.getElementById('smoothflow-root');
    if (oldRoot) oldRoot.remove();
  }
  window.__SMOOTHFLOW_INITIALIZED__ = true;

  // Configuration State
  const state = {
    hudVisible: true,
    hudMinimized: false,
    activeTab: 'director', // 'director' | 'cursor' | 'scroll' | 'settings'
    cursorEnabled: true,
    cursorSmoothing: 0.15,
    rippleEnabled: true,
    cursorStyle: 'arrow', // 'arrow' | 'classic' | 'dot' | 'ring' | 'halo'
    cursorColor: '#2563eb',
    cursorSize: 24, // px
    cursorAutoHide: true, // only show while the mouse moves, clicks or hovers something clickable
    videoHeight: 1080, // export resolution (height); width follows the page's shape
    videoFps: 60,
    videoFormat: 'mp4', // 'mp4' (H.264) | 'webm' (VP9)
    spotlightEnabled: false,
    wheelScrollEnabled: true,
    wheelDamping: 0.88,
    isRecording: false,
    isPlaying: false, // timeline preview/recording in progress
    activePlayingSceneIndex: -1,
    pickingTarget: null, // null | number (step index)
    // Each scene: { id, name, target: { selector, label } | null, offset,
    //   moveDuration, easing, waitDuration }
    timelineSteps: [],
  };

  // Timelines are saved per page, since scenes point at that page's elements
  const TIMELINE_KEY = `timeline:${location.origin}${location.pathname}`;
  const TIMELINE_VERSION = 4; // v3 is migrated; anything older is ignored and the page is re-detected

  // Cursor interpolation state
  const cursorState = {
    targetX: -100,
    targetY: -100,
    currX: -100,
    currY: -100,
    active: false,
    scripted: false, // true while the timeline drives the cursor
  };

  // Real mouse activity, for the "show only on activity" cursor mode
  const cursorActivity = {
    lastMove: 0,
    lastClick: 0,
    lastScroll: 0,
    hovering: false, // over a link / button / field
    lastX: null,
    lastY: null
  };
  const CURSOR_SHOW_MS = 1200; // stay visible this long after a move or click
  const CURSOR_SCROLL_HIDE_MS = 200; // hidden while scroll events keep arriving
  const INTERACTIVE_SELECTOR = 'a, button, [role="button"], input, select, textarea, label, summary, [onclick], [tabindex]:not([tabindex="-1"])';

  // Cursor shapes on a 24px grid. hotspot = the point that sits on the mouse position.
  const CURSOR_SHAPES = {
    arrow: {
      label: 'Arrow',
      hotspot: [4, 3],
      svg: (c, s) => `<path d="M4 3L11.5 21L14.5 13.5L22 10.5L4 3Z" fill="${c}" stroke="${s}" stroke-width="2" stroke-linejoin="round"/>`
    },
    classic: {
      label: 'Classic',
      hotspot: [5, 2.5],
      svg: (c, s) => `<path d="M5 2.5v16.8l4.3-4.1 2.9 6.5 2.9-1.3-2.9-6.4h6z" fill="${c}" stroke="${s}" stroke-width="1.6" stroke-linejoin="round"/>`
    },
    dot: {
      label: 'Dot',
      hotspot: [12, 12],
      svg: (c, s) => `<circle cx="12" cy="12" r="6" fill="${c}" stroke="${s}" stroke-width="2"/>`
    },
    ring: {
      label: 'Ring',
      hotspot: [12, 12],
      svg: (c) => `<circle cx="12" cy="12" r="9" fill="${c}" fill-opacity="0.15" stroke="${c}" stroke-width="2.5"/>`
    },
    halo: {
      label: 'Halo',
      hotspot: [12, 12],
      svg: (c, s) => `<circle cx="12" cy="12" r="11" fill="${c}" fill-opacity="0.22"/><circle cx="12" cy="12" r="4.5" fill="${c}" stroke="${s}" stroke-width="1.5"/>`
    }
  };
  // Export resolutions. 8K is listed but unavailable: Chrome has no encoder that can
  // record 8K live, and a browser tab only captures as many pixels as the screen shows.
  const VIDEO_PRESETS = [
    { height: 720, label: '720p' },
    { height: 1080, label: '1080p' },
    { height: 1440, label: '1440p' },
    { height: 2160, label: '4K' },
    { height: 4320, label: '8K', unavailable: 'Not available: Chrome can\'t encode 8K video while recording, and a browser tab only captures as many pixels as your screen shows' }
  ];

  const CURSOR_COLORS = ['#2563eb', '#111827', '#ffffff', '#ef4444', '#f97316', '#22c55e', '#8b5cf6', '#ec4899'];

  // Outline that contrasts with the fill (dark outline on light colors)
  function cursorOutline(hex) {
    const n = parseInt(hex.slice(1), 16);
    const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    return lum > 0.65 ? '#111827' : '#ffffff';
  }

  function cursorSvg(style, color, size) {
    const shape = CURSOR_SHAPES[style] || CURSOR_SHAPES.arrow;
    return `<svg class="sf-cursor-shape" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" aria-hidden="true">${shape.svg(color, cursorOutline(color))}</svg>`;
  }

  // Wheel smooth scroll state
  const wheelState = {
    targetY: window.scrollY,
    currentY: window.scrollY,
    animating: false,
  };

  let mediaRecorder = null;
  let recordedChunks = [];
  let recordStream = null;
  let toastTimeout = null;

  // Shortcuts: ⌘⇧ on macOS, Ctrl+Shift elsewhere. Plain ⌘H / ⌘S / ⌘R belong to
  // macOS and Chrome (Hide, Save, Reload), and ⌘⇧H / ⌘⇧R are Chrome's too.
  const IS_MAC = /mac/i.test((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '');
  const MOD_KEYS = IS_MAC ? ['⌘', '⇧'] : ['Ctrl', 'Shift'];
  const shortcut = (letter) => IS_MAC ? `⌘⇧${letter}` : `Ctrl+Shift+${letter}`;
  const shortcutKeys = (letter) => [...MOD_KEYS, letter].map(k => `<kbd>${k}</kbd>`).join('');
  let pickerHandlers = null;

  // DOM Elements
  let rootEl, hudEl, cursorEl, spotlightEl, pickerBoxEl, countdownEl, modalEl, toastEl;

  // Lucide-style stroke icons on a 24px grid
  const icon = (paths, size = 16, strokeWidth = 2, cls = '') =>
    `<svg${cls ? ` class="${cls}"` : ''} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

  const ICONS = {
    logoWave: icon('<path d="M2 12c2.5-4 5-4 7 0s4.5 4 7 0 4.5-4 6 0"/>', 16, 2.5),
    director: icon('<path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z"/><path d="m6.2 5.3 3.1 3.9"/><path d="m12.4 3.4 3.1 4"/><path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>', 18),
    cursor: icon('<path d="m4 4 7.07 17 2.51-7.39L21 11.07z"/>', 18),
    scroll: icon('<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>', 18),
    video: icon('<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>', 18),
    keyboard: icon('<rect width="20" height="16" x="2" y="4" rx="2"/><path d="M6 8h.01"/><path d="M10 8h.01"/><path d="M14 8h.01"/><path d="M18 8h.01"/><path d="M8 12h.01"/><path d="M12 12h.01"/><path d="M16 12h.01"/><path d="M7 16h10"/>', 18),
    pick: icon('<path d="M14 4.1 12 6"/><path d="m5.1 8-2.9-.8"/><path d="m6 12-1.9 2"/><path d="M7.2 2.2 8 5.1"/><path d="M9.037 9.69a.498.498 0 0 1 .653-.653l11 4.5a.5.5 0 0 1-.074.949l-4.349 1.041a1 1 0 0 0-.74.739l-1.04 4.35a.5.5 0 0 1-.95.074z"/>', 14),
    target: icon('<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>', 12),
    here: icon('<path d="M12 3v12"/><path d="m6 9 6 6 6-6"/><path d="M5 21h14"/>', 14),
    trash: icon('<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>', 14),
    plus: icon('<path d="M12 5v14"/><path d="M5 12h14"/>', 14),
    chevron: icon('<path d="m6 9 6 6 6-6"/>', 14, 2, 'sf-dropdown-arrow'),
    minimize: icon('<path d="M5 12h14"/>', 14),
    close: icon('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>', 14),
    play: `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z"/></svg>`,
    download: icon('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>', 14),
    repeat: icon('<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>', 14),
    check: icon('<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>', 18)
  };

  // Easing Profiles Mathematical Models
  const easings = {
    cinematic: (t) => t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2, // smooth quintic
    easeInOut: (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2, // cubic
    easeOut: (t) => 1 - Math.pow(1 - t, 3), // soft landing
    linear: (t) => t,
    // Constant speed with short soft ramps — for scroll-driven page animations
    cruise: (t) => {
      const r = 0.12;
      const v = 1 / (1 - r);
      if (t < r) return v * t * t / (2 * r);
      if (t > 1 - r) return 1 - v * (1 - t) * (1 - t) / (2 * r);
      return v * (t - r / 2);
    },
    snappy: (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2, // power 2
    spring: (t) => {
      const c4 = (2 * Math.PI) / 3;
      return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
    }
  };

  function getEasingShortName(key) {
    const map = {
      cinematic: 'Cinema',
      easeInOut: 'In-Out',
      easeOut: 'Cushioned',
      linear: 'Linear',
      snappy: 'Snappy',
      spring: 'Spring'
    };
    return map[key] || 'Cinema';
  }

  // Initialize Extension
  function init() {
    createDOM();
    bindEvents();
    applyCursorAppearance();
    applyVideoSettingsUI();
    detectPageScenes();
    renderTimelineUI();
    startCursorLoop();
    startWheelScrollLoop();
    loadStorageSettings();
  }

  // Build isolated DOM Elements
  function createDOM() {
    rootEl = document.createElement('div');
    rootEl.id = 'smoothflow-root';

    // 1. Spotlight Overlay
    spotlightEl = document.createElement('div');
    spotlightEl.id = 'smoothflow-spotlight';
    rootEl.appendChild(spotlightEl);

    // 2. Element Picker Outline Box
    pickerBoxEl = document.createElement('div');
    pickerBoxEl.id = 'smoothflow-picker-box';
    pickerBoxEl.innerHTML = `<span class="sf-picker-tag" id="sf-picker-tag">Select Element</span>`;
    rootEl.appendChild(pickerBoxEl);

    // 3. Countdown Overlay
    countdownEl = document.createElement('div');
    countdownEl.id = 'smoothflow-countdown';
    countdownEl.innerHTML = `
      <div class="sf-countdown-number" id="sf-countdown-num">3</div>
      <div class="sf-countdown-label">Recording starts in</div>
    `;
    rootEl.appendChild(countdownEl);

    // 4. Smooth Virtual Cursor
    cursorEl = document.createElement('div');
    cursorEl.id = 'smoothflow-cursor';
    cursorEl.classList.add('sf-cursor-idle'); // nothing to show until the mouse moves
    rootEl.appendChild(cursorEl);
    applyCursorAppearance();

    // 5. Floating Director HUD (sidebar tabs + content panes)
    hudEl = document.createElement('div');
    hudEl.className = 'sf-hud';
    hudEl.innerHTML = `
      <div class="sf-hud-toast" id="sf-hud-toast" role="status" aria-live="polite"></div>

      <div class="sf-hud-topbar" id="sf-hud-header">
        <div class="sf-brand">
          <div class="sf-logo">${ICONS.logoWave}</div>
          <span class="sf-brand-title">SmoothFlow</span>
          <span class="sf-brand-badge">Studio</span>
        </div>
        <div class="sf-topbar-actions">
          <button type="button" class="sf-icon-btn" id="sf-btn-minimize" title="Minimize" aria-label="Minimize">${ICONS.minimize}</button>
          <button type="button" class="sf-icon-btn" id="sf-btn-close" title="Hide (${shortcut('E')})" aria-label="Hide panel">${ICONS.close}</button>
        </div>
      </div>

      <div class="sf-hud-shell">
        <div class="sf-sidebar" role="tablist" aria-orientation="vertical">
          <button type="button" class="sf-side-item active" data-tab="director" role="tab" aria-selected="true">
            ${ICONS.director}<span class="sf-side-label">Director</span>
          </button>
          <button type="button" class="sf-side-item" data-tab="cursor" role="tab" aria-selected="false">
            ${ICONS.cursor}<span class="sf-side-label">Cursor</span>
          </button>
          <button type="button" class="sf-side-item" data-tab="scroll" role="tab" aria-selected="false">
            ${ICONS.scroll}<span class="sf-side-label">Scroll</span>
          </button>
          <button type="button" class="sf-side-item" data-tab="video" role="tab" aria-selected="false">
            ${ICONS.video}<span class="sf-side-label">Video</span>
          </button>
          <button type="button" class="sf-side-item" data-tab="settings" role="tab" aria-selected="false">
            ${ICONS.keyboard}<span class="sf-side-label">Shortcuts</span>
          </button>
        </div>

        <div class="sf-main-content">
          <!-- DIRECTOR: scene timeline -->
          <section class="sf-view-pane" id="sf-view-director">
            <div class="sf-section-head">
              <div>
                <span class="sf-section-title">Timeline</span>
                <span class="sf-section-desc">Each scene: move there → wait.</span>
              </div>
              <span class="sf-count-badge" id="sf-timeline-total-badge">3 scenes · ~15s</span>
            </div>

            <div class="sf-timeline-list" id="sf-timeline-list"></div>

            <button type="button" class="sf-btn-add-step" id="sf-btn-add-step">
              ${ICONS.plus}<span>Add scene</span>
            </button>
          </section>

          <!-- CURSOR -->
          <section class="sf-view-pane" id="sf-view-cursor" style="display:none;">
            <div class="sf-section-head">
              <div>
                <span class="sf-section-title">Cursor</span>
                <span class="sf-section-desc">How the on-screen pointer looks and moves.</span>
              </div>
            </div>

            <div class="sf-card">
              <div class="sf-row">
                <div class="sf-row-text">
                  <span class="sf-row-title">Smooth cursor</span>
                  <span class="sf-row-desc">Glides with spring damping</span>
                </div>
                <label class="sf-switch" aria-label="Smooth cursor">
                  <input type="checkbox" id="sf-chk-cursor" checked>
                  <span class="sf-switch-slider"></span>
                </label>
              </div>

              <div class="sf-row">
                <div class="sf-row-text">
                  <span class="sf-row-title">Show only on activity</span>
                  <span class="sf-row-desc">Shows on move, click or hover. Hides while scrolling or idle</span>
                </div>
                <label class="sf-switch" aria-label="Show cursor only on activity">
                  <input type="checkbox" id="sf-chk-autohide" checked>
                  <span class="sf-switch-slider"></span>
                </label>
              </div>

              <div class="sf-row sf-row-stack">
                <span class="sf-row-title">Style</span>
                <div class="sf-style-grid" id="sf-cursor-styles" role="radiogroup" aria-label="Cursor style">
                  ${Object.entries(CURSOR_SHAPES).map(([key, shape]) => `
                    <button type="button" class="sf-style-option" data-style="${key}" role="radio" aria-checked="false" title="${shape.label}">
                      <span class="sf-style-preview"></span>
                      <span class="sf-style-label">${shape.label}</span>
                    </button>
                  `).join('')}
                </div>
              </div>

              <div class="sf-row sf-row-stack">
                <div class="sf-row-head">
                  <span class="sf-row-title">Color</span>
                  <span class="sf-row-value sf-color-value" id="sf-cursor-color-disp">#2563eb</span>
                </div>
                <div class="sf-swatches" id="sf-cursor-colors" role="radiogroup" aria-label="Cursor color">
                  ${CURSOR_COLORS.map(c => `<button type="button" class="sf-swatch" data-color="${c}" style="--swatch:${c}" role="radio" aria-checked="false" title="${c}"></button>`).join('')}
                  <label class="sf-swatch sf-swatch-custom" title="Custom color">
                    <input type="color" id="sf-cursor-color-custom" value="#2563eb" aria-label="Custom cursor color">
                  </label>
                </div>
              </div>

              <div class="sf-row sf-row-stack">
                <div class="sf-row-head">
                  <span class="sf-row-title">Size</span>
                  <span class="sf-row-value" id="sf-cursor-size-disp">24px</span>
                </div>
                <input type="range" min="16" max="48" step="2" value="24" class="sf-range" id="sf-slider-cursor-size" aria-label="Cursor size">
              </div>

              <div class="sf-row sf-row-stack">
                <div class="sf-row-head">
                  <div class="sf-row-text">
                    <span class="sf-row-title">Responsiveness</span>
                    <span class="sf-row-desc">Higher follows the mouse more tightly</span>
                  </div>
                  <span class="sf-row-value" id="sf-smoothing-disp">0.15</span>
                </div>
                <input type="range" min="0.05" max="0.35" step="0.02" value="0.15" class="sf-range" id="sf-slider-smoothing" aria-label="Cursor responsiveness">
              </div>

              <div class="sf-row">
                <div class="sf-row-text">
                  <span class="sf-row-title">Click ripple</span>
                  <span class="sf-row-desc">Animated ring on every click</span>
                </div>
                <label class="sf-switch" aria-label="Click ripple">
                  <input type="checkbox" id="sf-chk-ripple" checked>
                  <span class="sf-switch-slider"></span>
                </label>
              </div>

              <div class="sf-row">
                <div class="sf-row-text">
                  <span class="sf-row-title">Spotlight</span>
                  <span class="sf-row-desc">Dims the page around the cursor</span>
                </div>
                <label class="sf-switch" aria-label="Spotlight">
                  <input type="checkbox" id="sf-chk-spotlight">
                  <span class="sf-switch-slider"></span>
                </label>
              </div>
            </div>
          </section>

          <!-- SCROLL -->
          <section class="sf-view-pane" id="sf-view-scroll" style="display:none;">
            <div class="sf-section-head">
              <div>
                <span class="sf-section-title">Wheel scrolling</span>
                <span class="sf-section-desc">Smooths manual mouse-wheel scrolling.</span>
              </div>
            </div>

            <div class="sf-card">
              <div class="sf-row">
                <div class="sf-row-text">
                  <span class="sf-row-title">Inertial smoothing</span>
                  <span class="sf-row-desc">Removes choppy notch steps</span>
                </div>
                <label class="sf-switch" aria-label="Inertial smoothing">
                  <input type="checkbox" id="sf-chk-wheel" checked>
                  <span class="sf-switch-slider"></span>
                </label>
              </div>

              <div class="sf-row sf-row-stack">
                <div class="sf-row-head">
                  <div class="sf-row-text">
                    <span class="sf-row-title">Momentum</span>
                    <span class="sf-row-desc">Higher glides further after each notch</span>
                  </div>
                  <span class="sf-row-value" id="sf-damping-disp">0.88</span>
                </div>
                <input type="range" min="0.75" max="0.96" step="0.02" value="0.88" class="sf-range" id="sf-slider-damping" aria-label="Scroll momentum">
              </div>
            </div>
          </section>

          <!-- VIDEO EXPORT -->
          <section class="sf-view-pane" id="sf-view-video" style="display:none;">
            <div class="sf-section-head">
              <div>
                <span class="sf-section-title">Video export</span>
                <span class="sf-section-desc">Resolution and format used by Record.</span>
              </div>
            </div>

            <div class="sf-card">
              <div class="sf-row sf-row-stack">
                <div class="sf-row-head">
                  <span class="sf-row-title">Resolution</span>
                  <span class="sf-row-value" id="sf-video-dims">1920×1080</span>
                </div>
                <div class="sf-segmented" id="sf-video-res" role="radiogroup" aria-label="Resolution">
                  ${VIDEO_PRESETS.map(p => `<button type="button" class="sf-segment" data-height="${p.height}" role="radio" aria-checked="false" ${p.unavailable ? `disabled title="${p.unavailable}"` : ''}>${p.label}</button>`).join('')}
                </div>
                <span class="sf-row-desc" id="sf-video-native"></span>
              </div>

              <div class="sf-row">
                <span class="sf-row-title">Frame rate</span>
                <div class="sf-segmented sf-segmented-sm" id="sf-video-fps" role="radiogroup" aria-label="Frame rate">
                  <button type="button" class="sf-segment" data-fps="30" role="radio" aria-checked="false">30 fps</button>
                  <button type="button" class="sf-segment" data-fps="60" role="radio" aria-checked="false">60 fps</button>
                </div>
              </div>

              <div class="sf-row">
                <div class="sf-row-text">
                  <span class="sf-row-title">Format</span>
                  <span class="sf-row-desc">MP4 plays everywhere</span>
                </div>
                <div class="sf-segmented sf-segmented-sm" id="sf-video-format" role="radiogroup" aria-label="Format">
                  <button type="button" class="sf-segment" data-format="mp4" role="radio" aria-checked="false">MP4</button>
                  <button type="button" class="sf-segment" data-format="webm" role="radio" aria-checked="false">WebM</button>
                </div>
              </div>
            </div>
          </section>

          <!-- SHORTCUTS -->
          <section class="sf-view-pane" id="sf-view-settings" style="display:none;">
            <div class="sf-section-head">
              <div>
                <span class="sf-section-title">Keyboard shortcuts</span>
                <span class="sf-section-desc">Available on any page while SmoothFlow is loaded.</span>
              </div>
            </div>

            <div class="sf-card">
              <div class="sf-row sf-row-compact">
                <span class="sf-row-title">Show / hide panel</span>
                <span class="sf-keys">${shortcutKeys('E')}</span>
              </div>
              <div class="sf-row sf-row-compact">
                <span class="sf-row-title">Preview timeline</span>
                <span class="sf-keys">${shortcutKeys('S')}</span>
              </div>
              <div class="sf-row sf-row-compact">
                <span class="sf-row-title">Record timeline</span>
                <span class="sf-keys">${shortcutKeys('L')}</span>
              </div>
              <div class="sf-row sf-row-compact">
                <span class="sf-row-title">Cancel picker / stop</span>
                <span class="sf-keys"><kbd>Esc</kbd></span>
              </div>
            </div>
          </section>

          <!-- Director actions (pinned) -->
          <div class="sf-pane-footer" id="sf-director-footer">
            <button type="button" class="sf-btn sf-btn-secondary" id="sf-btn-play-timeline">
              ${ICONS.play}<span>Preview</span><kbd>${shortcut('S')}</kbd>
            </button>
            <button type="button" class="sf-btn sf-btn-primary" id="sf-btn-record-timeline">
              <span class="sf-rec-dot"></span><span>Record</span><kbd>${shortcut('L')}</kbd>
            </button>
          </div>
        </div>
      </div>
    `;
    rootEl.appendChild(hudEl);
    toastEl = hudEl.querySelector('#sf-hud-toast');

    // 6. Recording Export Modal
    modalEl = document.createElement('div');
    modalEl.className = 'sf-modal-backdrop';
    modalEl.style.display = 'none';
    modalEl.innerHTML = `
      <div class="sf-modal-card" role="dialog" aria-modal="true" aria-labelledby="sf-modal-title">
        <div class="sf-modal-header">
          <div class="sf-modal-title" id="sf-modal-title">
            <span class="sf-success-icon">${ICONS.check}</span>
            <span>Recording ready</span>
          </div>
          <button type="button" class="sf-icon-btn" id="sf-btn-modal-close" aria-label="Close">${ICONS.close}</button>
        </div>
        <div class="sf-modal-video-wrap">
          <video class="sf-modal-video" id="sf-modal-video" controls autoplay loop playsinline></video>
        </div>
        <div class="sf-modal-footer">
          <span class="sf-modal-meta" id="sf-modal-meta">WebM video</span>
          <div class="sf-modal-actions">
            <button type="button" class="sf-btn sf-btn-secondary" id="sf-btn-rerecord">
              ${ICONS.repeat}<span>Re-record</span>
            </button>
            <a class="sf-btn sf-btn-primary" id="sf-btn-download" download="smoothflow-recording.webm">
              ${ICONS.download}<span>Download</span>
            </a>
          </div>
        </div>
      </div>
    `;
    rootEl.appendChild(modalEl);

    document.documentElement.appendChild(rootEl);
  }

  // Toast notification for user confirmation
  function showToastNotification(text) {
    if (!toastEl) return;
    toastEl.textContent = text;
    toastEl.classList.add('active');
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      toastEl.classList.remove('active');
    }, 1800);
  }

  // Load Saved Settings from chrome.storage
  function loadStorageSettings() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['cursorEnabled', 'wheelScrollEnabled', 'spotlightEnabled', 'cursorStyle', 'cursorColor', 'cursorSize', 'cursorAutoHide', 'videoHeight', 'videoFps', 'videoFormat', TIMELINE_KEY], (res) => {
        if (res.cursorStyle && CURSOR_SHAPES[res.cursorStyle]) state.cursorStyle = res.cursorStyle;
        if (typeof res.cursorColor === 'string' && /^#[0-9a-f]{6}$/i.test(res.cursorColor)) state.cursorColor = res.cursorColor;
        if (typeof res.cursorSize === 'number') state.cursorSize = res.cursorSize;
        if (typeof res.cursorAutoHide === 'boolean') state.cursorAutoHide = res.cursorAutoHide;
        applyCursorAppearance();
        if (VIDEO_PRESETS.some(p => p.height === res.videoHeight && !p.unavailable)) state.videoHeight = res.videoHeight;
        if (res.videoFps === 30 || res.videoFps === 60) state.videoFps = res.videoFps;
        if (res.videoFormat === 'mp4' || res.videoFormat === 'webm') state.videoFormat = res.videoFormat;
        applyVideoSettingsUI();

        if (res.cursorEnabled !== undefined) {
          state.cursorEnabled = res.cursorEnabled;
          const chk = document.getElementById('sf-chk-cursor');
          if (chk) chk.checked = state.cursorEnabled;
          updateCursorVisibility();
        }
        if (res.wheelScrollEnabled !== undefined) {
          state.wheelScrollEnabled = res.wheelScrollEnabled;
          const chk = document.getElementById('sf-chk-wheel');
          if (chk) chk.checked = state.wheelScrollEnabled;
        }
        if (res.spotlightEnabled !== undefined) {
          state.spotlightEnabled = res.spotlightEnabled;
          const chk = document.getElementById('sf-chk-spotlight');
          if (chk) chk.checked = state.spotlightEnabled;
          spotlightEl.classList.toggle('active', state.spotlightEnabled);
        }
        const saved = res[TIMELINE_KEY];
        if (saved && Array.isArray(saved.steps) && saved.steps.length > 0 && (saved.version === TIMELINE_VERSION || saved.version === 3)) {
          state.timelineSteps = saved.version === 3 ? migrateV3Steps(saved.steps) : saved.steps.map(s => makeScene(s));
          renderTimelineUI();
        }
      });
    }
  }

  function saveCursorSettings() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({
        cursorStyle: state.cursorStyle,
        cursorColor: state.cursorColor,
        cursorSize: state.cursorSize,
        cursorAutoHide: state.cursorAutoHide
      });
    }
  }

  function saveVideoSettings() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ videoHeight: state.videoHeight, videoFps: state.videoFps, videoFormat: state.videoFormat });
    }
  }

  // Pixels a tab recording can capture: the page's size on screen at full Retina density
  function nativeCaptureSize() {
    const dpr = window.devicePixelRatio || 1;
    return { width: Math.round(window.innerWidth * dpr), height: Math.round(window.innerHeight * dpr) };
  }

  // Output frame for a chosen height, keeping the captured page's shape (even sizes for H.264).
  // H.264 can't go wider than 4096px, so very wide 4K frames shrink to fit instead of stretching.
  function exportSize(height, srcWidth, srcHeight, format = state.videoFormat) {
    const even = (n) => Math.round(n / 2) * 2;
    let width = height * srcWidth / srcHeight;
    if (format === 'mp4' && width > 4096) {
      height = height * 4096 / width;
      width = 4096;
    }
    return { width: even(width), height: even(height) };
  }

  function pickRecorderMimeType(format) {
    const options = format === 'mp4'
      ? ['video/mp4;codecs=avc1.640034', 'video/mp4;codecs=avc1', 'video/mp4']
      : ['video/webm;codecs=vp9', 'video/webm'];
    return options.find(t => MediaRecorder.isTypeSupported(t)) ||
      (MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : '');
  }

  function applyVideoSettingsUI() {
    if (!hudEl) return;
    const native = nativeCaptureSize();
    const out = exportSize(state.videoHeight, native.width, native.height);
    const preset = VIDEO_PRESETS.find(p => p.height === state.videoHeight);

    hudEl.querySelectorAll('#sf-video-res .sf-segment').forEach(btn => {
      const on = parseInt(btn.getAttribute('data-height')) === state.videoHeight;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-checked', String(on));
    });
    hudEl.querySelectorAll('#sf-video-fps .sf-segment').forEach(btn => {
      const on = parseInt(btn.getAttribute('data-fps')) === state.videoFps;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-checked', String(on));
    });
    hudEl.querySelectorAll('#sf-video-format .sf-segment').forEach(btn => {
      const on = btn.getAttribute('data-format') === state.videoFormat;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-checked', String(on));
    });

    hudEl.querySelector('#sf-video-dims').textContent = `${out.width}×${out.height}`;
    hudEl.querySelector('#sf-video-native').textContent = state.videoHeight > native.height
      ? `Your screen captures ${native.width}×${native.height}, so ${preset.label} is upscaled — bigger file, not sharper.`
      : `Your screen captures ${native.width}×${native.height}, so ${preset.label} is full quality.`;
    hudEl.querySelector('#sf-btn-record-timeline').title = `Record · ${state.videoFormat.toUpperCase()} ${preset.label} ${state.videoFps}fps`;
  }

  function saveTimelineSteps() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ [TIMELINE_KEY]: { version: TIMELINE_VERSION, steps: state.timelineSteps } });
    }
  }

  // Event Listeners Binding
  function bindEvents() {
    // Draggable HUD
    setupDraggable(hudEl, document.getElementById('sf-hud-header'));

    // Header buttons
    document.getElementById('sf-btn-close').addEventListener('click', () => toggleHUD(false));
    document.getElementById('sf-btn-minimize').addEventListener('click', () => {
      state.hudMinimized = !state.hudMinimized;
      hudEl.classList.toggle('sf-minimized', state.hudMinimized);
    });

    // Sidebar navigation items
    document.querySelectorAll('.sf-side-item').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.sf-side-item').forEach(b => {
          b.classList.remove('active');
          b.setAttribute('aria-selected', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
        state.activeTab = btn.getAttribute('data-tab');

        ['director', 'cursor', 'scroll', 'video', 'settings'].forEach(tabName => {
          const pane = document.getElementById(`sf-view-${tabName}`);
          if (pane) pane.style.display = state.activeTab === tabName ? '' : 'none';
        });
        document.getElementById('sf-director-footer').style.display = state.activeTab === 'director' ? '' : 'none';
      });
    });

    // Timeline Actions
    document.getElementById('sf-btn-add-step').addEventListener('click', () => {
      addTimelineStep();
    });

    document.getElementById('sf-btn-play-timeline').addEventListener('click', () => {
      playTimelineSequence();
    });

    document.getElementById('sf-btn-record-timeline').addEventListener('click', () => {
      startRecordAndTimelineSequence();
    });

    // Cursor Tab Controls
    const chkCursor = document.getElementById('sf-chk-cursor');
    if (chkCursor) {
      chkCursor.addEventListener('change', (e) => {
        state.cursorEnabled = e.target.checked;
        updateCursorVisibility();
      });
    }

    // Video export settings
    hudEl.querySelectorAll('#sf-video-res .sf-segment').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        state.videoHeight = parseInt(btn.getAttribute('data-height'));
        applyVideoSettingsUI();
        saveVideoSettings();
      });
    });
    hudEl.querySelectorAll('#sf-video-fps .sf-segment').forEach(btn => {
      btn.addEventListener('click', () => {
        state.videoFps = parseInt(btn.getAttribute('data-fps'));
        applyVideoSettingsUI();
        saveVideoSettings();
      });
    });
    hudEl.querySelectorAll('#sf-video-format .sf-segment').forEach(btn => {
      btn.addEventListener('click', () => {
        state.videoFormat = btn.getAttribute('data-format');
        applyVideoSettingsUI();
        saveVideoSettings();
      });
    });
    window.addEventListener('resize', applyVideoSettingsUI, { passive: true });

    const chkAutoHide = document.getElementById('sf-chk-autohide');
    chkAutoHide.addEventListener('change', (e) => {
      state.cursorAutoHide = e.target.checked;
      saveCursorSettings();
    });

    document.querySelectorAll('#sf-cursor-styles .sf-style-option').forEach(btn => {
      btn.addEventListener('click', () => {
        state.cursorStyle = btn.getAttribute('data-style');
        applyCursorAppearance();
        saveCursorSettings();
      });
    });

    document.querySelectorAll('#sf-cursor-colors .sf-swatch[data-color]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.cursorColor = btn.getAttribute('data-color');
        applyCursorAppearance();
        saveCursorSettings();
      });
    });

    document.getElementById('sf-cursor-color-custom').addEventListener('input', (e) => {
      state.cursorColor = e.target.value;
      applyCursorAppearance();
      saveCursorSettings();
    });

    const sliderCursorSize = document.getElementById('sf-slider-cursor-size');
    updateRangeFill(sliderCursorSize);
    sliderCursorSize.addEventListener('input', (e) => {
      state.cursorSize = parseInt(e.target.value);
      applyCursorAppearance();
      saveCursorSettings();
    });

    const sliderSmoothing = document.getElementById('sf-slider-smoothing');
    if (sliderSmoothing) {
      updateRangeFill(sliderSmoothing);
      sliderSmoothing.addEventListener('input', (e) => {
        state.cursorSmoothing = parseFloat(e.target.value);
        document.getElementById('sf-smoothing-disp').textContent = state.cursorSmoothing.toFixed(2);
        updateRangeFill(e.target);
      });
    }

    const chkRipple = document.getElementById('sf-chk-ripple');
    if (chkRipple) {
      chkRipple.addEventListener('change', (e) => {
        state.rippleEnabled = e.target.checked;
      });
    }

    const chkSpotlight = document.getElementById('sf-chk-spotlight');
    if (chkSpotlight) {
      chkSpotlight.addEventListener('change', (e) => {
        state.spotlightEnabled = e.target.checked;
        spotlightEl.classList.toggle('active', state.spotlightEnabled);
      });
    }

    // Scroll Tab Controls
    const chkWheel = document.getElementById('sf-chk-wheel');
    if (chkWheel) {
      chkWheel.addEventListener('change', (e) => {
        state.wheelScrollEnabled = e.target.checked;
      });
    }

    const sliderDamping = document.getElementById('sf-slider-damping');
    if (sliderDamping) {
      updateRangeFill(sliderDamping);
      sliderDamping.addEventListener('input', (e) => {
        state.wheelDamping = parseFloat(e.target.value);
        document.getElementById('sf-damping-disp').textContent = state.wheelDamping.toFixed(2);
        updateRangeFill(e.target);
      });
    }

    // Modal Events
    document.getElementById('sf-btn-modal-close').addEventListener('click', closeModal);
    document.getElementById('sf-btn-rerecord').addEventListener('click', () => {
      closeModal();
      startRecordAndTimelineSequence();
    });

    // Chrome Runtime Message Listener (from popup)
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
        if (req.action === 'TOGGLE_HUD') {
          toggleHUD();
          sendResponse({ success: true, hudVisible: state.hudVisible });
        } else if (req.action === 'PLAY_SCROLL') {
          playTimelineSequence();
          sendResponse({ success: true });
        } else if (req.action === 'RECORD_AND_SCROLL') {
          startRecordAndTimelineSequence();
          sendResponse({ success: true });
        } else if (req.action === 'SET_SETTING') {
          if (req.key === 'cursorEnabled') {
            state.cursorEnabled = req.value;
            const chk = document.getElementById('sf-chk-cursor');
            if (chk) chk.checked = state.cursorEnabled;
            updateCursorVisibility();
          } else if (req.key === 'wheelScrollEnabled') {
            state.wheelScrollEnabled = req.value;
            const chk = document.getElementById('sf-chk-wheel');
            if (chk) chk.checked = state.wheelScrollEnabled;
          } else if (req.key === 'spotlightEnabled') {
            state.spotlightEnabled = req.value;
            const chk = document.getElementById('sf-chk-spotlight');
            if (chk) chk.checked = state.spotlightEnabled;
            spotlightEl.classList.toggle('active', state.spotlightEnabled);
          }
          sendResponse({ success: true });
        }
      });
    }

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (state.pickingTarget !== null) {
          stopPicker();
        }
        if (state.isPlaying) {
          state.isPlaying = false;
        }
      }

      // ⌘⇧ + letter on macOS, Ctrl+Shift + letter elsewhere. Match e.code (physical
      // key) so it works on any keyboard layout. Handled in-page (not chrome.commands)
      // because getDisplayMedia needs the user activation from a real keypress.
      const primaryMod = IS_MAC ? e.metaKey : e.ctrlKey;
      const otherMod = IS_MAC ? e.ctrlKey : e.metaKey;
      if (!primaryMod || !e.shiftKey || e.altKey || otherMod) return;

      if (e.code === 'KeyE') {
        e.preventDefault();
        toggleHUD();
      } else if (e.code === 'KeyS') {
        e.preventDefault();
        playTimelineSequence();
      } else if (e.code === 'KeyL') {
        e.preventDefault();
        startRecordAndTimelineSequence();
      }
    }, { capture: true });

    // Mouse Tracking for Cursor & Spotlight
    window.addEventListener('mousemove', (e) => {
      // Ignore synthetic moves Chrome can send while the page scrolls under a still mouse
      if (e.clientX !== cursorActivity.lastX || e.clientY !== cursorActivity.lastY) {
        cursorActivity.lastMove = performance.now();
        cursorActivity.lastX = e.clientX;
        cursorActivity.lastY = e.clientY;
        cursorActivity.hovering = !rootEl.contains(e.target) && !!(e.target.closest && e.target.closest(INTERACTIVE_SELECTOR));
      }
      cursorState.targetX = e.clientX;
      cursorState.targetY = e.clientY;
      if (!cursorState.active && state.cursorEnabled) {
        cursorState.currX = e.clientX;
        cursorState.currY = e.clientY;
        cursorState.active = true;
      }
      if (state.spotlightEnabled) {
        spotlightEl.style.setProperty('--mouse-x', `${e.clientX}px`);
        spotlightEl.style.setProperty('--mouse-y', `${e.clientY}px`);
      }
    }, { passive: true });

    // Clicks show the cursor (with a small press) in "show only on activity" mode
    window.addEventListener('pointerdown', () => {
      cursorActivity.lastClick = performance.now();
      cursorEl.classList.add('is-pressed');
    }, { passive: true });
    window.addEventListener('pointerup', () => cursorEl.classList.remove('is-pressed'), { passive: true });

    // Scrolling hides the cursor in "show only on activity" mode
    window.addEventListener('scroll', () => {
      cursorActivity.lastScroll = performance.now();
      cursorActivity.hovering = false;
    }, { passive: true });

    // Click Ripple Trigger
    window.addEventListener('pointerdown', (e) => {
      if (!state.rippleEnabled) return;
      if (hudEl.contains(e.target) || modalEl.contains(e.target)) return;
      createRipple(e.clientX, e.clientY);
    });

    // Butter Wheel Scroll Interception
    window.addEventListener('wheel', handleWheelScroll, { passive: false });
  }

  // Paint the filled part of a range track up to the thumb
  function updateRangeFill(range) {
    const min = parseFloat(range.min);
    const max = parseFloat(range.max);
    const pct = ((parseFloat(range.value) - min) / (max - min)) * 100;
    range.style.setProperty('--sf-fill', `${pct}%`);
  }

  function toggleHUD(forceState) {
    state.hudVisible = forceState !== undefined ? forceState : !state.hudVisible;
    hudEl.classList.toggle('sf-hidden', !state.hudVisible);
  }

  // Draggable HUD
  function setupDraggable(container, handle) {
    let isDragging = false;
    let startX, startY, origLeft, origTop;

    handle.addEventListener('mousedown', (e) => {
      if (e.target.closest('button') || e.target.closest('input')) return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = container.getBoundingClientRect();
      origLeft = rect.left;
      origTop = rect.top;

      container.style.right = 'auto';
      container.style.left = `${origLeft}px`;
      container.style.top = `${origTop}px`;

      const onMouseMove = (ev) => {
        if (!isDragging) return;
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        container.style.left = `${Math.max(12, Math.min(window.innerWidth - container.offsetWidth - 12, origLeft + dx))}px`;
        container.style.top = `${Math.max(12, Math.min(window.innerHeight - container.offsetHeight - 12, origTop + dy))}px`;
      };

      const onMouseUp = () => {
        isDragging = false;
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    });
  }

  // ==========================================================================
  // Element targets — scenes point at page elements, resolved at play time
  // ==========================================================================

  // Prefer the meaningful element under the pointer (the button, not the <span> inside it)
  function pickableElement(el) {
    return el.closest('a, button, [role="button"], input, select, textarea, label, img, video, h1, h2, h3, h4, h5, h6') || el;
  }

  function buildSelector(el) {
    const hasUniqueId = (node) => node.id && document.querySelectorAll(`#${CSS.escape(node.id)}`).length === 1;
    const parts = [];
    for (let node = el; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
      if (hasUniqueId(node)) {
        parts.unshift(`#${CSS.escape(node.id)}`);
        return parts.join(' > ');
      }
      let part = node.tagName.toLowerCase();
      const siblings = node.parentElement ? Array.from(node.parentElement.children).filter(c => c.tagName === node.tagName) : [];
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
      parts.unshift(part);
    }
    parts.unshift('body');
    return parts.join(' > ');
  }

  function describeElement(el, textEl = el) {
    const tag = el.tagName.toLowerCase();
    const raw = textEl.getAttribute('aria-label') || textEl.getAttribute('alt') || textEl.getAttribute('title') || textEl.textContent || '';
    const text = raw.replace(/\s+/g, ' ').trim();
    if (text) return `${tag} · ${text.length > 36 ? `${text.slice(0, 36)}…` : text}`;
    return el.id ? `${tag}#${el.id}` : tag;
  }

  function findSceneElement(step) {
    if (!step.target || !step.target.selector) return null;
    try {
      return document.querySelector(step.target.selector);
    } catch (err) {
      return null;
    }
  }

  // Document-relative top from layout. Ignores transforms, so reveal animations
  // (e.g. translateY(40px) → 0) don't shift where a scene lands.
  function layoutTop(el) {
    if (!(el instanceof HTMLElement)) return el.getBoundingClientRect().top + window.scrollY;
    let top = 0;
    for (let node = el; node; node = node.offsetParent) top += node.offsetTop;
    return top;
  }

  function clampScroll(y) {
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    return Math.max(0, Math.min(maxScroll, y));
  }

  // Bypass any `scroll-behavior: smooth` on the host page — we animate ourselves
  function jumpTo(y) {
    window.scrollTo({ top: y, left: 0, behavior: 'instant' });
  }

  // Where the page should be scrolled to frame a scene
  function sceneScrollY(step) {
    const el = findSceneElement(step);
    if (!el) return clampScroll(step.offset || 0);
    const top = layoutTop(el);
    const height = el.offsetHeight || el.getBoundingClientRect().height;
    const vh = window.innerHeight;
    // Center elements that fit on screen; align taller ones (sections) near the top
    const y = height < vh * 0.8 ? top + height / 2 - vh / 2 : top - 64;
    return Math.round(clampScroll(y));
  }

  // Where the cursor should land on a scene's element once scrolled to scrollY
  function sceneCursorPoint(step, scrollY) {
    const el = findSceneElement(step);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const height = el.offsetHeight || rect.height;
    const vh = window.innerHeight;
    const viewTop = layoutTop(el) - scrollY;
    // Aim at the middle of the part of the element that's on screen
    const visTop = Math.max(viewTop, 0);
    const visBottom = Math.min(viewTop + height, vh);
    const y = visBottom > visTop ? (visTop + visBottom) / 2 : viewTop + height / 2;
    return {
      x: Math.max(16, Math.min(window.innerWidth - 16, rect.left + rect.width / 2)),
      y: Math.max(16, Math.min(vh - 16, y))
    };
  }

  function makeScene(fields = {}) {
    return Object.assign({
      id: Date.now() + Math.random(),
      name: 'Scene',
      target: null,
      offset: 0,
      moveDuration: 2.0, // scroll here from the previous scene
      easing: 'cinematic',
      waitDuration: 3.0 // hold after arriving
    }, fields);
  }

  // v3 scenes had glide-in + wait + an in-section scroll; split the scroll into its own scene
  function migrateV3Steps(steps) {
    const out = [];
    steps.forEach(s => {
      out.push(makeScene({
        id: s.id, name: s.name, target: s.target, offset: s.offset,
        moveDuration: s.glideDuration ?? 2.0, easing: s.glideEasing || 'cinematic', waitDuration: s.waitDuration ?? 3.0
      }));
      if (s.scrollTo !== null && s.scrollTo !== undefined && s.scrollDuration > 0) {
        out.push(makeScene({ name: `${s.name} · scroll`, offset: s.scrollTo, moveDuration: s.scrollDuration, easing: 'cruise', waitDuration: 0 }));
      }
    });
    return out;
  }



  // ==========================================================================
  // Element picker
  // ==========================================================================

  function startPicker(sceneIndex) {
    stopPicker();
    state.pickingTarget = sceneIndex;
    pickerBoxEl.style.display = 'block';
    pickerBoxEl.style.width = '0px';
    pickerBoxEl.style.height = '0px';
    const tag = document.getElementById('sf-picker-tag');

    const stepName = state.timelineSteps[sceneIndex] ? state.timelineSteps[sceneIndex].name : `Scene ${sceneIndex + 1}`;
    tag.textContent = `Click an element for “${stepName}” · Esc to cancel`;

    // Picker box is position: fixed, so viewport coordinates
    const onPickerHover = (e) => {
      if (rootEl.contains(e.target)) return;
      const el = pickableElement(e.target);
      const rect = el.getBoundingClientRect();
      pickerBoxEl.style.width = `${rect.width}px`;
      pickerBoxEl.style.height = `${rect.height}px`;
      pickerBoxEl.style.left = `${rect.left}px`;
      pickerBoxEl.style.top = `${rect.top}px`;
      tag.textContent = `${describeElement(el)} · click to use for “${stepName}”`;
    };

    const onPickerClick = (e) => {
      if (rootEl.contains(e.target)) return;
      e.preventDefault();
      e.stopPropagation();

      const el = pickableElement(e.target);
      const step = state.timelineSteps[state.pickingTarget];
      if (step) {
        // Pinned / scroll-animated elements (inside position: fixed or transformed
        // containers) show up far from their layout position. Going "to the element"
        // would jump to the wrong place, so use the scroll position the user is looking at.
        const visualTop = el.getBoundingClientRect().top + window.scrollY;
        const isPinned = Math.abs(visualTop - layoutTop(el)) > 150;
        if (isPinned) {
          step.target = null;
          step.offset = Math.round(window.scrollY);
          showToastNotification(`Animated element — ${step.name} set to this view (${step.offset}px)`);
        } else {
          step.target = { selector: buildSelector(el), label: describeElement(el) };
          step.offset = sceneScrollY(step); // fallback if the element disappears later
          showToastNotification(`${step.name} → ${step.target.label}`);
        }
        renderTimelineUI();
        saveTimelineSteps();
      }

      stopPicker();
    };

    pickerHandlers = { hover: onPickerHover, click: onPickerClick };
    window.addEventListener('mousemove', onPickerHover, { passive: true });
    window.addEventListener('click', onPickerClick, { capture: true });
  }

  function stopPicker() {
    state.pickingTarget = null;
    pickerBoxEl.style.display = 'none';
    if (pickerHandlers) {
      window.removeEventListener('mousemove', pickerHandlers.hover);
      window.removeEventListener('click', pickerHandlers.click, { capture: true });
      pickerHandlers = null;
    }
  }

  // Default timeline: one scene per detected page section
  function detectPageScenes() {
    const docHeight = document.documentElement.scrollHeight;
    const candidates = Array.from(document.querySelectorAll('section, [id*="feature"], [id*="pricing"], [id*="about"], [class*="feature"], [class*="pricing"], footer, main > div'));
    const found = [];

    candidates.forEach(el => {
      if (rootEl.contains(el) || !el.offsetHeight) return;
      const top = layoutTop(el);
      // Skip nested duplicates (a section and its wrapper) and near-identical tops
      const duplicate = found.some(f => f.el.contains(el) || el.contains(f.el) || Math.abs(f.top - top) < 120);
      if (top < docHeight - 150 && !duplicate) {
        found.push({ el, top });
      }
    });
    found.sort((a, b) => a.top - b.top);

    const sceneFor = (el, fallbackName) => {
      const heading = el.querySelector('h1, h2, h3');
      const text = (heading || el).textContent.replace(/\s+/g, ' ').trim();
      const scene = makeScene({
        name: text ? (text.length > 28 ? `${text.slice(0, 28)}…` : text) : fallbackName,
        target: { selector: buildSelector(el), label: describeElement(el, heading || el) }
      });
      scene.offset = sceneScrollY(scene);
      return scene;
    };

    const steps = [];
    const hero = found.length && found[0].top <= 200 ? found.shift() : null;
    steps.push(hero ? sceneFor(hero.el, 'Hero') : makeScene({ name: 'Top of page', offset: 0 }));
    found.slice(0, 3).forEach((f, i) => steps.push(sceneFor(f.el, `Section ${i + 2}`)));

    if (steps.length < 2) {
      const maxScroll = clampScroll(Infinity);
      steps.push(makeScene({ name: 'Middle', offset: Math.round(maxScroll * 0.45) }));
      steps.push(makeScene({ name: 'Bottom', offset: maxScroll }));
    }
    steps[steps.length - 1].easing = 'easeOut';
    state.timelineSteps = steps;
  }

  // Smooth scroll interpolation; resolves false if playback was cancelled
  function executeCinematicScroll(startY, targetY, durationMs, easingType) {
    return new Promise((resolve) => {
      const easeFn = easings[easingType] || easings.cinematic;
      const distance = targetY - startY;
      const startTime = performance.now();

      function step(now) {
        if (!state.isPlaying) {
          resolve(false);
          return;
        }

        const progress = Math.min(1, (now - startTime) / durationMs);
        const easedProgress = Math.max(0, Math.min(1.05, easeFn(progress)));
        jumpTo(Math.max(0, startY + distance * easedProgress));

        if (progress < 1) {
          requestAnimationFrame(step);
        } else {
          jumpTo(targetY);
          resolve(true);
        }
      }

      requestAnimationFrame(step);
    });
  }

  // Glide the virtual cursor to a viewport point, optionally after a delay
  async function glideCursor(to, durationMs, delayMs) {
    if (delayMs > 0) await holdFor(delayMs);
    if (!state.isPlaying) return;

    const fromX = cursorState.currX;
    const fromY = cursorState.currY;
    const startTime = performance.now();

    await new Promise((resolve) => {
      function step(now) {
        if (!state.isPlaying) {
          resolve();
          return;
        }
        const progress = Math.min(1, (now - startTime) / durationMs);
        const eased = easings.easeInOut(progress);
        cursorState.currX = fromX + (to.x - fromX) * eased;
        cursorState.currY = fromY + (to.y - fromY) * eased;
        if (progress < 1) requestAnimationFrame(step);
        else resolve();
      }
      requestAnimationFrame(step);
    });
  }

  // Wait that ends early if playback is cancelled (Esc)
  async function holdFor(ms) {
    const end = performance.now() + ms;
    while (state.isPlaying && performance.now() < end) {
      await sleep(Math.min(50, end - performance.now()));
    }
  }

  // ==========================================================================
  // Timeline Storyboard UI
  // ==========================================================================

  function renderTimelineUI() {
    const listEl = document.getElementById('sf-timeline-list');
    if (!listEl) return;

    listEl.innerHTML = '';

    state.timelineSteps.forEach((step, index) => {
      const card = document.createElement('div');
      card.className = `sf-scene-card ${state.activePlayingSceneIndex === index ? 'playing' : ''}`;
      card.setAttribute('data-index', index);

      const isFirst = index === 0;
      const targetEl = findSceneElement(step);
      const toY = sceneScrollY(step);
      const easingOptions = [
        ['cinematic', 'Cinematic'],
        ['easeInOut', 'Smooth'],
        ['easeOut', 'Soft landing'],
        ['cruise', 'Constant'],
        ['linear', 'Linear'],
        ['snappy', 'Snappy'],
        ['spring', 'Spring']
      ].map(([value, label]) => `<option value="${value}" ${step.easing === value ? 'selected' : ''}>${label}</option>`).join('');

      // Show where this move goes from/to, and flag moves that go nowhere or upward
      let moveNote = '';
      if (!isFirst && step.moveDuration > 0) {
        const fromY = sceneScrollY(state.timelineSteps[index - 1]);
        const dist = toY - fromY;
        if (Math.abs(dist) < 50) {
          moveNote = `<div class="sf-field-hint">Already at ${toY}px from the previous scene, so the page won't move. Scroll to the new spot and press ↓.</div>`;
        } else if (dist < 0) {
          moveNote = `<div class="sf-field-hint">Goes UP ${fromY} → ${toY}px (${dist}px) in ${step.moveDuration.toFixed(1)}s</div>`;
        } else {
          moveNote = `<div class="sf-field-note">Goes ${fromY} → ${toY}px (+${dist}px) in ${step.moveDuration.toFixed(1)}s</div>`;
        }
      }

      const targetField = step.target ? `
        <div class="sf-target-chip ${targetEl ? '' : 'is-missing'}" title="${escapeHtml(step.target.selector)}">
          <span class="sf-target-icon">${ICONS.target}</span>
          <span class="sf-target-label">${escapeHtml(targetEl ? step.target.label : `Not found on this page · using ${step.offset}px`)}</span>
          <button type="button" class="sf-target-clear sf-step-clear-target" data-index="${index}" title="Remove element (use a fixed position)" aria-label="Remove element target">${ICONS.close}</button>
        </div>
      ` : `
        <label class="sf-input-group">
          <input type="number" min="0" max="99999" step="50" class="sf-step-offset-input" value="${step.offset}" data-index="${index}" aria-label="Scene position">
          <span class="sf-input-unit">px</span>
        </label>
      `;

      card.innerHTML = `
        <div class="sf-scene-top">
          <span class="sf-scene-num">${index + 1}</span>
          <input type="text" class="sf-scene-name-input" value="${escapeHtml(step.name)}" data-index="${index}" placeholder="Scene ${index + 1}" aria-label="Scene name">
          <div class="sf-scene-tools">
            <button type="button" class="sf-tool-btn sf-step-curr-btn" data-index="${index}" title="Use the current scroll position" aria-label="Use current scroll position">${ICONS.here}</button>
            <button type="button" class="sf-tool-btn sf-step-pick-btn" data-index="${index}" title="Pick an element on the page" aria-label="Pick element on page">${ICONS.pick}</button>
            ${state.timelineSteps.length > 1 ? `
              <button type="button" class="sf-tool-btn sf-tool-btn-danger sf-step-del-btn" data-index="${index}" title="Delete scene" aria-label="Delete scene">${ICONS.trash}</button>
            ` : ''}
          </div>
        </div>

        <div class="sf-field">
          <span class="sf-field-label">${isFirst ? 'Starts at' : 'Goes to'} ${step.target ? `element · ${toY}px` : 'position'}</span>
          ${targetField}
        </div>

        <div class="sf-scene-fields sf-scene-fields-move">
          <label class="sf-field" title="${isFirst ? 'First scene — the timeline starts here' : 'Seconds to scroll here from the previous scene'}">
            <span class="sf-field-label">Move</span>
            <span class="sf-input-group ${isFirst ? 'is-disabled' : ''}">
              <input type="number" min="0" max="120" step="0.5" class="sf-step-move-input" value="${step.moveDuration.toFixed(1)}" data-index="${index}" ${isFirst ? 'disabled' : ''}>
              <span class="sf-input-unit">s</span>
            </span>
          </label>
          <label class="sf-field" title="Seconds to hold after arriving">
            <span class="sf-field-label">Wait</span>
            <span class="sf-input-group">
              <input type="number" min="0" max="120" step="0.5" class="sf-step-wait-input" value="${step.waitDuration.toFixed(1)}" data-index="${index}">
              <span class="sf-input-unit">s</span>
            </span>
          </label>
          <label class="sf-field" title="Constant = steady speed, best for scroll-animated sections">
            <span class="sf-field-label">Easing</span>
            <span class="sf-select-wrap">
              <select class="sf-select sf-scene-easing-select" data-index="${index}" ${isFirst ? 'disabled' : ''}>${easingOptions}</select>
              ${ICONS.chevron}
            </span>
          </label>
        </div>

        ${moveNote}
      `;

      listEl.appendChild(card);
    });

    updateTotalTimelineTime();
    wireTimelineEventListeners(listEl);
  }

  function wireTimelineEventListeners(listEl) {
    const idxOf = (el) => parseInt(el.getAttribute('data-index'));
    const onNumber = (selector, field) => {
      listEl.querySelectorAll(selector).forEach(input => {
        input.addEventListener('input', (e) => {
          state.timelineSteps[idxOf(e.target)][field] = Math.max(0, parseFloat(e.target.value) || 0);
          updateTotalTimelineTime();
          saveTimelineSteps();
        });
        input.addEventListener('change', renderTimelineUI);
      });
    };

    listEl.querySelectorAll('.sf-scene-name-input').forEach(input => {
      input.addEventListener('input', (e) => {
        const idx = idxOf(e.target);
        state.timelineSteps[idx].name = e.target.value.trim() || `Scene ${idx + 1}`;
        saveTimelineSteps();
      });
    });

    onNumber('.sf-step-offset-input', 'offset');
    onNumber('.sf-step-move-input', 'moveDuration');
    onNumber('.sf-step-wait-input', 'waitDuration');

    listEl.querySelectorAll('.sf-scene-easing-select').forEach(select => {
      select.addEventListener('change', (e) => {
        state.timelineSteps[idxOf(e.target)].easing = e.target.value;
        saveTimelineSteps();
      });
    });

    listEl.querySelectorAll('.sf-step-curr-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const step = state.timelineSteps[idxOf(btn)];
        step.target = null;
        step.offset = Math.round(window.scrollY);
        renderTimelineUI();
        saveTimelineSteps();
        showToastNotification(`${step.name} set to ${step.offset}px`);
      });
    });

    listEl.querySelectorAll('.sf-step-pick-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        startPicker(idxOf(btn));
      });
    });

    listEl.querySelectorAll('.sf-step-clear-target').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const step = state.timelineSteps[idxOf(btn)];
        step.offset = sceneScrollY(step);
        step.target = null;
        renderTimelineUI();
        saveTimelineSteps();
      });
    });

    listEl.querySelectorAll('.sf-step-del-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        state.timelineSteps.splice(idxOf(btn), 1);
        renderTimelineUI();
        saveTimelineSteps();
      });
    });
  }

  function addTimelineStep() {
    const lastStep = state.timelineSteps[state.timelineSteps.length - 1];
    state.timelineSteps.push(makeScene({
      name: `Scene ${state.timelineSteps.length + 1}`,
      offset: lastStep ? Math.round(clampScroll(sceneScrollY(lastStep) + 700)) : 0
    }));
    renderTimelineUI();
    saveTimelineSteps();
  }

  // Seconds a scene takes: move here (not for the first scene) + wait
  function sceneSeconds(step, index) {
    return (index === 0 ? 0 : (step.moveDuration || 0)) + (step.waitDuration || 0);
  }

  function updateTotalTimelineTime() {
    const totalSecs = state.timelineSteps.reduce((sum, step, idx) => sum + sceneSeconds(step, idx), 0);
    const totalBadge = document.getElementById('sf-timeline-total-badge');
    if (totalBadge) {
      const n = state.timelineSteps.length;
      totalBadge.textContent = `${n} ${n === 1 ? 'scene' : 'scenes'} · ~${Math.round(totalSecs)}s`;
    }
  }

  function highlightActiveScene(index) {
    state.activePlayingSceneIndex = index;
    const cards = document.querySelectorAll('.sf-scene-card');
    cards.forEach((c, idx) => {
      c.classList.toggle('playing', idx === index);
    });
  }

  function clearSceneHighlights() {
    state.activePlayingSceneIndex = -1;
    document.querySelectorAll('.sf-scene-card').forEach(c => c.classList.remove('playing'));
  }

  // For each scene: move to it (the cursor travels onto the scene's element alongside) → wait
  async function playTimelineSequence() {
    if (state.isPlaying || state.timelineSteps.length === 0) return;

    state.isPlaying = true;
    wheelState.animating = false;
    const steps = state.timelineSteps;

    jumpTo(sceneScrollY(steps[0]));
    // In "show only on activity" mode the cursor follows the real mouse (it's hidden
    // while the page scrolls or waits), so the timeline doesn't drive it
    const scriptCursor = !state.cursorAutoHide;
    cursorState.scripted = scriptCursor;
    if (scriptCursor && !cursorState.active) {
      cursorState.currX = window.innerWidth / 2;
      cursorState.currY = window.innerHeight * 0.6;
      cursorState.active = true;
    }

    for (let i = 0; i < steps.length && state.isPlaying; i++) {
      const step = steps[i];
      highlightActiveScene(i);

      // Element positions are resolved now, so layout shifts from page animations are respected
      const toY = sceneScrollY(step);
      const moveMs = i === 0 ? 0 : (step.moveDuration || 0) * 1000;
      const cursorTo = scriptCursor ? sceneCursorPoint(step, toY) : null;
      if (moveMs > 0) {
        await Promise.all([
          executeCinematicScroll(window.scrollY, toY, moveMs, step.easing),
          cursorTo ? glideCursor(cursorTo, moveMs, 0) : null
        ]);
      } else {
        jumpTo(toY);
        if (cursorTo) {
          cursorState.currX = cursorTo.x;
          cursorState.currY = cursorTo.y;
        }
      }

      if (step.waitDuration > 0) await holdFor(step.waitDuration * 1000);
    }

    cursorState.scripted = false;
    clearSceneHighlights();
    state.isPlaying = false;
  }

  async function startRecordAndTimelineSequence() {
    if (state.isRecording || state.isPlaying || state.timelineSteps.length === 0) return;

    let stopScaling = () => {};
    try {
      recordStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'browser',
          frameRate: { ideal: state.videoFps, max: state.videoFps },
          // Capture the tab at its real pixel size; it's scaled to the chosen size below
          width: { ideal: nativeCaptureSize().width },
          height: { ideal: nativeCaptureSize().height }
        },
        audio: false
      });

      hudEl.classList.add('sf-hidden');
      jumpTo(sceneScrollY(state.timelineSteps[0]));

      // Scale every captured frame onto a canvas at the chosen export size
      const [track] = recordStream.getVideoTracks();
      const captured = track.getSettings();
      const native = nativeCaptureSize();
      const out = exportSize(state.videoHeight, captured.width || native.width, captured.height || native.height);

      const sourceVideo = document.createElement('video');
      sourceVideo.muted = true;
      sourceVideo.playsInline = true;
      sourceVideo.srcObject = recordStream;
      await sourceVideo.play();

      const canvas = document.createElement('canvas');
      canvas.width = out.width;
      canvas.height = out.height;
      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      let scaling = true;
      const drawFrame = () => {
        if (!scaling) return;
        if (sourceVideo.readyState >= 2) ctx.drawImage(sourceVideo, 0, 0, out.width, out.height);
        requestAnimationFrame(drawFrame);
      };
      requestAnimationFrame(drawFrame);
      stopScaling = () => {
        scaling = false;
        sourceVideo.srcObject = null;
      };

      await runCountdown();

      recordedChunks = [];
      const mimeType = pickRecorderMimeType(state.videoFormat);
      const isMp4 = mimeType.startsWith('video/mp4');
      const exportInfo = {
        ext: isMp4 ? 'mp4' : 'webm',
        format: isMp4 ? 'MP4' : 'WebM',
        width: out.width,
        height: out.height,
        fps: state.videoFps
      };

      mediaRecorder = new MediaRecorder(canvas.captureStream(state.videoFps), {
        mimeType,
        // ~0.1 bits per pixel per frame: about 15 Mbps at 1080p60, 50 Mbps at 4K60
        videoBitsPerSecond: Math.round(out.width * out.height * state.videoFps * 0.1)
      });

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          recordedChunks.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        stopScaling();
        if (recordStream) {
          recordStream.getTracks().forEach(track => track.stop());
        }

        const blob = new Blob(recordedChunks, { type: isMp4 ? 'video/mp4' : 'video/webm' });
        const videoUrl = URL.createObjectURL(blob);

        openExportModal(videoUrl, blob, exportInfo);

        state.isRecording = false;
        hudEl.classList.remove('sf-hidden');
      };

      state.isRecording = true;
      mediaRecorder.start(100);

      await sleep(300);

      await playTimelineSequence();

      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
      }

    } catch (err) {
      console.warn('Timeline recording failed:', err);
      stopScaling();
      state.isRecording = false;
      hudEl.classList.remove('sf-hidden');
      if (recordStream) {
        recordStream.getTracks().forEach(track => track.stop());
      }
    }
  }

  function runCountdown() {
    return new Promise((resolve) => {
      countdownEl.classList.add('active');
      const numEl = document.getElementById('sf-countdown-num');
      let count = 3;
      numEl.textContent = count;

      const interval = setInterval(() => {
        count--;
        if (count > 0) {
          numEl.textContent = count;
        } else {
          clearInterval(interval);
          countdownEl.classList.remove('active');
          resolve();
        }
      }, 900);
    });
  }

  function openExportModal(videoUrl, blob, info) {
    const video = document.getElementById('sf-modal-video');
    video.src = videoUrl;

    const downloadBtn = document.getElementById('sf-btn-download');
    downloadBtn.href = videoUrl;
    downloadBtn.download = `smoothflow-${info.width}x${info.height}-${Date.now()}.${info.ext}`;
    downloadBtn.querySelector('span').textContent = `Download .${info.ext}`;

    const sizeMb = (blob.size / (1024 * 1024)).toFixed(1);
    document.getElementById('sf-modal-meta').textContent = `${info.format} · ${info.width}×${info.height} · ${info.fps} fps · ${sizeMb} MB`;

    modalEl.style.display = 'flex';
    requestAnimationFrame(() => modalEl.classList.add('active'));
  }

  function closeModal() {
    modalEl.classList.remove('active');
    setTimeout(() => {
      modalEl.style.display = 'none';
      const video = document.getElementById('sf-modal-video');
      video.pause();
      video.src = '';
    }, 200);
  }

  function updateCursorVisibility() {
    cursorEl.classList.toggle('active', state.cursorEnabled);
  }

  function cursorHotspotPx() {
    const shape = CURSOR_SHAPES[state.cursorStyle] || CURSOR_SHAPES.arrow;
    return [shape.hotspot[0] * state.cursorSize / 24, shape.hotspot[1] * state.cursorSize / 24];
  }

  // "Show only on activity": visible after a real move or click, or while hovering
  // something clickable — but never while the page is scrolling
  function cursorShouldShow(now) {
    if (!state.cursorAutoHide) return true;
    if (now - cursorActivity.lastScroll < CURSOR_SCROLL_HIDE_MS) return false;
    return now - cursorActivity.lastMove < CURSOR_SHOW_MS ||
      now - cursorActivity.lastClick < CURSOR_SHOW_MS ||
      cursorActivity.hovering;
  }

  // Redraw the cursor and sync the Cursor tab controls with the current settings
  function applyCursorAppearance() {
    if (!cursorEl) return;
    const { cursorStyle, cursorColor, cursorSize } = state;
    const [hx, hy] = cursorHotspotPx();
    cursorEl.style.width = `${cursorSize}px`;
    cursorEl.style.height = `${cursorSize}px`;
    cursorEl.innerHTML = cursorSvg(cursorStyle, cursorColor, cursorSize);
    cursorEl.firstElementChild.style.transformOrigin = `${hx}px ${hy}px`; // press-scale around the tip
    rootEl.style.setProperty('--sf-cursor-color', cursorColor);

    if (!hudEl) return;
    hudEl.querySelectorAll('#sf-cursor-styles .sf-style-option').forEach(btn => {
      const key = btn.getAttribute('data-style');
      const selected = key === cursorStyle;
      btn.classList.toggle('active', selected);
      btn.setAttribute('aria-checked', String(selected));
      btn.querySelector('.sf-style-preview').innerHTML = cursorSvg(key, cursorColor, 24);
    });
    hudEl.querySelectorAll('#sf-cursor-colors .sf-swatch[data-color]').forEach(btn => {
      const selected = btn.getAttribute('data-color').toLowerCase() === cursorColor.toLowerCase();
      btn.classList.toggle('active', selected);
      btn.setAttribute('aria-checked', String(selected));
    });
    const custom = hudEl.querySelector('#sf-cursor-color-custom');
    custom.value = cursorColor;
    custom.parentElement.classList.toggle('active', !CURSOR_COLORS.includes(cursorColor.toLowerCase()));
    hudEl.querySelector('#sf-cursor-color-disp').textContent = cursorColor;
    const size = hudEl.querySelector('#sf-slider-cursor-size');
    size.value = cursorSize;
    updateRangeFill(size);
    hudEl.querySelector('#sf-cursor-size-disp').textContent = `${cursorSize}px`;
    hudEl.querySelector('#sf-chk-autohide').checked = state.cursorAutoHide;
  }

  function startCursorLoop() {
    updateCursorVisibility();

    function renderCursor() {
      if (state.cursorEnabled && cursorState.active) {
        // While the timeline is playing, glideCursor() sets the position directly
        if (!cursorState.scripted) {
          const factor = state.cursorSmoothing;
          cursorState.currX += (cursorState.targetX - cursorState.currX) * factor;
          cursorState.currY += (cursorState.targetY - cursorState.currY) * factor;
        }

        const [hx, hy] = cursorHotspotPx();
        cursorEl.style.transform = `translate3d(${cursorState.currX - hx}px, ${cursorState.currY - hy}px, 0)`;
        cursorEl.classList.toggle('sf-cursor-idle', !cursorShouldShow(performance.now()));
      }
      requestAnimationFrame(renderCursor);
    }
    requestAnimationFrame(renderCursor);
  }

  function createRipple(x, y) {
    const ripple = document.createElement('div');
    ripple.className = 'sf-click-ripple';
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
    rootEl.appendChild(ripple);
    setTimeout(() => ripple.remove(), 550);
  }

  function handleWheelScroll(e) {
    if (!state.wheelScrollEnabled || state.isPlaying) return;
    if (hudEl.contains(e.target) || modalEl.contains(e.target)) return;
    // The page already smooths its own scrolling (Lenis, Locomotive) — don't double up
    if (pageHasOwnSmoothScroll()) return;

    e.preventDefault();
    // Start each new gesture from where the page actually is — it may have been
    // scrolled by the keyboard, scrollbar, a link or the timeline since the last one
    if (!wheelState.animating) {
      wheelState.currentY = window.scrollY;
      wheelState.targetY = window.scrollY;
      wheelState.animating = true;
    }
    wheelState.targetY = clampScroll(wheelState.targetY + e.deltaY);
  }

  function pageHasOwnSmoothScroll() {
    const html = document.documentElement;
    return html.classList.contains('lenis') || html.classList.contains('lenis-smooth') || !!document.querySelector('[data-scroll-container]');
  }

  function startWheelScrollLoop() {
    function step() {
      if (state.wheelScrollEnabled && wheelState.animating && !state.isPlaying) {
        const diff = wheelState.targetY - wheelState.currentY;
        if (Math.abs(diff) > 0.5) {
          wheelState.currentY += diff * (1 - state.wheelDamping);
          jumpTo(wheelState.currentY);
        } else {
          wheelState.currentY = wheelState.targetY;
          jumpTo(wheelState.currentY);
          wheelState.animating = false;
        }
      }
      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

// ============================================================
//  Content Script - News Ticker Bar
//  Full-width scrolling ticker at the bottom of every page
//  Uses requestAnimationFrame for smooth, non-disruptive updates
// ============================================================

(function () {
  "use strict";
  if (document.getElementById("news-ext-root")) return;

  // ─── Detect Frame Context ──────────────────────────────────
  const isTopFrame = (window === window.top);
  const isIframe = !isTopFrame;

  // ─── Create Host Element ────────────────────────────────────
  const host = document.createElement("div");
  host.id = "news-ext-root";
  host.style.cssText = `
    position: fixed !important;
    z-index: 2147483647 !important;
    bottom: 20px !important;
    left: 50% !important;
    transform: translateX(-50%) !important;
    width: 85% !important;
    max-width: 1400px !important;
    height: auto !important;
    pointer-events: auto !important;
  `;

  // Start hidden by default - shown via extension popup toggle
  // In iframes: also hidden, only shown during fullscreen
  host.style.display = "none";

  document.documentElement.appendChild(host);

  // ─── Always On Top Enforcer ──────────────────────────────────
  if (isTopFrame) {
    const zEnforcer = new MutationObserver(() => {
      if (!document.fullscreenElement && host.parentNode === document.documentElement) {
        if (document.documentElement.lastElementChild !== host) {
          document.documentElement.appendChild(host);
        }
      }
    });
    zEnforcer.observe(document.documentElement, { childList: true });
  }

  // ─── Fullscreen Support ─────────────────────────────────────
  // In top frame: move ticker inside the fullscreen element
  // In iframe: show ticker when the iframe content goes fullscreen
  function handleFullscreenChange() {
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;

    if (isIframe) {
      // In an iframe: show ticker when something inside goes fullscreen
      if (fsEl) {
        host.style.display = "block";
        // Append inside the fullscreen element so we're in the top layer
        fsEl.appendChild(host);
        host.style.setProperty('position', 'fixed', 'important');
        host.style.setProperty('z-index', '2147483647', 'important');
      } else {
        host.style.display = "none";
        document.documentElement.appendChild(host);
      }
    } else {
      // In top frame: move ticker into the fullscreen element
      if (fsEl) {
        // Only move if the fullscreen element is NOT an iframe
        // (for iframe fullscreen, the iframe's own content script handles it)
        if (fsEl.tagName !== 'IFRAME') {
          fsEl.appendChild(host);
          host.style.setProperty('position', 'fixed', 'important');
          host.style.setProperty('z-index', '2147483647', 'important');
        }
      } else {
        document.documentElement.appendChild(host);
      }
    }
  }

  document.addEventListener("fullscreenchange", handleFullscreenChange);
  document.addEventListener("webkitfullscreenchange", handleFullscreenChange);

  const shadow = host.attachShadow({ mode: "closed" });

  // ─── Shadow DOM Styles ──────────────────────────────────────
  const style = document.createElement("style");
  style.textContent = `
    /* System fonts — no external font loading for performance & CSP compliance */

    :host {
      all: initial;
      font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
      direction: rtl;
      display: block;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    /* ─── Ticker Bar ─── */
    .ticker-bar {
      width: 100%;
      height: 42px;
      background: linear-gradient(180deg, rgba(12, 12, 20, 0.97) 0%, rgba(8, 8, 16, 0.99) 100%);
      border: 1px solid rgba(229, 57, 53, 0.4);
      border-radius: 10px;
      display: flex;
      align-items: center;
      overflow: hidden;
      position: relative;
      font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
      user-select: none;
      box-shadow: 0 4px 20px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04);
    }

    .ticker-bar.hidden {
      transform: translateY(100%);
      transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .ticker-bar:not(.hidden) {
      transform: translateY(0);
      transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    }

    /* ─── Label Section ─── */
    .ticker-label {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      gap: 7px;
      padding: 0 16px;
      height: 100%;
      background: linear-gradient(135deg, #c62828 0%, #e53935 100%);
      font-size: 13px;
      font-weight: 700;
      color: #fff;
      letter-spacing: 0.3px;
      white-space: nowrap;
      position: relative;
      z-index: 2;
    }

    .ticker-label::after {
      content: '';
      position: absolute;
      left: -12px;
      top: 0;
      bottom: 0;
      width: 24px;
      background: linear-gradient(135deg, #c62828 0%, #e53935 100%);
      transform: skewX(-12deg);
      z-index: -1;
    }

    /* ─── Drag Handle ─── */
    .drag-handle {
      flex-shrink: 0;
      width: 28px;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: grab;
      color: rgba(255,255,255,0.3);
      font-size: 12px;
      border-left: 1px solid rgba(255,255,255,0.06);
      transition: color 0.2s;
    }

    .drag-handle:active {
      cursor: grabbing;
    }

    .drag-handle:hover {
      color: rgba(255,255,255,0.6);
    }

    .drag-handle svg {
      width: 14px;
      height: 14px;
      fill: currentColor;
    }

    .live-dot {
      width: 7px;
      height: 7px;
      background: #fff;
      border-radius: 50%;
      animation: blink 1.2s ease-in-out infinite;
      box-shadow: 0 0 6px rgba(255,255,255,0.6);
    }

    @keyframes blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.25; }
    }

    /* ─── Scrolling Track ─── */
    .ticker-track-wrapper {
      flex: 1;
      overflow: hidden;
      height: 100%;
      display: flex;
      align-items: center;
      position: relative;
      mask-image: linear-gradient(to left, transparent 0%, black 3%, black 97%, transparent 100%);
      -webkit-mask-image: linear-gradient(to left, transparent 0%, black 3%, black 97%, transparent 100%);
    }

    .ticker-track {
      display: flex;
      align-items: center;
      white-space: nowrap;
      will-change: transform;
      gap: 0;
      direction: rtl;
    }

    .ticker-copy {
      display: inline-flex;
      align-items: center;
      white-space: nowrap;
    }

    /* ─── News Item ─── */
    .ticker-item {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 0 28px;
      height: 42px;
      cursor: default;
      direction: rtl;
    }

    .ticker-separator {
      color: rgba(229, 57, 53, 0.5);
      font-size: 10px;
      padding: 0 4px;
      flex-shrink: 0;
    }

    .item-source {
      font-size: 10px;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 20px;
      letter-spacing: 0.4px;
      flex-shrink: 0;
      text-transform: uppercase;
      align-self: center;
      height: auto;
      line-height: 1.4;
    }

    .item-source.n12 {
      background: rgba(229, 57, 53, 0.25);
      color: #ff8a80;
      border: 1px solid rgba(229, 57, 53, 0.35);
    }

    .item-source.ynet {
      background: rgba(33, 150, 243, 0.2);
      color: #82b1ff;
      border: 1px solid rgba(33, 150, 243, 0.3);
    }

    .item-time {
      font-size: 11px;
      color: rgba(255,255,255,0.35);
      flex-shrink: 0;
      direction: ltr;
    }

    .item-text {
      font-size: 14px;
      font-weight: 500;
      color: #e8e8e8;
      white-space: nowrap;
    }

    .item-text a {
      color: #e8e8e8;
      text-decoration: none;
      transition: color 0.2s;
    }

    .item-text a:hover {
      color: #ff8a80;
      text-decoration: underline;
    }

    /* ─── Toggle Button ─── */
    .ticker-toggle {
      flex-shrink: 0;
      width: 36px;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(255,255,255,0.04);
      border: none;
      border-right: 1px solid rgba(255,255,255,0.06);
      color: #888;
      font-size: 14px;
      cursor: pointer;
      transition: all 0.2s;
    }

    .ticker-toggle:hover {
      background: rgba(255,255,255,0.08);
      color: #fff;
    }



    /* ─── Loading State ─── */
    .ticker-loading {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 0 20px;
      color: #666;
      font-size: 13px;
    }

    .spinner {
      width: 16px;
      height: 16px;
      border: 2px solid rgba(255,255,255,0.1);
      border-top-color: #e53935;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    /* ─── Resize Handles (top/bottom edges) ─── */
    .resize-handle-top,
    .resize-handle-bottom {
      position: absolute;
      left: 0;
      right: 0;
      height: 6px;
      cursor: ns-resize;
      z-index: 10;
    }

    .resize-handle-top    { top: 0;    border-radius: 10px 10px 0 0; }
    .resize-handle-bottom { bottom: 0; border-radius: 0 0 10px 10px; }

    .resize-handle-top:hover,
    .resize-handle-bottom:hover {
      background: rgba(229, 57, 53, 0.25);
    }

    /* ─── Width Resize Handles (left/right edges) ─── */
    .widget-outer {
      position: relative;
    }

    .width-handle {
      position: absolute;
      top: 0;
      height: 100%;
      width: 10px;
      cursor: ew-resize;
      z-index: 20;
    }

    .width-handle.left  { left:  -5px; }
    .width-handle.right { right: -5px; }

    .width-handle::after {
      content: '';
      position: absolute;
      top: 20%;
      bottom: 20%;
      left: 50%;
      width: 3px;
      transform: translateX(-50%);
      background: rgba(229, 57, 53, 0);
      border-radius: 2px;
      transition: background 0.2s;
    }

    .width-handle:hover::after {
      background: rgba(229, 57, 53, 0.5);
    }

  `;

  // ─── Widget HTML ────────────────────────────────────────────
  const container = document.createElement("div");
  container.innerHTML = `
    <div class="widget-outer">
      <div class="width-handle left"  id="widthHandleLeft"  title="גרור לשינוי רוחב"></div>
      <div class="width-handle right" id="widthHandleRight" title="גרור לשינוי רוחב"></div>
      <div class="ticker-bar" id="tickerBar">
        <div class="resize-handle-top"    id="resizeHandleTop"    title="גרור לשינוי גובה"></div>
        <div class="resize-handle-bottom" id="resizeHandleBottom" title="גרור לשינוי גובה"></div>
        <button class="ticker-toggle" id="closeBtn" title="הסתר">✕</button>
        <div class="ticker-label">
          <span class="live-dot"></span>
          <span>חדשות</span>
        </div>
        <div class="ticker-track-wrapper" id="trackWrapper">
          <div class="ticker-track" id="tickerTrack">
            <div class="ticker-loading" id="loadingState">
              <div class="spinner"></div>
              <span>טוען עדכונים...</span>
            </div>
          </div>
        </div>
        <div class="drag-handle" id="dragHandle" title="גרור">
          <svg viewBox="0 0 24 24"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>
        </div>
      </div>
    </div>
  `;

  shadow.appendChild(style);
  shadow.appendChild(container);

  // ─── References ─────────────────────────────────────────────
  const tickerBar           = shadow.getElementById("tickerBar");
  const tickerTrack         = shadow.getElementById("tickerTrack");
  const closeBtn            = shadow.getElementById("closeBtn");
  const dragHandle          = shadow.getElementById("dragHandle");
  const resizeHandleTop     = shadow.getElementById("resizeHandleTop");
  const resizeHandleBottom  = shadow.getElementById("resizeHandleBottom");
  const widthHandleLeft     = shadow.getElementById("widthHandleLeft");
  const widthHandleRight    = shadow.getElementById("widthHandleRight");


  let newsItems = [];

  // ─── Close Button (hides ticker and persists setting) ──────
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    host.style.display = "none";
    chrome.runtime.sendMessage({
      type: "SET_SETTINGS",
      settings: { widgetVisible: false }
    });
  });
  const scrollSpeed = 60; // pixels per second

  // ─── Apply Strip Style (height → font auto-scales) ─────────
  // Font scales proportionally with height: base 14px at 42px height
  function applyStripStyle(height) {
    const h = Math.min(80, Math.max(28, height || 42));
    const f = Math.min(22, Math.max(10, Math.round(14 * h / 42)));
    tickerBar.style.height = h + 'px';
    shadow.querySelectorAll('.ticker-item').forEach(el => {
      el.style.height = h + 'px';
    });
    shadow.querySelectorAll('.item-text').forEach(el => {
      el.style.fontSize = f + 'px';
    });
    currentHeight = h;
    currentFontSize = f;
  }

  let currentHeight = 42;
  let currentFontSize = 14;
  let currentWidth = null; // null = use default % width

  function persistStripStyle() {
    const toSave = { stripHeight: currentHeight };
    if (currentWidth !== null) toSave.stripWidth = currentWidth;
    chrome.runtime.sendMessage({ type: "SET_SETTINGS", settings: toSave });
  }

  // ─── Height Resize (top & bottom edge handles) ────────────────
  // dir: -1 for top handle (drag up = bigger), +1 for bottom (drag down = bigger)
  let isResizing = false;
  let resizeStartY = 0;
  let resizeStartHeight = 0;
  let resizeDir = -1;

  function startHeightResize(e, dir) {
    isResizing = true;
    resizeDir = dir;
    resizeStartY = e.clientY;
    resizeStartHeight = tickerBar.offsetHeight;
    e.preventDefault();
    e.stopPropagation();
    document.body.style.cursor = 'ns-resize';
  }

  resizeHandleTop.addEventListener("mousedown",    (e) => startHeightResize(e, +1));
  resizeHandleBottom.addEventListener("mousedown", (e) => startHeightResize(e, -1));

  document.addEventListener("mousemove", (e) => {
    if (!isResizing) return;
    const delta = (resizeStartY - e.clientY) * resizeDir;
    const newH = Math.min(80, Math.max(28, resizeStartHeight + delta));
    applyStripStyle(newH);
  });

  document.addEventListener("mouseup", () => {
    if (isResizing) {
      isResizing = false;
      document.body.style.cursor = '';
      persistStripStyle();
    }
  });

  // ─── Width Resize (left / right edge handles) ───────────────
  let isWidthResizing = false;
  let widthResizeEdge = null; // 'left' or 'right'
  let widthResizeStartX = 0;
  let widthResizeStartW = 0;
  let widthResizeStartLeft = 0;

  function startWidthResize(e, edge) {
    isWidthResizing = true;
    widthResizeEdge = edge;
    widthResizeStartX = e.clientX;
    // Snapshot current pixel width
    widthResizeStartW = host.offsetWidth;
    widthResizeStartLeft = host.getBoundingClientRect().left;
    // Ensure absolute positioning so width changes don't re-center
    host.style.left = widthResizeStartLeft + 'px';
    host.style.transform = 'none';
    host.style.bottom = 'auto';
    const rect = host.getBoundingClientRect();
    host.style.top = rect.top + 'px';
    document.body.style.cursor = 'ew-resize';
    e.preventDefault();
    e.stopPropagation();
  }

  widthHandleLeft.addEventListener("mousedown",  (e) => startWidthResize(e, 'left'));
  widthHandleRight.addEventListener("mousedown", (e) => startWidthResize(e, 'right'));

  document.addEventListener("mousemove", (e) => {
    if (!isWidthResizing) return;
    const dx = e.clientX - widthResizeStartX;
    let newW;
    if (widthResizeEdge === 'right') {
      // Right edge: drag right = wider
      newW = Math.min(window.innerWidth - 20, Math.max(260, widthResizeStartW + dx));
    } else {
      // Left edge: drag left = wider, need to also shift position
      newW = Math.min(window.innerWidth - 20, Math.max(260, widthResizeStartW - dx));
      host.style.left = (widthResizeStartLeft + dx) + 'px';
    }
    host.style.width = newW + 'px';
    currentWidth = newW;
    // Re-measure for scroll engine
    requestAnimationFrame(() => { halfWidth = tickerTrack.scrollWidth / 2; });
  });

  document.addEventListener("mouseup", () => {
    if (isWidthResizing) {
      isWidthResizing = false;
      document.body.style.cursor = '';
      persistStripStyle();
      // Save left position too
      chrome.storage.local.set({
        tickerPosition: {
          left: host.getBoundingClientRect().left,
          top: host.getBoundingClientRect().top
        }
      });
    }
  });


  let isDragging = false;
  let dragStartX, dragStartY, hostStartX, hostStartY;

  dragHandle.addEventListener("mousedown", (e) => {
    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    const rect = host.getBoundingClientRect();
    hostStartX = rect.left;
    hostStartY = rect.top;
    // Switch to absolute left/top positioning
    host.style.transform = 'none';
    host.style.left = hostStartX + 'px';
    host.style.top = hostStartY + 'px';
    host.style.bottom = 'auto';
    e.preventDefault();
    e.stopPropagation();
  });

  document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    host.style.left = (hostStartX + dx) + 'px';
    host.style.top = (hostStartY + dy) + 'px';
    host.style.bottom = 'auto';
    host.style.transform = 'none';
  });

  document.addEventListener("mouseup", () => {
    if (isDragging) {
      isDragging = false;
      const rect = host.getBoundingClientRect();
      chrome.storage.local.set({
        tickerPosition: { left: rect.left, top: rect.top }
      });
    }
  });

  // ─── Scroll Engine (rAF-based) ─────────────────────────────
  let scrollOffset = 0;      // current pixel offset
  let halfWidth = 0;         // width of one copy of items
  let animFrameId = null;
  let lastTimestamp = 0;
  let pendingItems = null;   // queued update, applied at loop seam
  let isScrolling = false;

  function startScrolling() {
    if (isScrolling) return;
    isScrolling = true;
    lastTimestamp = performance.now();
    animFrameId = requestAnimationFrame(tick);
  }

  function stopScrolling() {
    isScrolling = false;
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
  }

  function tick(now) {
    if (!isScrolling) return;

    const delta = (now - lastTimestamp) / 1000; // seconds
    lastTimestamp = now;

    // Move right (positive translateX) for RTL Hebrew text
    scrollOffset += scrollSpeed * delta;

    // When we've scrolled past one full copy, loop back seamlessly
    if (halfWidth > 0 && scrollOffset >= halfWidth) {
      scrollOffset -= halfWidth;

      // This is the seamless seam point — apply queued full rebuild if any
      if (pendingItems) {
        buildTrackDOM(pendingItems);
        pendingItems = null;
      }
    }

    tickerTrack.style.transform = `translateX(${scrollOffset}px)`;
    animFrameId = requestAnimationFrame(tick);
  }


  // ─── Build Ticker Content ──────────────────────────────────
  // limitPerSource removed — background.js already trims per source

  function createItemNodes(items) {
    const fragment = document.createDocumentFragment();
    items.forEach((item, idx) => {
      const el = document.createElement("span");
      el.className = "ticker-item";

      const time = formatTime(item.timestamp);
      const sourceClass = item.source === "n12" ? "n12" : "ynet";
      const sourceLabel = item.source === "n12" ? "N12" : "Ynet";
      const text = escapeHtml(item.title);

      let textHtml = text;
      if (item.link && isSafeUrl(item.link)) {
        textHtml = `<a href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
      }

      el.innerHTML = `
        <span class="item-time">${time}</span>
        <span class="item-source ${sourceClass}">${sourceLabel}</span>
        <span class="item-text" style="font-size:${currentFontSize}px">${textHtml}</span>
      `;
      el.style.height = currentHeight + 'px';
      el.style.lineHeight = currentHeight + 'px';

      fragment.appendChild(el);

      // Separator between items
      const sep = document.createElement("span");
      sep.className = "ticker-separator";
      sep.textContent = "◆";
      fragment.appendChild(sep);
    });
    return fragment;
  }

  function buildTrackDOM(items) {
    newsItems = items;
    tickerTrack.innerHTML = "";

    if (!items || items.length === 0) {
      const loading = document.createElement("div");
      loading.className = "ticker-loading";
      loading.innerHTML = `<div class="spinner"></div><span>טוען עדכונים...</span>`;
      tickerTrack.appendChild(loading);
      halfWidth = 0;
      return;
    }

    // First copy
    const copy1 = document.createElement("span");
    copy1.className = "ticker-copy ticker-copy-1";
    copy1.appendChild(createItemNodes(items));
    tickerTrack.appendChild(copy1);

    // Second copy (for seamless loop)
    const copy2 = document.createElement("span");
    copy2.className = "ticker-copy ticker-copy-2";
    copy2.appendChild(createItemNodes(items));
    tickerTrack.appendChild(copy2);

    // Measure half-width (one copy)
    requestAnimationFrame(() => {
      halfWidth = tickerTrack.scrollWidth / 2;
      // Ensure scrollOffset stays valid
      if (halfWidth > 0 && scrollOffset >= halfWidth) {
        scrollOffset = scrollOffset % halfWidth;
      }
    });
  }

  /**
   * Append only-new items to both copies currently in the track.
   * Works safely as long as we're not right at the seam wrap point.
   */
  function appendNewItemsToTrack(newOnlyItems) {
    const copies = tickerTrack.querySelectorAll(".ticker-copy");
    if (copies.length !== 2) {
      // Fallback: full rebuild at seam
      pendingItems = newOnlyItems.concat(newsItems);
      return;
    }

    // Append nodes to both copies
    copies[0].appendChild(createItemNodes(newOnlyItems));
    copies[1].appendChild(createItemNodes(newOnlyItems));

    // Update newsItems list
    newsItems = newsItems.concat(newOnlyItems);

    // Re-measure halfWidth
    requestAnimationFrame(() => {
      halfWidth = tickerTrack.scrollWidth / 2;
    });
  }

  function renderTicker(items) {
    if (newsItems.length === 0 || halfWidth === 0) {
      // First render — build immediately and start scrolling
      buildTrackDOM(items);
      scrollOffset = 0;
      startScrolling();
      return;
    }

    // Find genuinely new items (not already in newsItems)
    const existingIds = new Set(newsItems.map(n => n.id));
    const newOnly = items.filter(i => !existingIds.has(i.id));

    // If items were removed (source toggled off) — need full rebuild
    const removedItems = newsItems.some(n => !items.find(i => i.id === n.id));

    if (removedItems) {
      // Source was toggled or items removed — queue full rebuild at seam
      pendingItems = items;
      return;
    }

    if (newOnly.length === 0) return; // nothing new

    // Check proximity to the seam — if too close, queue for seam instead
    const SEAM_SAFETY_MARGIN = 50; // px
    const distanceToSeam = halfWidth - scrollOffset;
    if (distanceToSeam < SEAM_SAFETY_MARGIN) {
      // Too close to seam, queue full rebuild
      pendingItems = items;
      return;
    }

    // Safe to append immediately
    appendNewItemsToTrack(newOnly);
  }

  function formatTime(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
  }

  function escapeHtml(str) {
    if (!str) return "";
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function isSafeUrl(url) {
    if (!url) return false;
    try {
      const parsed = new URL(url, location.href);
      return ['http:', 'https:'].includes(parsed.protocol);
    } catch {
      return false;
    }
  }

  // ─── Listen for Background Messages ─────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "NEWS_UPDATE") {
      chrome.storage.local.get(["sources"], (data) => {
        const sources = data.sources || { n12: true, ynet: true };
        const filtered = filterBySources(msg.items, sources);
        renderTicker(filtered);
      });
    }
    if (msg.type === "SETTINGS_UPDATE") {
      applyVisibility(msg.settings.widgetVisible);
      if (msg.settings.sources) {
        chrome.runtime.sendMessage({ type: "GET_NEWS" }, (resp) => {
          if (resp && resp.items) {
            const filtered = filterBySources(resp.items, msg.settings.sources);
            renderTicker(filtered);
          }
        });
      }
      if (msg.settings.stripHeight !== undefined || msg.settings.fontSize !== undefined) {
        chrome.storage.local.get(["stripHeight", "fontSize"], (data) => {
          applyStripStyle(
            msg.settings.stripHeight !== undefined ? msg.settings.stripHeight : data.stripHeight,
            msg.settings.fontSize !== undefined ? msg.settings.fontSize : data.fontSize
          );
        });
      }
    }

  });

  // ─── Storage Change Listener (backup for message delivery) ──
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.widgetVisible) {
      applyVisibility(changes.widgetVisible.newValue);
    }
    if (changes.sources) {
      const sources = changes.sources.newValue || { n12: true, ynet: true };
      chrome.runtime.sendMessage({ type: "GET_NEWS" }, (resp) => {
        if (chrome.runtime.lastError) return;
        if (resp && resp.items) {
          const filtered = filterBySources(resp.items, sources);
          renderTicker(filtered);
        }
      });
    }
  });

  // ─── Apply Visibility Helper ────────────────────────────────
  function applyVisibility(visible) {
    if (visible === undefined || !isTopFrame) return;
    host.style.display = visible ? "block" : "none";
    if (visible) {
      // Force a full rebuild since DOM measurements are invalid when hidden
      // (scrollWidth = 0 when display:none, so halfWidth was 0)
      chrome.runtime.sendMessage({ type: "GET_NEWS" }, (resp) => {
        if (chrome.runtime.lastError) return;
        if (resp && resp.items) {
          chrome.storage.local.get(["sources"], (data) => {
            const sources = data.sources || { n12: true, ynet: true };
            const filtered = filterBySources(resp.items, sources);
            // Force rebuild: reset state so renderTicker does a fresh build
            newsItems = [];
            halfWidth = 0;
            stopScrolling();
            renderTicker(filtered);
          });
        }
      });
    }
  }

  function filterBySources(items, sources) {
    return items.filter((item) => {
      if (item.source === "n12" && !sources.n12) return false;
      if (item.source === "ynet" && !sources.ynet) return false;
      return true;
    });
  }

  // ─── Initial Load ───────────────────────────────────────────
  chrome.storage.local.get(["widgetVisible", "sources", "tickerPosition", "stripHeight", "stripWidth"], (data) => {
    // In top frame: apply visibility and position settings
    if (isTopFrame) {
      host.style.display = data.widgetVisible ? "block" : "none";
      // Restore saved position
      if (data.tickerPosition) {
        host.style.left = data.tickerPosition.left + 'px';
        host.style.top = data.tickerPosition.top + 'px';
        host.style.bottom = 'auto';
        host.style.transform = 'none';
      }
      // Restore saved width
      if (data.stripWidth) {
        host.style.width = data.stripWidth + 'px';
        currentWidth = data.stripWidth;
      }
    }
    // Apply strip style (height → font scales automatically)
    applyStripStyle(data.stripHeight);

    // In iframes: visibility is controlled by fullscreen events

    const sources = data.sources || { n12: true, ynet: true };

    chrome.runtime.sendMessage({ type: "GET_NEWS" }, (resp) => {
      if (chrome.runtime.lastError) return;
      if (resp && resp.items) {
        const filtered = filterBySources(resp.items, sources);
        renderTicker(filtered);
      }
    });
  });

})();

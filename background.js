// ============================================================
//  Background Service Worker
//  - Firebase SSE for N12 Chat Hakatavim
//  - Ynet RSS polling every 2 minutes
//  - Programmatic content script injection (activeTab)
// ============================================================

const FIREBASE_DB_URL = "https://channel-2-news.firebaseio.com";
const DB_PATH = "desk12";
const TOPIC_ID_FILTER = 1; // 1 = חדשות N12

const YNET_RSS_URL = "https://www.ynet.co.il/Integration/StoryRss1854.xml";
const YNET_POLL_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
const MAX_PER_SOURCE = 10;

let newsItems = [];
let seenIds = new Set();
let firebaseController = null;
let firebaseRetryDelay = 30000;
const MAX_FIREBASE_RETRY = 5 * 60 * 1000; // 5 minutes max

// ─── Injected Tabs Tracking ──────────────────────────────────
// Tracks tab IDs where the content script has been injected
let injectedTabs = new Set();

// Clean up when tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
  injectedTabs.delete(tabId);
});

// Clean up when a tab navigates to a new page (content script is gone)
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    injectedTabs.delete(tabId);
  }
});

// ─── Content Script Injection ─────────────────────────────────
async function injectContentScript(tabId) {
  if (injectedTabs.has(tabId)) return true; // Already injected

  try {
    await chrome.scripting.insertCSS({
      target: { tabId, allFrames: true },
      files: ["content.css"]
    });
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["content.js"]
    });
    injectedTabs.add(tabId);
    return true;
  } catch (e) {
    console.error("[Inject] Failed for tab", tabId, e);
    return false;
  }
}

// ─── Initialization ───────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    widgetVisible: false,
    sources: { n12: true, ynet: true }
  });
  startAll();
});

chrome.runtime.onStartup.addListener(() => {
  startAll();
});

// Also start when the service worker wakes up
startAll();

async function startAll() {
  await loadStoredNews();
  startFirebaseSSE();
  fetchYnetRSS();
  // Set up alarm for Ynet polling
  chrome.alarms.create("ynet-poll", { periodInMinutes: 2 });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "ynet-poll") {
    fetchYnetRSS();
  }
});

// ─── Firebase SSE Listener (no auth needed - DB is public) ────
async function startFirebaseSSE() {
  // Abort any existing connection
  if (firebaseController) {
    try { firebaseController.abort(); } catch (e) {}
  }

  const url = `${FIREBASE_DB_URL}/${DB_PATH}.json`;

  firebaseController = new AbortController();

  try {
    const resp = await fetch(url, {
      headers: { "Accept": "text/event-stream" },
      signal: firebaseController.signal
    });

    if (!resp.ok) {
      console.error("[N12] Connection failed:", resp.status);
      // Retry with exponential backoff
      setTimeout(startFirebaseSSE, firebaseRetryDelay);
      firebaseRetryDelay = Math.min(firebaseRetryDelay * 2, MAX_FIREBASE_RETRY);
      return;
    }

    firebaseRetryDelay = 30000; // Reset backoff on successful connection
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let eventType = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("event:")) {
          eventType = line.slice(6).trim();
          continue;
        }

        if (!line.startsWith("data:")) continue;

        const dataStr = line.slice(5).trim();
        if (!dataStr || dataStr === "null") continue;

        let payload;
        try {
          payload = JSON.parse(dataStr);
        } catch (e) {
          continue;
        }

        if (typeof payload !== "object" || payload === null) continue;

        const path = payload.path || "";
        const data = payload.data;

        // Initial load: all existing messages
        if (path === "/" && typeof data === "object" && data !== null) {
          const entries = Object.entries(data)
            .filter(([id, msg]) => typeof msg === "object" && msg !== null)
            .sort(([a], [b]) => a.localeCompare(b));

          for (const [msgId, msg] of entries) {
            const itemId = `n12-${msgId}`;
            if (!seenIds.has(itemId)) {
              seenIds.add(itemId);
              const item = parseN12Message(msg, msgId);
              if (item) newsItems.push(item);
            }
          }
          trimAndBroadcast();
          continue;
        }

        // New message: path = "/-OoXXX"
        if (path && path !== "/" && path.split("/").length === 2) {
          const msgId = path.replace("/", "");
          const itemId = `n12-${msgId}`;
          if (!seenIds.has(itemId) && typeof data === "object" && data !== null) {
            seenIds.add(itemId);
            const item = parseN12Message(data, msgId);
            if (item) {
              newsItems.unshift(item); // Add to front
              trimAndBroadcast();
            }
          }
          continue;
        }

        // Patch updates
        if (eventType === "patch" && typeof data === "object" && data !== null) {
          for (const [msgId, msg] of Object.entries(data)) {
            const itemId = `n12-${msgId}`;
            if (typeof msg === "object" && msg !== null && !seenIds.has(itemId)) {
              seenIds.add(itemId);
              const item = parseN12Message(msg, msgId);
              if (item) {
                newsItems.unshift(item);
                trimAndBroadcast();
              }
            }
          }
        }
      }
    }
  } catch (e) {
    if (e.name !== "AbortError") {
      console.error("[N12] SSE Error:", e);
      // Retry with exponential backoff
      setTimeout(startFirebaseSSE, firebaseRetryDelay);
      firebaseRetryDelay = Math.min(firebaseRetryDelay * 2, MAX_FIREBASE_RETRY);
    }
  }
}

function parseN12Message(msg, msgId) {
  if (!msg || typeof msg !== "object") return null;

  // Filter by topic - only reject if topicID is explicitly set and not matching
  try {
    const topicId = msg.reporter?.reporter?.topicID;
    if (TOPIC_ID_FILTER !== null && topicId !== undefined && topicId !== TOPIC_ID_FILTER) return null;
  } catch (e) {}

  const content = msg.messageContent || "";
  if (!content) return null;

  let timestamp = Date.now();
  try {
    const ts = msg.updatedDate?.time;
    if (ts) timestamp = ts;
  } catch (e) {}

  return {
    id: `n12-${msgId}`,
    source: "n12",
    title: content,
    timestamp,
    link: null
  };
}

// ─── Ynet RSS ─────────────────────────────────────────────────
async function fetchYnetRSS() {
  try {
    const resp = await fetch(YNET_RSS_URL);
    if (!resp.ok) {
      console.error("[Ynet] Fetch failed:", resp.status);
      return;
    }

    const text = await resp.text();

    // Parse RSS XML with regex (DOMParser unavailable in service workers)
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let newCount = 0;
    let match;

    while ((match = itemRegex.exec(text)) !== null) {
      const itemXml = match[1];
      const title = extractTag(itemXml, "title");
      const link = extractTag(itemXml, "link");
      const pubDate = extractTag(itemXml, "pubDate");

      const itemId = `ynet-${link || title}`;
      if (!seenIds.has(itemId) && title) {
        seenIds.add(itemId);
        newsItems.unshift({
          id: itemId,
          source: "ynet",
          title: decodeXmlEntities(title),
          timestamp: pubDate ? new Date(pubDate).getTime() : Date.now(),
          link: link
        });
        newCount++;
      }
    }

    if (newCount > 0) {
      trimAndBroadcast();
    }
  } catch (e) {
    console.error("[Ynet] RSS Error:", e);
  }
}

// ─── XML Helpers ──────────────────────────────────────────────
function extractTag(xml, tag) {
  // Handle CDATA sections: <tag><![CDATA[content]]></tag>
  const cdataRegex = new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, "i");
  const cdataMatch = xml.match(cdataRegex);
  if (cdataMatch) return cdataMatch[1].trim();

  // Handle regular tags: <tag>content</tag>
  const regex = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i");
  const match = xml.match(regex);
  return match ? match[1].trim() : "";
}

function decodeXmlEntities(str) {
  if (!str) return "";
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'");
}

// ─── Helpers ──────────────────────────────────────────────────
function trimAndBroadcast() {
  // Sort by timestamp descending
  newsItems.sort((a, b) => a.timestamp - b.timestamp);
  // Keep only MAX_PER_SOURCE per source
  const n12 = newsItems.filter(i => i.source === "n12").slice(-MAX_PER_SOURCE);
  const ynet = newsItems.filter(i => i.source === "ynet").slice(-MAX_PER_SOURCE);
  newsItems = [...n12, ...ynet].sort((a, b) => a.timestamp - b.timestamp);
  // Cap seenIds to prevent unbounded memory growth
  if (seenIds.size > 500) {
    seenIds = new Set(newsItems.map(i => i.id));
  }
  // Save to storage
  chrome.storage.local.set({ newsItems });
  // Broadcast only to injected tabs
  broadcastToTabs({ type: "NEWS_UPDATE", items: newsItems });
}

async function broadcastToTabs(message) {
  // Only send to tabs where content script was injected
  for (const tabId of injectedTabs) {
    try {
      await chrome.tabs.sendMessage(tabId, message);
    } catch (e) {
      // Tab no longer valid or content script unloaded
      injectedTabs.delete(tabId);
    }
  }
}

async function loadStoredNews() {
  try {
    const data = await chrome.storage.local.get(["newsItems"]);
    if (data.newsItems && Array.isArray(data.newsItems)) {
      newsItems = data.newsItems;
      for (const item of newsItems) {
        seenIds.add(item.id);
      }
    }
  } catch (e) {}
}

// ─── Message Handler ──────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "GET_NEWS") {
    sendResponse({ items: newsItems });
    return true;
  }
  if (msg.type === "GET_SETTINGS") {
    chrome.storage.local.get(["widgetVisible", "sources"], (data) => {
      sendResponse(data);
    });
    return true;
  }
  if (msg.type === "SET_SETTINGS") {
    // Validate and whitelist allowed settings
    const allowed = {};
    if (typeof msg.settings?.widgetVisible === 'boolean') {
      allowed.widgetVisible = msg.settings.widgetVisible;
    }
    if (msg.settings?.sources && typeof msg.settings.sources === 'object') {
      allowed.sources = {
        n12: msg.settings.sources.n12 !== false,
        ynet: msg.settings.sources.ynet !== false
      };
    }
    chrome.storage.local.set(allowed, () => {
      // If widget is being toggled ON, inject into the active tab first
      if (allowed.widgetVisible === true) {
        chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
          if (tabs[0]?.id) {
            await injectContentScript(tabs[0].id);
          }
          broadcastToTabs({ type: "SETTINGS_UPDATE", settings: allowed });
          sendResponse({ ok: true });
        });
      } else {
        broadcastToTabs({ type: "SETTINGS_UPDATE", settings: allowed });
        sendResponse({ ok: true });
      }
    });
    return true;
  }
  // Inject request from popup for the active tab
  if (msg.type === "INJECT_ACTIVE_TAB") {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (tabs[0]?.id) {
        const ok = await injectContentScript(tabs[0].id);
        sendResponse({ ok });
      } else {
        sendResponse({ ok: false });
      }
    });
    return true;
  }
});

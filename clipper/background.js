// OD Clipper service worker.
//
// All daemon traffic flows through here: the service-worker fetch carries the
// extension's chrome-extension:// origin (allowlisted at pairing time) and the
// library bearer token, and host_permissions let it reach the loopback daemon
// without CORS friction. The popup and the on-page toolbar both message this
// worker rather than talking to the daemon directly, so token handling lives
// in one place.

const DEFAULT_DAEMON_URL = 'http://127.0.0.1:7456';

async function getConfig() {
  const { daemonUrl, token } = await chrome.storage.local.get(['daemonUrl', 'token']);
  return { daemonUrl: daemonUrl || DEFAULT_DAEMON_URL, token: token || null };
}

function extensionOrigin() {
  return `chrome-extension://${chrome.runtime.id}`;
}

async function ingest(body) {
  const { daemonUrl, token } = await getConfig();
  if (!token) throw new Error('not paired');
  const resp = await fetch(`${daemonUrl}/api/library/ingest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`ingest ${resp.status}${text ? `: ${text}` : ''}`);
  }
  return resp.json();
}

async function pair(code) {
  const { daemonUrl } = await getConfig();
  const resp = await fetch(`${daemonUrl}/api/library/pair/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, extensionOrigin: extensionOrigin(), label: 'OD Clipper' }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error((data && (data.error?.message || data.error)) || `pair failed (${resp.status})`);
  }
  await chrome.storage.local.set({ token: data.token });
  return data;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error('no active tab');
  return tab;
}

async function captureScreenshot() {
  const tab = await activeTab();
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  return ingest({
    dataUrl,
    kind: 'image',
    sourceUrl: tab.url,
    sourceTitle: tab.title,
    tags: ['screenshot'],
  });
}

// Runs in the page context (serialized by executeScript) — keep self-contained.
function collectImages() {
  const out = [];
  const seen = new Set();
  for (const el of document.images) {
    const src = el.currentSrc || el.src;
    if (!src || seen.has(src)) continue;
    if (!/^https?:/i.test(src)) continue;
    if ((el.naturalWidth || 0) < 64 || (el.naturalHeight || 0) < 64) continue;
    seen.add(src);
    out.push({ src, alt: el.alt || '' });
  }
  return out;
}

async function grabImages() {
  const tab = await activeTab();
  const [first] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: collectImages,
  });
  const images = Array.isArray(first?.result) ? first.result.slice(0, 30) : [];
  let count = 0;
  for (const img of images) {
    try {
      await ingest({ url: img.src, kind: 'image', sourceUrl: tab.url, sourceTitle: img.alt || tab.title });
      count += 1;
    } catch {
      // skip individual failures (hotlink-protected / oversized)
    }
  }
  return { count, total: images.length };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      switch (msg && msg.type) {
        case 'getStatus': {
          const c = await getConfig();
          sendResponse({ ok: true, paired: Boolean(c.token), daemonUrl: c.daemonUrl });
          break;
        }
        case 'setDaemonUrl':
          await chrome.storage.local.set({ daemonUrl: msg.url || DEFAULT_DAEMON_URL });
          sendResponse({ ok: true });
          break;
        case 'unpair':
          await chrome.storage.local.remove('token');
          sendResponse({ ok: true });
          break;
        case 'pair':
          await pair(msg.code);
          sendResponse({ ok: true });
          break;
        case 'captureScreenshot': {
          const r = await captureScreenshot();
          sendResponse({ ok: true, deduped: Boolean(r.deduped) });
          break;
        }
        case 'grabImages': {
          const r = await grabImages();
          sendResponse({ ok: true, count: r.count, total: r.total });
          break;
        }
        default:
          sendResponse({ ok: false, error: 'unknown message' });
      }
    } catch (err) {
      sendResponse({ ok: false, error: (err && err.message) || String(err) });
    }
  })();
  return true; // keep the message channel open for the async response
});

// Right-click any image → save straight to the library.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'od-save-image',
    title: 'Save image to OD Library',
    contexts: ['image'],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'od-save-image' || !info.srcUrl) return;
  try {
    await ingest({
      url: info.srcUrl,
      kind: 'image',
      sourceUrl: tab && tab.url,
      sourceTitle: tab && tab.title,
    });
  } catch {
    // best-effort; the popup surfaces detailed errors
  }
});

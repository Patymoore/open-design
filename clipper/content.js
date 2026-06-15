// OD Clipper on-page toolbar.
//
// A tiny floating launcher injected into every page (Shadow DOM so page CSS
// can't bleed in). Two capture modes route through the service worker:
// screenshot of the visible tab, and "grab images" which harvests the page's
// <img> sources. Pairing happens in the popup; this bar just captures.

(function () {
  if (window.__odClipperInjected) return;
  window.__odClipperInjected = true;

  const host = document.createElement('div');
  host.id = 'od-clipper-root';
  host.style.cssText = 'position:fixed;z-index:2147483647;right:16px;bottom:16px;';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      .bar {
        display: flex; gap: 6px; padding: 6px;
        background: rgba(17,24,39,0.92); border-radius: 999px;
        box-shadow: 0 6px 24px rgba(0,0,0,0.25);
        font-family: system-ui, sans-serif;
      }
      .bar button {
        all: unset; cursor: pointer; width: 34px; height: 34px;
        display: grid; place-items: center; border-radius: 999px;
        font-size: 16px; color: #fff; transition: background 160ms;
      }
      .bar button:hover { background: rgba(255,255,255,0.16); }
      .toast {
        position: absolute; bottom: 48px; right: 0; white-space: nowrap;
        background: #111827; color: #fff; font-size: 12px;
        font-family: system-ui, sans-serif; padding: 6px 10px;
        border-radius: 8px; opacity: 0; transform: translateY(6px);
        transition: opacity 160ms, transform 160ms; pointer-events: none;
      }
      .toast.show { opacity: 1; transform: translateY(0); }
    </style>
    <div class="toast" id="t"></div>
    <div class="bar">
      <button data-act="shot" title="Capture screenshot → OD Library">📸</button>
      <button data-act="imgs" title="Grab images on page → OD Library">🖼️</button>
    </div>
  `;
  document.documentElement.appendChild(host);

  const toastEl = shadow.getElementById('t');
  let toastTimer = null;
  function toast(text) {
    toastEl.textContent = text;
    toastEl.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
  }

  shadow.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const type = btn.dataset.act === 'shot' ? 'captureScreenshot' : 'grabImages';
      toast('Capturing…');
      let res;
      try {
        res = await chrome.runtime.sendMessage({ type });
      } catch (err) {
        toast('Extension error — reload the page');
        return;
      }
      if (!res || !res.ok) {
        toast(res && res.error === 'not paired'
          ? 'Pair first: click the OD Clipper icon'
          : `Failed: ${(res && res.error) || 'unknown'}`);
        return;
      }
      if (type === 'grabImages') toast(`Saved ${res.count}/${res.total} image(s)`);
      else toast(res.deduped ? 'Already in library' : 'Saved screenshot');
    });
  });
})();

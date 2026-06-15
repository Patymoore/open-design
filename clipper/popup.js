// OD Clipper popup. Thin UI over the service worker message API.

const $ = (id) => document.getElementById(id);

function send(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (res) => resolve(res || { ok: false, error: 'no response' }));
  });
}

function setMsg(text, kind) {
  const el = $('msg');
  el.textContent = text || '';
  el.dataset.kind = kind || '';
}

function render(paired) {
  $('status').textContent = paired ? '● paired' : '○ not paired';
  $('status').dataset.paired = paired ? 'true' : 'false';
  $('pair-block').style.display = paired ? 'none' : '';
  $('capture-block').style.display = paired ? '' : 'none';
}

async function refresh() {
  const res = await send({ type: 'getStatus' });
  if (res.ok) {
    $('daemon').value = res.daemonUrl || '';
    render(Boolean(res.paired));
  }
}

$('save-daemon').addEventListener('click', async () => {
  const url = $('daemon').value.trim();
  await send({ type: 'setDaemonUrl', url });
  setMsg('Daemon URL saved.', 'ok');
});

$('pair').addEventListener('click', async () => {
  const code = $('code').value.trim();
  if (!/^\d{6}$/.test(code)) {
    setMsg('Enter the 6-digit code from the OD Library tab.', 'err');
    return;
  }
  setMsg('Pairing…');
  const res = await send({ type: 'pair', code });
  if (res.ok) {
    setMsg('Paired! You can capture now.', 'ok');
    await refresh();
  } else {
    setMsg(`Pairing failed: ${res.error || 'unknown'}`, 'err');
  }
});

$('shot').addEventListener('click', async () => {
  setMsg('Capturing screenshot…');
  const res = await send({ type: 'captureScreenshot' });
  setMsg(res.ok ? (res.deduped ? 'Already in library.' : 'Screenshot saved to library.') : `Failed: ${res.error}`, res.ok ? 'ok' : 'err');
});

$('imgs').addEventListener('click', async () => {
  setMsg('Grabbing images…');
  const res = await send({ type: 'grabImages' });
  setMsg(res.ok ? `Saved ${res.count}/${res.total} image(s) to library.` : `Failed: ${res.error}`, res.ok ? 'ok' : 'err');
});

$('unpair').addEventListener('click', async () => {
  await send({ type: 'unpair' });
  setMsg('Unpaired.', 'ok');
  await refresh();
});

void refresh();

# OD Clipper (Chrome MV3)

A browser extension that captures images, screenshots, and page content from
any site straight into your Open Design **Library** (the global asset registry).

This is a **standalone subproject** — it is intentionally *not* part of the pnpm
workspace and has **no build step**. The files here load directly as an unpacked
extension. The daemon/web TypeScript boundaries are unaffected.

## Load it

1. Start Open Design locally (`pnpm tools-dev`) so the daemon is listening on
   `http://127.0.0.1:7456` (the default; change it in the popup if you used a
   different `--daemon-port`).
2. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**,
   and select this `clipper/` directory.

## Pair it (one time)

1. In Open Design, open the **Library** tab and click **Connect extension** — it
   shows a 6-digit code (valid for 5 minutes).
2. Click the OD Clipper toolbar icon, paste the code, and press **Pair**.

Pairing exchanges the code for a long-lived `odlt_…` token and registers this
extension's `chrome-extension://<id>` origin in the daemon's allowlist, so it
survives daemon restarts.

## Capture

- **Popup** → *Capture screenshot* (visible tab) or *Grab images* (harvest the
  page's `<img>` sources).
- **On-page toolbar** → the floating 📸 / 🖼️ launcher at the bottom-right of
  every page.
- **Right-click an image** → *Save image to OD Library*.

Everything you capture appears in the Library tab (live, via SSE) with a
**Clipper** source badge and a back-link to its source page.

## Permissions

- `host_permissions: <all_urls>` — needed to screenshot/read images on any page
  and to reach the loopback daemon. Standard for web clippers (Evernote, Figma).
- `scripting`, `tabs` — capture the active tab and harvest images.
- `contextMenus` — the right-click "Save image" entry.
- `storage` — remember the daemon URL and pairing token locally.

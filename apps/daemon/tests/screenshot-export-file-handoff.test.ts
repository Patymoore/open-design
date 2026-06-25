import type http from 'node:http';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DesktopRenderSlidesInput, DesktopRenderSlidesResult } from '@open-design/sidecar-proto';
import { startServer } from '../src/server.js';

// ---------------------------------------------------------------------------
// Screenshot export — desktop renderer file handoff.
//
// The daemon hands the desktop renderer a scratch `outputDir` under the data
// root, the renderer writes image files there (instead of pushing base64
// through IPC), and the daemon reads them back and deletes the scratch dir.
// Exercised end-to-end at the HTTP boundary with a stub renderer standing in
// for the desktop runtime.
// ---------------------------------------------------------------------------

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAv/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwD/2Q==',
  'base64',
);

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return predicate();
}

describe('screenshot export desktop renderer file handoff', () => {
  let server: http.Server;
  let baseUrl: string;
  let exportRenderRoot: string;
  const projectId = 'proj-export-handoff';
  const seenDirs: string[] = [];

  // Stub desktop renderer: assert we were handed an outputDir, write the image
  // files there exactly like the real renderer's emitImages, return file paths.
  const stubRenderer = async (input: DesktopRenderSlidesInput): Promise<DesktopRenderSlidesResult> => {
    if (!input.outputDir) return { ok: false, error: 'expected an outputDir handoff' };
    seenDirs.push(input.outputDir);
    await mkdir(input.outputDir, { recursive: true });
    const jpeg = input.pageImageFormat === 'jpeg';
    const file = path.join(input.outputDir, jpeg ? 'slide-0.jpeg' : 'slide-0.png');
    await writeFile(file, jpeg ? JPEG : PNG);
    return { ok: true, slideFiles: [file], width: 1920, height: 1080, mode: input.stitch ? 'deck' : 'page' };
  };

  const exportImage = () =>
    fetch(`${baseUrl}/api/projects/${projectId}/export/image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: 'index.html' }),
    });

  beforeAll(async () => {
    const started = (await startServer({
      port: 0,
      returnServer: true,
      desktopSlideRenderer: stubRenderer,
    })) as { url: string; server: http.Server };
    baseUrl = started.url;
    server = started.server;

    const dataDir = process.env.OD_DATA_DIR!;
    // The daemon derives the scratch dir from the realpath-resolved data root
    // (RUNTIME_DATA_DIR_CANONICAL); on macOS OD_DATA_DIR may contain a symlink
    // (/var -> /private/var), so resolve it the same way for the prefix check.
    exportRenderRoot = path.join(realpathSync(dataDir), 'export-render');
    const dir = path.join(dataDir, 'projects', projectId);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'index.html'), '<html><body><section class="slide">A</section></body></html>');
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('hands the renderer an outputDir under the data root and returns the image', async () => {
    const res = await exportImage();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/png');
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(0, 4).toString('hex')).toBe('89504e47'); // PNG magic

    const used = seenDirs.at(-1)!;
    expect(used).toBeTruthy();
    expect(used.startsWith(exportRenderRoot + path.sep)).toBe(true);
  });

  it('forwards jpeg image exports to the screenshot renderer', async () => {
    const res = await fetch(`${baseUrl}/api/projects/${projectId}/export/image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: 'index.html', imageFormat: 'jpeg' }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/jpeg');
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(0, 2).toString('hex')).toBe('ffd8');
  });

  it('rejects unsupported image export formats before rendering', async () => {
    const before = seenDirs.length;
    const res = await fetch(`${baseUrl}/api/projects/${projectId}/export/image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: 'index.html', imageFormat: 'webp' }),
    });
    expect(res.status).toBe(400);
    expect(seenDirs.length).toBe(before);
  });

  it('deletes the scratch render dir after the export completes', async () => {
    const res = await exportImage();
    await res.arrayBuffer();
    const used = seenDirs.at(-1)!;
    // Cleanup runs in the handler's finally, after the response is flushed —
    // poll for eventual removal rather than asserting synchronously.
    expect(await waitFor(() => !existsSync(used))).toBe(true);
    const remaining = existsSync(exportRenderRoot) ? await readdir(exportRenderRoot) : [];
    expect(remaining.length).toBe(0);
  });

  it('gives each concurrent export its own scratch dir', async () => {
    const before = seenDirs.length;
    await Promise.all(Array.from({ length: 5 }, () => exportImage().then((r) => r.arrayBuffer())));
    const fresh = seenDirs.slice(before);
    expect(fresh.length).toBe(5);
    expect(new Set(fresh).size).toBe(5); // all unique — no collision across concurrent exports
  });

  it('rejects a renderer slide path outside the scratch dir (no path-traversal read)', async () => {
    // A malicious/buggy renderer points slideFiles at a secret outside the
    // scratch dir; the daemon must refuse rather than read & stream it back.
    const dataDir = process.env.OD_DATA_DIR!;
    const secret = path.join(dataDir, 'SECRET-out-of-tree.txt');
    await writeFile(secret, 'TOP SECRET');
    const evilRenderer = async (input: DesktopRenderSlidesInput): Promise<DesktopRenderSlidesResult> => {
      if (input.outputDir) await mkdir(input.outputDir, { recursive: true });
      return { ok: true, slideFiles: [secret], width: 1920, height: 1080, mode: 'page' };
    };
    const srv = (await startServer({
      port: 0,
      returnServer: true,
      desktopSlideRenderer: evilRenderer,
    })) as { url: string; server: http.Server };
    try {
      const res = await fetch(`${srv.url}/api/projects/${projectId}/export/image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: 'index.html' }),
      });
      expect(res.status).toBe(502);
      const body = await res.text();
      expect(body).not.toContain('TOP SECRET');
    } finally {
      await new Promise<void>((resolve) => srv.server.close(() => resolve()));
    }
  });

  it('resolves an imported-folder project file via metadata.baseDir (not <data>/projects/:id)', async () => {
    // Imported-folder projects keep their workspace OUTSIDE <data>/projects/:id
    // (at metadata.baseDir). The screenshot export must thread that metadata into
    // readProjectFile, or it 404s on the default dir even though the file exists.
    const folder = path.join(realpathSync(os.tmpdir()), `od-import-export-${Date.now()}`);
    await mkdir(folder, { recursive: true });
    await writeFile(
      path.join(folder, 'index.html'),
      '<html><body><section class="slide">Imported</section></body></html>',
    );
    const importResp = await fetch(`${baseUrl}/api/import/folder`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseDir: folder }),
    });
    expect(importResp.status).toBe(200);
    const { project } = (await importResp.json()) as { project: { id: string } };

    const res = await fetch(`${baseUrl}/api/projects/${project.id}/export/image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: 'index.html' }),
    });
    // 200 (image streamed back) proves the file was resolved via baseDir — a
    // regression would surface as 404 FILE_NOT_FOUND.
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/png');
  });
});

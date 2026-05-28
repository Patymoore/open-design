import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { buildDesktopPdfExportInput } from '../src/pdf-export.js';
import { startServer } from '../src/server.js';

describe('buildDesktopPdfExportInput', () => {
  let projectsRoot = '';
  const projectId = 'proj-pdf-test';

  beforeEach(async () => {
    projectsRoot = mkdtempSync(path.join(tmpdir(), 'od-pdf-export-'));
    await mkdir(path.join(projectsRoot, projectId, 'deck', 'assets'), { recursive: true });
    await writeFile(
      path.join(projectsRoot, projectId, 'deck', 'index.html'),
      '<!doctype html><section class="slide">One</section>',
    );
  });

  afterEach(() => {
    if (projectsRoot) rmSync(projectsRoot, { recursive: true, force: true });
  });

  it('reads the project file and derives a raw-route baseHref from the file directory', async () => {
    const input = await buildDesktopPdfExportInput({
      daemonUrl: 'http://127.0.0.1:7456',
      deck: true,
      fileName: 'deck/index.html',
      projectId,
      projectsRoot,
      title: 'Seed Deck',
    });

    expect(input).toEqual({
      baseHref: 'http://127.0.0.1:7456/api/projects/proj-pdf-test/raw/deck/',
      deck: true,
      defaultFilename: 'Seed-Deck.pdf',
      html: '<!doctype html><section class="slide">One</section>',
      title: 'Seed Deck',
    });
  });

  it('falls back to the file basename when the caller omits a title', async () => {
    const input = await buildDesktopPdfExportInput({
      daemonUrl: 'http://127.0.0.1:7456',
      deck: false,
      fileName: 'deck/index.html',
      projectId,
      projectsRoot,
    });

    expect(input.title).toBe('index');
    expect(input.defaultFilename).toBe('index.pdf');
  });
});

describe('POST /api/projects/:id/export/pdf', () => {
  it('checks workspace membership before request body validation', async () => {
    const started = await startServer({
      port: 0,
      returnServer: true,
      desktopPdfExporter: async () => ({ ok: true, path: '/tmp/should-not-run.pdf' }),
    }) as { server: { close(cb: () => void): void }; url: string };

    try {
      const workspaceResp = await fetch(`${started.url}/api/workspaces`, {
        body: JSON.stringify({ name: `PDF private workspace ${Date.now()}` }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
      expect(workspaceResp.status).toBe(200);
      const workspaceBody = (await workspaceResp.json()) as { workspace: { id: string } };
      const projectId = `proj-pdf-private-${Date.now()}`;
      const createProjectResp = await fetch(`${started.url}/api/projects`, {
        body: JSON.stringify({
          id: projectId,
          name: 'PDF private route fixture',
          workspaceId: workspaceBody.workspace.id,
          skillId: null,
          designSystemId: null,
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
      expect(createProjectResp.status).toBe(200);

      const ownerResp = await fetch(`${started.url}/api/workspaces`);
      const ownerBody = (await ownerResp.json()) as { currentUserId: string };
      const dataDir = process.env.OD_DATA_DIR;
      if (!dataDir) throw new Error('OD_DATA_DIR is required for daemon route tests');
      const db = new Database(path.join(dataDir, 'app.sqlite'));
      try {
        db.prepare(
          `DELETE FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?`,
        ).run(workspaceBody.workspace.id, ownerBody.currentUserId);
      } finally {
        db.close();
      }

      const response = await fetch(`${started.url}/api/projects/${encodeURIComponent(projectId)}/export/pdf`, {
        body: JSON.stringify({}),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });

      expect(response.status).toBe(403);
      const body = (await response.json()) as { error?: { code?: string; message?: string } };
      expect(body.error?.code).toBe('FORBIDDEN');
      expect(body.error?.message).toMatch(/workspace membership/i);
    } finally {
      await new Promise<void>((resolve) => started.server.close(resolve));
    }
  });

  it('forwards the project HTML file to the configured desktop PDF exporter', async () => {
    const projectId = `proj-pdf-route-${Date.now()}`;
    const calls: unknown[] = [];
    const started = await startServer({
      port: 0,
      returnServer: true,
      desktopPdfExporter: async (input: unknown) => {
        calls.push(input);
        return { ok: true, path: '/tmp/seed.pdf' };
      },
    }) as { server: { close(cb: () => void): void }; url: string };

    try {
      const createProjectResp = await fetch(`${started.url}/api/projects`, {
        body: JSON.stringify({
          id: projectId,
          name: 'PDF route fixture',
          skillId: null,
          designSystemId: null,
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
      expect(createProjectResp.status).toBe(200);

      const fileResp = await fetch(`${started.url}/api/projects/${encodeURIComponent(projectId)}/files`, {
        body: JSON.stringify({
          content: '<!doctype html><section class="slide">One</section>',
          name: 'deck/index.html',
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
      expect(fileResp.status).toBe(200);

      const response = await fetch(`${started.url}/api/projects/${encodeURIComponent(projectId)}/export/pdf`, {
        body: JSON.stringify({ deck: true, fileName: 'deck/index.html', title: 'Seed Deck' }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, path: '/tmp/seed.pdf' });
      expect(calls).toEqual([
        {
          baseHref: `${started.url}/api/projects/${encodeURIComponent(projectId)}/raw/deck/`,
          deck: true,
          defaultFilename: 'Seed-Deck.pdf',
          html: '<!doctype html><section class="slide">One</section>',
          title: 'Seed Deck',
        },
      ]);
    } finally {
      await new Promise<void>((resolve) => started.server.close(resolve));
    }
  });
});

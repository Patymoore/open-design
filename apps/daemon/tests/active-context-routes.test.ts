import http from 'node:http';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { getActiveRoute, postActiveRoute } from '../src/active-context-routes.js';
import { ACTIVE_CONTEXT_TTL_MS } from '../src/constants.js';
import { startServer } from '../src/server.js';

interface MockStore {
  current:
    | {
        projectId: string;
        fileName: string | null;
        ts: number;
      }
    | null;
}

function makeDeps(now = 1_000) {
  const store: MockStore = { current: null };
  const getProject = vi.fn(
    (
      _db: unknown,
      id: string,
    ): { name?: string | null; workspaceId?: string | null } | null | undefined => ({
      name: `Project ${id}`,
      workspaceId: 'w1',
    }),
  );
  return {
    store,
    db: { fake: true },
    getLocalUserId: vi.fn(() => 'u1'),
    getProject,
    getWorkspaceMembership: vi.fn(
      (_db: unknown, _workspaceId: string, _userId: string): { role: string } | null => ({
        role: 'owner',
      }),
    ),
    now: () => now,
  };
}

const EMPTY_INPUT = { body: {}, query: {}, params: {} };

describe('active context — POST /api/active', () => {
  it('clears the store when body.active === false', async () => {
    const deps = makeDeps();
    deps.store.current = { projectId: 'p1', fileName: 'a.html', ts: 1 };
    const parsed = postActiveRoute.parse({ ...EMPTY_INPUT, body: { active: false } });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const out = await postActiveRoute.handle(parsed.value, deps);
    expect(out).toEqual({ ok: true, value: { active: false } });
    expect(deps.store.current).toBeNull();
  });

  it('rejects when projectId is missing', () => {
    const parsed = postActiveRoute.parse({ ...EMPTY_INPUT, body: {} });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.code).toBe('BAD_REQUEST');
    expect(parsed.error.message).toBe('projectId is required');
  });

  it('stores projectId + fileName + timestamp on success', async () => {
    const deps = makeDeps(5_000);
    const parsed = postActiveRoute.parse({
      ...EMPTY_INPUT,
      body: { projectId: 'p1', fileName: 'index.html' },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const out = await postActiveRoute.handle(parsed.value, deps);
    expect(out).toEqual({
      ok: true,
      value: { active: true, projectId: 'p1', fileName: 'index.html', ts: 5_000 },
    });
    expect(deps.store.current).toEqual({ projectId: 'p1', fileName: 'index.html', ts: 5_000 });
  });

  it('rejects storing active context without workspace membership', async () => {
    const deps = makeDeps(5_000);
    deps.getWorkspaceMembership.mockReturnValue(null);
    const parsed = postActiveRoute.parse({
      ...EMPTY_INPUT,
      body: { projectId: 'p1', fileName: 'index.html' },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const out = await postActiveRoute.handle(parsed.value, deps);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.code).toBe('FORBIDDEN');
    expect(deps.store.current).toBeNull();
  });

  it('treats empty fileName as null', async () => {
    const deps = makeDeps(7_000);
    const parsed = postActiveRoute.parse({
      ...EMPTY_INPUT,
      body: { projectId: 'p1', fileName: '' },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const out = await postActiveRoute.handle(parsed.value, deps);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value).toMatchObject({ active: true, fileName: null });
  });
});

describe('active context — GET /api/active', () => {
  it('returns inactive when nothing is stored', async () => {
    const deps = makeDeps();
    const out = await getActiveRoute.handle(undefined, deps);
    expect(out).toEqual({ ok: true, value: { active: false } });
  });

  it('returns inactive and clears when TTL has expired', async () => {
    const deps = makeDeps(10_000 + ACTIVE_CONTEXT_TTL_MS);
    deps.store.current = { projectId: 'p1', fileName: null, ts: 9_000 };
    const out = await getActiveRoute.handle(undefined, deps);
    expect(out).toEqual({ ok: true, value: { active: false } });
    expect(deps.store.current).toBeNull();
  });

  it('returns active payload with project name + ageMs when fresh', async () => {
    const deps = makeDeps(2_500);
    deps.store.current = { projectId: 'p7', fileName: 'plan.md', ts: 2_000 };
    const out = await getActiveRoute.handle(undefined, deps);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value).toEqual({
      active: true,
      projectId: 'p7',
      projectName: 'Project p7',
      fileName: 'plan.md',
      ts: 2_000,
      ageMs: 500,
    });
    expect(deps.getProject).toHaveBeenCalledWith(deps.db, 'p7');
  });

  it('returns inactive when the stored project is inaccessible', async () => {
    const deps = makeDeps(3_000);
    deps.getWorkspaceMembership.mockReturnValue(null);
    deps.store.current = { projectId: 'p9', fileName: null, ts: 2_500 };
    const out = await getActiveRoute.handle(undefined, deps);
    expect(out).toEqual({ ok: true, value: { active: false } });
    expect(deps.store.current).toBeNull();
  });
});

describe('/api/active workspace access', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
    };
    baseUrl = started.url;
    server = started.server;
  });

  afterAll(() => {
    if (!server) return;
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('only exposes the active project to members of its workspace', async () => {
    const workspaceResp = await fetch(`${baseUrl}/api/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Active context workspace ${Date.now()}` }),
    });
    expect(workspaceResp.status).toBe(200);
    const workspaceBody = (await workspaceResp.json()) as { workspace: { id: string } };

    const projectId = `active-context-private-${Date.now()}`;
    const projectResp = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: projectId,
        workspaceId: workspaceBody.workspace.id,
        name: 'Active context private project',
        skillId: null,
        designSystemId: null,
      }),
    });
    expect(projectResp.status).toBe(200);

    const activeResp = await fetch(`${baseUrl}/api/active`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, fileName: 'secret.html' }),
    });
    expect(activeResp.status).toBe(200);

    const ownerResp = await fetch(`${baseUrl}/api/workspaces`);
    const ownerBody = (await ownerResp.json()) as { currentUserId: string };
    const dataDir = process.env.OD_DATA_DIR;
    if (!dataDir) throw new Error('OD_DATA_DIR is required for daemon route tests');
    const db = new Database(path.join(dataDir, 'app.sqlite'));
    try {
      db.prepare(
        `INSERT OR REPLACE INTO local_identity (key, value) VALUES ('localUserId', ?)`,
      ).run(`active-context-outsider-${Date.now()}`);
    } finally {
      db.close();
    }

    try {
      const readResp = await fetch(`${baseUrl}/api/active`);
      expect(readResp.status).toBe(200);
      const readBody = (await readResp.json()) as {
        active: boolean;
        projectName?: string | null;
        fileName?: string | null;
      };
      expect(readBody).toEqual({ active: false });

      const writeResp = await fetch(`${baseUrl}/api/active`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, fileName: 'secret.html' }),
      });
      expect(writeResp.status).toBe(403);
    } finally {
      const restoreDb = new Database(path.join(dataDir, 'app.sqlite'));
      try {
        restoreDb.prepare(
          `INSERT OR REPLACE INTO local_identity (key, value) VALUES ('localUserId', ?)`,
        ).run(ownerBody.currentUserId);
      } finally {
        restoreDb.close();
      }
    }
  });
});

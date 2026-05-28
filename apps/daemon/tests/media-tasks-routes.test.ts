import type http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  closeDatabase,
  getLocalUserId,
  insertProject,
  insertWorkspace,
  openDatabase,
} from '../src/db.js';
import { insertMediaTask } from '../src/media-tasks.js';
import { startServer } from '../src/server.js';

describe('media task route recovery', () => {
  let server: http.Server | null = null;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      server = null;
    }
    closeDatabase();
  });

  it('recovers a pre-restart running task so wait returns interrupted instead of 404', async () => {
    const dataDir = process.env.OD_DATA_DIR;
    const db = openDatabase(process.cwd(), dataDir === undefined ? {} : { dataDir });
    const projectId = `project_${randomUUID()}`;
    const taskId = `task_${randomUUID()}`;
    const now = Date.now() - 5_000;

    insertProject(db, {
      id: projectId,
      name: 'Recovered media project',
      createdAt: now,
      updatedAt: now,
    });
    insertMediaTask(db, {
      id: taskId,
      projectId,
      status: 'running',
      surface: 'video',
      model: 'seedance-2',
      progress: ['provider task accepted'],
      startedAt: now,
      updatedAt: now,
    });

    const started = await startServer({ port: 0, returnServer: true }) as {
      url: string;
      server: http.Server;
    };
    server = started.server;

    const response = await fetch(`${started.url}/api/media/tasks/${encodeURIComponent(taskId)}/wait`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ since: 0, timeoutMs: 0 }),
    });
    const body = await response.json() as {
      status?: string;
      progress?: string[];
      error?: { code?: string; message?: string };
    };

    expect(response.status).toBe(200);
    expect(body.status).toBe('interrupted');
    expect(body.progress).toEqual(['provider task accepted']);
    expect(body.error).toMatchObject({
      code: 'DAEMON_RESTART',
      message: 'media task interrupted by daemon restart',
    });
  });

  it('requires workspace membership before waiting on a media task', async () => {
    const dataDir = process.env.OD_DATA_DIR;
    const db = openDatabase(process.cwd(), dataDir === undefined ? {} : { dataDir });
    const ownerUserId = getLocalUserId(db);
    const workspace = insertWorkspace(db, {
      name: 'Private media workspace',
      userId: ownerUserId,
    });
    if (!workspace) throw new Error('workspace fixture missing');
    const projectId = `project_${randomUUID()}`;
    const taskId = `task_${randomUUID()}`;
    const now = Date.now() - 5_000;

    insertProject(db, {
      id: projectId,
      workspaceId: workspace.id,
      name: 'Private media project',
      createdAt: now,
      updatedAt: now,
    });
    insertMediaTask(db, {
      id: taskId,
      projectId,
      status: 'running',
      surface: 'image',
      model: 'gpt-image-1',
      progress: ['provider task accepted'],
      startedAt: now,
      updatedAt: now,
    });
    db.prepare(
      `INSERT OR REPLACE INTO local_identity (key, value) VALUES ('localUserId', ?)`,
    ).run(`media-outsider-${randomUUID()}`);

    const started = await startServer({ port: 0, returnServer: true }) as {
      url: string;
      server: http.Server;
    };
    server = started.server;

    const response = await fetch(`${started.url}/api/media/tasks/${encodeURIComponent(taskId)}/wait`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ since: 0, timeoutMs: 0 }),
    });
    const body = await response.json() as {
      error?: { code?: string; message?: string };
    };

    expect(response.status).toBe(403);
    expect(body.error).toMatchObject({
      code: 'FORBIDDEN',
      message: 'workspace membership required',
    });
  });

  it('requires workspace membership before listing or creating media tasks', async () => {
    const dataDir = process.env.OD_DATA_DIR;
    const db = openDatabase(process.cwd(), dataDir === undefined ? {} : { dataDir });
    const ownerUserId = getLocalUserId(db);
    const workspace = insertWorkspace(db, {
      name: 'Private media generation workspace',
      userId: ownerUserId,
    });
    if (!workspace) throw new Error('workspace fixture missing');
    const projectId = `project_${randomUUID()}`;
    const taskId = `task_${randomUUID()}`;
    const now = Date.now() - 5_000;

    insertProject(db, {
      id: projectId,
      workspaceId: workspace.id,
      name: 'Private media generation project',
      createdAt: now,
      updatedAt: now,
    });
    insertMediaTask(db, {
      id: taskId,
      projectId,
      status: 'running',
      surface: 'image',
      model: 'gpt-image-1',
      progress: ['provider task accepted'],
      startedAt: now,
      updatedAt: now,
    });
    db.prepare(
      `INSERT OR REPLACE INTO local_identity (key, value) VALUES ('localUserId', ?)`,
    ).run(`media-list-outsider-${randomUUID()}`);

    const started = await startServer({ port: 0, returnServer: true }) as {
      url: string;
      server: http.Server;
    };
    server = started.server;

    const listResponse = await fetch(`${started.url}/api/projects/${encodeURIComponent(projectId)}/media/tasks`);
    const listBody = await listResponse.json() as {
      error?: { code?: string; message?: string };
    };

    expect(listResponse.status).toBe(403);
    expect(listBody.error).toMatchObject({
      code: 'FORBIDDEN',
      message: 'workspace membership required',
    });

    const generateResponse = await fetch(`${started.url}/api/projects/${encodeURIComponent(projectId)}/media/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        surface: 'image',
        model: 'gpt-image-1',
        prompt: 'blocked before provider call',
      }),
    });
    const generateBody = await generateResponse.json() as {
      error?: { code?: string; message?: string };
    };

    expect(generateResponse.status).toBe(403);
    expect(generateBody.error).toMatchObject({
      code: 'FORBIDDEN',
      message: 'workspace membership required',
    });
  });
});

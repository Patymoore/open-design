import { mkdir, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

import { startServer } from '../src/server.js';
import { connectorService, ConnectorServiceError } from '../src/connectors/service.js';
import { CHAT_TOOL_ENDPOINTS, CHAT_TOOL_OPERATIONS, toolTokenRegistry } from '../src/tool-tokens.js';

type StartedServer = { server: http.Server; url: string };
type JsonObject = Record<string, any>;
type JsonFetchResult<TBody extends JsonObject = JsonObject> = { status: number; body: TBody };
type TextFetchResult = { status: number; headers: Headers; body: string };
type RawHttpJsonFetchResult<TBody extends JsonObject = JsonObject> = {
  status: number | undefined;
  headers: http.IncomingHttpHeaders;
  body: TBody;
};
type ProjectEvent = { event: string; data: any };
type ProjectEventStream = {
  waitFor(predicate: (event: ProjectEvent) => boolean, timeoutMs?: number): Promise<ProjectEvent>;
  close(): Promise<void>;
};

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '../../..');
const serverRuntimeDataRoot = process.env.OD_DATA_DIR
  ? path.resolve(projectRoot, process.env.OD_DATA_DIR)
  : path.join(projectRoot, '.od');

let server: http.Server | undefined;
let baseUrl: string;
const projectIds: string[] = [];

beforeEach(async () => {
  const started = (await startServer({ port: 0, returnServer: true })) as StartedServer;
  server = started.server;
  baseUrl = started.url;
});

afterEach(async () => {
  vi.restoreAllMocks();
  await new Promise((resolve, reject) => {
    if (!server) return resolve(undefined);
    server.close((error?: Error) => (error ? reject(error) : resolve(undefined)));
  });
  server = undefined;
  toolTokenRegistry.clear();
  const cleanupProjectIds = projectIds.splice(0);
  await Promise.all(
    cleanupProjectIds.map((projectId) =>
      rm(path.join(serverRuntimeDataRoot, 'projects', projectId), { recursive: true, force: true }),
    ),
  );
});

function uniqueProjectId() {
  const id = `route-live-artifact-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  projectIds.push(id);
  return id;
}

function readAutoSafety(reason = 'test read-only connector fixture') {
  return { sideEffect: 'read' as const, approval: 'auto' as const, reason };
}

function validCreateInput(title = 'Tool Route Live Artifact') {
  return {
    title,
    preview: { type: 'html', entry: 'index.html' },
    document: {
      format: 'html_template_v1',
      templatePath: 'template.html',
      generatedPreviewPath: 'index.html',
      dataPath: 'data.json',
      dataJson: { title, owner: 'Agent' },
    },
  };
}

async function jsonFetch<TBody extends JsonObject = JsonObject>(url: string | URL, init?: RequestInit): Promise<JsonFetchResult<TBody>> {
  const response = await fetch(url, init);
  return { status: response.status, body: (await response.json()) as TBody };
}

async function textFetch(url: string | URL, init?: RequestInit): Promise<TextFetchResult> {
  const response = await fetch(url, init);
  return { status: response.status, headers: response.headers, body: await response.text() };
}

async function createProject(projectId: string): Promise<JsonFetchResult> {
  const response = await fetch(`${baseUrl}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: projectId, name: projectId }),
  });
  return { status: response.status, body: (await response.json()) as JsonObject };
}

async function rawHttpJsonFetch<TBody extends JsonObject = JsonObject>(
  url: string,
  { headers = {}, method = 'GET' }: { headers?: http.OutgoingHttpHeaders; method?: string } = {},
): Promise<RawHttpJsonFetchResult<TBody>> {
  const parsed = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: `${parsed.pathname}${parsed.search}`,
        method,
        headers,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(body) as TBody });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function writeProjectJson(projectId: string, name: string, value: JsonObject): Promise<void> {
  const candidates = [path.join(serverRuntimeDataRoot, 'projects', projectId)];
  let lastError: unknown;
  let wrote = false;
  for (const dir of candidates) {
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
      wrote = true;
    } catch (error) {
      lastError = error;
    }
  }
  if (wrote) return;
  throw lastError;
}

async function openProjectEvents(projectId: string): Promise<ProjectEventStream> {
  const response = await fetch(`${baseUrl}/api/projects/${encodeURIComponent(projectId)}/events`, {
    headers: { Accept: 'text/event-stream' },
  });
  if (!response.ok || !response.body) {
    throw new Error(`failed to open project events stream: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const events: ProjectEvent[] = [];

  const pump = (async () => {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const raw = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf('\n\n');
        if (!raw.trim() || raw.startsWith(':')) continue;
        const evt: ProjectEvent = { event: 'message', data: '' };
        for (const line of raw.split('\n')) {
          if (line.startsWith('event: ')) evt.event = line.slice(7);
          if (line.startsWith('data: ')) evt.data += line.slice(6);
        }
        try {
          evt.data = JSON.parse(evt.data);
        } catch {}
        events.push(evt);
      }
    }
  })();

  return {
    async waitFor(predicate: (event: ProjectEvent) => boolean, timeoutMs = 5_000) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const match = events.find(predicate);
        if (match) return match;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error(`timed out waiting for project event; seen=${JSON.stringify(events)}`);
    },
    async close() {
      await reader.cancel().catch(() => {});
      await pump.catch(() => {});
    },
  };
}

function mintToolToken(projectId: string, runId: string, overrides: Partial<Parameters<typeof toolTokenRegistry.mint>[0]> = {}) {
  const db = new Database(path.join(serverRuntimeDataRoot, 'app.sqlite'));
  try {
    const now = Date.now();
    db.prepare(
      `INSERT OR IGNORE INTO projects (id, workspace_id, name, created_at, updated_at)
       VALUES (?, 'local-personal', ?, ?, ?)`,
    ).run(projectId, projectId, now, now);
  } finally {
    db.close();
  }
  return toolTokenRegistry.mint({
    projectId,
    runId,
    allowedEndpoints: CHAT_TOOL_ENDPOINTS,
    allowedOperations: CHAT_TOOL_OPERATIONS,
    ...overrides,
  }).token;
}

describe('live artifact tool routes', () => {
  it('creates and lists live artifacts for agent registration', async () => {
    const projectId = uniqueProjectId();
    const runId = 'run-route-test';
    const token = mintToolToken(projectId, runId);
    const create = await jsonFetch(`${baseUrl}/api/tools/live-artifacts/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        input: validCreateInput(),
        templateHtml: '<!doctype html><h1>{{data.title}}</h1><p>{{data.owner}}</p>',
        provenanceJson: {
          generatedAt: '2026-04-30T00:00:00.000Z',
          generatedBy: 'agent',
          sources: [{ label: 'Route test', type: 'user_input' }],
        },
      }),
    });

    expect(create.status).toBe(200);
    expect(create.body.artifact).toMatchObject({
      projectId,
      title: 'Tool Route Live Artifact',
      createdByRunId: runId,
      refreshStatus: 'idle',
    });

    const list = await jsonFetch(`${baseUrl}/api/tools/live-artifacts/list`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(list.status).toBe(200);
    expect(list.body.artifacts).toHaveLength(1);
    expect(list.body.artifacts[0]).toMatchObject({
      id: create.body.artifact.id,
      projectId,
      title: 'Tool Route Live Artifact',
      hasDocument: true,
    });
    expect(list.body.artifacts[0].document).toBeUndefined();
  });

  it('rejects live artifact access after its project is deleted from the workspace database', async () => {
    const projectId = uniqueProjectId();
    const token = mintToolToken(projectId, 'run-deleted-project-token-test');
    await createProject(projectId);
    const existing = await jsonFetch(`${baseUrl}/api/tools/live-artifacts/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        input: validCreateInput('Deleted Project Existing Artifact'),
        templateHtml: '<!doctype html><h1>{{data.title}}</h1>',
      }),
    });
    expect(existing.status).toBe(200);

    const db = new Database(path.join(serverRuntimeDataRoot, 'app.sqlite'));
    try {
      db.prepare(`DELETE FROM projects WHERE id = ?`).run(projectId);
    } finally {
      db.close();
    }

    const create = await jsonFetch(`${baseUrl}/api/tools/live-artifacts/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        input: validCreateInput('Deleted Project Token Artifact'),
        templateHtml: '<!doctype html><h1>{{data.title}}</h1>',
      }),
    });

    expect(create.status).toBe(404);
    expect(create.body.error).toMatchObject({
      code: 'PROJECT_NOT_FOUND',
      message: 'project not found',
    });

    const list = await jsonFetch(`${baseUrl}/api/live-artifacts?projectId=${encodeURIComponent(projectId)}`);
    expect(list.status).toBe(404);
    expect(list.body.error).toMatchObject({
      code: 'PROJECT_NOT_FOUND',
      message: 'project not found',
    });

    const detail = await jsonFetch(`${baseUrl}/api/live-artifacts/${existing.body.artifact.id}?projectId=${encodeURIComponent(projectId)}`);
    expect(detail.status).toBe(404);
    expect(detail.body.error).toMatchObject({
      code: 'PROJECT_NOT_FOUND',
      message: 'project not found',
    });

    const deleteResp = await jsonFetch(`${baseUrl}/api/live-artifacts/${existing.body.artifact.id}?projectId=${encodeURIComponent(projectId)}`, {
      method: 'DELETE',
    });
    expect(deleteResp.status).toBe(404);
    expect(deleteResp.body.error).toMatchObject({
      code: 'PROJECT_NOT_FOUND',
      message: 'project not found',
    });
  });

  it('creates public viewer links for live artifacts', async () => {
    const projectId = uniqueProjectId();
    const runId = 'run-share-test';
    await createProject(projectId);
    const token = mintToolToken(projectId, runId);
    const create = await jsonFetch(`${baseUrl}/api/tools/live-artifacts/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        input: validCreateInput('Shared Artifact'),
        templateHtml: '<!doctype html><h1>{{data.title}}</h1><p>{{data.owner}}</p>',
      }),
    });

    expect(create.status).toBe(200);
    const artifactId = create.body.artifact.id;
    const share = await jsonFetch(`${baseUrl}/api/live-artifacts/${artifactId}/shares?projectId=${projectId}`, {
      method: 'POST',
    });

    expect(share.status).toBe(200);
    expect(share.body.share).toMatchObject({
      targetType: 'live_artifact',
      projectId,
      projectName: projectId,
      artifactId,
      role: 'viewer',
    });
    expect(share.body.share.shareUrl).toContain('/share/live-artifact/');

    const duplicateShare = await jsonFetch(`${baseUrl}/api/live-artifacts/${artifactId}/shares?projectId=${projectId}`, {
      method: 'POST',
    });
    expect(duplicateShare.status).toBe(200);
    expect(duplicateShare.body.share.id).toBe(share.body.share.id);
    expect(duplicateShare.body.share.token).toBe(share.body.share.token);
    expect(duplicateShare.body.share.reused).toBeUndefined();

    const publicShare = await jsonFetch(`${baseUrl}/api/shares/live-artifacts/${share.body.share.token}`);
    expect(publicShare.status).toBe(200);
    expect(publicShare.body.share).toMatchObject({
      targetType: 'live_artifact',
      projectName: projectId,
      role: 'viewer',
    });
    expect(publicShare.body.share.createdByUserId).toBeUndefined();
    expect(publicShare.body.share.projectId).toBeUndefined();
    expect(publicShare.body.share.artifactId).toBeUndefined();
    expect(publicShare.body.share.token).toBeUndefined();
    expect(publicShare.body.artifact).toMatchObject({
      title: 'Shared Artifact',
      hasDocument: true,
    });
    expect(publicShare.body.artifact.id).toBeUndefined();
    expect(publicShare.body.artifact.document).toBeUndefined();
    expect(publicShare.body.artifact.projectId).toBeUndefined();
    expect(publicShare.body.artifact.sessionId).toBeUndefined();
    expect(publicShare.body.artifact.createdByRunId).toBeUndefined();
    expect(publicShare.body.previewUrl).toBe(`/api/shares/live-artifacts/${share.body.share.token}/preview`);

    const preview = await textFetch(`${baseUrl}/api/shares/live-artifacts/${share.body.share.token}/preview`);
    expect(preview.status).toBe(200);
    expect(preview.body).toContain('Shared Artifact');

    const workspaceShares = await jsonFetch(`${baseUrl}/api/workspaces/local-personal/shares`);
    expect(workspaceShares.status).toBe(200);
    expect(workspaceShares.body.shares.filter((item: any) => item.artifactId === artifactId)).toHaveLength(1);
    expect(workspaceShares.body.shares.find((item: any) => item.id === share.body.share.id)?.projectName).toBe(projectId);
    const workspaceActivity = await jsonFetch(`${baseUrl}/api/workspaces/local-personal/activity`);
    expect(workspaceActivity.status).toBe(200);
    expect(workspaceActivity.body.activities.filter((item: any) => (
      item.action === 'share.created' && item.targetId === share.body.share.id
    ))).toHaveLength(1);

    const deleteProjectResp = await jsonFetch(`${baseUrl}/api/projects/${projectId}`, {
      method: 'DELETE',
    });
    expect(deleteProjectResp.status).toBe(200);
    const afterProjectDelete = await jsonFetch(`${baseUrl}/api/shares/live-artifacts/${share.body.share.token}`);
    expect(afterProjectDelete.status).toBe(404);
    const db = new Database(path.join(serverRuntimeDataRoot, 'app.sqlite'));
    try {
      const shareRow = db.prepare(`SELECT id FROM resource_shares WHERE id = ?`).get(share.body.share.id);
      expect(shareRow).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it('revokes public viewer links for live artifacts', async () => {
    const projectId = uniqueProjectId();
    const runId = 'run-share-revoke-test';
    await createProject(projectId);
    const token = mintToolToken(projectId, runId);
    const create = await jsonFetch(`${baseUrl}/api/tools/live-artifacts/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        input: validCreateInput('Revoked Shared Artifact'),
        templateHtml: '<!doctype html><h1>{{data.title}}</h1>',
      }),
    });

    expect(create.status).toBe(200);
    const artifactId = create.body.artifact.id;
    const share = await jsonFetch(`${baseUrl}/api/live-artifacts/${artifactId}/shares?projectId=${projectId}`, {
      method: 'POST',
    });
    expect(share.status).toBe(200);

    const revoke = await jsonFetch(`${baseUrl}/api/workspaces/local-personal/shares/${share.body.share.id}`, {
      method: 'DELETE',
    });
    expect(revoke.status).toBe(200);

    const revokedShare = await jsonFetch(`${baseUrl}/api/shares/live-artifacts/${share.body.share.token}`);
    expect(revokedShare.status).toBe(404);

    const activity = await jsonFetch(`${baseUrl}/api/workspaces/local-personal/activity`);
    expect(activity.status).toBe(200);
    const actions = activity.body.activities.map((item: any) => item.action);
    expect(actions).toContain('share.created');
    expect(actions).toContain('share.revoked');
    expect(activity.body.activities.find((item: any) => item.action === 'share.created')?.metadata).toMatchObject({
      projectId,
      projectName: projectId,
      artifactId,
    });
    expect(activity.body.activities.find((item: any) => item.action === 'share.revoked')?.metadata).toMatchObject({
      projectId,
      projectName: projectId,
      artifactId,
    });
  });

  it('revokes public viewer links when their live artifact is deleted', async () => {
    const projectId = uniqueProjectId();
    await createProject(projectId);
    const token = mintToolToken(projectId, 'run-share-delete-artifact-test');
    const create = await jsonFetch(`${baseUrl}/api/tools/live-artifacts/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        input: validCreateInput('Deleted Shared Artifact'),
        templateHtml: '<!doctype html><h1>{{data.title}}</h1>',
      }),
    });
    expect(create.status).toBe(200);

    const artifactId = create.body.artifact.id;
    const share = await jsonFetch(`${baseUrl}/api/live-artifacts/${artifactId}/shares?projectId=${projectId}`, {
      method: 'POST',
    });
    expect(share.status).toBe(200);

    const beforeDelete = await jsonFetch(`${baseUrl}/api/workspaces/local-personal/shares`);
    expect(beforeDelete.status).toBe(200);
    expect(beforeDelete.body.shares.some((item: any) => item.id === share.body.share.id)).toBe(true);

    const deleted = await jsonFetch(`${baseUrl}/api/live-artifacts/${artifactId}?projectId=${projectId}`, {
      method: 'DELETE',
    });
    expect(deleted.status).toBe(200);

    const afterDelete = await jsonFetch(`${baseUrl}/api/workspaces/local-personal/shares`);
    expect(afterDelete.status).toBe(200);
    expect(afterDelete.body.shares.some((item: any) => item.id === share.body.share.id)).toBe(false);

    const publicShare = await jsonFetch(`${baseUrl}/api/shares/live-artifacts/${share.body.share.token}`);
    expect(publicShare.status).toBe(404);

    const db = new Database(path.join(serverRuntimeDataRoot, 'app.sqlite'));
    try {
      const shareRow = db
        .prepare(`SELECT revoked_at AS revokedAt FROM resource_shares WHERE id = ?`)
        .get(share.body.share.id) as { revokedAt?: number | null } | undefined;
      expect(typeof shareRow?.revokedAt).toBe('number');
    } finally {
      db.close();
    }

    const activity = await jsonFetch(`${baseUrl}/api/workspaces/local-personal/activity`);
    expect(activity.status).toBe(200);
    expect(activity.body.activities.find((item: any) => item.targetId === share.body.share.id)?.metadata).toMatchObject({
      reason: 'artifact_deleted',
      projectId,
      projectName: projectId,
      artifactId,
    });
  });

  it('requires workspace admin role to create public viewer links', async () => {
    const workspaceResp = await jsonFetch(`${baseUrl}/api/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Share workspace ${Date.now()}` }),
    });
    expect(workspaceResp.status).toBe(200);
    const workspaceId = workspaceResp.body.workspace.id as string;
    const projectId = uniqueProjectId();
    const projectResp = await jsonFetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: projectId, name: projectId, workspaceId }),
    });
    expect(projectResp.status).toBe(200);
    const token = mintToolToken(projectId, 'run-share-role-test');
    const create = await jsonFetch(`${baseUrl}/api/tools/live-artifacts/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        input: validCreateInput('Manager-only Share Artifact'),
        templateHtml: '<!doctype html><h1>{{data.title}}</h1>',
      }),
    });
    expect(create.status).toBe(200);

    const db = new Database(path.join(serverRuntimeDataRoot, 'app.sqlite'));
    const owner = await jsonFetch(`${baseUrl}/api/workspaces`);
    const ownerUserId = owner.body.currentUserId as string;
    const memberUserId = `share-member-${Date.now()}`;
    try {
      db.prepare(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role, joined_at)
         VALUES (?, ?, 'member', ?)`,
      ).run(workspaceId, memberUserId, Date.now());
      db.prepare(
        `INSERT OR REPLACE INTO local_identity (key, value) VALUES ('localUserId', ?)`,
      ).run(memberUserId);
    } finally {
      db.close();
    }

    const denied = await jsonFetch(`${baseUrl}/api/live-artifacts/${create.body.artifact.id}/shares?projectId=${projectId}`, {
      method: 'POST',
    });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('FORBIDDEN');

    const memberDelete = await jsonFetch(`${baseUrl}/api/live-artifacts/${create.body.artifact.id}?projectId=${projectId}`, {
      method: 'DELETE',
    });
    expect(memberDelete.status).toBe(403);
    expect(memberDelete.body.error.code).toBe('FORBIDDEN');

    const restoreDb = new Database(path.join(serverRuntimeDataRoot, 'app.sqlite'));
    try {
      restoreDb.prepare(
        `INSERT OR REPLACE INTO local_identity (key, value) VALUES ('localUserId', ?)`,
      ).run(ownerUserId);
    } finally {
      restoreDb.close();
    }

    const allowed = await jsonFetch(`${baseUrl}/api/live-artifacts/${create.body.artifact.id}/shares?projectId=${projectId}`, {
      method: 'POST',
    });
    expect(allowed.status).toBe(200);
    expect(allowed.body.share.shareUrl).toContain('/share/live-artifact/');

    const memberAgainDb = new Database(path.join(serverRuntimeDataRoot, 'app.sqlite'));
    try {
      memberAgainDb.prepare(
        `INSERT OR REPLACE INTO local_identity (key, value) VALUES ('localUserId', ?)`,
      ).run(memberUserId);
    } finally {
      memberAgainDb.close();
    }

    const memberShares = await jsonFetch(`${baseUrl}/api/workspaces/${workspaceId}/shares`);
    expect(memberShares.status).toBe(403);
    expect(memberShares.body.error.code).toBe('FORBIDDEN');

    const memberRevoke = await jsonFetch(`${baseUrl}/api/workspaces/${workspaceId}/shares/${allowed.body.share.id}`, {
      method: 'DELETE',
    });
    expect(memberRevoke.status).toBe(403);
    expect(memberRevoke.body.error.code).toBe('FORBIDDEN');

    const finalRestoreDb = new Database(path.join(serverRuntimeDataRoot, 'app.sqlite'));
    try {
      finalRestoreDb.prepare(
        `INSERT OR REPLACE INTO local_identity (key, value) VALUES ('localUserId', ?)`,
      ).run(ownerUserId);
    } finally {
      finalRestoreDb.close();
    }

    const ownerDelete = await jsonFetch(`${baseUrl}/api/live-artifacts/${create.body.artifact.id}?projectId=${projectId}`, {
      method: 'DELETE',
    });
    expect(ownerDelete.status).toBe(200);
  });

  it('allows members to collaborate on live artifacts but rejects non-members', async () => {
    const workspaceResp = await jsonFetch(`${baseUrl}/api/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Live artifact collaboration ${Date.now()}` }),
    });
    expect(workspaceResp.status).toBe(200);
    const workspaceId = workspaceResp.body.workspace.id as string;
    const projectId = uniqueProjectId();
    const projectResp = await jsonFetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: projectId, name: projectId, workspaceId }),
    });
    expect(projectResp.status).toBe(200);
    await writeProjectJson(projectId, 'artifact-metrics.json', {
      summary: { owner: 'Member source', status: 'ready' },
    });

    const token = mintToolToken(projectId, 'run-member-live-artifact-test');
    const create = await jsonFetch(`${baseUrl}/api/tools/live-artifacts/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        input: {
          ...validCreateInput('Member Editable Artifact'),
          document: {
            ...validCreateInput('Member Editable Artifact').document,
            sourceJson: {
              type: 'local_file',
              input: { path: 'artifact-metrics.json' },
              outputMapping: { dataPaths: [{ from: 'json.summary', to: 'summary' }], transform: 'identity' },
              refreshPermission: 'manual_refresh_granted_for_read_only',
            },
          },
        },
        templateHtml: '<!doctype html><h1>{{data.title}}</h1>',
      }),
    });
    expect(create.status).toBe(200);

    const owner = await jsonFetch(`${baseUrl}/api/workspaces`);
    const ownerUserId = owner.body.currentUserId as string;
    const memberUserId = `live-artifact-member-${Date.now()}`;
    const outsiderUserId = `live-artifact-outsider-${Date.now()}`;
    const db = new Database(path.join(serverRuntimeDataRoot, 'app.sqlite'));
    try {
      db.prepare(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role, joined_at)
         VALUES (?, ?, 'member', ?)`,
      ).run(workspaceId, memberUserId, Date.now());
      db.prepare(
        `INSERT OR REPLACE INTO local_identity (key, value) VALUES ('localUserId', ?)`,
      ).run(memberUserId);
    } finally {
      db.close();
    }

    const memberPatch = await jsonFetch(`${baseUrl}/api/live-artifacts/${create.body.artifact.id}?projectId=${encodeURIComponent(projectId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Member Updated Artifact' }),
    });
    expect(memberPatch.status).toBe(200);
    expect(memberPatch.body.artifact.title).toBe('Member Updated Artifact');

    const memberRefresh = await jsonFetch(`${baseUrl}/api/live-artifacts/${create.body.artifact.id}/refresh?projectId=${encodeURIComponent(projectId)}`, {
      method: 'POST',
    });
    expect(memberRefresh.status).toBe(200);
    expect(memberRefresh.body.artifact.refreshStatus).toBe('succeeded');

    const outsiderDb = new Database(path.join(serverRuntimeDataRoot, 'app.sqlite'));
    try {
      outsiderDb.prepare(
        `INSERT OR REPLACE INTO local_identity (key, value) VALUES ('localUserId', ?)`,
      ).run(outsiderUserId);
    } finally {
      outsiderDb.close();
    }

    const outsiderPatch = await jsonFetch(`${baseUrl}/api/live-artifacts/${create.body.artifact.id}?projectId=${encodeURIComponent(projectId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Outsider Updated Artifact' }),
    });
    expect(outsiderPatch.status).toBe(403);
    expect(outsiderPatch.body.error).toMatchObject({
      code: 'FORBIDDEN',
      message: 'workspace membership required',
    });

    const outsiderRefresh = await jsonFetch(`${baseUrl}/api/live-artifacts/${create.body.artifact.id}/refresh?projectId=${encodeURIComponent(projectId)}`, {
      method: 'POST',
    });
    expect(outsiderRefresh.status).toBe(403);
    expect(outsiderRefresh.body.error).toMatchObject({
      code: 'FORBIDDEN',
      message: 'workspace membership required',
    });

    const restoreDb = new Database(path.join(serverRuntimeDataRoot, 'app.sqlite'));
    try {
      restoreDb.prepare(
        `INSERT OR REPLACE INTO local_identity (key, value) VALUES ('localUserId', ?)`,
      ).run(ownerUserId);
    } finally {
      restoreDb.close();
    }
  });

  it('revokes viewer links created by admins when they lose manager access', async () => {
    const workspaceResp = await jsonFetch(`${baseUrl}/api/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Share revoke workspace ${Date.now()}` }),
    });
    expect(workspaceResp.status).toBe(200);
    const workspaceId = workspaceResp.body.workspace.id as string;
    const projectId = uniqueProjectId();
    const projectResp = await jsonFetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: projectId, name: projectId, workspaceId }),
    });
    expect(projectResp.status).toBe(200);
    const token = mintToolToken(projectId, 'run-share-creator-demote-test');
    const create = await jsonFetch(`${baseUrl}/api/tools/live-artifacts/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        input: validCreateInput('Admin-created Share Artifact'),
        templateHtml: '<!doctype html><h1>{{data.title}}</h1>',
      }),
    });
    expect(create.status).toBe(200);

    const owner = await jsonFetch(`${baseUrl}/api/workspaces`);
    const ownerUserId = owner.body.currentUserId as string;
    const adminUserId = `share-admin-${Date.now()}`;
    const db = new Database(path.join(serverRuntimeDataRoot, 'app.sqlite'));
    try {
      db.prepare(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role, joined_at)
         VALUES (?, ?, 'admin', ?)`,
      ).run(workspaceId, adminUserId, Date.now());
      db.prepare(
        `INSERT OR REPLACE INTO local_identity (key, value) VALUES ('localUserId', ?)`,
      ).run(adminUserId);
    } finally {
      db.close();
    }

    const share = await jsonFetch(`${baseUrl}/api/live-artifacts/${create.body.artifact.id}/shares?projectId=${projectId}`, {
      method: 'POST',
    });
    expect(share.status).toBe(200);
    const publicShareBeforeDemote = await jsonFetch(`${baseUrl}/api/shares/live-artifacts/${share.body.share.token}`);
    expect(publicShareBeforeDemote.status).toBe(200);

    const restoreDb = new Database(path.join(serverRuntimeDataRoot, 'app.sqlite'));
    try {
      restoreDb.prepare(
        `INSERT OR REPLACE INTO local_identity (key, value) VALUES ('localUserId', ?)`,
      ).run(ownerUserId);
    } finally {
      restoreDb.close();
    }

    const demote = await jsonFetch(`${baseUrl}/api/workspaces/${workspaceId}/members/${adminUserId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'member' }),
    });
    expect(demote.status).toBe(200);

    const publicShareAfterDemote = await jsonFetch(`${baseUrl}/api/shares/live-artifacts/${share.body.share.token}`);
    expect(publicShareAfterDemote.status).toBe(404);
    expect(publicShareAfterDemote.body.error.code).toBe('SHARE_NOT_FOUND');

    const workspaceShares = await jsonFetch(`${baseUrl}/api/workspaces/${workspaceId}/shares`);
    expect(workspaceShares.status).toBe(200);
    expect(workspaceShares.body.shares.some((item: any) => item.id === share.body.share.id)).toBe(false);

    const activity = await jsonFetch(`${baseUrl}/api/workspaces/${workspaceId}/activity`);
    expect(activity.status).toBe(200);
    const revokedActivity = activity.body.activities.find((item: any) => item.targetId === share.body.share.id);
    expect(revokedActivity?.action).toBe('share.revoked');
    expect(revokedActivity?.metadata).toMatchObject({
      reason: 'member_demoted',
      revokedUserId: adminUserId,
      artifactId: create.body.artifact.id,
      projectId,
      projectName: projectId,
    });
  });

  it('does not expose live artifact document source metadata through public viewer links', async () => {
    const projectId = uniqueProjectId();
    await createProject(projectId);
    const token = mintToolToken(projectId, 'run-share-redaction-test');
    const create = await jsonFetch(`${baseUrl}/api/tools/live-artifacts/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        input: {
          ...validCreateInput('Redacted Shared Artifact'),
          document: {
            ...validCreateInput('Redacted Shared Artifact').document,
            sourceJson: {
              type: 'local_file',
              input: { path: 'private-metrics.json' },
              refreshPermission: 'manual_refresh_granted_for_read_only',
            },
          },
        },
        templateHtml: '<!doctype html><h1>{{data.title}}</h1>',
      }),
    });
    expect(create.status).toBe(200);
    expect(create.body.artifact.document.sourceJson.input.path).toBe('private-metrics.json');

    const share = await jsonFetch(`${baseUrl}/api/live-artifacts/${create.body.artifact.id}/shares?projectId=${projectId}`, {
      method: 'POST',
    });
    expect(share.status).toBe(200);

    const publicShare = await jsonFetch(`${baseUrl}/api/shares/live-artifacts/${share.body.share.token}`);
    expect(publicShare.status).toBe(200);
    expect(publicShare.body.artifact).toMatchObject({
      title: 'Redacted Shared Artifact',
      hasDocument: true,
    });
    expect(publicShare.body.artifact.id).toBeUndefined();
    expect(publicShare.body.artifact.document).toBeUndefined();
    expect(JSON.stringify(publicShare.body)).not.toContain('private-metrics.json');
    expect(JSON.stringify(publicShare.body)).not.toContain('sourceJson');
    expect(JSON.stringify(publicShare.body)).not.toContain('run-share-redaction-test');
  });

  it('refreshes live artifacts through tool and UI routes', async () => {
    const projectId = uniqueProjectId();
    const token = mintToolToken(projectId, 'run-route-test-refresh');
    const executeConnector = vi.spyOn(connectorService, 'execute')
      .mockResolvedValueOnce({
        ok: true,
        connectorId: 'monet',
        toolName: 'monet.metrics',
        safety: readAutoSafety(),
        output: { title: 'Open bugs', owner: '7' },
      })
      .mockResolvedValueOnce({
        ok: true,
        connectorId: 'monet',
        toolName: 'monet.metrics',
        safety: readAutoSafety(),
        output: { title: 'Open bugs', owner: '8' },
      });

    const create = await jsonFetch(`${baseUrl}/api/tools/live-artifacts/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        input: {
          ...validCreateInput('Refresh Route Artifact'),
          document: {
            ...validCreateInput('Refresh Route Artifact').document,
            sourceJson: {
              type: 'connector_tool',
              toolName: 'monet.metrics',
              input: { report: 'bugs' },
              connector: {
                connectorId: 'monet',
                toolName: 'monet.metrics',
                approvalPolicy: 'read_only_auto',
              },
              refreshPermission: 'manual_refresh_granted_for_read_only',
            },
          },
        },
      }),
    });
    expect(create.status).toBe(200);
    expect(create.body.artifact.document.sourceJson.refreshPermission).toBe('manual_refresh_granted_for_read_only');

    const toolRefresh = await jsonFetch(`${baseUrl}/api/tools/live-artifacts/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ artifactId: create.body.artifact.id }),
    });
    expect(toolRefresh.status).toBe(200);
    expect(toolRefresh.body.refresh).toMatchObject({ id: 'refresh-000001', status: 'succeeded', refreshedSourceCount: 1 });
    expect(toolRefresh.body.artifact).toMatchObject({ refreshStatus: 'succeeded', lastRefreshedAt: expect.any(String) });
    expect(toolRefresh.body.artifact.document.dataJson).toMatchObject({ title: 'Open bugs', owner: '7' });
    expect(executeConnector).toHaveBeenCalledTimes(1);
    expect(executeConnector).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ expectedApprovalPolicy: expect.anything() }),
      expect.objectContaining({ purpose: 'artifact_refresh' }),
    );

    const uiRefresh = await jsonFetch(`${baseUrl}/api/live-artifacts/${create.body.artifact.id}/refresh?projectId=${encodeURIComponent(projectId)}`, {
      method: 'POST',
    });
    expect(uiRefresh.status).toBe(200);
    expect(uiRefresh.body.refresh).toMatchObject({ id: 'refresh-000002', status: 'succeeded', refreshedSourceCount: 1 });
    expect(uiRefresh.body.artifact.document.dataJson).toMatchObject({ title: 'Open bugs', owner: '8' });
    expect(executeConnector).toHaveBeenCalledTimes(2);
    expect(executeConnector).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ expectedApprovalPolicy: expect.anything() }),
      expect.objectContaining({ purpose: 'artifact_refresh' }),
    );
  });

  it('rejects local refresh sources when refreshPermission is none', async () => {
    const projectId = uniqueProjectId();
    const token = mintToolToken(projectId, 'run-route-test-refresh-disabled');

    const create = await jsonFetch(`${baseUrl}/api/tools/live-artifacts/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ input: validCreateInput('Disabled Refresh Artifact') }),
    });
    expect(create.status).toBe(200);

    const update = await jsonFetch(`${baseUrl}/api/tools/live-artifacts/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        artifactId: create.body.artifact.id,
        input: {
          document: {
            ...validCreateInput('Disabled Refresh Artifact').document,
            sourceJson: {
              type: 'daemon_tool',
              toolName: 'project_files.search',
              input: { query: 'should-not-run' },
              refreshPermission: 'none',
            },
          },
        },
      }),
    });
    expect(update.status).toBe(200);
    expect(update.body.artifact.document.sourceJson.refreshPermission).toBe('none');

    const refresh = await jsonFetch(`${baseUrl}/api/live-artifacts/${create.body.artifact.id}/refresh?projectId=${encodeURIComponent(projectId)}`, {
      method: 'POST',
    });
    expect(refresh.status).toBe(400);
    expect(refresh.body.error).toMatchObject({
      code: 'LIVE_ARTIFACT_REFRESH_UNAVAILABLE',
      message: 'Refresh is disabled for this artifact source.',
    });
  });

  it('returns persisted refresh history after a local_file refresh', async () => {
    const projectId = uniqueProjectId();
    const token = mintToolToken(projectId, 'run-route-test-refresh-history');
    await writeProjectJson(projectId, 'artifact-metrics.json', {
      summary: { owner: 'Disk source', status: 'ready' },
      stats: { openBugs: 7 },
    });

    const create = await jsonFetch(`${baseUrl}/api/tools/live-artifacts/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        input: {
          ...validCreateInput('Refresh History Artifact'),
          document: {
            ...validCreateInput('Refresh History Artifact').document,
            dataJson: { title: 'Refresh History Artifact', summary: { owner: 'Agent' } },
            sourceJson: {
              type: 'local_file',
              input: { path: 'artifact-metrics.json' },
              outputMapping: {
                dataPaths: [
                  { from: 'json.summary', to: 'summary' },
                  { from: 'json.stats', to: 'stats' },
                ],
                transform: 'identity',
              },
              refreshPermission: 'manual_refresh_granted_for_read_only',
            },
          },
        },
      }),
    });
    expect(create.status).toBe(200);

    const refresh = await jsonFetch(`${baseUrl}/api/live-artifacts/${create.body.artifact.id}/refresh?projectId=${encodeURIComponent(projectId)}`, {
      method: 'POST',
    });
    expect(refresh.status).toBe(200);
    expect(refresh.body.artifact.document.dataJson).toMatchObject({
      title: 'Refresh History Artifact',
      summary: { owner: 'Disk source', status: 'ready' },
      stats: { openBugs: 7 },
    });

    const refreshes = await jsonFetch(`${baseUrl}/api/live-artifacts/${create.body.artifact.id}/refreshes?projectId=${encodeURIComponent(projectId)}`);
    expect(refreshes.status).toBe(200);
    expect(refreshes.body.refreshes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          projectId,
          artifactId: create.body.artifact.id,
          refreshId: refresh.body.refresh.id,
          step: 'document',
          status: 'succeeded',
          source: expect.objectContaining({ sourceType: 'document' }),
        }),
      ]),
    );
  });

  it('emits project SSE live artifact events for patch delete and refresh', async () => {
    const projectId = uniqueProjectId();
    const token = mintToolToken(projectId, 'run-route-test-project-sse');
    await createProject(projectId);
    await writeProjectJson(projectId, 'artifact-metrics.json', {
      summary: { owner: 'Disk source', status: 'ready' },
    });
    const stream = await openProjectEvents(projectId);

    try {
      await stream.waitFor((evt) => evt.event === 'ready' && evt.data.projectId === projectId);

      const create = await jsonFetch(`${baseUrl}/api/tools/live-artifacts/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          input: {
            ...validCreateInput('SSE Artifact'),
            document: {
              ...validCreateInput('SSE Artifact').document,
              sourceJson: {
                type: 'local_file',
                input: { path: 'artifact-metrics.json' },
                outputMapping: { dataPaths: [{ from: 'json.summary', to: 'summary' }], transform: 'identity' },
                refreshPermission: 'manual_refresh_granted_for_read_only',
              },
            },
          },
        }),
      });
      expect(create.status).toBe(200);

      const patch = await jsonFetch(`${baseUrl}/api/live-artifacts/${create.body.artifact.id}?projectId=${encodeURIComponent(projectId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'SSE Artifact Updated' }),
      });
      expect(patch.status).toBe(200);
      await stream.waitFor((evt) => evt.event === 'live_artifact'
        && evt.data.action === 'updated'
        && evt.data.artifactId === create.body.artifact.id
        && evt.data.title === 'SSE Artifact Updated');

      const refresh = await jsonFetch(`${baseUrl}/api/live-artifacts/${create.body.artifact.id}/refresh?projectId=${encodeURIComponent(projectId)}`, {
        method: 'POST',
      });
      expect(refresh.status).toBe(200);
      await stream.waitFor((evt) => evt.event === 'live_artifact_refresh'
        && evt.data.phase === 'started'
        && evt.data.artifactId === create.body.artifact.id);
      await stream.waitFor((evt) => evt.event === 'live_artifact_refresh'
        && evt.data.phase === 'succeeded'
        && evt.data.artifactId === create.body.artifact.id
        && evt.data.refreshId === refresh.body.refresh.id);

      const deleted = await jsonFetch(`${baseUrl}/api/live-artifacts/${create.body.artifact.id}?projectId=${encodeURIComponent(projectId)}`, {
        method: 'DELETE',
      });
      expect(deleted.status).toBe(200);
      await stream.waitFor((evt) => evt.event === 'live_artifact'
        && evt.data.action === 'deleted'
        && evt.data.artifactId === create.body.artifact.id);
    } finally {
      await stream.close();
    }
  }, 15_000);

  it('rejects manual refresh requests with non-loopback host before refresh side effects', async () => {
    const projectId = uniqueProjectId();
    const token = mintToolToken(projectId, 'run-route-test-refresh-local-security');
    const executeConnector = vi.spyOn(connectorService, 'execute').mockResolvedValue({
      ok: true,
      connectorId: 'monet',
      toolName: 'monet.metrics',
      safety: readAutoSafety(),
      output: { title: 'Should not refresh', owner: '0' },
    });

    const create = await jsonFetch(`${baseUrl}/api/tools/live-artifacts/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        input: {
          ...validCreateInput('Refresh Local Security'),
          document: {
            ...validCreateInput('Refresh Local Security').document,
            sourceJson: {
              type: 'connector_tool',
              toolName: 'monet.metrics',
              input: { report: 'bugs' },
              connector: {
                connectorId: 'monet',
                toolName: 'monet.metrics',
                approvalPolicy: 'read_only_auto',
              },
              refreshPermission: 'manual_refresh_granted_for_read_only',
            },
          },
        },
      }),
    });
    expect(create.status).toBe(200);

    const refresh = await rawHttpJsonFetch(`${baseUrl}/api/live-artifacts/${create.body.artifact.id}/refresh?projectId=${encodeURIComponent(projectId)}`, {
      method: 'POST',
      headers: { Host: 'attacker.example' },
    });

    expect(refresh.status).toBe(403);
    expect(refresh.body.error).toMatchObject({
      code: 'FORBIDDEN',
      details: { header: 'host' },
    });
    expect(executeConnector).not.toHaveBeenCalled();
  });

  it('rejects connector refresh sources when refreshPermission is none', async () => {
    const projectId = uniqueProjectId();
    const token = mintToolToken(projectId, 'run-route-test-refresh-default');
    const executeConnector = vi.spyOn(connectorService, 'execute').mockResolvedValueOnce({
      ok: true,
      connectorId: 'monet',
      toolName: 'monet.metrics',
      safety: readAutoSafety(),
      output: { title: 'Default refresh', owner: '9' },
    });

    const create = await jsonFetch(`${baseUrl}/api/tools/live-artifacts/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ input: validCreateInput('Default Refresh Artifact') }),
    });
    expect(create.status).toBe(200);

    const update = await jsonFetch(`${baseUrl}/api/tools/live-artifacts/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        artifactId: create.body.artifact.id,
        input: {
          document: {
            ...validCreateInput('Default Refresh Artifact').document,
            sourceJson: {
              type: 'connector_tool',
              toolName: 'monet.metrics',
              input: { report: 'defaults' },
              connector: {
                connectorId: 'monet',
                toolName: 'monet.metrics',
                approvalPolicy: 'read_only_auto',
              },
              refreshPermission: 'none',
            },
          },
        },
      }),
    });
    expect(update.status).toBe(200);
    expect(update.body.artifact.document.sourceJson.refreshPermission).toBe('none');

    const refresh = await jsonFetch(`${baseUrl}/api/live-artifacts/${create.body.artifact.id}/refresh?projectId=${encodeURIComponent(projectId)}`, {
      method: 'POST',
    });
    expect(refresh.status).toBe(400);
    expect(refresh.body.error).toMatchObject({
      code: 'LIVE_ARTIFACT_REFRESH_UNAVAILABLE',
      message: 'Refresh is disabled for this artifact source.',
    });
    expect(executeConnector).not.toHaveBeenCalled();
  });

  it('rejects refresh requests when no refresh source exists', async () => {
    const projectId = uniqueProjectId();
    const token = mintToolToken(projectId, 'run-route-test-refresh-unavailable');

    const create = await jsonFetch(`${baseUrl}/api/tools/live-artifacts/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ input: validCreateInput('No Source Artifact') }),
    });
    expect(create.status).toBe(200);

    const uiRefresh = await jsonFetch(`${baseUrl}/api/live-artifacts/${create.body.artifact.id}/refresh?projectId=${encodeURIComponent(projectId)}`, {
      method: 'POST',
    });
    expect(uiRefresh.status).toBe(400);
    expect(uiRefresh.body.error).toMatchObject({
      code: 'LIVE_ARTIFACT_REFRESH_UNAVAILABLE',
      message: 'No refresh source is available yet.',
    });
  });

  it('marks artifacts failed and returns connector refresh error codes', async () => {
    const projectId = uniqueProjectId();
    const token = mintToolToken(projectId, 'run-route-test-refresh-failure');
    vi.spyOn(connectorService, 'execute').mockRejectedValueOnce(
      new ConnectorServiceError('CONNECTOR_NOT_CONNECTED', 'connector is not connected', 403, { connectorId: 'monet' }),
    );

    const create = await jsonFetch(`${baseUrl}/api/tools/live-artifacts/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        input: {
          ...validCreateInput('Failed Refresh Artifact'),
          document: {
            ...validCreateInput('Failed Refresh Artifact').document,
            sourceJson: {
              type: 'connector_tool',
              toolName: 'monet.metrics',
              input: { report: 'fail' },
              connector: {
                connectorId: 'monet',
                toolName: 'monet.metrics',
                approvalPolicy: 'read_only_auto',
              },
              refreshPermission: 'manual_refresh_granted_for_read_only',
            },
          },
        },
      }),
    });
    expect(create.status).toBe(200);

    const refresh = await jsonFetch(`${baseUrl}/api/live-artifacts/${create.body.artifact.id}/refresh?projectId=${encodeURIComponent(projectId)}`, {
      method: 'POST',
    });
    expect(refresh.status).toBe(403);
    expect(refresh.body.error).toMatchObject({ code: 'CONNECTOR_NOT_CONNECTED', message: 'connector is not connected' });

    const detail = await jsonFetch(`${baseUrl}/api/live-artifacts/${create.body.artifact.id}?projectId=${encodeURIComponent(projectId)}`);
    expect(detail.status).toBe(200);
    expect(detail.body.artifact).toMatchObject({ refreshStatus: 'failed' });
  });

  it('serves live artifact previews with restrictive iframe headers', async () => {
    const projectId = uniqueProjectId();
    const token = mintToolToken(projectId, 'run-route-test-preview');
    const create = await jsonFetch(`${baseUrl}/api/tools/live-artifacts/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        input: validCreateInput('Preview Route Artifact'),
        templateHtml: '<!doctype html><html><body><h1>{{data.title}}</h1><p>{{data.owner}}</p></body></html>',
      }),
    });

    expect(create.status).toBe(200);
    const preview = await textFetch(`${baseUrl}/api/live-artifacts/${create.body.artifact.id}/preview?projectId=${encodeURIComponent(projectId)}`);

    expect(preview.status).toBe(200);
    expect(preview.headers.get('content-type')).toContain('text/html');
    expect(preview.headers.get('x-content-type-options')).toBe('nosniff');
    expect(preview.headers.get('referrer-policy')).toBe('no-referrer');
    expect(preview.headers.get('access-control-allow-origin')).toBeNull();
    expect(preview.headers.get('vary')).toContain('Origin');
    const csp = preview.headers.get('content-security-policy') || '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain('sandbox allow-same-origin');
    expect(preview.body).toContain('<h1>Preview Route Artifact</h1>');
    expect(preview.body).toContain('<p>Agent</p>');

    const templateSource = await textFetch(`${baseUrl}/api/live-artifacts/${create.body.artifact.id}/preview?projectId=${encodeURIComponent(projectId)}&variant=template`);
    expect(templateSource.status).toBe(200);
    expect(templateSource.headers.get('content-type')).toContain('text/plain');
    expect(templateSource.body).toContain('{{data.title}}');

    const renderedSource = await textFetch(`${baseUrl}/api/live-artifacts/${create.body.artifact.id}/preview?projectId=${encodeURIComponent(projectId)}&variant=rendered-source`);
    expect(renderedSource.status).toBe(200);
    expect(renderedSource.headers.get('content-type')).toContain('text/plain');
    expect(renderedSource.body).toContain('<h1>Preview Route Artifact</h1>');
    expect(renderedSource.body).not.toContain('{{data.title}}');
  });

  it('returns API dataJson from data.json when the artifact cache diverges', async () => {
    const projectId = uniqueProjectId();
    const token = mintToolToken(projectId, 'run-route-test-data-json-source');
    const create = await jsonFetch(`${baseUrl}/api/tools/live-artifacts/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        input: validCreateInput('API Cache Artifact'),
        templateHtml: '<!doctype html><h1>{{data.title}}</h1><p>{{data.owner}}</p>',
      }),
    });

    expect(create.status).toBe(200);
    const diskDataJson = { title: 'Disk API Title', owner: 'data.json owner' };
    await writeFile(
      path.join(serverRuntimeDataRoot, 'projects', projectId, '.live-artifacts', create.body.artifact.id, 'data.json'),
      `${JSON.stringify(diskDataJson, null, 2)}\n`,
      'utf8',
    );

    const detail = await jsonFetch(`${baseUrl}/api/live-artifacts/${create.body.artifact.id}?projectId=${encodeURIComponent(projectId)}`);
    const preview = await textFetch(`${baseUrl}/api/live-artifacts/${create.body.artifact.id}/preview?projectId=${encodeURIComponent(projectId)}`);

    expect(detail.status).toBe(200);
    expect(detail.body.artifact.document.dataJson).toEqual(diskDataJson);
    expect(preview.status).toBe(200);
    expect(preview.body).toContain('<h1>Disk API Title</h1>');
    expect(preview.body).toContain('<p>data.json owner</p>');
  });

  it('rejects preview requests with non-loopback host or origin headers', async () => {
    const projectId = uniqueProjectId();
    const token = mintToolToken(projectId, 'run-route-test-preview-local-security');
    const create = await jsonFetch(`${baseUrl}/api/tools/live-artifacts/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        input: validCreateInput('Preview Local Security'),
        templateHtml: '<!doctype html><h1>{{data.title}}</h1>',
      }),
    });

    expect(create.status).toBe(200);
    const previewUrl = `${baseUrl}/api/live-artifacts/${create.body.artifact.id}/preview?projectId=${encodeURIComponent(projectId)}`;

    const rejectedHost = await rawHttpJsonFetch(previewUrl, { headers: { Host: 'attacker.example' } });
    expect(rejectedHost.status).toBe(403);
    expect(rejectedHost.body.error).toMatchObject({
      code: 'FORBIDDEN',
      details: { header: 'host' },
    });

    const rejectedOrigin = await jsonFetch(previewUrl, { headers: { Origin: 'https://attacker.example' } });
    expect(rejectedOrigin.status).toBe(403);
    expect(rejectedOrigin.body.error).toMatchObject({
      code: 'FORBIDDEN',
      details: { header: 'origin' },
    });
  });

  it('allows loopback-origin preview preflight without opening broad CORS', async () => {
    const projectId = uniqueProjectId();
    const response = await fetch(`${baseUrl}/api/live-artifacts/unused/preview?projectId=${encodeURIComponent(projectId)}`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:17573' },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:17573');
    expect(response.headers.get('access-control-allow-methods')).toBe('GET, POST, OPTIONS');
    expect(response.headers.get('access-control-allow-origin')).not.toBe('*');
  });

  it('rejects executable script in template previews', async () => {
    const projectId = uniqueProjectId();
    const token = mintToolToken(projectId, 'run-route-test-template-script');
    const create = await jsonFetch(`${baseUrl}/api/tools/live-artifacts/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        input: validCreateInput('Unsafe Template'),
        templateHtml: '<!doctype html><h1>{{data.title}}</h1><script src="/evil.js"></script>',
      }),
    });

    expect(create.status).toBe(400);
    expect(create.body.error).toMatchObject({
      code: 'LIVE_ARTIFACT_INVALID',
      details: { kind: 'validation' },
    });
    expect(JSON.stringify(create.body.error.details.issues)).toContain('script elements are not supported');
  });

  it('returns shared API validation errors from tool create', async () => {
    const projectId = uniqueProjectId();
    const token = mintToolToken(projectId, 'run-route-test-validation');
    const create = await jsonFetch(`${baseUrl}/api/tools/live-artifacts/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ input: { title: '' } }),
    });

    expect(create.status).toBe(400);
    expect(create.body.error).toMatchObject({
      code: 'LIVE_ARTIFACT_INVALID',
      details: { kind: 'validation' },
    });
  });

  it('rejects missing bearer token', async () => {
    const create = await jsonFetch(`${baseUrl}/api/tools/live-artifacts/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: validCreateInput() }),
    });

    expect(create.status).toBe(401);
    expect(create.body.error).toMatchObject({
      code: 'TOOL_TOKEN_MISSING',
      details: {
        endpoint: '/api/tools/live-artifacts/create',
        operation: 'live-artifacts:create',
      },
    });
  });

  it('rejects projectId overrides from the request body', async () => {
    const projectId = uniqueProjectId();
    const token = mintToolToken(projectId, 'run-route-test-project-override');
    const create = await jsonFetch(`${baseUrl}/api/tools/live-artifacts/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        projectId: 'different-project-id',
        input: validCreateInput(),
      }),
    });

    expect(create.status).toBe(403);
    expect(create.body.error).toMatchObject({
      code: 'FORBIDDEN',
      details: { suppliedProjectId: 'different-project-id' },
    });
  });

  it('rejects tokens that are not allowed to access the endpoint', async () => {
    const projectId = uniqueProjectId();
    const token = mintToolToken(projectId, 'run-route-test-endpoint-denied', {
      allowedEndpoints: ['/api/tools/live-artifacts/create'],
    });

    const list = await jsonFetch(`${baseUrl}/api/tools/live-artifacts/list`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(list.status).toBe(403);
    expect(list.body.error).toMatchObject({
      code: 'TOOL_ENDPOINT_DENIED',
      details: {
        endpoint: '/api/tools/live-artifacts/list',
        operation: 'live-artifacts:list',
      },
    });
  });

  it('rejects tokens that are not allowed to perform the operation', async () => {
    const projectId = uniqueProjectId();
    const token = mintToolToken(projectId, 'run-route-test-operation-denied', {
      allowedEndpoints: ['/api/tools/live-artifacts/list'],
      allowedOperations: ['live-artifacts:create'],
    });

    const list = await jsonFetch(`${baseUrl}/api/tools/live-artifacts/list`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(list.status).toBe(403);
    expect(list.body.error).toMatchObject({
      code: 'TOOL_OPERATION_DENIED',
      details: {
        endpoint: '/api/tools/live-artifacts/list',
        operation: 'live-artifacts:list',
      },
    });
  });
});

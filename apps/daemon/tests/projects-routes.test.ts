/**
 * Coverage for `GET /api/projects/:id`. The route was extended (#451) to
 * include a derived `resolvedDir` field so the web client can address the
 * on-disk working directory directly without reconstructing it from the
 * daemon's internal projects root. Two cases:
 *   1. Folder-imported project — `resolvedDir === metadata.baseDir`.
 *   2. Native project — `resolvedDir === path.join(<projects root>, id)`.
 *
 * Pre-existing daemon test files cover specific subdomains
 * (folder-import-projects, project-status, project-watchers, ...);
 * none own this route, so a dedicated `projects-routes` file is cleaner
 * than expanding any of them.
 */
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { startServer } from '../src/server.js';
import { createSnapshot } from '../src/plugins/snapshots.js';

function rawHttpRequest(
  url: string,
  opts: { method?: string; headers?: http.OutgoingHttpHeaders; body?: string } = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: `${parsed.pathname}${parsed.search}`,
        method: opts.method ?? 'GET',
        headers: opts.headers ?? {},
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

describe('GET /api/projects/:id resolvedDir', () => {
  let server: http.Server;
  let baseUrl: string;
  const tempDirs: string[] = [];

  beforeAll(async () => {
    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
    };
    baseUrl = started.url;
    server = started.server;
  });

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  afterAll(() => {
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function makeFolder(): string {
    const d = mkdtempSync(path.join(tmpdir(), 'od-projects-routes-'));
    tempDirs.push(d);
    return d;
  }

  it('returns resolvedDir === metadata.baseDir for an imported-folder project', async () => {
    const folder = makeFolder();
    await writeFile(path.join(folder, 'index.html'), '<!doctype html>');

    const importResp = await fetch(`${baseUrl}/api/import/folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseDir: folder }),
    });
    expect(importResp.status).toBe(200);
    const importBody = (await importResp.json()) as {
      project: { id: string; metadata?: { baseDir?: string } };
    };
    const projectId = importBody.project.id;
    const baseDir = importBody.project.metadata?.baseDir;
    expect(baseDir).toBeTruthy();

    const detailResp = await fetch(`${baseUrl}/api/projects/${projectId}`);
    expect(detailResp.status).toBe(200);
    const detail = (await detailResp.json()) as {
      project: { id: string };
      resolvedDir: string;
    };
    expect(detail.project.id).toBe(projectId);
    expect(detail.resolvedDir).toBe(baseDir);
  });

  it('returns resolvedDir under <projects root>/<id> for a native project', async () => {
    const projectId = `proj-routes-${Date.now()}`;
    const createResp = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: projectId,
        name: 'Native fixture',
        skillId: null,
        designSystemId: null,
      }),
    });
    expect(createResp.status).toBe(200);

    const detailResp = await fetch(`${baseUrl}/api/projects/${projectId}`);
    expect(detailResp.status).toBe(200);
    const detail = (await detailResp.json()) as {
      project: { id: string; metadata?: { baseDir?: string } };
      resolvedDir: string;
    };
    expect(detail.project.metadata?.baseDir).toBeUndefined();

    const dataDir = process.env.OD_DATA_DIR;
    if (!dataDir) throw new Error('OD_DATA_DIR is required for daemon route tests');
    const expected = path.join(dataDir, 'projects', projectId);
    expect(detail.resolvedDir).toBe(expected);
    expect(path.isAbsolute(detail.resolvedDir)).toBe(true);
  });

  it('defaults project creation to the current workspace when workspaceId is omitted', async () => {
    const workspaceResp = await fetch(`${baseUrl}/api/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Default project workspace ${Date.now()}` }),
    });
    expect(workspaceResp.status).toBe(200);
    const workspaceBody = (await workspaceResp.json()) as {
      workspace: { id: string };
      currentWorkspaceId?: string;
    };
    expect(workspaceBody.currentWorkspaceId).toBe(workspaceBody.workspace.id);

    const projectId = `proj-current-workspace-${Date.now()}`;
    const createResp = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: projectId,
        name: 'Current workspace default fixture',
        skillId: null,
        designSystemId: null,
      }),
    });
    expect(createResp.status).toBe(200);
    const createBody = (await createResp.json()) as { project: { workspaceId?: string } };
    expect(createBody.project.workspaceId).toBe(workspaceBody.workspace.id);

    const workspaceProjectsResp = await fetch(`${baseUrl}/api/projects?workspaceId=${workspaceBody.workspace.id}`);
    expect(workspaceProjectsResp.status).toBe(200);
    const workspaceProjectsBody = (await workspaceProjectsResp.json()) as { projects: Array<{ id: string }> };
    expect(workspaceProjectsBody.projects.some((project) => project.id === projectId)).toBe(true);

    const personalProjectsResp = await fetch(`${baseUrl}/api/projects?workspaceId=local-personal`);
    expect(personalProjectsResp.status).toBe(200);
    const personalProjectsBody = (await personalProjectsResp.json()) as { projects: Array<{ id: string }> };
    expect(personalProjectsBody.projects.some((project) => project.id === projectId)).toBe(false);
  });

  it('records project creation in workspace activity', async () => {
    const workspaceResp = await fetch(`${baseUrl}/api/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Activity workspace ${Date.now()}` }),
    });
    expect(workspaceResp.status).toBe(200);
    const workspaceBody = (await workspaceResp.json()) as { workspace: { id: string }; currentWorkspaceId?: string };
    const workspacesResp = await fetch(`${baseUrl}/api/workspaces`);
    expect(workspacesResp.status).toBe(200);
    const workspacesBody = (await workspacesResp.json()) as { currentUserId: string };
    const projectId = `proj-activity-${Date.now()}`;
    const createResp = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: projectId,
        workspaceId: workspaceBody.workspace.id,
        name: 'Activity fixture',
        skillId: null,
        designSystemId: null,
      }),
    });
    expect(createResp.status).toBe(200);
    const createBody = (await createResp.json()) as { project: { createdByUserId?: string; ownedByUserId?: string } };
    expect(createBody.project.createdByUserId).toBe(workspacesBody.currentUserId);
    expect(createBody.project.ownedByUserId).toBe(workspacesBody.currentUserId);
    const ownerTransferUserId = `project-owner-${Date.now()}`;
    const dataDir = process.env.OD_DATA_DIR;
    if (!dataDir) throw new Error('OD_DATA_DIR is required for daemon route tests');
    const ownerTransferDb = new Database(path.join(dataDir, 'app.sqlite'));
    try {
      ownerTransferDb.prepare(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role, joined_at)
         VALUES (?, ?, 'member', ?)`,
      ).run(workspaceBody.workspace.id, ownerTransferUserId, Date.now());
    } finally {
      ownerTransferDb.close();
    }
    const transferResp = await fetch(`${baseUrl}/api/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownedByUserId: ownerTransferUserId }),
    });
    expect(transferResp.status).toBe(200);
    const transferBody = (await transferResp.json()) as { project: { ownedByUserId?: string } };
    expect(transferBody.project.ownedByUserId).toBe(ownerTransferUserId);

    const activityResp = await fetch(`${baseUrl}/api/workspaces/${workspaceBody.workspace.id}/activity`);
    expect(activityResp.status).toBe(200);
    const activityBody = (await activityResp.json()) as {
      activities: Array<{ action: string; targetId?: string; metadata?: Record<string, unknown> }>;
    };
    expect(activityBody.activities).toContainEqual(expect.objectContaining({
      action: 'project.owner_transferred',
      targetId: projectId,
      metadata: expect.objectContaining({
        projectName: 'Activity fixture',
        fromUserId: workspacesBody.currentUserId,
        toUserId: ownerTransferUserId,
      }),
    }));
    expect(activityBody.activities).toContainEqual(expect.objectContaining({
      action: 'project.created',
      targetId: projectId,
      metadata: expect.objectContaining({
        projectName: 'Activity fixture',
        source: 'manual',
        createdByUserId: workspacesBody.currentUserId,
        ownedByUserId: workspacesBody.currentUserId,
      }),
    }));
  });

  it('persists skipDiscoveryBrief for batch-created projects', async () => {
    const projectId = `proj-skip-discovery-${Date.now()}`;
    const createResp = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: projectId,
        name: 'Batch fixture',
        skillId: null,
        designSystemId: 'default',
        metadata: { kind: 'prototype', platform: 'responsive' },
        skipDiscoveryBrief: true,
      }),
    });
    expect(createResp.status).toBe(200);
    const body = (await createResp.json()) as {
      project: { designSystemId?: string | null; metadata?: { skipDiscoveryBrief?: boolean } };
    };
    expect(body.project.designSystemId).toBe('default');
    expect(body.project.metadata?.skipDiscoveryBrief).toBe(true);
  });

  it('rejects non-boolean skipDiscoveryBrief on POST /api/projects', async () => {
    const projectId = `proj-skip-discovery-bad-${Date.now()}`;
    const resp = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: projectId,
        name: 'Bad batch fixture',
        skipDiscoveryBrief: 'yes',
      }),
    });
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error?: { code?: string; message?: string } };
    expect(body.error?.code).toBe('BAD_REQUEST');
    expect(body.error?.message).toMatch(/skipDiscoveryBrief/i);
  });

  it('returns 404 with PROJECT_NOT_FOUND for unknown ids', async () => {
    const resp = await fetch(`${baseUrl}/api/projects/does-not-exist-${Date.now()}`);
    expect(resp.status).toBe(404);
    const body = (await resp.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('PROJECT_NOT_FOUND');
  });

  // PR #974: `fromTrustedPicker` is privileged the same way `baseDir`
  // is — only the HMAC-gated POST /api/import/folder may set it. POST
  // /api/projects (the generic create endpoint) and PATCH
  // /api/projects/:id must reject any client-supplied attempt to
  // acquire or flip the marker, otherwise a compromised renderer could
  // mark a previously-untrusted folder-imported project as trusted and
  // re-open the openPath bypass.
  it('rejects fromTrustedPicker on POST /api/projects', async () => {
    const projectId = `proj-trusted-${Date.now()}`;
    const resp = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: projectId,
        name: 'Smuggled trust',
        skillId: null,
        designSystemId: null,
        metadata: { kind: 'prototype', fromTrustedPicker: true },
      }),
    });
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error?: { code?: string; message?: string } };
    expect(body.error?.code).toBe('BAD_REQUEST');
    expect(body.error?.message).toMatch(/fromTrustedPicker/i);
  });

  it('rejects fromTrustedPicker on PATCH /api/projects/:id', async () => {
    // Create a vanilla native project, then try to PATCH the
    // trusted-picker marker onto it. The handler must refuse —
    // PATCHing privileged metadata fields is the same threat surface
    // as setting them on creation.
    const projectId = `proj-trusted-patch-${Date.now()}`;
    const createResp = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: projectId,
        name: 'Native fixture',
        skillId: null,
        designSystemId: null,
      }),
    });
    expect(createResp.status).toBe(200);

    const patchResp = await fetch(`${baseUrl}/api/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ metadata: { kind: 'prototype', fromTrustedPicker: true } }),
    });
    expect(patchResp.status).toBe(400);
    const body = (await patchResp.json()) as { error?: { code?: string; message?: string } };
    expect(body.error?.code).toBe('BAD_REQUEST');
    expect(body.error?.message).toMatch(/fromTrustedPicker/i);
  });

  it('requires workspace membership for project access', async () => {
    const workspaceResp = await fetch(`${baseUrl}/api/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Private workspace ${Date.now()}` }),
    });
    expect(workspaceResp.status).toBe(200);
    const workspaceBody = (await workspaceResp.json()) as {
      workspace: { id: string };
    };
    const workspaceId = workspaceBody.workspace.id;

    const projectId = `proj-private-${Date.now()}`;
    const createResp = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: projectId,
        workspaceId,
        name: 'Private fixture',
        skillId: null,
        designSystemId: null,
      }),
    });
    expect(createResp.status).toBe(200);
    const createBody = (await createResp.json()) as { conversationId: string };

    const meResp = await fetch(`${baseUrl}/api/workspaces`);
    const meBody = (await meResp.json()) as { currentUserId: string };
    const dataDir = process.env.OD_DATA_DIR;
    if (!dataDir) throw new Error('OD_DATA_DIR is required for daemon route tests');
    const db = new Database(path.join(dataDir, 'app.sqlite'));
    let snapshotId = '';
    try {
      const snapshot = createSnapshot(db, {
        projectId,
        pluginId: 'private-plugin',
        pluginVersion: '1.0.0',
        manifestSourceDigest: 'digest-private-plugin',
        taskKind: 'new-generation',
        inputs: {},
        resolvedContext: { items: [] },
        capabilitiesGranted: [],
        capabilitiesRequired: [],
        assetsStaged: [],
        connectorsRequired: [],
        connectorsResolved: [],
        mcpServers: [],
      });
      snapshotId = snapshot.snapshotId;
      db.prepare(
        `DELETE FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?`,
      ).run(workspaceId, meBody.currentUserId);
    } finally {
      db.close();
    }

    const listForbidden = await fetch(`${baseUrl}/api/projects?workspaceId=${workspaceId}`);
    expect(listForbidden.status).toBe(403);

    const listAll = await fetch(`${baseUrl}/api/projects`);
    expect(listAll.status).toBe(200);
    const listAllBody = (await listAll.json()) as { projects: Array<{ id: string }> };
    expect(listAllBody.projects.some((project) => project.id === projectId)).toBe(false);

    const checks = await Promise.all([
      fetch(`${baseUrl}/api/projects/${projectId}`),
      fetch(`${baseUrl}/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Nope' }),
      }),
      fetch(`${baseUrl}/api/projects/${projectId}/conversations`),
      fetch(`${baseUrl}/api/projects/${projectId}/conversations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Nope' }),
      }),
      fetch(`${baseUrl}/api/projects/${projectId}/conversations/${createBody.conversationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Nope' }),
      }),
      fetch(`${baseUrl}/api/projects/${projectId}/conversations/${createBody.conversationId}/messages`),
      fetch(`${baseUrl}/api/projects/${projectId}/conversations/${createBody.conversationId}/messages/msg-forbidden`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'user', content: 'Nope' }),
      }),
      fetch(`${baseUrl}/api/projects/${projectId}/conversations/${createBody.conversationId}/comments`),
      fetch(`${baseUrl}/api/projects/${projectId}/conversations/${createBody.conversationId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: 'index.html', body: 'Nope' }),
      }),
      fetch(`${baseUrl}/api/projects/${projectId}/tabs`),
      fetch(`${baseUrl}/api/projects/${projectId}/tabs`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tabs: ['index.html'], active: 'index.html' }),
      }),
      fetch(`${baseUrl}/api/projects/${projectId}/files`),
      fetch(`${baseUrl}/api/projects/${projectId}/search`),
      fetch(`${baseUrl}/api/projects/${projectId}/upload`, { method: 'POST' }),
      fetch(`${baseUrl}/api/projects/${projectId}/applied-plugins`),
      fetch(`${baseUrl}/api/projects/${projectId}/genui`),
      fetch(`${baseUrl}/api/projects/${projectId}/genui/prefill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshotId: 'snap-1', surfaceId: 'surface-1' }),
      }),
      fetch(`${baseUrl}/api/projects/${projectId}/archive/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: [] }),
      }),
      fetch(`${baseUrl}/api/projects/${projectId}/export/index.html`),
      fetch(`${baseUrl}/api/projects/${projectId}/finalize/anthropic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      fetch(`${baseUrl}/api/projects/${projectId}/plugins/install-folder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '.' }),
      }),
      fetch(`${baseUrl}/api/projects/${projectId}/plugins/publish-github`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '.' }),
      }),
      fetch(`${baseUrl}/api/projects/${projectId}/plugins/contribute-open-design`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '.' }),
      }),
      fetch(`${baseUrl}/api/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, agentId: 'codex', message: 'Nope' }),
      }),
      fetch(`${baseUrl}/api/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: createBody.conversationId, agentId: 'codex', message: 'Nope' }),
      }),
      fetch(`${baseUrl}/api/projects/${projectId}`, { method: 'DELETE' }),
    ]);
    expect(checks.map((resp) => resp.status)).toEqual([
      403, 403, 403, 403, 403,
      403, 403, 403, 403, 403,
      403, 403, 403, 403, 403,
      403, 403, 403, 403, 403,
      403, 403, 403, 403, 403,
      403,
    ]);

    const snapshotDetailForbidden = await fetch(`${baseUrl}/api/applied-plugins/${snapshotId}`);
    expect(snapshotDetailForbidden.status).toBe(403);

    const snapshotCanonForbidden = await fetch(`${baseUrl}/api/applied-plugins/${snapshotId}/canon`);
    expect(snapshotCanonForbidden.status).toBe(403);

    const snapshotsResp = await fetch(`${baseUrl}/api/applied-plugins`);
    expect(snapshotsResp.status).toBe(200);
    const snapshotsBody = (await snapshotsResp.json()) as { snapshots: Array<{ snapshotId: string }> };
    expect(snapshotsBody.snapshots.some((snapshot) => snapshot.snapshotId === snapshotId)).toBe(false);

    const exportResp = await fetch(`${baseUrl}/api/applied-plugins/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        snapshotId,
        target: 'od',
        outDir: path.join(dataDir, 'private-snapshot-export'),
      }),
    });
    expect(exportResp.status).toBe(403);

    const projectExportResp = await fetch(`${baseUrl}/api/applied-plugins/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId,
        target: 'od',
        outDir: path.join(dataDir, 'private-project-export'),
      }),
    });
    expect(projectExportResp.status).toBe(403);

    const pluginStatsResp = await fetch(`${baseUrl}/api/plugins/stats`);
    expect(pluginStatsResp.status).toBe(200);
    const pluginStatsBody = (await pluginStatsResp.json()) as { snapshots: { total: number } };
    expect(pluginStatsBody.snapshots.total).toBe(snapshotsBody.snapshots.length);

    const personalTargetId = `${projectId}-personal-target`;
    const personalTargetResp = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: personalTargetId,
        name: 'Personal target',
        skillId: null,
        designSystemId: null,
      }),
    });
    expect(personalTargetResp.status).toBe(200);

    const reuseSnapshotRunResp = await fetch(`${baseUrl}/api/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: personalTargetId,
        appliedPluginSnapshotId: snapshotId,
        agentId: 'codex',
        message: 'Nope',
      }),
    });
    expect(reuseSnapshotRunResp.status).toBe(403);
    const reuseSnapshotRunBody = (await reuseSnapshotRunResp.json()) as {
      error?: { code?: string };
    };
    expect(reuseSnapshotRunBody.error?.code).toBe('snapshot-project-forbidden');

    const prefillPrivateSnapshotResp = await fetch(`${baseUrl}/api/projects/${personalTargetId}/genui/prefill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        snapshotId,
        surfaceId: 'private-surface',
        value: { accepted: true },
      }),
    });
    expect(prefillPrivateSnapshotResp.status).toBe(403);

    const reuseSnapshotProjectId = `${projectId}-reuse-target`;
    const reuseSnapshotProjectResp = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: reuseSnapshotProjectId,
        name: 'Reuse target',
        skillId: null,
        designSystemId: null,
        appliedPluginSnapshotId: snapshotId,
      }),
    });
    expect(reuseSnapshotProjectResp.status).toBe(403);
    const reuseSnapshotProjectBody = (await reuseSnapshotProjectResp.json()) as {
      error?: { code?: string };
    };
    expect(reuseSnapshotProjectBody.error?.code).toBe('snapshot-project-forbidden');

    const leakedReuseProjectResp = await fetch(`${baseUrl}/api/projects/${reuseSnapshotProjectId}`);
    expect(leakedReuseProjectResp.status).toBe(404);

    const createInWorkspace = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: `${projectId}-next`,
        workspaceId,
        name: 'Should not create',
        skillId: null,
        designSystemId: null,
      }),
    });
    expect(createInWorkspace.status).toBe(403);
  });

  it('requires workspace manager access for generated plugin external share actions', async () => {
    const workspaceResp = await fetch(`${baseUrl}/api/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Plugin action workspace ${Date.now()}` }),
    });
    expect(workspaceResp.status).toBe(200);
    const workspaceBody = (await workspaceResp.json()) as { workspace: { id: string } };
    const workspaceId = workspaceBody.workspace.id;
    const projectId = `proj-plugin-actions-${Date.now()}`;
    const createResp = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: projectId,
        workspaceId,
        name: 'Generated plugin action fixture',
        skillId: null,
        designSystemId: null,
      }),
    });
    expect(createResp.status).toBe(200);

    const meResp = await fetch(`${baseUrl}/api/workspaces`);
    const meBody = (await meResp.json()) as { currentUserId: string };
    const dataDir = process.env.OD_DATA_DIR;
    if (!dataDir) throw new Error('OD_DATA_DIR is required for daemon route tests');
    const db = new Database(path.join(dataDir, 'app.sqlite'));
    try {
      db.prepare(
        `UPDATE workspace_memberships SET role = 'member' WHERE workspace_id = ? AND user_id = ?`,
      ).run(workspaceId, meBody.currentUserId);
    } finally {
      db.close();
    }

    const publishResp = await fetch(`${baseUrl}/api/projects/${projectId}/plugins/publish-github`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '.' }),
    });
    expect(publishResp.status).toBe(403);
    const publishBody = (await publishResp.json()) as { error?: { message?: string } };
    expect(publishBody.error?.message).toMatch(/workspace admin role required/i);

    const contributeResp = await fetch(`${baseUrl}/api/projects/${projectId}/plugins/contribute-open-design`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '.' }),
    });
    expect(contributeResp.status).toBe(403);
    const contributeBody = (await contributeResp.json()) as { error?: { message?: string } };
    expect(contributeBody.error?.message).toMatch(/workspace admin role required/i);
  });

  it('renames, leaves, and deletes team workspaces with role checks', async () => {
    const workspaceResp = await fetch(`${baseUrl}/api/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Lifecycle workspace ${Date.now()}` }),
    });
    expect(workspaceResp.status).toBe(200);
    const workspaceBody = (await workspaceResp.json()) as {
      workspace: { id: string };
      currentWorkspaceId?: string;
    };
    const workspaceId = workspaceBody.workspace.id;
    expect(workspaceBody.currentWorkspaceId).toBe(workspaceId);
    const afterCreateWorkspacesResp = await fetch(`${baseUrl}/api/workspaces`);
    const afterCreateWorkspacesBody = (await afterCreateWorkspacesResp.json()) as { currentWorkspaceId: string };
    expect(afterCreateWorkspacesBody.currentWorkspaceId).toBe(workspaceId);

    const renameResp = await fetch(`${baseUrl}/api/workspaces/${workspaceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Lifecycle renamed' }),
    });
    expect(renameResp.status).toBe(200);
    const renameBody = (await renameResp.json()) as { workspace: { name: string } };
    expect(renameBody.workspace.name).toBe('Lifecycle renamed');

    const projectResp = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: `proj-lifecycle-${Date.now()}`,
        workspaceId,
        name: 'Lifecycle fixture',
        skillId: null,
        designSystemId: null,
      }),
    });
    expect(projectResp.status).toBe(200);
    const notEmptyResp = await fetch(`${baseUrl}/api/workspaces/${workspaceId}`, {
      method: 'DELETE',
    });
    expect(notEmptyResp.status).toBe(409);
    const notEmptyBody = (await notEmptyResp.json()) as { error?: { code?: string; message?: string } };
    expect(notEmptyBody.error?.code).toBe('WORKSPACE_NOT_EMPTY');
    expect(notEmptyBody.error?.message).toBe('delete or move 1 workspace project first');

    const routineWorkspaceResp = await fetch(`${baseUrl}/api/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Routine workspace ${Date.now()}` }),
    });
    expect(routineWorkspaceResp.status).toBe(200);
    const routineWorkspaceBody = (await routineWorkspaceResp.json()) as {
      workspace: { id: string };
    };
    const routineWorkspaceId = routineWorkspaceBody.workspace.id;
    const routineResp = await fetch(`${baseUrl}/api/routines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: routineWorkspaceId,
        name: 'Workspace automation',
        prompt: 'Summarize workspace activity.',
        schedule: { kind: 'daily', time: '09:00', timezone: 'UTC' },
        target: { mode: 'create_each_run' },
      }),
    });
    expect(routineResp.status).toBe(201);
    const routineBody = (await routineResp.json()) as { routine: { id: string } };
    const routineNotEmptyResp = await fetch(`${baseUrl}/api/workspaces/${routineWorkspaceId}`, {
      method: 'DELETE',
    });
    expect(routineNotEmptyResp.status).toBe(409);
    const routineNotEmptyBody = (await routineNotEmptyResp.json()) as { error?: { message?: string } };
    expect(routineNotEmptyBody.error?.message).toBe('delete 1 workspace automation first');
    const deleteRoutineResp = await fetch(`${baseUrl}/api/routines/${routineBody.routine.id}`, {
      method: 'DELETE',
    });
    expect(deleteRoutineResp.status).toBe(204);
    const deleteRoutineWorkspaceResp = await fetch(`${baseUrl}/api/workspaces/${routineWorkspaceId}`, {
      method: 'DELETE',
    });
    expect(deleteRoutineWorkspaceResp.status).toBe(200);

    const emptyWorkspaceResp = await fetch(`${baseUrl}/api/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Empty workspace ${Date.now()}` }),
    });
    expect(emptyWorkspaceResp.status).toBe(200);
    const emptyWorkspaceBody = (await emptyWorkspaceResp.json()) as {
      workspace: { id: string };
    };
    const emptyWorkspaceId = emptyWorkspaceBody.workspace.id;

    const inviteResp = await fetch(`${baseUrl}/api/workspaces/${emptyWorkspaceId}/invites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'member' }),
    });
    expect(inviteResp.status).toBe(200);
    const inviteBody = (await inviteResp.json()) as { invite: { token: string } };

    const dataDir = process.env.OD_DATA_DIR;
    if (!dataDir) throw new Error('OD_DATA_DIR is required for daemon route tests');
    const ownerResp = await fetch(`${baseUrl}/api/workspaces`);
    const ownerBody = (await ownerResp.json()) as { currentUserId: string };
    const inviteeUserId = `lifecycle-invitee-${Date.now()}`;
    const inviteeDb = new Database(path.join(dataDir, 'app.sqlite'));
    try {
      inviteeDb.prepare(
        `INSERT OR REPLACE INTO local_identity (key, value) VALUES ('localUserId', ?)`,
      ).run(inviteeUserId);
    } finally {
      inviteeDb.close();
    }

    const acceptResp = await fetch(`${baseUrl}/api/workspace-invites/${inviteBody.invite.token}/accept`, {
      method: 'POST',
    });
    expect(acceptResp.status).toBe(200);
    const inviteeWorkspacesResp = await fetch(`${baseUrl}/api/workspaces`);
    const inviteeWorkspacesBody = (await inviteeWorkspacesResp.json()) as { currentWorkspaceId: string };
    expect(inviteeWorkspacesBody.currentWorkspaceId).toBe(emptyWorkspaceId);
    const memberRenameResp = await fetch(`${baseUrl}/api/workspaces/${emptyWorkspaceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Member should not rename' }),
    });
    expect(memberRenameResp.status).toBe(403);
    const memberRenameBody = (await memberRenameResp.json()) as { error?: { code?: string } };
    expect(memberRenameBody.error?.code).toBe('FORBIDDEN');
    const leaveResp = await fetch(`${baseUrl}/api/workspaces/${emptyWorkspaceId}/membership`, {
      method: 'DELETE',
    });
    expect(leaveResp.status).toBe(200);
    const afterLeaveDb = new Database(path.join(dataDir, 'app.sqlite'));
    try {
      const currentRow = afterLeaveDb
        .prepare(`SELECT value FROM local_identity WHERE key = ?`)
        .get(`currentWorkspaceId:${inviteeUserId}`) as { value?: string } | undefined;
      expect(currentRow?.value).toBeUndefined();
    } finally {
      afterLeaveDb.close();
    }
    const afterLeaveResp = await fetch(`${baseUrl}/api/workspaces`);
    const afterLeaveBody = (await afterLeaveResp.json()) as { workspaces: Array<{ id: string }> };
    expect(afterLeaveBody.workspaces.some((workspace) => workspace.id === emptyWorkspaceId)).toBe(false);

    const restoreDb = new Database(path.join(dataDir, 'app.sqlite'));
    try {
      restoreDb.prepare(
        `INSERT OR REPLACE INTO local_identity (key, value) VALUES ('localUserId', ?)`,
      ).run(ownerBody.currentUserId);
      restoreDb.prepare(
        `INSERT OR REPLACE INTO local_identity (key, value) VALUES (?, ?)`,
      ).run(`currentWorkspaceId:${ownerBody.currentUserId}`, emptyWorkspaceId);
    } finally {
      restoreDb.close();
    }

    const deleteResp = await fetch(`${baseUrl}/api/workspaces/${emptyWorkspaceId}`, {
      method: 'DELETE',
    });
    expect(deleteResp.status).toBe(200);
    const afterDeleteDb = new Database(path.join(dataDir, 'app.sqlite'));
    try {
      const currentRow = afterDeleteDb
        .prepare(`SELECT value FROM local_identity WHERE key = ?`)
        .get(`currentWorkspaceId:${ownerBody.currentUserId}`) as { value?: string } | undefined;
      expect(currentRow?.value).toBeUndefined();
    } finally {
      afterDeleteDb.close();
    }
    const deletedMembersResp = await fetch(`${baseUrl}/api/workspaces/${emptyWorkspaceId}/members`);
    expect(deletedMembersResp.status).toBe(404);

    const personalDeleteResp = await fetch(`${baseUrl}/api/workspaces/local-personal`, {
      method: 'DELETE',
    });
    expect(personalDeleteResp.status).toBe(400);
  });

  it('persists the current workspace and falls back when access is gone', async () => {
    const workspaceResp = await fetch(`${baseUrl}/api/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Current workspace ${Date.now()}` }),
    });
    expect(workspaceResp.status).toBe(200);
    const workspaceBody = (await workspaceResp.json()) as { workspace: { id: string } };

    const selectResp = await fetch(`${baseUrl}/api/workspaces/current`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: workspaceBody.workspace.id }),
    });
    expect(selectResp.status).toBe(200);
    const selectBody = (await selectResp.json()) as { currentWorkspaceId: string };
    expect(selectBody.currentWorkspaceId).toBe(workspaceBody.workspace.id);

    const listResp = await fetch(`${baseUrl}/api/workspaces`);
    const listBody = (await listResp.json()) as { currentWorkspaceId: string };
    expect(listBody.currentWorkspaceId).toBe(workspaceBody.workspace.id);

    const accessListResp = await fetch(`${baseUrl}/api/workspaces`);
    expect(accessListResp.status).toBe(200);
    const accessListBody = (await accessListResp.json()) as {
      workspaces: Array<{ id: string; currentUserRole?: string }>;
    };
    expect(accessListBody.workspaces.find((workspace) => workspace.id === workspaceBody.workspace.id)?.currentUserRole).toBe('owner');
    expect(accessListBody.workspaces.find((workspace) => workspace.id === 'local-personal')?.currentUserRole).toBe('owner');

    const forbiddenResp = await fetch(`${baseUrl}/api/workspaces/current`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: 'missing-workspace' }),
    });
    expect(forbiddenResp.status).toBe(404);
    const forbiddenBody = (await forbiddenResp.json()) as { error?: { code?: string } };
    expect(forbiddenBody.error?.code).toBe('WORKSPACE_NOT_FOUND');

    const dataDir = process.env.OD_DATA_DIR;
    if (!dataDir) throw new Error('OD_DATA_DIR is required for daemon route tests');
    const db = new Database(path.join(dataDir, 'app.sqlite'));
    const meResp = await fetch(`${baseUrl}/api/workspaces`);
    const meBody = (await meResp.json()) as { currentUserId: string };
    try {
      db.prepare(
        `DELETE FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?`,
      ).run(workspaceBody.workspace.id, meBody.currentUserId);
    } finally {
      db.close();
    }

    const fallbackResp = await fetch(`${baseUrl}/api/workspaces`);
    const fallbackBody = (await fallbackResp.json()) as { currentWorkspaceId: string };
    expect(fallbackBody.currentWorkspaceId).toBe('local-personal');
  });

  it('moves projects between accessible workspaces', async () => {
    const sourceResp = await fetch(`${baseUrl}/api/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Source workspace ${Date.now()}` }),
    });
    const targetResp = await fetch(`${baseUrl}/api/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Target workspace ${Date.now()}` }),
    });
    expect(sourceResp.status).toBe(200);
    expect(targetResp.status).toBe(200);
    const sourceBody = (await sourceResp.json()) as { workspace: { id: string } };
    const targetBody = (await targetResp.json()) as { workspace: { id: string } };
    const projectId = `proj-move-${Date.now()}`;
    const createResp = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: projectId,
        workspaceId: sourceBody.workspace.id,
        name: 'Movable fixture',
        skillId: null,
        designSystemId: null,
      }),
    });
    expect(createResp.status).toBe(200);
    const currentUserResp = await fetch(`${baseUrl}/api/workspaces`);
    const currentUserBody = (await currentUserResp.json()) as { currentUserId: string };
    const sourceOnlyRoutineOwnerId = `routine-source-owner-${Date.now()}`;
    const dataDir = process.env.OD_DATA_DIR;
    if (!dataDir) throw new Error('OD_DATA_DIR is required for daemon route tests');
    const deploymentDb = new Database(path.join(dataDir, 'app.sqlite'));
    try {
      deploymentDb.prepare(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role, joined_at)
         VALUES (?, ?, 'member', ?)`,
      ).run(sourceBody.workspace.id, sourceOnlyRoutineOwnerId, Date.now());
      deploymentDb.prepare(
        `INSERT INTO deployments
           (id, project_id, file_name, provider_id, url, deployment_id, deployment_count, target, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        `deploy-${Date.now()}`,
        projectId,
        'index.html',
        'vercel',
        'https://example.com/movable-fixture',
        'deployment-1',
        1,
        'preview',
        'ready',
        Date.now(),
        Date.now(),
      );
      deploymentDb.prepare(
        `INSERT INTO resource_shares
           (id, token, target_type, project_id, artifact_id, role, created_by_user_id, created_at)
         VALUES (?, ?, 'live_artifact', ?, ?, 'viewer', ?, ?)`,
      ).run(
        `share-${Date.now()}`,
        `sharetoken${Date.now()}`,
        projectId,
        'artifact-1',
        currentUserBody.currentUserId,
        Date.now(),
      );
    } finally {
      deploymentDb.close();
    }
    const routineResp = await fetch(`${baseUrl}/api/routines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Move with project',
        prompt: 'Keep following the moved project.',
        schedule: { kind: 'daily', time: '09:00', timezone: 'UTC' },
        target: { mode: 'reuse', projectId },
        enabled: true,
      }),
    });
    expect(routineResp.status).toBe(201);
    const routineBody = (await routineResp.json()) as { routine: { id: string; workspaceId: string } };
    expect(routineBody.routine.workspaceId).toBe(sourceBody.workspace.id);
    const routineOwnerResp = await fetch(`${baseUrl}/api/routines/${routineBody.routine.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownedByUserId: sourceOnlyRoutineOwnerId }),
    });
    expect(routineOwnerResp.status).toBe(200);

    const moveResp = await fetch(`${baseUrl}/api/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: targetBody.workspace.id }),
    });
    expect(moveResp.status).toBe(200);
    const moveBody = (await moveResp.json()) as { project: { workspaceId: string } };
    expect(moveBody.project.workspaceId).toBe(targetBody.workspace.id);

    const sourceListResp = await fetch(`${baseUrl}/api/projects?workspaceId=${sourceBody.workspace.id}`);
    const sourceList = (await sourceListResp.json()) as { projects: Array<{ id: string }> };
    expect(sourceList.projects.some((project) => project.id === projectId)).toBe(false);

    const targetListResp = await fetch(`${baseUrl}/api/projects?workspaceId=${targetBody.workspace.id}`);
    const targetList = (await targetListResp.json()) as { projects: Array<{ id: string }> };
    expect(targetList.projects.some((project) => project.id === projectId)).toBe(true);

    const sourceRoutinesResp = await fetch(`${baseUrl}/api/routines?workspaceId=${sourceBody.workspace.id}`);
    expect(sourceRoutinesResp.status).toBe(200);
    const sourceRoutines = (await sourceRoutinesResp.json()) as { routines: Array<{ id: string }> };
    expect(sourceRoutines.routines.some((routine) => routine.id === routineBody.routine.id)).toBe(false);

    const targetRoutinesResp = await fetch(`${baseUrl}/api/routines?workspaceId=${targetBody.workspace.id}`);
    expect(targetRoutinesResp.status).toBe(200);
    const targetRoutines = (await targetRoutinesResp.json()) as { routines: Array<{ id: string; target: { mode: string; projectId?: string } }> };
    expect(targetRoutines.routines.find((routine) => routine.id === routineBody.routine.id)).toMatchObject({
      id: routineBody.routine.id,
      target: { mode: 'reuse', projectId },
    });
    const afterMoveDb = new Database(path.join(dataDir, 'app.sqlite'));
    try {
      const movedRoutineOwner = afterMoveDb
        .prepare(`SELECT owned_by_user_id AS ownedByUserId FROM routines WHERE id = ?`)
        .get(routineBody.routine.id) as { ownedByUserId?: string } | undefined;
      expect(movedRoutineOwner?.ownedByUserId).toBe(currentUserBody.currentUserId);
    } finally {
      afterMoveDb.close();
    }

    const sourceSharesResp = await fetch(`${baseUrl}/api/workspaces/${sourceBody.workspace.id}/shares`);
    expect(sourceSharesResp.status).toBe(200);
    const sourceShares = (await sourceSharesResp.json()) as { shares: Array<{ projectId: string }> };
    expect(sourceShares.shares.some((share) => share.projectId === projectId)).toBe(false);

    const targetSharesResp = await fetch(`${baseUrl}/api/workspaces/${targetBody.workspace.id}/shares`);
    expect(targetSharesResp.status).toBe(200);
    const targetShares = (await targetSharesResp.json()) as { shares: Array<{ projectId: string; artifactId?: string }> };
    expect(targetShares.shares).toContainEqual(expect.objectContaining({
      projectId,
      artifactId: 'artifact-1',
    }));

    const sourceActivityResp = await fetch(`${baseUrl}/api/workspaces/${sourceBody.workspace.id}/activity`);
    expect(sourceActivityResp.status).toBe(200);
    const sourceActivity = (await sourceActivityResp.json()) as { activities: Array<{ action: string; targetId?: string; metadata?: any }> };
    expect(sourceActivity.activities).toContainEqual(expect.objectContaining({
      action: 'project.moved',
      targetId: projectId,
      metadata: expect.objectContaining({
        movedDeploymentCount: 1,
        movedShareCount: 1,
        fromWorkspaceId: sourceBody.workspace.id,
        toWorkspaceId: targetBody.workspace.id,
      }),
    }));
    expect(sourceActivity.activities).toContainEqual(expect.objectContaining({
      action: 'routine.updated',
      targetId: routineBody.routine.id,
      metadata: expect.objectContaining({
        reason: 'project_moved',
        projectId,
        fromWorkspaceId: sourceBody.workspace.id,
        toWorkspaceId: targetBody.workspace.id,
      }),
    }));

    const targetActivityResp = await fetch(`${baseUrl}/api/workspaces/${targetBody.workspace.id}/activity`);
    expect(targetActivityResp.status).toBe(200);
    const targetActivity = (await targetActivityResp.json()) as { activities: Array<{ action: string; targetId?: string; metadata?: any }> };
    expect(targetActivity.activities).toContainEqual(expect.objectContaining({
      action: 'project.moved',
      targetId: projectId,
      metadata: expect.objectContaining({
        movedDeploymentCount: 1,
        movedShareCount: 1,
        fromWorkspaceId: sourceBody.workspace.id,
        toWorkspaceId: targetBody.workspace.id,
      }),
    }));
    expect(targetActivity.activities).toContainEqual(expect.objectContaining({
      action: 'routine.updated',
      targetId: routineBody.routine.id,
      metadata: expect.objectContaining({
        reason: 'project_moved',
        projectId,
        fromWorkspaceId: sourceBody.workspace.id,
        toWorkspaceId: targetBody.workspace.id,
      }),
    }));
    expect(targetActivity.activities).toContainEqual(expect.objectContaining({
      action: 'routine.owner_transferred',
      targetId: routineBody.routine.id,
      metadata: expect.objectContaining({
        reason: 'project_moved',
        projectId,
        fromUserId: sourceOnlyRoutineOwnerId,
        toUserId: currentUserBody.currentUserId,
      }),
    }));
  });

  it('transfers project ownership to the mover when the old owner is not in the target workspace', async () => {
    const sourceResp = await fetch(`${baseUrl}/api/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Owner source ${Date.now()}` }),
    });
    const targetResp = await fetch(`${baseUrl}/api/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Owner target ${Date.now()}` }),
    });
    expect(sourceResp.status).toBe(200);
    expect(targetResp.status).toBe(200);
    const sourceBody = (await sourceResp.json()) as { workspace: { id: string } };
    const targetBody = (await targetResp.json()) as { workspace: { id: string } };
    const ownerResp = await fetch(`${baseUrl}/api/workspaces`);
    const ownerBody = (await ownerResp.json()) as { currentUserId: string };
    const sourceOnlyOwnerId = `source-owner-${Date.now()}`;
    const projectId = `proj-owner-move-${Date.now()}`;
    const dataDir = process.env.OD_DATA_DIR;
    if (!dataDir) throw new Error('OD_DATA_DIR is required for daemon route tests');
    const membershipDb = new Database(path.join(dataDir, 'app.sqlite'));
    try {
      membershipDb.prepare(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role, joined_at)
         VALUES (?, ?, 'member', ?)`,
      ).run(sourceBody.workspace.id, sourceOnlyOwnerId, Date.now());
    } finally {
      membershipDb.close();
    }

    const createResp = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: projectId,
        workspaceId: sourceBody.workspace.id,
        name: 'Move owner fixture',
        skillId: null,
        designSystemId: null,
      }),
    });
    expect(createResp.status).toBe(200);

    const sourceOwnerResp = await fetch(`${baseUrl}/api/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownedByUserId: sourceOnlyOwnerId }),
    });
    expect(sourceOwnerResp.status).toBe(200);
    const sourceOwnerBody = (await sourceOwnerResp.json()) as { project: { ownedByUserId?: string } };
    expect(sourceOwnerBody.project.ownedByUserId).toBe(sourceOnlyOwnerId);

    const moveResp = await fetch(`${baseUrl}/api/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: targetBody.workspace.id }),
    });
    expect(moveResp.status).toBe(200);
    const moveBody = (await moveResp.json()) as { project: { workspaceId: string; ownedByUserId?: string } };
    expect(moveBody.project.workspaceId).toBe(targetBody.workspace.id);
    expect(moveBody.project.ownedByUserId).toBe(ownerBody.currentUserId);

    const activityResp = await fetch(`${baseUrl}/api/workspaces/${targetBody.workspace.id}/activity`);
    expect(activityResp.status).toBe(200);
    const activityBody = (await activityResp.json()) as {
      activities: Array<{ action: string; targetId?: string; metadata?: Record<string, unknown> }>;
    };
    expect(activityBody.activities).toContainEqual(expect.objectContaining({
      action: 'project.owner_transferred',
      targetId: projectId,
      metadata: expect.objectContaining({
        fromUserId: sourceOnlyOwnerId,
        toUserId: ownerBody.currentUserId,
      }),
    }));
  });

  it('requires admin access in both workspaces to move a project', async () => {
    const sourceResp = await fetch(`${baseUrl}/api/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Move source ${Date.now()}` }),
    });
    const targetResp = await fetch(`${baseUrl}/api/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Move target ${Date.now()}` }),
    });
    expect(sourceResp.status).toBe(200);
    expect(targetResp.status).toBe(200);
    const sourceBody = (await sourceResp.json()) as { workspace: { id: string } };
    const targetBody = (await targetResp.json()) as { workspace: { id: string } };
    const projectId = `proj-member-move-${Date.now()}`;
    const createResp = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: projectId,
        workspaceId: sourceBody.workspace.id,
        name: 'Member move fixture',
        skillId: null,
        designSystemId: null,
      }),
    });
    expect(createResp.status).toBe(200);

    const dataDir = process.env.OD_DATA_DIR;
    if (!dataDir) throw new Error('OD_DATA_DIR is required for daemon route tests');
    const ownerResp = await fetch(`${baseUrl}/api/workspaces`);
    const ownerBody = (await ownerResp.json()) as { currentUserId: string };
    const memberUserId = `move-member-${Date.now()}`;
    const db = new Database(path.join(dataDir, 'app.sqlite'));
    try {
      db.prepare(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role, joined_at)
         VALUES (?, ?, 'member', ?)`,
      ).run(sourceBody.workspace.id, memberUserId, Date.now());
      db.prepare(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role, joined_at)
         VALUES (?, ?, 'member', ?)`,
      ).run(targetBody.workspace.id, memberUserId, Date.now());
      db.prepare(
        `INSERT OR REPLACE INTO local_identity (key, value) VALUES ('localUserId', ?)`,
      ).run(memberUserId);
    } finally {
      db.close();
    }

    const memberMoveResp = await fetch(`${baseUrl}/api/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: targetBody.workspace.id }),
    });
    expect(memberMoveResp.status).toBe(403);
    const memberMoveBody = (await memberMoveResp.json()) as { error?: { code?: string; message?: string } };
    expect(memberMoveBody.error?.code).toBe('FORBIDDEN');
    expect(memberMoveBody.error?.message).toMatch(/admin role/i);

    const memberOwnerTransferResp = await fetch(`${baseUrl}/api/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownedByUserId: memberUserId }),
    });
    expect(memberOwnerTransferResp.status).toBe(403);
    const memberOwnerTransferBody = (await memberOwnerTransferResp.json()) as { error?: { code?: string; message?: string } };
    expect(memberOwnerTransferBody.error?.code).toBe('FORBIDDEN');
    expect(memberOwnerTransferBody.error?.message).toMatch(/admin role/i);

    const memberRenameResp = await fetch(`${baseUrl}/api/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Member should not rename project' }),
    });
    expect(memberRenameResp.status).toBe(403);
    const memberRenameBody = (await memberRenameResp.json()) as { error?: { code?: string; message?: string } };
    expect(memberRenameBody.error?.code).toBe('FORBIDDEN');
    expect(memberRenameBody.error?.message).toMatch(/admin role/i);

    const memberDeleteResp = await fetch(`${baseUrl}/api/projects/${projectId}`, {
      method: 'DELETE',
    });
    expect(memberDeleteResp.status).toBe(403);
    const memberDeleteBody = (await memberDeleteResp.json()) as { error?: { code?: string; message?: string } };
    expect(memberDeleteBody.error?.code).toBe('FORBIDDEN');
    expect(memberDeleteBody.error?.message).toMatch(/admin role/i);

    const restoreDb = new Database(path.join(dataDir, 'app.sqlite'));
    try {
      restoreDb.prepare(
        `INSERT OR REPLACE INTO local_identity (key, value) VALUES ('localUserId', ?)`,
      ).run(ownerBody.currentUserId);
    } finally {
      restoreDb.close();
    }
    const ownerMoveResp = await fetch(`${baseUrl}/api/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId: targetBody.workspace.id }),
    });
    expect(ownerMoveResp.status).toBe(200);
    const ownerMoveBody = (await ownerMoveResp.json()) as { project: { workspaceId: string } };
    expect(ownerMoveBody.project.workspaceId).toBe(targetBody.workspace.id);

    const ownerDeleteResp = await fetch(`${baseUrl}/api/projects/${projectId}`, {
      method: 'DELETE',
    });
    expect(ownerDeleteResp.status).toBe(200);

    const activityResp = await fetch(`${baseUrl}/api/workspaces/${targetBody.workspace.id}/activity`);
    expect(activityResp.status).toBe(200);
    const activityBody = (await activityResp.json()) as {
      activities: Array<{ action: string; targetId?: string; metadata?: Record<string, unknown> }>;
    };
    const deleteActivity = activityBody.activities.find((activity) => activity.action === 'project.deleted');
    expect(deleteActivity).toMatchObject({
      targetId: projectId,
      metadata: { projectName: 'Member move fixture' },
    });
  });

  it('scopes saved templates to the source project workspace', async () => {
    const workspaceResp = await fetch(`${baseUrl}/api/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Template workspace ${Date.now()}` }),
    });
    expect(workspaceResp.status).toBe(200);
    const workspaceBody = (await workspaceResp.json()) as { workspace: { id: string } };
    const projectId = `proj-template-private-${Date.now()}`;
    const createResp = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: projectId,
        workspaceId: workspaceBody.workspace.id,
        name: 'Private template source',
        skillId: null,
        designSystemId: null,
      }),
    });
    expect(createResp.status).toBe(200);
    const fileResp = await fetch(`${baseUrl}/api/projects/${projectId}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'index.html',
        content: '<!doctype html><h1>Private template</h1>',
      }),
    });
    expect(fileResp.status).toBe(200);
    const templateResp = await fetch(`${baseUrl}/api/templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Private template',
        sourceProjectId: projectId,
      }),
    });
    expect(templateResp.status).toBe(200);
    const templateBody = (await templateResp.json()) as { template: { id: string } };
    const templateId = templateBody.template.id;

    const ownerTemplatesResp = await fetch(`${baseUrl}/api/templates`);
    expect(ownerTemplatesResp.status).toBe(200);
    const ownerTemplatesBody = (await ownerTemplatesResp.json()) as {
      templates: Array<{ id: string }>;
    };
    expect(ownerTemplatesBody.templates.some((template) => template.id === templateId)).toBe(true);

    const teamTemplatesResp = await fetch(
      `${baseUrl}/api/templates?workspaceId=${encodeURIComponent(workspaceBody.workspace.id)}`,
    );
    expect(teamTemplatesResp.status).toBe(200);
    const teamTemplatesBody = (await teamTemplatesResp.json()) as {
      templates: Array<{ id: string }>;
    };
    expect(teamTemplatesBody.templates.some((template) => template.id === templateId)).toBe(true);

    const personalTemplatesResp = await fetch(`${baseUrl}/api/templates?workspaceId=local-personal`);
    expect(personalTemplatesResp.status).toBe(200);
    const personalTemplatesBody = (await personalTemplatesResp.json()) as {
      templates: Array<{ id: string }>;
    };
    expect(personalTemplatesBody.templates.some((template) => template.id === templateId)).toBe(false);

    const crossWorkspaceCreateResp = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: `${projectId}-personal-clone`,
        workspaceId: 'local-personal',
        name: 'Cross workspace clone',
        skillId: null,
        designSystemId: null,
        metadata: { kind: 'template', templateId },
      }),
    });
    expect(crossWorkspaceCreateResp.status).toBe(403);
    const crossWorkspaceCreateBody = (await crossWorkspaceCreateResp.json()) as {
      error?: { code?: string; message?: string };
    };
    expect(crossWorkspaceCreateBody.error?.code).toBe('FORBIDDEN');
    expect(crossWorkspaceCreateBody.error?.message).toMatch(/another workspace/i);

    const dataDir = process.env.OD_DATA_DIR;
    if (!dataDir) throw new Error('OD_DATA_DIR is required for daemon route tests');
    const ownerResp = await fetch(`${baseUrl}/api/workspaces`);
    const ownerBody = (await ownerResp.json()) as { currentUserId: string };
    const outsiderUserId = `template-outsider-${Date.now()}`;
    const outsiderDb = new Database(path.join(dataDir, 'app.sqlite'));
    try {
      outsiderDb.prepare(
        `INSERT OR REPLACE INTO local_identity (key, value) VALUES ('localUserId', ?)`,
      ).run(outsiderUserId);
    } finally {
      outsiderDb.close();
    }

    const outsiderTemplatesResp = await fetch(`${baseUrl}/api/templates`);
    expect(outsiderTemplatesResp.status).toBe(200);
    const outsiderTemplatesBody = (await outsiderTemplatesResp.json()) as {
      templates: Array<{ id: string }>;
    };
    expect(outsiderTemplatesBody.templates.some((template) => template.id === templateId)).toBe(false);

    const outsiderTemplateResp = await fetch(`${baseUrl}/api/templates/${templateId}`);
    expect(outsiderTemplateResp.status).toBe(403);

    const outsiderCreateResp = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: `${projectId}-clone`,
        name: 'Unauthorized clone',
        skillId: null,
        designSystemId: null,
        metadata: { kind: 'template', templateId },
      }),
    });
    expect(outsiderCreateResp.status).toBe(403);

    const outsiderDeleteResp = await fetch(`${baseUrl}/api/templates/${templateId}`, {
      method: 'DELETE',
    });
    expect(outsiderDeleteResp.status).toBe(403);

    const memberUserId = `template-member-${Date.now()}`;
    const memberDb = new Database(path.join(dataDir, 'app.sqlite'));
    try {
      memberDb.prepare(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role, joined_at)
         VALUES (?, ?, 'member', ?)`,
      ).run(workspaceBody.workspace.id, memberUserId, Date.now());
      memberDb.prepare(
        `INSERT OR REPLACE INTO local_identity (key, value) VALUES ('localUserId', ?)`,
      ).run(memberUserId);
    } finally {
      memberDb.close();
    }

    const memberSaveResp = await fetch(`${baseUrl}/api/templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Member overwrite attempt',
        sourceProjectId: projectId,
      }),
    });
    expect(memberSaveResp.status).toBe(403);
    const memberSaveBody = (await memberSaveResp.json()) as { error?: { code?: string; message?: string } };
    expect(memberSaveBody.error?.code).toBe('FORBIDDEN');
    expect(memberSaveBody.error?.message).toMatch(/admin role/i);

    const memberDeleteResp = await fetch(`${baseUrl}/api/templates/${templateId}`, {
      method: 'DELETE',
    });
    expect(memberDeleteResp.status).toBe(403);
    const memberDeleteBody = (await memberDeleteResp.json()) as { error?: { code?: string; message?: string } };
    expect(memberDeleteBody.error?.code).toBe('FORBIDDEN');
    expect(memberDeleteBody.error?.message).toMatch(/admin role/i);

    const restoreDb = new Database(path.join(dataDir, 'app.sqlite'));
    try {
      restoreDb.prepare(
        `INSERT OR REPLACE INTO local_identity (key, value) VALUES ('localUserId', ?)`,
      ).run(ownerBody.currentUserId);
    } finally {
      restoreDb.close();
    }

    const ownerTemplateResp = await fetch(`${baseUrl}/api/templates/${templateId}`);
    expect(ownerTemplateResp.status).toBe(200);

    const legacyTemplateId = `legacy-template-${Date.now()}`;
    const legacyDb = new Database(path.join(dataDir, 'app.sqlite'));
    try {
      legacyDb.prepare(
        `INSERT INTO templates (id, name, description, source_project_id, files_json, created_at)
         VALUES (?, ?, ?, NULL, ?, ?)`,
      ).run(
        legacyTemplateId,
        'Legacy global template',
        'Read-only legacy starter',
        JSON.stringify([{ name: 'index.html', content: '<!doctype html>' }]),
        Date.now(),
      );
    } finally {
      legacyDb.close();
    }
    const legacyDeleteResp = await fetch(`${baseUrl}/api/templates/${legacyTemplateId}`, {
      method: 'DELETE',
    });
    expect(legacyDeleteResp.status).toBe(403);
    const legacyDeleteBody = (await legacyDeleteResp.json()) as { error?: { code?: string; message?: string } };
    expect(legacyDeleteBody.error?.code).toBe('READ_ONLY_TEMPLATE');
    expect(legacyDeleteBody.error?.message).toMatch(/read-only/i);
  });

  it('blocks deleting projects that still have reuse routines and removes sourced templates on delete', async () => {
    const workspaceResp = await fetch(`${baseUrl}/api/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Project cleanup workspace ${Date.now()}` }),
    });
    expect(workspaceResp.status).toBe(200);
    const workspaceBody = (await workspaceResp.json()) as { workspace: { id: string } };

    const projectId = `project-cleanup-${Date.now()}`;
    const projectResp = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: projectId,
        workspaceId: workspaceBody.workspace.id,
        name: 'Project cleanup fixture',
        skillId: null,
        designSystemId: null,
      }),
    });
    expect(projectResp.status).toBe(200);
    const dataDir = process.env.OD_DATA_DIR;
    if (!dataDir) throw new Error('OD_DATA_DIR is required for daemon route tests');
    const shareId = `share-cleanup-${Date.now()}`;
    const shareDb = new Database(path.join(dataDir, 'app.sqlite'));
    try {
      shareDb.prepare(
        `INSERT INTO resource_shares
           (id, token, target_type, project_id, artifact_id, role, created_by_user_id, created_at)
         VALUES (?, ?, 'live_artifact', ?, ?, 'viewer', ?, ?)`,
      ).run(
        shareId,
        `token-cleanup-${Date.now()}`,
        projectId,
        'artifact-cleanup',
        'owner-1',
        Date.now(),
      );
    } finally {
      shareDb.close();
    }

    const templateResp = await fetch(`${baseUrl}/api/templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Cleanup template',
        description: null,
        sourceProjectId: projectId,
      }),
    });
    expect(templateResp.status).toBe(200);
    const templateBody = (await templateResp.json()) as { template: { id: string } };

    const routineResp = await fetch(`${baseUrl}/api/routines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Cleanup routine',
        prompt: 'Keep this project warm.',
        schedule: {
          kind: 'weekly',
          weekday: 1,
          time: '09:00',
          timezone: 'UTC',
        },
        target: { mode: 'reuse', projectId },
        enabled: true,
      }),
    });
    expect(routineResp.status).toBe(201);
    const routineBody = (await routineResp.json()) as { routine: { id: string } };

    const blockedDeleteResp = await fetch(`${baseUrl}/api/projects/${projectId}`, {
      method: 'DELETE',
    });
    expect(blockedDeleteResp.status).toBe(409);
    const blockedDeleteBody = (await blockedDeleteResp.json()) as { error?: { code?: string; message?: string } };
    expect(blockedDeleteBody.error?.code).toBe('PROJECT_HAS_ROUTINES');

    const deleteRoutineResp = await fetch(`${baseUrl}/api/routines/${routineBody.routine.id}`, {
      method: 'DELETE',
    });
    expect(deleteRoutineResp.status).toBe(204);

    const deleteProjectResp = await fetch(`${baseUrl}/api/projects/${projectId}`, {
      method: 'DELETE',
    });
    expect(deleteProjectResp.status).toBe(200);

    const templateAfterDeleteResp = await fetch(`${baseUrl}/api/templates/${templateBody.template.id}`);
    expect(templateAfterDeleteResp.status).toBe(404);

    const activityResp = await fetch(`${baseUrl}/api/workspaces/${workspaceBody.workspace.id}/activity`);
    expect(activityResp.status).toBe(200);
    const activityBody = (await activityResp.json()) as {
      activities: Array<{ action: string; targetId?: string; metadata?: Record<string, unknown> }>;
    };
    const deleteActivity = activityBody.activities.find((activity) => activity.action === 'project.deleted');
    expect(deleteActivity).toMatchObject({
      targetId: projectId,
      metadata: { projectName: 'Project cleanup fixture', deletedTemplateCount: 1, revokedShareCount: 1 },
    });
    const revokeActivity = activityBody.activities.find((activity) => activity.action === 'share.revoked');
    expect(revokeActivity).toMatchObject({
      targetId: shareId,
      metadata: {
        reason: 'project_deleted',
        artifactId: 'artifact-cleanup',
        projectId,
        projectName: 'Project cleanup fixture',
      },
    });
  });

  it('transfers workspace ownership to an existing member', async () => {
    const workspaceResp = await fetch(`${baseUrl}/api/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Owner transfer ${Date.now()}` }),
    });
    expect(workspaceResp.status).toBe(200);
    const workspaceBody = (await workspaceResp.json()) as { workspace: { id: string } };
    const ownerResp = await fetch(`${baseUrl}/api/workspaces`);
    const ownerBody = (await ownerResp.json()) as { currentUserId: string };
    const inviteResp = await fetch(`${baseUrl}/api/workspaces/${workspaceBody.workspace.id}/invites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'member' }),
    });
    expect(inviteResp.status).toBe(200);
    const inviteBody = (await inviteResp.json()) as { invite: { token: string } };

    const dataDir = process.env.OD_DATA_DIR;
    if (!dataDir) throw new Error('OD_DATA_DIR is required for daemon route tests');
    const targetUserId = `owner-target-${Date.now()}`;
    const targetDb = new Database(path.join(dataDir, 'app.sqlite'));
    try {
      targetDb.prepare(
        `INSERT OR REPLACE INTO local_identity (key, value) VALUES ('localUserId', ?)`,
      ).run(targetUserId);
    } finally {
      targetDb.close();
    }
    const acceptResp = await fetch(`${baseUrl}/api/workspace-invites/${inviteBody.invite.token}/accept`, {
      method: 'POST',
    });
    expect(acceptResp.status).toBe(200);

    const restoreDb = new Database(path.join(dataDir, 'app.sqlite'));
    try {
      restoreDb.prepare(
        `INSERT OR REPLACE INTO local_identity (key, value) VALUES ('localUserId', ?)`,
      ).run(ownerBody.currentUserId);
    } finally {
      restoreDb.close();
    }

    const transferResp = await fetch(`${baseUrl}/api/workspaces/${workspaceBody.workspace.id}/owner`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: targetUserId }),
    });
    expect(transferResp.status).toBe(200);
    const transferBody = (await transferResp.json()) as {
      previousOwner: { userId: string; role: string };
      owner: { userId: string; role: string };
    };
    expect(transferBody.previousOwner.userId).toBe(ownerBody.currentUserId);
    expect(transferBody.previousOwner.role).toBe('admin');
    expect(transferBody.owner.userId).toBe(targetUserId);
    expect(transferBody.owner.role).toBe('owner');
  });

  it('does not transfer personal workspace ownership', async () => {
    const ownerResp = await fetch(`${baseUrl}/api/workspaces`);
    expect(ownerResp.status).toBe(200);
    const ownerBody = (await ownerResp.json()) as { currentUserId: string };

    const dataDir = process.env.OD_DATA_DIR;
    if (!dataDir) throw new Error('OD_DATA_DIR is required for daemon route tests');
    const targetUserId = `personal-owner-target-${Date.now()}`;
    const db = new Database(path.join(dataDir, 'app.sqlite'));
    try {
      db.prepare(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role, joined_at)
         VALUES ('local-personal', ?, 'member', ?)`,
      ).run(targetUserId, Date.now());
    } finally {
      db.close();
    }

    const transferResp = await fetch(`${baseUrl}/api/workspaces/local-personal/owner`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: targetUserId }),
    });
    expect(transferResp.status).toBe(400);
    const transferBody = (await transferResp.json()) as { error?: { code?: string; message?: string } };
    expect(transferBody.error?.code).toBe('BAD_REQUEST');
    expect(transferBody.error?.message).toMatch(/personal workspace ownership/i);

    const membersResp = await fetch(`${baseUrl}/api/workspaces/local-personal/members`);
    expect(membersResp.status).toBe(200);
    const membersBody = (await membersResp.json()) as { members: Array<{ userId: string; role: string }> };
    expect(membersBody.members.find((member) => member.userId === ownerBody.currentUserId)?.role).toBe('owner');
    expect(membersBody.members.find((member) => member.userId === targetUserId)?.role).toBe('member');
  });

  it('requires owner transfer before removing the workspace owner', async () => {
    const workspaceResp = await fetch(`${baseUrl}/api/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Owner removal ${Date.now()}` }),
    });
    expect(workspaceResp.status).toBe(200);
    const workspaceBody = (await workspaceResp.json()) as { workspace: { id: string } };
    const ownerResp = await fetch(`${baseUrl}/api/workspaces`);
    const ownerBody = (await ownerResp.json()) as { currentUserId: string };

    const dataDir = process.env.OD_DATA_DIR;
    if (!dataDir) throw new Error('OD_DATA_DIR is required for daemon route tests');
    const adminUserId = `owner-removal-admin-${Date.now()}`;
    const db = new Database(path.join(dataDir, 'app.sqlite'));
    try {
      db.prepare(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role, joined_at)
         VALUES (?, ?, 'admin', ?)`,
      ).run(workspaceBody.workspace.id, adminUserId, Date.now());
      db.prepare(
        `INSERT OR REPLACE INTO local_identity (key, value) VALUES ('localUserId', ?)`,
      ).run(adminUserId);
    } finally {
      db.close();
    }

    const removeResp = await fetch(
      `${baseUrl}/api/workspaces/${workspaceBody.workspace.id}/members/${ownerBody.currentUserId}`,
      { method: 'DELETE' },
    );
    expect(removeResp.status).toBe(400);
    const removeBody = (await removeResp.json()) as { error?: { code?: string; message?: string } };
    expect(removeBody.error?.code).toBe('OWNER_TRANSFER_REQUIRED');
    expect(removeBody.error?.message).toMatch(/transfer ownership/i);

    const membersResp = await fetch(`${baseUrl}/api/workspaces/${workspaceBody.workspace.id}/members`);
    expect(membersResp.status).toBe(200);
    const membersBody = (await membersResp.json()) as { members: Array<{ userId: string; role: string }> };
    expect(membersBody.members.some((member) => (
      member.userId === ownerBody.currentUserId && member.role === 'owner'
    ))).toBe(true);
  });

  it('transfers a leaving member owned projects and routines to the workspace owner', async () => {
    const workspaceResp = await fetch(`${baseUrl}/api/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Member leave transfer ${Date.now()}` }),
    });
    expect(workspaceResp.status).toBe(200);
    const workspaceBody = (await workspaceResp.json()) as { workspace: { id: string } };
    const ownerResp = await fetch(`${baseUrl}/api/workspaces`);
    const ownerBody = (await ownerResp.json()) as { currentUserId: string };

    const dataDir = process.env.OD_DATA_DIR;
    if (!dataDir) throw new Error('OD_DATA_DIR is required for daemon route tests');
    const memberUserId = `leave-transfer-member-${Date.now()}`;
    const projectId = `leave-transfer-project-${Date.now()}`;
    const routineId = `leave-transfer-routine-${Date.now()}`;
    const now = Date.now();
    const db = new Database(path.join(dataDir, 'app.sqlite'));
    try {
      db.prepare(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role, joined_at)
         VALUES (?, ?, 'member', ?)`,
      ).run(workspaceBody.workspace.id, memberUserId, now);
      db.prepare(
        `INSERT INTO projects (
           id, workspace_id, created_by_user_id, owned_by_user_id, name,
           skill_id, design_system_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
      ).run(
        projectId,
        workspaceBody.workspace.id,
        memberUserId,
        memberUserId,
        'Leaving member project',
        now,
        now,
      );
      db.prepare(
        `INSERT INTO routines (
           id, workspace_id, created_by_user_id, owned_by_user_id, name, prompt,
           schedule_kind, schedule_value, schedule_json, project_mode, project_id,
           skill_id, agent_id, enabled, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'daily', '09:00', ?, 'create_each_run', NULL, NULL, NULL, 1, ?, ?)`,
      ).run(
        routineId,
        workspaceBody.workspace.id,
        memberUserId,
        memberUserId,
        'Leaving member routine',
        'Summarize workspace activity.',
        JSON.stringify({ kind: 'daily', time: '09:00', timezone: 'UTC' }),
        now,
        now,
      );
      db.prepare(
        `INSERT OR REPLACE INTO local_identity (key, value) VALUES ('localUserId', ?)`,
      ).run(memberUserId);
      db.prepare(
        `INSERT OR REPLACE INTO local_identity (key, value) VALUES (?, ?)`,
      ).run(`currentWorkspaceId:${memberUserId}`, workspaceBody.workspace.id);
    } finally {
      db.close();
    }

    const leaveResp = await fetch(`${baseUrl}/api/workspaces/${workspaceBody.workspace.id}/membership`, {
      method: 'DELETE',
    });
    expect(leaveResp.status).toBe(200);

    const afterLeaveDb = new Database(path.join(dataDir, 'app.sqlite'));
    try {
      const memberRow = afterLeaveDb
        .prepare(`SELECT user_id AS userId FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?`)
        .get(workspaceBody.workspace.id, memberUserId) as { userId?: string } | undefined;
      expect(memberRow).toBeUndefined();
      const currentRow = afterLeaveDb
        .prepare(`SELECT value FROM local_identity WHERE key = ?`)
        .get(`currentWorkspaceId:${memberUserId}`) as { value?: string } | undefined;
      expect(currentRow).toBeUndefined();
      const projectRow = afterLeaveDb
        .prepare(`SELECT created_by_user_id AS createdByUserId, owned_by_user_id AS ownedByUserId FROM projects WHERE id = ?`)
        .get(projectId) as { createdByUserId?: string; ownedByUserId?: string } | undefined;
      expect(projectRow).toMatchObject({
        createdByUserId: memberUserId,
        ownedByUserId: ownerBody.currentUserId,
      });
      const routineRow = afterLeaveDb
        .prepare(`SELECT created_by_user_id AS createdByUserId, owned_by_user_id AS ownedByUserId FROM routines WHERE id = ?`)
        .get(routineId) as { createdByUserId?: string; ownedByUserId?: string } | undefined;
      expect(routineRow).toMatchObject({
        createdByUserId: memberUserId,
        ownedByUserId: ownerBody.currentUserId,
      });
    } finally {
      afterLeaveDb.close();
    }

    const restoreDb = new Database(path.join(dataDir, 'app.sqlite'));
    try {
      restoreDb.prepare(
        `INSERT OR REPLACE INTO local_identity (key, value) VALUES ('localUserId', ?)`,
      ).run(ownerBody.currentUserId);
    } finally {
      restoreDb.close();
    }

    const activityResp = await fetch(`${baseUrl}/api/workspaces/${workspaceBody.workspace.id}/activity`);
    expect(activityResp.status).toBe(200);
    const activityBody = (await activityResp.json()) as {
      activities: Array<{ action: string; targetId?: string; metadata?: Record<string, unknown> }>;
    };
    expect(activityBody.activities).toContainEqual(expect.objectContaining({
      action: 'member.left',
      targetId: memberUserId,
      metadata: expect.objectContaining({
        role: 'member',
        createdRoutineCount: 1,
        createdProjectCount: 1,
        ownedRoutineCount: 1,
        ownedProjectCount: 1,
        transferredRoutineCount: 1,
        transferredProjectCount: 1,
        transferToUserId: ownerBody.currentUserId,
      }),
    }));
  });

  it('requires another manager to change the current admin role', async () => {
    const workspaceResp = await fetch(`${baseUrl}/api/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Self role ${Date.now()}` }),
    });
    expect(workspaceResp.status).toBe(200);
    const workspaceBody = (await workspaceResp.json()) as { workspace: { id: string } };

    const dataDir = process.env.OD_DATA_DIR;
    if (!dataDir) throw new Error('OD_DATA_DIR is required for daemon route tests');
    const ownerResp = await fetch(`${baseUrl}/api/workspaces`);
    const ownerBody = (await ownerResp.json()) as { currentUserId: string };
    const adminUserId = `self-role-admin-${Date.now()}`;
    const db = new Database(path.join(dataDir, 'app.sqlite'));
    try {
      db.prepare(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role, joined_at)
         VALUES (?, ?, 'admin', ?)`,
      ).run(workspaceBody.workspace.id, adminUserId, Date.now());
      db.prepare(
        `INSERT OR REPLACE INTO local_identity (key, value) VALUES ('localUserId', ?)`,
      ).run(adminUserId);
    } finally {
      db.close();
    }

    const selfRoleResp = await fetch(`${baseUrl}/api/workspaces/${workspaceBody.workspace.id}/members/${adminUserId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'member' }),
    });
    expect(selfRoleResp.status).toBe(400);
    const selfRoleBody = (await selfRoleResp.json()) as { error?: { code?: string; message?: string } };
    expect(selfRoleBody.error?.message).toMatch(/another admin or owner/i);

    const restoreDb = new Database(path.join(dataDir, 'app.sqlite'));
    try {
      restoreDb.prepare(
        `INSERT OR REPLACE INTO local_identity (key, value) VALUES ('localUserId', ?)`,
      ).run(ownerBody.currentUserId);
    } finally {
      restoreDb.close();
    }

    const membersResp = await fetch(`${baseUrl}/api/workspaces/${workspaceBody.workspace.id}/members`);
    expect(membersResp.status).toBe(200);
    const membersBody = (await membersResp.json()) as { members: Array<{ userId: string; role: string }> };
    expect(membersBody.members.some((member) => member.userId === adminUserId && member.role === 'admin')).toBe(true);
  });

  it('creates usable workspace invite links and accepts them', async () => {
    const workspaceResp = await fetch(`${baseUrl}/api/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Invite workspace ${Date.now()}` }),
    });
    expect(workspaceResp.status).toBe(200);
    const workspaceBody = (await workspaceResp.json()) as {
      workspace: { id: string; name: string };
    };

    const inviteResp = await fetch(`${baseUrl}/api/workspaces/${workspaceBody.workspace.id}/invites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'member' }),
    });
    expect(inviteResp.status).toBe(200);
    const inviteBody = (await inviteResp.json()) as {
      invite: { id: string; token: string; inviteUrl?: string; workspaceId: string; role: string; status: string; expiresAt?: number };
    };
    expect(inviteBody.invite.workspaceId).toBe(workspaceBody.workspace.id);
    expect(inviteBody.invite.role).toBe('member');
    expect(inviteBody.invite.status).toBe('pending');
    expect(typeof inviteBody.invite.expiresAt).toBe('number');
    expect(inviteBody.invite.inviteUrl).toBe(`${baseUrl}/workspace-invites/${inviteBody.invite.token}`);
    expect(inviteBody.invite.inviteUrl).not.toContain('workspaceInvite=');

    const adminInviteResp = await fetch(`${baseUrl}/api/workspaces/${workspaceBody.workspace.id}/invites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin', expiresInDays: 14 }),
    });
    expect(adminInviteResp.status).toBe(200);
    const adminInviteBody = (await adminInviteResp.json()) as {
      invite: { role: string; expiresAt?: number };
    };
    expect(adminInviteBody.invite.role).toBe('admin');
    expect(adminInviteBody.invite.expiresAt).toBeGreaterThan(Date.now() + 13 * 24 * 60 * 60 * 1000);
    expect(adminInviteBody.invite.expiresAt).toBeLessThanOrEqual(Date.now() + 14 * 24 * 60 * 60 * 1000);

    const ownerAcceptResp = await fetch(`${baseUrl}/api/workspace-invites/${inviteBody.invite.token}/accept`, {
      method: 'POST',
    });
    expect(ownerAcceptResp.status).toBe(200);
    const ownerAcceptBody = (await ownerAcceptResp.json()) as {
      acceptedInvite?: boolean;
      membership: { role: string };
    };
    expect(ownerAcceptBody.acceptedInvite).toBe(false);
    expect(ownerAcceptBody.membership.role).toBe('owner');
    const ownerAfterAcceptResp = await fetch(`${baseUrl}/api/workspaces`);
    const ownerAfterAcceptBody = (await ownerAfterAcceptResp.json()) as { currentWorkspaceId: string };
    expect(ownerAfterAcceptBody.currentWorkspaceId).toBe(workspaceBody.workspace.id);

    const pendingInvitesResp = await fetch(`${baseUrl}/api/workspaces/${workspaceBody.workspace.id}/invites`);
    const pendingInvitesBody = (await pendingInvitesResp.json()) as {
      invites: Array<{ id: string; status: string }>;
    };
    expect(pendingInvitesBody.invites.find((invite) => invite.id === inviteBody.invite.id)?.status).toBe('pending');

    const dataDir = process.env.OD_DATA_DIR;
    if (!dataDir) throw new Error('OD_DATA_DIR is required for daemon route tests');
    const db = new Database(path.join(dataDir, 'app.sqlite'));
    const ownerResp = await fetch(`${baseUrl}/api/workspaces`);
    const ownerBody = (await ownerResp.json()) as { currentUserId: string };
    const inviteeUserId = `invitee-${Date.now()}`;
    try {
      db.prepare(
        `INSERT OR REPLACE INTO local_identity (key, value) VALUES ('localUserId', ?)`,
      ).run(inviteeUserId);
    } finally {
      db.close();
    }

    const beforeAcceptResp = await fetch(`${baseUrl}/api/workspaces`);
    expect(beforeAcceptResp.status).toBe(200);
    const beforeAcceptBody = (await beforeAcceptResp.json()) as {
      workspaces: Array<{ id: string }>;
    };
    expect(beforeAcceptBody.workspaces.some((workspace) => workspace.id === workspaceBody.workspace.id)).toBe(false);

    const membersForbiddenResp = await fetch(`${baseUrl}/api/workspaces/${workspaceBody.workspace.id}/members`);
    expect(membersForbiddenResp.status).toBe(403);

    const acceptResp = await fetch(`${baseUrl}/api/workspace-invites/${inviteBody.invite.token}/accept`, {
      method: 'POST',
    });
    expect(acceptResp.status).toBe(200);
    const acceptBody = (await acceptResp.json()) as {
      workspace: { id: string };
      membership: { workspaceId: string; userId: string; role: string };
      acceptedInvite?: boolean;
    };
    expect(acceptBody.workspace.id).toBe(workspaceBody.workspace.id);
    expect(acceptBody.membership.workspaceId).toBe(workspaceBody.workspace.id);
    expect(acceptBody.membership.userId).toBe(inviteeUserId);
    expect(acceptBody.membership.role).toBe('member');
    expect(acceptBody.acceptedInvite).toBe(true);

    const afterAcceptResp = await fetch(`${baseUrl}/api/workspaces`);
    expect(afterAcceptResp.status).toBe(200);
    const afterAcceptBody = (await afterAcceptResp.json()) as {
      workspaces: Array<{ id: string }>;
      currentWorkspaceId: string;
    };
    expect(afterAcceptBody.workspaces.some((workspace) => workspace.id === workspaceBody.workspace.id)).toBe(true);
    expect(afterAcceptBody.currentWorkspaceId).toBe(workspaceBody.workspace.id);

    const reuseDb = new Database(path.join(dataDir, 'app.sqlite'));
    try {
      reuseDb.prepare(
        `INSERT OR REPLACE INTO local_identity (key, value) VALUES ('localUserId', ?)`,
      ).run(`reuse-invitee-${Date.now()}`);
    } finally {
      reuseDb.close();
    }
    const reuseAcceptResp = await fetch(`${baseUrl}/api/workspace-invites/${inviteBody.invite.token}/accept`, {
      method: 'POST',
    });
    expect(reuseAcceptResp.status).toBe(409);
    const reuseAcceptBody = (await reuseAcceptResp.json()) as { error?: { code?: string; message?: string } };
    expect(reuseAcceptBody.error?.code).toBe('INVITE_ALREADY_ACCEPTED');

    const ownerReuseDb = new Database(path.join(dataDir, 'app.sqlite'));
    try {
      ownerReuseDb.prepare(
        `INSERT OR REPLACE INTO local_identity (key, value) VALUES ('localUserId', ?)`,
      ).run(ownerBody.currentUserId);
    } finally {
      ownerReuseDb.close();
    }
    const ownerReuseAcceptResp = await fetch(`${baseUrl}/api/workspace-invites/${inviteBody.invite.token}/accept`, {
      method: 'POST',
    });
    expect(ownerReuseAcceptResp.status).toBe(409);
    const ownerReuseAcceptBody = (await ownerReuseAcceptResp.json()) as { error?: { code?: string; message?: string } };
    expect(ownerReuseAcceptBody.error?.code).toBe('INVITE_ALREADY_ACCEPTED');

    const inviteeAgainDb = new Database(path.join(dataDir, 'app.sqlite'));
    try {
      inviteeAgainDb.prepare(
        `INSERT OR REPLACE INTO local_identity (key, value) VALUES ('localUserId', ?)`,
      ).run(inviteeUserId);
    } finally {
      inviteeAgainDb.close();
    }

    const memberInviteResp = await fetch(`${baseUrl}/api/workspaces/${workspaceBody.workspace.id}/invites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'member' }),
    });
    expect(memberInviteResp.status).toBe(403);

    const restoreDb = new Database(path.join(dataDir, 'app.sqlite'));
    try {
      restoreDb.prepare(
        `INSERT OR REPLACE INTO local_identity (key, value) VALUES ('localUserId', ?)`,
      ).run(ownerBody.currentUserId);
    } finally {
      restoreDb.close();
    }

    const acceptedExpiresDb = new Database(path.join(dataDir, 'app.sqlite'));
    try {
      acceptedExpiresDb.prepare(`UPDATE workspace_invites SET expires_at = ? WHERE id = ?`).run(Date.now() - 1000, inviteBody.invite.id);
    } finally {
      acceptedExpiresDb.close();
    }

    const invitesResp = await fetch(`${baseUrl}/api/workspaces/${workspaceBody.workspace.id}/invites`);
    expect(invitesResp.status).toBe(200);
    const invitesBody = (await invitesResp.json()) as {
      invites: Array<{ id: string; status: string; inviteUrl?: string }>;
    };
    expect(invitesBody.invites.find((invite) => invite.id === inviteBody.invite.id)?.status).toBe('accepted');

    const roleResp = await fetch(`${baseUrl}/api/workspaces/${workspaceBody.workspace.id}/members/${inviteeUserId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin' }),
    });
    expect(roleResp.status).toBe(200);
    const roleBody = (await roleResp.json()) as { member: { userId: string; role: string } };
    expect(roleBody.member.userId).toBe(inviteeUserId);
    expect(roleBody.member.role).toBe('admin');

    const adminSessionDb = new Database(path.join(dataDir, 'app.sqlite'));
    try {
      adminSessionDb.prepare(
        `INSERT OR REPLACE INTO local_identity (key, value) VALUES ('localUserId', ?)`,
      ).run(inviteeUserId);
    } finally {
      adminSessionDb.close();
    }
    const adminCreatedInviteResp = await fetch(`${baseUrl}/api/workspaces/${workspaceBody.workspace.id}/invites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'member' }),
    });
    expect(adminCreatedInviteResp.status).toBe(200);
    const adminCreatedInviteBody = (await adminCreatedInviteResp.json()) as {
      invite: { id: string; token: string; status: string };
    };
    expect(adminCreatedInviteBody.invite.status).toBe('pending');
    const adminRoutineResp = await fetch(`${baseUrl}/api/routines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: workspaceBody.workspace.id,
        name: 'Admin owned routine',
        prompt: 'Summarize this workspace.',
        schedule: { kind: 'daily', time: '09:00', timezone: 'UTC' },
        target: { mode: 'create_each_run' },
      }),
    });
    expect(adminRoutineResp.status).toBe(201);
    const adminRoutineBody = (await adminRoutineResp.json()) as {
      routine: { id: string; createdByUserId?: string; ownedByUserId?: string };
    };
    expect(adminRoutineBody.routine.createdByUserId).toBe(inviteeUserId);
    expect(adminRoutineBody.routine.ownedByUserId).toBe(inviteeUserId);
    const adminProjectResp = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: `admin-owned-project-${Date.now()}`,
        workspaceId: workspaceBody.workspace.id,
        name: 'Admin owned project',
        skillId: null,
        designSystemId: null,
      }),
    });
    expect(adminProjectResp.status).toBe(200);
    const adminProjectBody = (await adminProjectResp.json()) as {
      project: { createdByUserId?: string; ownedByUserId?: string };
    };
    expect(adminProjectBody.project.createdByUserId).toBe(inviteeUserId);
    expect(adminProjectBody.project.ownedByUserId).toBe(inviteeUserId);

    const ownerAssetResp = await fetch(`${baseUrl}/api/workspaces/${workspaceBody.workspace.id}/members`);
    expect(ownerAssetResp.status).toBe(200);
    const ownerAssetBody = (await ownerAssetResp.json()) as {
      members: Array<{ userId: string; ownedProjectCount?: number; ownedRoutineCount?: number }>;
    };
    expect(ownerAssetBody.members.find((member) => member.userId === inviteeUserId)).toMatchObject({
      ownedProjectCount: 1,
      ownedRoutineCount: 1,
    });

    const ownerForDemotionDb = new Database(path.join(dataDir, 'app.sqlite'));
    try {
      ownerForDemotionDb.prepare(
        `INSERT OR REPLACE INTO local_identity (key, value) VALUES ('localUserId', ?)`,
      ).run(ownerBody.currentUserId);
    } finally {
      ownerForDemotionDb.close();
    }
    const demoteResp = await fetch(`${baseUrl}/api/workspaces/${workspaceBody.workspace.id}/members/${inviteeUserId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'member' }),
    });
    expect(demoteResp.status).toBe(200);

    const afterDemoteInvitesResp = await fetch(`${baseUrl}/api/workspaces/${workspaceBody.workspace.id}/invites`);
    const afterDemoteInvitesBody = (await afterDemoteInvitesResp.json()) as {
      invites: Array<{ id: string; status: string; revokedAt?: number }>;
    };
    const adminCreatedInvite = afterDemoteInvitesBody.invites.find((invite) => invite.id === adminCreatedInviteBody.invite.id);
    expect(adminCreatedInvite?.status).toBe('revoked');
    expect(typeof adminCreatedInvite?.revokedAt).toBe('number');

    const revokedDemotionInviteeDb = new Database(path.join(dataDir, 'app.sqlite'));
    try {
      revokedDemotionInviteeDb.prepare(
        `INSERT OR REPLACE INTO local_identity (key, value) VALUES ('localUserId', ?)`,
      ).run(`demoted-admin-invitee-${Date.now()}`);
    } finally {
      revokedDemotionInviteeDb.close();
    }
    const demotedInviteAcceptResp = await fetch(`${baseUrl}/api/workspace-invites/${adminCreatedInviteBody.invite.token}/accept`, {
      method: 'POST',
    });
    expect(demotedInviteAcceptResp.status).toBe(410);
    const demotedInviteAcceptBody = (await demotedInviteAcceptResp.json()) as { error?: { code?: string } };
    expect(demotedInviteAcceptBody.error?.code).toBe('INVITE_REVOKED');

    const ownerBeforeRemoveDb = new Database(path.join(dataDir, 'app.sqlite'));
    const receiverUserId = `receiver-${Date.now()}`;
    try {
      ownerBeforeRemoveDb.prepare(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role, joined_at)
         VALUES (?, ?, 'member', ?)`,
      ).run(workspaceBody.workspace.id, receiverUserId, Date.now());
      ownerBeforeRemoveDb.prepare(
        `INSERT OR REPLACE INTO local_identity (key, value) VALUES ('localUserId', ?)`,
      ).run(ownerBody.currentUserId);
    } finally {
      ownerBeforeRemoveDb.close();
    }
    const removeResp = await fetch(`${baseUrl}/api/workspaces/${workspaceBody.workspace.id}/members/${inviteeUserId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transferToUserId: receiverUserId }),
    });
    expect(removeResp.status).toBe(200);
    const afterRemoveDb = new Database(path.join(dataDir, 'app.sqlite'));
    try {
      const currentRow = afterRemoveDb
        .prepare(`SELECT value FROM local_identity WHERE key = ?`)
        .get(`currentWorkspaceId:${inviteeUserId}`) as { value?: string } | undefined;
      expect(currentRow?.value).toBeUndefined();
      const projectOwnerRow = afterRemoveDb
        .prepare(`SELECT created_by_user_id AS createdByUserId, owned_by_user_id AS ownedByUserId FROM projects WHERE name = ?`)
        .get('Admin owned project') as { createdByUserId?: string; ownedByUserId?: string } | undefined;
      expect(projectOwnerRow).toMatchObject({
        createdByUserId: inviteeUserId,
        ownedByUserId: receiverUserId,
      });
      const routineOwnerRow = afterRemoveDb
        .prepare(`SELECT created_by_user_id AS createdByUserId, owned_by_user_id AS ownedByUserId FROM routines WHERE name = ?`)
        .get('Admin owned routine') as { createdByUserId?: string; ownedByUserId?: string } | undefined;
      expect(routineOwnerRow).toMatchObject({
        createdByUserId: inviteeUserId,
        ownedByUserId: receiverUserId,
      });
    } finally {
      afterRemoveDb.close();
    }
    const membersResp = await fetch(`${baseUrl}/api/workspaces/${workspaceBody.workspace.id}/members`);
    const membersBody = (await membersResp.json()) as { members: Array<{ userId: string }> };
    expect(membersBody.members.some((member) => member.userId === inviteeUserId)).toBe(false);

    const revokeAcceptedInviteResp = await fetch(
      `${baseUrl}/api/workspaces/${workspaceBody.workspace.id}/invites/${inviteBody.invite.id}`,
      { method: 'DELETE' },
    );
    expect(revokeAcceptedInviteResp.status).toBe(409);
    const revokeAcceptedInviteBody = (await revokeAcceptedInviteResp.json()) as { error?: { code?: string; message?: string } };
    expect(revokeAcceptedInviteBody.error?.code).toBe('INVITE_NOT_PENDING');

    const acceptedInvitesResp = await fetch(`${baseUrl}/api/workspaces/${workspaceBody.workspace.id}/invites`);
    const acceptedInvitesBody = (await acceptedInvitesResp.json()) as {
      invites: Array<{ id: string; status: string; revokedAt?: number }>;
    };
    const acceptedInvite = acceptedInvitesBody.invites.find((invite) => invite.id === inviteBody.invite.id);
    expect(acceptedInvite?.status).toBe('accepted');
    expect(acceptedInvite?.revokedAt).toBeUndefined();

    const pendingRevokeInviteResp = await fetch(`${baseUrl}/api/workspaces/${workspaceBody.workspace.id}/invites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'member' }),
    });
    expect(pendingRevokeInviteResp.status).toBe(200);
    const pendingRevokeInviteBody = (await pendingRevokeInviteResp.json()) as {
      invite: { id: string; token: string };
    };

    const revokeInviteResp = await fetch(
      `${baseUrl}/api/workspaces/${workspaceBody.workspace.id}/invites/${pendingRevokeInviteBody.invite.id}`,
      { method: 'DELETE' },
    );
    expect(revokeInviteResp.status).toBe(200);

    const revokedInvitesResp = await fetch(`${baseUrl}/api/workspaces/${workspaceBody.workspace.id}/invites`);
    const revokedInvitesBody = (await revokedInvitesResp.json()) as {
      invites: Array<{ id: string; status: string; revokedAt?: number }>;
    };
    const revokedInvite = revokedInvitesBody.invites.find((invite) => invite.id === pendingRevokeInviteBody.invite.id);
    expect(revokedInvite?.status).toBe('revoked');
    expect(typeof revokedInvite?.revokedAt).toBe('number');

    const revokedInviteeDb = new Database(path.join(dataDir, 'app.sqlite'));
    try {
      revokedInviteeDb.prepare(
        `INSERT OR REPLACE INTO local_identity (key, value) VALUES ('localUserId', ?)`,
      ).run(`revoked-invitee-${Date.now()}`);
    } finally {
      revokedInviteeDb.close();
    }
    const revokedAcceptResp = await fetch(`${baseUrl}/api/workspace-invites/${pendingRevokeInviteBody.invite.token}/accept`, {
      method: 'POST',
    });
    expect(revokedAcceptResp.status).toBe(410);
    const revokedAcceptBody = (await revokedAcceptResp.json()) as { error?: { code?: string; message?: string } };
    expect(revokedAcceptBody.error?.code).toBe('INVITE_REVOKED');

    const ownerAgainDb = new Database(path.join(dataDir, 'app.sqlite'));
    try {
      ownerAgainDb.prepare(
        `INSERT OR REPLACE INTO local_identity (key, value) VALUES ('localUserId', ?)`,
      ).run(ownerBody.currentUserId);
    } finally {
      ownerAgainDb.close();
    }

    const expiringInviteResp = await fetch(`${baseUrl}/api/workspaces/${workspaceBody.workspace.id}/invites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'member' }),
    });
    const expiringInviteBody = (await expiringInviteResp.json()) as {
      invite: { id: string; token: string };
    };
    const expireDb = new Database(path.join(dataDir, 'app.sqlite'));
    try {
      expireDb.prepare(`UPDATE workspace_invites SET expires_at = ? WHERE id = ?`).run(Date.now() - 1000, expiringInviteBody.invite.id);
      expireDb.prepare(
        `INSERT OR REPLACE INTO local_identity (key, value) VALUES ('localUserId', ?)`,
      ).run(`expired-invitee-${Date.now()}`);
    } finally {
      expireDb.close();
    }
    const expiredAcceptResp = await fetch(`${baseUrl}/api/workspace-invites/${expiringInviteBody.invite.token}/accept`, {
      method: 'POST',
    });
    expect(expiredAcceptResp.status).toBe(410);
    const expiredAcceptBody = (await expiredAcceptResp.json()) as { error?: { code?: string; message?: string } };
    expect(expiredAcceptBody.error?.code).toBe('INVITE_EXPIRED');

    const finalRestoreDb = new Database(path.join(dataDir, 'app.sqlite'));
    try {
      finalRestoreDb.prepare(
        `INSERT OR REPLACE INTO local_identity (key, value) VALUES ('localUserId', ?)`,
      ).run(ownerBody.currentUserId);
    } finally {
      finalRestoreDb.close();
    }

    const activityResp = await fetch(`${baseUrl}/api/workspaces/${workspaceBody.workspace.id}/activity`);
    expect(activityResp.status).toBe(200);
    const activityBody = (await activityResp.json()) as {
      activities: Array<{
        action: string;
        actorUserId: string;
        targetId?: string;
        metadata?: Record<string, unknown>;
      }>;
    };
    const actions = activityBody.activities.map((activity) => activity.action);
    expect(actions).toContain('workspace.created');
    expect(actions).toContain('invite.created');
    expect(actions).toContain('invite.accepted');
    expect(actions).toContain('member.role_updated');
    expect(actions).toContain('member.removed');
    expect(actions).toContain('invite.revoked');
    expect(activityBody.activities.some((activity) => (
      activity.action === 'member.role_updated' && activity.targetId === inviteeUserId
    ))).toBe(true);
    expect(activityBody.activities).toContainEqual(expect.objectContaining({
      action: 'member.role_updated',
      targetId: inviteeUserId,
      metadata: expect.objectContaining({
        from: 'admin',
        to: 'member',
        revokedInviteCount: 1,
        revokedShareCount: 0,
        createdRoutineCount: 1,
        createdProjectCount: 1,
        ownedRoutineCount: 1,
        ownedProjectCount: 1,
      }),
    }));
    expect(activityBody.activities).toContainEqual(expect.objectContaining({
      action: 'member.removed',
      targetId: inviteeUserId,
      metadata: expect.objectContaining({
        role: 'member',
        revokedInviteCount: 0,
        revokedShareCount: 0,
        createdRoutineCount: 1,
        createdProjectCount: 1,
        ownedRoutineCount: 1,
        ownedProjectCount: 1,
        transferredRoutineCount: 1,
        transferredProjectCount: 1,
        transferToUserId: receiverUserId,
      }),
    }));
    expect(activityBody.activities).toContainEqual(expect.objectContaining({
      action: 'invite.revoked',
      targetId: pendingRevokeInviteBody.invite.id,
      metadata: expect.objectContaining({
        reason: 'manual_revoke',
        role: 'member',
        createdByUserId: ownerBody.currentUserId,
      }),
    }));
  });

  it('rejects cross-origin workspace management and invite acceptance requests', async () => {
    const serverUrl = new URL(baseUrl);
    const port = serverUrl.port;
    const workspaceResp = await fetch(`${baseUrl}/api/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Origin guard ${Date.now()}` }),
    });
    expect(workspaceResp.status).toBe(200);
    const workspaceBody = (await workspaceResp.json()) as { workspace: { id: string } };

    const rejectedList = await rawHttpRequest(`${baseUrl}/api/workspaces`, {
      headers: {
        Host: `127.0.0.1:${port}`,
        Origin: 'https://evil.example',
      },
    });
    expect(rejectedList.status).toBe(403);

    const rejectedCreateWorkspace = await rawHttpRequest(`${baseUrl}/api/workspaces`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Host: `127.0.0.1:${port}`,
        Origin: 'https://evil.example',
      },
      body: JSON.stringify({ name: 'Cross origin workspace' }),
    });
    expect(rejectedCreateWorkspace.status).toBe(403);

    const rejectedInvite = await rawHttpRequest(`${baseUrl}/api/workspaces/${workspaceBody.workspace.id}/invites`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Host: `127.0.0.1:${port}`,
        Origin: 'https://evil.example',
      },
      body: JSON.stringify({ role: 'member' }),
    });
    expect(rejectedInvite.status).toBe(403);

    const inviteResp = await fetch(`${baseUrl}/api/workspaces/${workspaceBody.workspace.id}/invites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'member' }),
    });
    expect(inviteResp.status).toBe(200);
    const inviteBody = (await inviteResp.json()) as { invite: { token: string } };

    const rejectedAccept = await rawHttpRequest(`${baseUrl}/api/workspace-invites/${inviteBody.invite.token}/accept`, {
      method: 'POST',
      headers: {
        Host: `127.0.0.1:${port}`,
        Origin: 'https://evil.example',
      },
    });
    expect(rejectedAccept.status).toBe(403);
  });

  it('does not list or create invite links for the personal workspace', async () => {
    const listResp = await fetch(`${baseUrl}/api/workspaces/local-personal/invites`);
    expect(listResp.status).toBe(400);
    const listBody = (await listResp.json()) as { error?: { code?: string; message?: string } };
    expect(listBody.error?.code).toBe('BAD_REQUEST');
    expect(listBody.error?.message).toMatch(/personal workspace/i);

    const inviteResp = await fetch(`${baseUrl}/api/workspaces/local-personal/invites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'member' }),
    });
    expect(inviteResp.status).toBe(400);
    const inviteBody = (await inviteResp.json()) as { error?: { code?: string; message?: string } };
    expect(inviteBody.error?.code).toBe('BAD_REQUEST');
    expect(inviteBody.error?.message).toMatch(/personal workspace/i);
  });

  it('returns workspace not found for missing workspace management resources', async () => {
    const missingWorkspaceId = `missing-workspace-${Date.now()}`;
    const cases: Array<{ url: string; init?: RequestInit }> = [
      { url: `${baseUrl}/api/workspaces/${missingWorkspaceId}/invites` },
      {
        url: `${baseUrl}/api/workspaces/${missingWorkspaceId}/invites/inv-missing`,
        init: { method: 'DELETE' },
      },
      {
        url: `${baseUrl}/api/workspaces/${missingWorkspaceId}/shares/share-missing`,
        init: { method: 'DELETE' },
      },
      {
        url: `${baseUrl}/api/workspaces/${missingWorkspaceId}/members/user-missing`,
        init: {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'admin' }),
        },
      },
      {
        url: `${baseUrl}/api/workspaces/${missingWorkspaceId}/members/user-missing`,
        init: { method: 'DELETE' },
      },
      {
        url: `${baseUrl}/api/workspaces/${missingWorkspaceId}/owner`,
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: 'user-missing' }),
        },
      },
    ];

    for (const item of cases) {
      const resp = await fetch(item.url, item.init);
      expect(resp.status).toBe(404);
      const body = (await resp.json()) as { error?: { code?: string; message?: string } };
      expect(body.error?.code).toBe('WORKSPACE_NOT_FOUND');
    }
  });
});

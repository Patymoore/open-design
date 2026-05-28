import type { Server } from 'node:http';
import path from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getInstalledPlugin } from '../src/plugins/registry.js';
import { startServer } from '../src/server.js';

type JsonObject = Record<string, any>;

interface JsonFetchResponse<TBody = JsonObject> {
  status: number;
  body: TBody;
}

let server: Server | undefined;
let baseUrl = '';

beforeEach(async () => {
  const started = await startServer({ port: 0, returnServer: true }) as {
    url: string;
    server: Server;
  };
  server = started.server;
  baseUrl = started.url;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    if (!server) return resolve(undefined);
    server.close((error?: Error) => (error ? reject(error) : resolve(undefined)));
  });
  server = undefined;
});

async function jsonFetch<TBody = JsonObject>(url: string, init?: RequestInit): Promise<JsonFetchResponse<TBody>> {
  const response = await fetch(url, init);
  return { status: response.status, body: await response.json() as TBody };
}

describe('plugin management routes workspace access', () => {
  it('requires workspace manager access for global plugin mutations', async () => {
    const dataDir = process.env.OD_DATA_DIR;
    if (!dataDir) throw new Error('OD_DATA_DIR is required for daemon route tests');

    const ownerResp = await jsonFetch<{ currentUserId: string }>(`${baseUrl}/api/workspaces`);
    expect(ownerResp.status).toBe(200);

    const workspaceResp = await jsonFetch<{ workspace: { id: string } }>(`${baseUrl}/api/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Plugin Management Access ${Date.now()}` }),
    });
    expect(workspaceResp.status).toBe(200);

    const memberUserId = `plugin-member-${Date.now()}`;
    const sqlite = new Database(path.join(dataDir, 'app.sqlite'));
    try {
      sqlite.prepare(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role, joined_at)
         VALUES (?, ?, 'member', ?)`,
      ).run(workspaceResp.body.workspace.id, memberUserId, Date.now());
      sqlite.prepare(`INSERT OR REPLACE INTO local_identity (key, value) VALUES ('localUserId', ?)`).run(memberUserId);
      sqlite.prepare(`INSERT OR REPLACE INTO local_identity (key, value) VALUES (?, ?)`)
        .run(`currentWorkspaceId:${memberUserId}`, workspaceResp.body.workspace.id);
    } finally {
      sqlite.close();
    }

    const assertForbiddenAdmin = async (response: JsonFetchResponse) => {
      expect(response.status).toBe(403);
      expect(response.body.error?.code).toBe('FORBIDDEN');
      expect(response.body.error?.message).toMatch(/admin role/i);
    };

    try {
      await assertForbiddenAdmin(await jsonFetch(`${baseUrl}/api/plugins/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'github:open-design/blocked-plugin' }),
      }));
      await assertForbiddenAdmin(await jsonFetch(`${baseUrl}/api/plugins/od-new-generation/uninstall`, {
        method: 'POST',
      }));
      await assertForbiddenAdmin(await jsonFetch(`${baseUrl}/api/plugins/od-new-generation/upgrade`, {
        method: 'POST',
      }));
      await assertForbiddenAdmin(await jsonFetch(`${baseUrl}/api/plugins/od-new-generation/trust`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capabilities: ['connector:github'] }),
      }));
    } finally {
      const restoreDb = new Database(path.join(dataDir, 'app.sqlite'));
      try {
        restoreDb.prepare(`INSERT OR REPLACE INTO local_identity (key, value) VALUES ('localUserId', ?)`).run(ownerResp.body.currentUserId);
      } finally {
        restoreDb.close();
      }
    }

    const verifyDb = new Database(path.join(dataDir, 'app.sqlite'));
    try {
      expect(getInstalledPlugin(verifyDb, 'od-new-generation')).toBeTruthy();
      expect(getInstalledPlugin(verifyDb, 'blocked-plugin')).toBeNull();
    } finally {
      verifyDb.close();
    }
  });
});

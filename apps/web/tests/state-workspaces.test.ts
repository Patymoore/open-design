// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createWorkspaceInvite,
  deleteWorkspaceResult,
  deleteWorkspaceInvite,
  deleteWorkspace,
  leaveWorkspace,
  listWorkspaces,
  listWorkspaceActivity,
  listWorkspaceActivityResult,
  listWorkspaceInvites,
  listWorkspaceMembersResult,
  listWorkspaceRoutinesResult,
  listWorkspaceShares,
  listWorkspaceSharesResult,
  removeWorkspaceMember,
  removeWorkspaceMemberResult,
  revokeWorkspaceShare,
  setCurrentWorkspace,
  updateWorkspaceName,
  updateWorkspaceMemberRole,
} from '../src/state/workspaces';

describe('workspace state API helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('preserves daemon invite URLs when creating invite links', async () => {
    window.history.replaceState(null, '', '/');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      invite: {
        id: 'inv-1',
        workspaceId: 'ws-1',
        token: 'abc/with space',
        role: 'member',
        createdByUserId: 'user-1',
        createdAt: 1,
        status: 'pending',
        inviteUrl: 'http://127.0.0.1:17456/workspace-invites/abc%2Fwith%20space',
      },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const invite = await createWorkspaceInvite('ws-1', { role: 'admin', expiresInDays: 14 });

    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces/ws-1/invites', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ role: 'admin', expiresInDays: 14 }),
    }));
    expect(invite?.inviteUrl).toBe('http://127.0.0.1:17456/workspace-invites/abc%2Fwith%20space');
    expect(invite?.status).toBe('pending');
  });

  it('preserves listed invite URLs and falls back when old daemons omit them', async () => {
    window.history.replaceState(null, '', 'http://localhost:3000/');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      invites: [{
        id: 'inv-2',
        workspaceId: 'ws-1',
        token: 'def',
        role: 'admin',
        createdByUserId: 'user-1',
        createdAt: 1,
        expiresAt: Date.now() - 1,
        inviteUrl: 'http://127.0.0.1:17456/workspace-invites/def',
      }, {
        id: 'inv-3',
        workspaceId: 'ws-1',
        token: 'accepted',
        role: 'member',
        createdByUserId: 'user-1',
        createdAt: 1,
        expiresAt: Date.now() - 1,
        acceptedAt: Date.now() - 2,
        acceptedByUserId: 'user-2',
      }],
    }), { status: 200 })));

    const invites = await listWorkspaceInvites('ws-1');

    expect(invites).toHaveLength(2);
    expect(invites[0]?.inviteUrl).toBe('http://127.0.0.1:17456/workspace-invites/def');
    expect(invites[0]?.status).toBe('expired');
    expect(invites[1]?.inviteUrl).toBe('http://localhost:3000/workspace-invites/accepted');
    expect(invites[1]?.status).toBe('accepted');
  });

  it('calls workspace member, invite, and lifecycle management endpoints', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/workspaces/current' && init?.method === 'PATCH') {
        return new Response(JSON.stringify({
          workspaces: [{
            id: 'ws-1',
            name: 'Team workspace',
            kind: 'team',
            createdAt: 1,
            updatedAt: 1,
          }],
          currentWorkspaceId: 'ws-1',
          currentUserId: 'user-1',
        }), { status: 200 });
      }
      if (url.endsWith('/members/user-2') && init?.method === 'PATCH') {
        return new Response(JSON.stringify({
          member: {
            workspaceId: 'ws-1',
            userId: 'user-2',
            role: 'admin',
            joinedAt: 1,
          },
        }), { status: 200 });
      }
      if (url === '/api/workspaces/ws-1' && init?.method === 'PATCH') {
        return new Response(JSON.stringify({
          workspace: {
            id: 'ws-1',
            name: 'Renamed workspace',
            kind: 'team',
            createdAt: 1,
            updatedAt: 2,
          },
        }), { status: 200 });
      }
      if (url === '/api/workspaces/ws-1/shares' && !init) {
        return new Response(JSON.stringify({
          shares: [{
            id: 'share-1',
            token: 'share-token',
            targetType: 'live_artifact',
            projectId: 'proj-1',
            projectName: 'Project One',
            artifactId: 'artifact-1',
            role: 'viewer',
            createdByUserId: 'user-1',
            createdAt: 1,
            shareUrl: 'http://127.0.0.1:17456/share/live-artifact/share-token',
          }],
        }), { status: 200 });
      }
      if (url === '/api/workspaces/ws-1/activity' && !init) {
        return new Response(JSON.stringify({
          activities: [{
            id: 'act-1',
            workspaceId: 'ws-1',
            actorUserId: 'user-1',
            action: 'invite.created',
            targetType: 'invite',
            targetId: 'inv-1',
            metadata: { role: 'member' },
            createdAt: 1,
          }],
        }), { status: 200 });
      }
      if (url === '/api/workspaces/ws-1/members' && !init) {
        return new Response(JSON.stringify({
          members: [{
            workspaceId: 'ws-1',
            userId: 'user-1',
            role: 'owner',
            joinedAt: 1,
            ownedProjectCount: 2,
            ownedRoutineCount: 1,
          }],
        }), { status: 200 });
      }
      if (url === '/api/routines?workspaceId=ws-1' && !init) {
        return new Response(JSON.stringify({
          routines: [{
            id: 'routine-1',
            workspaceId: 'ws-1',
            name: 'Daily automation',
            prompt: 'Summarize activity.',
            schedule: { kind: 'daily', time: '09:00', timezone: 'UTC' },
            target: { mode: 'create_each_run' },
            skillId: null,
            agentId: null,
            enabled: true,
            nextRunAt: null,
            lastRun: null,
            createdAt: 1,
            updatedAt: 1,
          }],
        }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const shares = await listWorkspaceShares('ws-1');
    const activities = await listWorkspaceActivity('ws-1');
    const members = await listWorkspaceMembersResult('ws-1');
    const routines = await listWorkspaceRoutinesResult('ws-1');
    const selected = await setCurrentWorkspace('ws-1');
    const workspace = await updateWorkspaceName('ws-1', 'Renamed workspace');
    const member = await updateWorkspaceMemberRole('ws-1', 'user-2', 'admin');
    const removed = await removeWorkspaceMember('ws-1', 'user-2');
    const removedWithTransfer = await removeWorkspaceMemberResult('ws-1', 'user-3', {
      transferToUserId: 'user-4',
    });
    const revoked = await deleteWorkspaceInvite('ws-1', 'inv-2');
    const shareRevoked = await revokeWorkspaceShare('ws-1', 'share-1');
    const left = await leaveWorkspace('ws-1');
    const deleted = await deleteWorkspace('ws-1');

    expect(workspace?.name).toBe('Renamed workspace');
    expect(selected?.currentWorkspaceId).toBe('ws-1');
    expect(shares[0]?.shareUrl).toBe('http://127.0.0.1:17456/share/live-artifact/share-token');
    expect(activities[0]?.action).toBe('invite.created');
    expect(members.ok).toBe(true);
    if (members.ok) {
      expect(members.value[0]?.ownedProjectCount).toBe(2);
      expect(members.value[0]?.ownedRoutineCount).toBe(1);
    }
    expect(routines.ok).toBe(true);
    if (routines.ok) expect(routines.value[0]?.workspaceId).toBe('ws-1');
    expect(member?.role).toBe('admin');
    expect(removed).toBe(true);
    expect(removedWithTransfer.ok).toBe(true);
    expect(revoked).toBe(true);
    expect(shareRevoked).toBe(true);
    expect(left).toBe(true);
    expect(deleted).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces/ws-1', expect.objectContaining({
      method: 'PATCH',
    }));
    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces/current', expect.objectContaining({
      method: 'PATCH',
    }));
    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces/ws-1/members/user-2', expect.objectContaining({
      method: 'PATCH',
    }));
    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces/ws-1/members/user-2', { method: 'DELETE' });
    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces/ws-1/members/user-3', expect.objectContaining({
      method: 'DELETE',
      body: JSON.stringify({ transferToUserId: 'user-4' }),
    }));
    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces/ws-1/invites/inv-2', { method: 'DELETE' });
    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces/ws-1/shares/share-1', { method: 'DELETE' });
    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces/ws-1/membership', { method: 'DELETE' });
    expect(fetchMock).toHaveBeenCalledWith('/api/workspaces/ws-1', { method: 'DELETE' });
  });

  it('falls back when the daemon returns a stale current workspace id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      workspaces: [{
        id: 'local-personal',
        name: 'Personal Workspace',
        kind: 'local',
        currentUserRole: 'owner',
        createdAt: 1,
        updatedAt: 1,
      }, {
        id: 'ws-active',
        name: 'Active workspace',
        kind: 'team',
        currentUserRole: 'member',
        createdAt: 2,
        updatedAt: 2,
      }],
      currentWorkspaceId: 'ws-removed',
      currentUserId: 'user-1',
    }), { status: 200 })));

    const response = await listWorkspaces();

    expect(response.currentWorkspaceId).toBe('local-personal');
  });

  it('falls back to a browser-origin share URL when old daemons omit shareUrl', async () => {
    window.history.replaceState(null, '', 'http://localhost:3000/');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      shares: [{
        id: 'share-legacy',
        token: 'legacy-token',
        targetType: 'live_artifact',
        projectId: 'proj-1',
        projectName: 'Project One',
        artifactId: 'artifact-1',
        role: 'viewer',
        createdByUserId: 'user-1',
        createdAt: 1,
      }],
    }), { status: 200 })));

    const shares = await listWorkspaceShares('ws-1');

    expect(shares[0]?.shareUrl).toBe('http://localhost:3000/share/live-artifact/legacy-token');
  });

  it('surfaces daemon error messages from result helpers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: {
        code: 'WORKSPACE_NOT_EMPTY',
        message: 'delete or move 2 workspace projects first',
      },
    }), { status: 409 })));

    const result = await deleteWorkspaceResult('ws-1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('delete or move 2 workspace projects first');
    }
  });

  it('preserves list helper compatibility while result helpers expose load failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: { message: 'workspace membership required' },
    }), { status: 403 })));

    const membersResult = await listWorkspaceMembersResult('ws-1');
    const sharesResult = await listWorkspaceSharesResult('ws-1');
    const activityResult = await listWorkspaceActivityResult('ws-1');
    const shares = await listWorkspaceShares('ws-1');

    expect(membersResult.ok).toBe(false);
    if (!membersResult.ok) expect(membersResult.error).toBe('workspace membership required');
    expect(sharesResult.ok).toBe(false);
    expect(activityResult.ok).toBe(false);
    expect(shares).toEqual([]);
  });
});

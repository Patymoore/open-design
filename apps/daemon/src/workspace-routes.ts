import type { Express } from 'express';
import type {
  AcceptWorkspaceInviteResponse,
  CreateWorkspaceResponse,
  DeleteWorkspaceInviteResponse,
  DeleteWorkspaceResponse,
  LeaveWorkspaceResponse,
  RemoveWorkspaceMemberResponse,
  RevokeWorkspaceShareResponse,
  TransferWorkspaceOwnerResponse,
  WorkspaceActivityResponse,
  WorkspaceInviteResponse,
  WorkspaceInvitesResponse,
  WorkspaceInviteWithStatus,
  WorkspaceMemberResponse,
  WorkspaceMembersResponse,
  WorkspaceResourceSharesResponse,
  WorkspaceResponse,
  WorkspacesResponse,
} from '@open-design/contracts';
import type { RouteDeps } from './server-context.js';

export interface RegisterWorkspaceRoutesDeps extends RouteDeps<'db' | 'http' | 'projectStore'> {}

function inviteUrl(req: { protocol: string; get(name: string): string | undefined }, token: string) {
  const host = req.get('host') ?? '127.0.0.1';
  return `${req.protocol}://${host}/workspace-invites/${encodeURIComponent(token)}`;
}

function liveArtifactShareUrl(req: { protocol: string; get(name: string): string | undefined }, token: string) {
  const host = req.get('host') ?? '127.0.0.1';
  return `${req.protocol}://${host}/share/live-artifact/${encodeURIComponent(token)}`;
}

function isManager(role: string | undefined) {
  return role === 'owner' || role === 'admin';
}

function resourceCountLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function inviteStatus(invite: { revokedAt?: number; expiresAt?: number; acceptedAt?: number }): WorkspaceInviteWithStatus['status'] {
  const now = Date.now();
  if (invite.revokedAt != null) return 'revoked';
  if (invite.acceptedAt != null) return 'accepted';
  if (invite.expiresAt != null && invite.expiresAt <= now) return 'expired';
  return 'pending';
}

export function registerWorkspaceRoutes(app: Express, ctx: RegisterWorkspaceRoutesDeps) {
  const { db } = ctx;
  const { sendApiError, isLocalSameOrigin, resolvedPortRef } = ctx.http;
  const {
    acceptWorkspaceInvite,
    clearCurrentWorkspaceForWorkspace,
    clearCurrentWorkspaceIfMatches,
    countWorkspaceProjects,
    countWorkspaceProjectsByCreator,
    countWorkspaceProjectsByOwner,
    countWorkspaceRoutines,
    countWorkspaceRoutinesByCreator,
    countWorkspaceRoutinesByOwner,
    deleteWorkspace,
    getCurrentWorkspaceId,
    getLocalUserId,
    getWorkspace,
    getWorkspaceInviteById,
    getWorkspaceInviteByToken,
    getWorkspaceMembership,
    insertWorkspaceActivity,
    insertWorkspace,
    insertWorkspaceInvite,
    deleteWorkspaceInvite,
    deleteWorkspaceMember,
    listWorkspaceActivity,
    listWorkspaceInvites,
    listWorkspaceMembers,
    listWorkspaceResourceShares,
    listWorkspaces,
    revokePendingWorkspaceInvitesByCreator,
    revokeResourceShare,
    revokeResourceSharesByCreator,
    setCurrentWorkspaceId,
    transferWorkspaceProjectsByOwner,
    transferWorkspaceRoutinesByOwner,
    transferWorkspaceOwner,
    updateWorkspace,
    updateWorkspaceMemberRole,
  } = ctx.projectStore;
  const getResolvedPort = () => resolvedPortRef.current;

  function requireLocalWorkspaceRequest(req: any, res: any) {
    if (isLocalSameOrigin(req, getResolvedPort())) return true;
    res.status(403).json({ error: 'cross-origin request rejected' });
    return false;
  }

  function requireWorkspace(res: Parameters<typeof sendApiError>[0], workspaceId: string) {
    const workspace = getWorkspace(db, workspaceId);
    if (!workspace) {
      sendApiError(res, 404, 'WORKSPACE_NOT_FOUND', 'workspace not found');
      return null;
    }
    return workspace;
  }

  function revokePendingInvitesCreatedBy(workspaceId: string, userId: string, actorUserId: string, reason: string) {
    const revokedInvites = revokePendingWorkspaceInvitesByCreator(db, { workspaceId, userId });
    for (const invite of revokedInvites) {
      insertWorkspaceActivity(db, {
        workspaceId,
        actorUserId,
        action: 'invite.revoked',
        targetType: 'invite',
        targetId: invite.id,
        metadata: { reason, revokedUserId: userId, role: invite.role },
      });
    }
    return revokedInvites;
  }

  function revokeResourceSharesCreatedBy(workspaceId: string, userId: string, actorUserId: string, reason: string) {
    const revokedShares = revokeResourceSharesByCreator(db, { workspaceId, userId });
    for (const share of revokedShares) {
      insertWorkspaceActivity(db, {
        workspaceId,
        actorUserId,
        action: 'share.revoked',
        targetType: 'share',
        targetId: share.id,
        metadata: {
          reason,
          revokedUserId: userId,
          artifactId: share.artifactId,
          projectId: share.projectId,
          projectName: share.projectName,
        },
      });
    }
    return revokedShares;
  }

  function revokedResourceCounts(revokedInvites: unknown[], revokedShares: unknown[]) {
    return {
      revokedInviteCount: revokedInvites.length,
      revokedShareCount: revokedShares.length,
    };
  }

  function memberRoutineMetadata(workspaceId: string, userId: string) {
    return {
      createdRoutineCount: countWorkspaceRoutinesByCreator(db, { workspaceId, userId }),
      createdProjectCount: countWorkspaceProjectsByCreator(db, { workspaceId, userId }),
      ownedRoutineCount: countWorkspaceRoutinesByOwner(db, { workspaceId, userId }),
      ownedProjectCount: countWorkspaceProjectsByOwner(db, { workspaceId, userId }),
    };
  }

  function memberAssetSummary(workspaceId: string, userId: string) {
    return {
      ownedProjectCount: countWorkspaceProjectsByOwner(db, { workspaceId, userId }),
      ownedRoutineCount: countWorkspaceRoutinesByOwner(db, { workspaceId, userId }),
    };
  }

  function transferMemberOwnedAssets(workspaceId: string, fromUserId: string, toUserId: string | null) {
    if (!toUserId || toUserId === fromUserId) {
      return {
        transferToUserId: toUserId ?? undefined,
        transferredProjectCount: 0,
        transferredRoutineCount: 0,
      };
    }
    return {
      transferToUserId: toUserId,
      transferredProjectCount: transferWorkspaceProjectsByOwner(db, { workspaceId, fromUserId, toUserId }),
      transferredRoutineCount: transferWorkspaceRoutinesByOwner(db, { workspaceId, fromUserId, toUserId }),
    };
  }

  app.get('/api/workspaces', (req, res) => {
    if (!requireLocalWorkspaceRequest(req, res)) return;
    const currentUserId = getLocalUserId(db);
    const workspaces = listWorkspaces(db, { userId: currentUserId });
    const savedWorkspaceId = getCurrentWorkspaceId(db, currentUserId);
    const currentWorkspaceId = workspaces.some((workspace: any) => workspace.id === savedWorkspaceId)
      ? savedWorkspaceId
      : workspaces[0]?.id ?? 'local-personal';
    if (currentWorkspaceId !== savedWorkspaceId) {
      setCurrentWorkspaceId(db, currentUserId, currentWorkspaceId);
    }
    const response: WorkspacesResponse = {
      workspaces,
      currentWorkspaceId,
      currentUserId,
    };
    res.json(response);
  });

  app.patch('/api/workspaces/current', (req, res) => {
    if (!requireLocalWorkspaceRequest(req, res)) return;
    const currentUserId = getLocalUserId(db);
    const workspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId.trim() : '';
    if (!workspaceId) return sendApiError(res, 400, 'BAD_REQUEST', 'workspaceId required');
    if (!requireWorkspace(res, workspaceId)) return;
    const membership = getWorkspaceMembership(db, workspaceId, currentUserId);
    if (!membership) {
      return sendApiError(res, 403, 'FORBIDDEN', 'workspace membership required');
    }
    setCurrentWorkspaceId(db, currentUserId, workspaceId);
    const response: WorkspacesResponse = {
      workspaces: listWorkspaces(db, { userId: currentUserId }),
      currentWorkspaceId: workspaceId,
      currentUserId,
    };
    res.json(response);
  });

  app.post('/api/workspaces', (req, res) => {
    if (!requireLocalWorkspaceRequest(req, res)) return;
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) return sendApiError(res, 400, 'BAD_REQUEST', 'name required');
    const currentUserId = getLocalUserId(db);
    const workspace = db.transaction(() => {
      const created = insertWorkspace(db, { name, userId: currentUserId });
      if (!created) return null;
      setCurrentWorkspaceId(db, currentUserId, created.id);
      insertWorkspaceActivity(db, {
        workspaceId: created.id,
        actorUserId: currentUserId,
        action: 'workspace.created',
        targetType: 'workspace',
        targetId: created.id,
        metadata: { name: created.name },
      });
      return created;
    })();
    if (!workspace) return sendApiError(res, 500, 'WORKSPACE_CREATE_FAILED', 'could not create workspace');
    const response: CreateWorkspaceResponse = { workspace, currentWorkspaceId: workspace.id };
    res.json(response);
  });

  app.patch('/api/workspaces/:id', (req, res) => {
    if (!requireLocalWorkspaceRequest(req, res)) return;
    const workspace = getWorkspace(db, req.params.id);
    if (!workspace) {
      return sendApiError(res, 404, 'WORKSPACE_NOT_FOUND', 'workspace not found');
    }
    if (workspace.kind === 'local') {
      return sendApiError(res, 400, 'BAD_REQUEST', 'personal workspace cannot be renamed');
    }
    const currentUserId = getLocalUserId(db);
    const membership = getWorkspaceMembership(db, req.params.id, currentUserId);
    if (!isManager(membership?.role)) {
      return sendApiError(res, 403, 'FORBIDDEN', 'workspace admin role required');
    }
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) return sendApiError(res, 400, 'BAD_REQUEST', 'name required');
    const updated = db.transaction(() => {
      const renamed = updateWorkspace(db, { id: req.params.id, name });
      if (!renamed) return null;
      insertWorkspaceActivity(db, {
        workspaceId: req.params.id,
        actorUserId: currentUserId,
        action: 'workspace.renamed',
        targetType: 'workspace',
        targetId: req.params.id,
        metadata: { from: workspace.name, to: name },
      });
      return renamed;
    })();
    if (!updated) return sendApiError(res, 404, 'WORKSPACE_NOT_FOUND', 'workspace not found');
    const response: WorkspaceResponse = { workspace: updated };
    res.json(response);
  });

  app.delete('/api/workspaces/:id', (req, res) => {
    if (!requireLocalWorkspaceRequest(req, res)) return;
    const workspace = getWorkspace(db, req.params.id);
    if (!workspace) {
      return sendApiError(res, 404, 'WORKSPACE_NOT_FOUND', 'workspace not found');
    }
    if (workspace.kind === 'local') {
      return sendApiError(res, 400, 'BAD_REQUEST', 'personal workspace cannot be deleted');
    }
    const currentUserId = getLocalUserId(db);
    const membership = getWorkspaceMembership(db, req.params.id, currentUserId);
    if (membership?.role !== 'owner') {
      return sendApiError(res, 403, 'FORBIDDEN', 'workspace owner role required');
    }
    const projectCount = countWorkspaceProjects(db, req.params.id);
    if (projectCount > 0) {
      return sendApiError(
        res,
        409,
        'WORKSPACE_NOT_EMPTY',
        `delete or move ${resourceCountLabel(projectCount, 'workspace project')} first`,
      );
    }
    const routineCount = countWorkspaceRoutines(db, req.params.id);
    if (routineCount > 0) {
      return sendApiError(
        res,
        409,
        'WORKSPACE_NOT_EMPTY',
        `delete ${resourceCountLabel(routineCount, 'workspace automation')} first`,
      );
    }
    const deleted = db.transaction(() => {
      if (!deleteWorkspace(db, req.params.id)) return false;
      clearCurrentWorkspaceForWorkspace(db, req.params.id);
      return true;
    })();
    if (!deleted) {
      return sendApiError(res, 404, 'WORKSPACE_NOT_FOUND', 'workspace not found');
    }
    const response: DeleteWorkspaceResponse = { ok: true };
    res.json(response);
  });

  app.delete('/api/workspaces/:id/membership', (req, res) => {
    if (!requireLocalWorkspaceRequest(req, res)) return;
    const workspace = getWorkspace(db, req.params.id);
    if (!workspace) {
      return sendApiError(res, 404, 'WORKSPACE_NOT_FOUND', 'workspace not found');
    }
    if (workspace.kind === 'local') {
      return sendApiError(res, 400, 'BAD_REQUEST', 'personal workspace cannot be left');
    }
    const currentUserId = getLocalUserId(db);
    const membership = getWorkspaceMembership(db, req.params.id, currentUserId);
    if (!membership) {
      return sendApiError(res, 403, 'FORBIDDEN', 'workspace membership required');
    }
    if (membership.role === 'owner') {
      return sendApiError(res, 400, 'OWNER_TRANSFER_REQUIRED', 'transfer ownership before leaving');
    }
    const left = db.transaction(() => {
      if (!getWorkspaceMembership(db, req.params.id, currentUserId)) return false;
      const beforeTransfer = memberRoutineMetadata(req.params.id, currentUserId);
      const ownerMember = listWorkspaceMembers(db, req.params.id).find((member: any) => member.role === 'owner');
      const ownershipTransfer = transferMemberOwnedAssets(req.params.id, currentUserId, ownerMember?.userId ?? null);
      const revokedInvites = revokePendingInvitesCreatedBy(req.params.id, currentUserId, currentUserId, 'member_left');
      const revokedShares = revokeResourceSharesCreatedBy(req.params.id, currentUserId, currentUserId, 'member_left');
      if (!deleteWorkspaceMember(db, { workspaceId: req.params.id, userId: currentUserId })) {
        return false;
      }
      clearCurrentWorkspaceIfMatches(db, { workspaceId: req.params.id, userId: currentUserId });
      insertWorkspaceActivity(db, {
        workspaceId: req.params.id,
        actorUserId: currentUserId,
        action: 'member.left',
        targetType: 'member',
        targetId: currentUserId,
        metadata: {
          role: membership.role,
          ...revokedResourceCounts(revokedInvites, revokedShares),
          ...beforeTransfer,
          ...ownershipTransfer,
        },
      });
      return true;
    })();
    if (!left) {
      return sendApiError(res, 404, 'MEMBER_NOT_FOUND', 'member not found');
    }
    const response: LeaveWorkspaceResponse = { ok: true };
    res.json(response);
  });

  app.get('/api/workspaces/:id/members', (req, res) => {
    if (!requireLocalWorkspaceRequest(req, res)) return;
    if (!getWorkspace(db, req.params.id)) {
      return sendApiError(res, 404, 'WORKSPACE_NOT_FOUND', 'workspace not found');
    }
    const currentUserId = getLocalUserId(db);
    if (!getWorkspaceMembership(db, req.params.id, currentUserId)) {
      return sendApiError(res, 403, 'FORBIDDEN', 'workspace membership required');
    }
    const response: WorkspaceMembersResponse = {
      members: listWorkspaceMembers(db, req.params.id).map((member: any) => ({
        ...member,
        ...memberAssetSummary(req.params.id, member.userId),
      })),
    };
    res.json(response);
  });

  app.get('/api/workspaces/:id/activity', (req, res) => {
    if (!requireLocalWorkspaceRequest(req, res)) return;
    if (!getWorkspace(db, req.params.id)) {
      return sendApiError(res, 404, 'WORKSPACE_NOT_FOUND', 'workspace not found');
    }
    const currentUserId = getLocalUserId(db);
    if (!getWorkspaceMembership(db, req.params.id, currentUserId)) {
      return sendApiError(res, 403, 'FORBIDDEN', 'workspace membership required');
    }
    const response: WorkspaceActivityResponse = { activities: listWorkspaceActivity(db, req.params.id) };
    res.json(response);
  });

  app.patch('/api/workspaces/:id/members/:userId', (req, res) => {
    if (!requireLocalWorkspaceRequest(req, res)) return;
    if (!requireWorkspace(res, req.params.id)) return;
    const currentUserId = getLocalUserId(db);
    const currentMembership = getWorkspaceMembership(db, req.params.id, currentUserId);
    if (!isManager(currentMembership?.role)) {
      return sendApiError(res, 403, 'FORBIDDEN', 'workspace admin role required');
    }
    const target = getWorkspaceMembership(db, req.params.id, req.params.userId);
    if (!target) return sendApiError(res, 404, 'MEMBER_NOT_FOUND', 'member not found');
    if (target.role === 'owner') {
      return sendApiError(res, 400, 'BAD_REQUEST', 'owner role cannot be changed');
    }
    if (req.params.userId === currentUserId) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'ask another admin or owner to change your role');
    }
    const role = req.body?.role === 'admin' ? 'admin' : req.body?.role === 'member' ? 'member' : null;
    if (!role) return sendApiError(res, 400, 'BAD_REQUEST', 'role must be admin or member');
    const member = db.transaction(() => {
      const currentTarget = getWorkspaceMembership(db, req.params.id, req.params.userId);
      if (!currentTarget || currentTarget.role === 'owner') return null;
      const updatedMember = updateWorkspaceMemberRole(db, { workspaceId: req.params.id, userId: req.params.userId, role });
      if (!updatedMember) return null;
      let revokedInvites: unknown[] = [];
      let revokedShares: unknown[] = [];
      if (currentTarget.role === 'admin' && role === 'member') {
        revokedInvites = revokePendingInvitesCreatedBy(req.params.id, req.params.userId, currentUserId, 'member_demoted');
        revokedShares = revokeResourceSharesCreatedBy(req.params.id, req.params.userId, currentUserId, 'member_demoted');
      }
      insertWorkspaceActivity(db, {
        workspaceId: req.params.id,
        actorUserId: currentUserId,
        action: 'member.role_updated',
        targetType: 'member',
        targetId: req.params.userId,
        metadata: {
          from: currentTarget.role,
          to: role,
          ...revokedResourceCounts(revokedInvites, revokedShares),
          ...memberRoutineMetadata(req.params.id, req.params.userId),
        },
      });
      return updatedMember;
    })();
    if (!member) return sendApiError(res, 404, 'MEMBER_NOT_FOUND', 'member not found');
    const response: WorkspaceMemberResponse = { member };
    res.json(response);
  });

  app.post('/api/workspaces/:id/owner', (req, res) => {
    if (!requireLocalWorkspaceRequest(req, res)) return;
    const workspace = requireWorkspace(res, req.params.id);
    if (!workspace) return;
    if (workspace.kind === 'local') {
      return sendApiError(res, 400, 'BAD_REQUEST', 'personal workspace ownership cannot be transferred');
    }
    const currentUserId = getLocalUserId(db);
    const currentMembership = getWorkspaceMembership(db, req.params.id, currentUserId);
    if (currentMembership?.role !== 'owner') {
      return sendApiError(res, 403, 'FORBIDDEN', 'workspace owner role required');
    }
    const targetUserId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
    if (!targetUserId) return sendApiError(res, 400, 'BAD_REQUEST', 'userId required');
    if (targetUserId === currentUserId) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'target user is already owner');
    }
    const target = getWorkspaceMembership(db, req.params.id, targetUserId);
    if (!target) return sendApiError(res, 404, 'MEMBER_NOT_FOUND', 'member not found');
    const result = db.transaction(() => {
      const currentOwner = getWorkspaceMembership(db, req.params.id, currentUserId);
      const currentTarget = getWorkspaceMembership(db, req.params.id, targetUserId);
      if (currentOwner?.role !== 'owner' || !currentTarget || currentTarget.role === 'owner') return null;
      const transferred = transferWorkspaceOwner(db, {
        workspaceId: req.params.id,
        fromUserId: currentUserId,
        toUserId: targetUserId,
      });
      if (!transferred?.previousOwner || !transferred.owner) return null;
      insertWorkspaceActivity(db, {
        workspaceId: req.params.id,
        actorUserId: currentUserId,
        action: 'owner.transferred',
        targetType: 'member',
        targetId: targetUserId,
        metadata: { previousOwnerUserId: currentUserId, ownerUserId: targetUserId },
      });
      return transferred;
    })();
    if (!result?.previousOwner || !result.owner) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'could not transfer owner');
    }
    const response: TransferWorkspaceOwnerResponse = result;
    res.json(response);
  });

  app.delete('/api/workspaces/:id/members/:userId', (req, res) => {
    if (!requireLocalWorkspaceRequest(req, res)) return;
    if (!requireWorkspace(res, req.params.id)) return;
    const currentUserId = getLocalUserId(db);
    const currentMembership = getWorkspaceMembership(db, req.params.id, currentUserId);
    if (!isManager(currentMembership?.role)) {
      return sendApiError(res, 403, 'FORBIDDEN', 'workspace admin role required');
    }
    const target = getWorkspaceMembership(db, req.params.id, req.params.userId);
    if (!target) {
      return sendApiError(res, 404, 'MEMBER_NOT_FOUND', 'member not found');
    }
    if (target.role === 'owner') {
      return sendApiError(res, 400, 'OWNER_TRANSFER_REQUIRED', 'transfer ownership before removing owner');
    }
    if (req.params.userId === currentUserId) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'use leave workspace instead');
    }
    const requestedTransferToUserId =
      typeof req.body?.transferToUserId === 'string' ? req.body.transferToUserId.trim() : '';
    const transferToUserId = requestedTransferToUserId || currentUserId;
    if (transferToUserId === req.params.userId) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'asset transfer target must be another workspace member');
    }
    const transferTarget = getWorkspaceMembership(db, req.params.id, transferToUserId);
    if (!transferTarget) {
      return sendApiError(res, 404, 'MEMBER_NOT_FOUND', 'asset transfer target not found');
    }
    const removed = db.transaction(() => {
      if (!getWorkspaceMembership(db, req.params.id, req.params.userId)) return false;
      const beforeTransfer = memberRoutineMetadata(req.params.id, req.params.userId);
      const ownershipTransfer = transferMemberOwnedAssets(req.params.id, req.params.userId, transferToUserId);
      const removedMember = deleteWorkspaceMember(db, { workspaceId: req.params.id, userId: req.params.userId });
      if (!removedMember) return false;
      const revokedInvites = revokePendingInvitesCreatedBy(req.params.id, req.params.userId, currentUserId, 'member_removed');
      const revokedShares = revokeResourceSharesCreatedBy(req.params.id, req.params.userId, currentUserId, 'member_removed');
      clearCurrentWorkspaceIfMatches(db, { workspaceId: req.params.id, userId: req.params.userId });
      insertWorkspaceActivity(db, {
        workspaceId: req.params.id,
        actorUserId: currentUserId,
        action: 'member.removed',
        targetType: 'member',
        targetId: req.params.userId,
        metadata: {
          role: target.role,
          ...revokedResourceCounts(revokedInvites, revokedShares),
          ...beforeTransfer,
          ...ownershipTransfer,
        },
      });
      return true;
    })();
    if (!removed) return sendApiError(res, 404, 'MEMBER_NOT_FOUND', 'member not found');
    const response: RemoveWorkspaceMemberResponse = { ok: true };
    res.json(response);
  });

  app.get('/api/workspaces/:id/invites', (req, res) => {
    if (!requireLocalWorkspaceRequest(req, res)) return;
    const workspace = requireWorkspace(res, req.params.id);
    if (!workspace) return;
    if (workspace.kind === 'local') {
      return sendApiError(res, 400, 'BAD_REQUEST', 'personal workspace cannot list invite links');
    }
    const currentUserId = getLocalUserId(db);
    const membership = getWorkspaceMembership(db, req.params.id, currentUserId);
    if (!isManager(membership?.role)) {
      return sendApiError(res, 403, 'FORBIDDEN', 'workspace admin role required');
    }
    const invites = listWorkspaceInvites(db, req.params.id).map((invite: any) => ({
      ...invite,
      status: inviteStatus(invite),
      inviteUrl: inviteUrl(req, invite.token),
    }));
    const response: WorkspaceInvitesResponse = { invites };
    res.json(response);
  });

  app.get('/api/workspaces/:id/shares', (req, res) => {
    if (!requireLocalWorkspaceRequest(req, res)) return;
    if (!getWorkspace(db, req.params.id)) {
      return sendApiError(res, 404, 'WORKSPACE_NOT_FOUND', 'workspace not found');
    }
    const currentUserId = getLocalUserId(db);
    const membership = getWorkspaceMembership(db, req.params.id, currentUserId);
    if (!isManager(membership?.role)) {
      return sendApiError(res, 403, 'FORBIDDEN', 'workspace admin role required');
    }
    const shares = listWorkspaceResourceShares(db, req.params.id).map((share: any) => ({
      ...share,
      shareUrl: liveArtifactShareUrl(req, share.token),
    }));
    const response: WorkspaceResourceSharesResponse = { shares };
    res.json(response);
  });

  app.post('/api/workspaces/:id/invites', (req, res) => {
    if (!requireLocalWorkspaceRequest(req, res)) return;
    const workspace = getWorkspace(db, req.params.id);
    if (!workspace) {
      return sendApiError(res, 404, 'WORKSPACE_NOT_FOUND', 'workspace not found');
    }
    if (workspace.kind === 'local') {
      return sendApiError(res, 400, 'BAD_REQUEST', 'personal workspace cannot invite members');
    }
    const currentUserId = getLocalUserId(db);
    const membership = getWorkspaceMembership(db, req.params.id, currentUserId);
    if (!isManager(membership?.role)) {
      return sendApiError(res, 403, 'FORBIDDEN', 'workspace admin role required');
    }
    const role = req.body?.role === 'admin' ? 'admin' : req.body?.role === 'member' || req.body?.role == null ? 'member' : null;
    if (!role) return sendApiError(res, 400, 'BAD_REQUEST', 'role must be admin or member');
    const expiresInDays = typeof req.body?.expiresInDays === 'number'
      ? Math.max(1, Math.min(30, Math.floor(req.body.expiresInDays)))
      : 7;
    const invite = db.transaction(() => {
      const created = insertWorkspaceInvite(db, {
        workspaceId: req.params.id,
        userId: currentUserId,
        role,
        expiresAt: Date.now() + expiresInDays * 24 * 60 * 60 * 1000,
      });
      if (!created) return null;
      insertWorkspaceActivity(db, {
        workspaceId: req.params.id,
        actorUserId: currentUserId,
        action: 'invite.created',
        targetType: 'invite',
        targetId: created.id,
        metadata: { role, expiresAt: created.expiresAt },
      });
      return created;
    })();
    if (!invite) return sendApiError(res, 500, 'INVITE_CREATE_FAILED', 'could not create invite');
    const response: WorkspaceInviteResponse = {
      invite: { ...invite, status: inviteStatus(invite), inviteUrl: inviteUrl(req, invite.token) },
    };
    res.json(response);
  });

  app.delete('/api/workspaces/:id/invites/:inviteId', (req, res) => {
    if (!requireLocalWorkspaceRequest(req, res)) return;
    if (!requireWorkspace(res, req.params.id)) return;
    const currentUserId = getLocalUserId(db);
    const membership = getWorkspaceMembership(db, req.params.id, currentUserId);
    if (!isManager(membership?.role)) {
      return sendApiError(res, 403, 'FORBIDDEN', 'workspace admin role required');
    }
    const invite = getWorkspaceInviteById(db, { workspaceId: req.params.id, inviteId: req.params.inviteId });
    if (!invite) return sendApiError(res, 404, 'INVITE_NOT_FOUND', 'invite not found');
    if (inviteStatus(invite) !== 'pending') {
      return sendApiError(res, 409, 'INVITE_NOT_PENDING', 'only pending invites can be revoked');
    }
    const removed = db.transaction(() => {
      const currentInvite = getWorkspaceInviteById(db, { workspaceId: req.params.id, inviteId: req.params.inviteId });
      if (!currentInvite || inviteStatus(currentInvite) !== 'pending') return false;
      const deleted = deleteWorkspaceInvite(db, { workspaceId: req.params.id, inviteId: req.params.inviteId });
      if (!deleted) return false;
      insertWorkspaceActivity(db, {
        workspaceId: req.params.id,
        actorUserId: currentUserId,
        action: 'invite.revoked',
        targetType: 'invite',
        targetId: req.params.inviteId,
        metadata: {
          reason: 'manual_revoke',
          role: currentInvite.role,
          createdByUserId: currentInvite.createdByUserId,
        },
      });
      return true;
    })();
    if (!removed) return sendApiError(res, 409, 'INVITE_NOT_PENDING', 'only pending invites can be revoked');
    const response: DeleteWorkspaceInviteResponse = { ok: true };
    res.json(response);
  });

  app.delete('/api/workspaces/:id/shares/:shareId', (req, res) => {
    if (!requireLocalWorkspaceRequest(req, res)) return;
    if (!requireWorkspace(res, req.params.id)) return;
    const currentUserId = getLocalUserId(db);
    const membership = getWorkspaceMembership(db, req.params.id, currentUserId);
    if (!isManager(membership?.role)) {
      return sendApiError(res, 403, 'FORBIDDEN', 'workspace admin role required');
    }
    const revokedShare = db.transaction(() => {
      const share = revokeResourceShare(db, { workspaceId: req.params.id, shareId: req.params.shareId });
      if (!share) return null;
      insertWorkspaceActivity(db, {
        workspaceId: req.params.id,
        actorUserId: currentUserId,
        action: 'share.revoked',
        targetType: 'share',
        targetId: req.params.shareId,
        metadata: {
          artifactId: share.artifactId,
          projectId: share.projectId,
          projectName: share.projectName,
        },
      });
      return share;
    })();
    if (!revokedShare) return sendApiError(res, 404, 'SHARE_NOT_FOUND', 'share not found');
    const response: RevokeWorkspaceShareResponse = { ok: true };
    res.json(response);
  });

  app.post('/api/workspace-invites/:token/accept', (req, res) => {
    if (!requireLocalWorkspaceRequest(req, res)) return;
    const currentUserId = getLocalUserId(db);
    const invite = getWorkspaceInviteByToken(db, req.params.token);
    const result = db.transaction(() => {
      const accepted = acceptWorkspaceInvite(db, req.params.token, currentUserId);
      if (!accepted?.workspace || !accepted.membership) return null;
      if (accepted.acceptedInvite !== false) {
        insertWorkspaceActivity(db, {
          workspaceId: accepted.workspace.id,
          actorUserId: currentUserId,
          action: 'invite.accepted',
          targetType: 'member',
          targetId: currentUserId,
          metadata: { inviteId: invite?.id, role: accepted.membership.role },
        });
      }
      setCurrentWorkspaceId(db, currentUserId, accepted.workspace.id);
      return accepted;
    })();
    if (!result?.workspace || !result.membership) {
      if (invite) {
        const status = inviteStatus(invite);
        if (status === 'revoked') {
          return sendApiError(res, 410, 'INVITE_REVOKED', 'invite link was revoked');
        }
        if (status === 'expired') {
          return sendApiError(res, 410, 'INVITE_EXPIRED', 'invite link expired');
        }
        if (status === 'accepted') {
          return sendApiError(res, 409, 'INVITE_ALREADY_ACCEPTED', 'invite link was already used');
        }
      }
      return sendApiError(res, 404, 'INVITE_NOT_FOUND', 'invite not found');
    }
    const response: AcceptWorkspaceInviteResponse = result;
    res.json(response);
  });
}

import type { OkResponse } from '../common.js';

export type WorkspaceKind = 'local' | 'team';
export type WorkspaceRole = 'owner' | 'admin' | 'member';
export type WorkspaceActivityAction =
  | 'workspace.created'
  | 'workspace.renamed'
  | 'member.left'
  | 'member.removed'
  | 'member.role_updated'
  | 'owner.transferred'
  | 'invite.created'
  | 'invite.revoked'
  | 'invite.accepted'
  | 'project.created'
  | 'project.deleted'
  | 'project.imported'
  | 'project.moved'
  | 'project.owner_transferred'
  | 'routine.created'
  | 'routine.updated'
  | 'routine.deleted'
  | 'routine.owner_transferred'
  | 'routine.run_requested'
  | 'share.created'
  | 'share.revoked';

export interface Workspace {
  id: string;
  name: string;
  kind: WorkspaceKind;
  currentUserRole?: WorkspaceRole;
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceMembership {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  joinedAt: number;
  ownedProjectCount?: number;
  ownedRoutineCount?: number;
}

export interface WorkspaceInvite {
  id: string;
  workspaceId: string;
  token: string;
  role: Exclude<WorkspaceRole, 'owner'>;
  createdByUserId: string;
  createdAt: number;
  expiresAt?: number;
  revokedAt?: number;
  acceptedAt?: number;
  acceptedByUserId?: string;
  inviteUrl?: string;
}

export interface WorkspaceInviteWithStatus extends WorkspaceInvite {
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
}

export interface WorkspaceActivity {
  id: string;
  workspaceId: string;
  actorUserId: string;
  action: WorkspaceActivityAction;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
}

export interface WorkspacesResponse {
  workspaces: Workspace[];
  currentWorkspaceId: string;
  currentUserId: string;
}

export interface SetCurrentWorkspaceRequest {
  workspaceId: string;
}

export interface CreateWorkspaceRequest {
  name: string;
}

export interface CreateWorkspaceResponse {
  workspace: Workspace;
  currentWorkspaceId: string;
}

export interface UpdateWorkspaceRequest {
  name: string;
}

export interface WorkspaceResponse {
  workspace: Workspace;
}

export interface WorkspaceMembersResponse {
  members: WorkspaceMembership[];
}

export interface UpdateWorkspaceMemberRequest {
  role: Exclude<WorkspaceRole, 'owner'>;
}

export interface WorkspaceMemberResponse {
  member: WorkspaceMembership;
}

export interface RemoveWorkspaceMemberRequest {
  transferToUserId?: string;
}

export interface RemoveWorkspaceMemberResponse extends OkResponse {}

export interface LeaveWorkspaceResponse extends OkResponse {}

export interface DeleteWorkspaceResponse extends OkResponse {}

export interface TransferWorkspaceOwnerRequest {
  userId: string;
}

export interface TransferWorkspaceOwnerResponse {
  previousOwner: WorkspaceMembership;
  owner: WorkspaceMembership;
}

export interface CreateWorkspaceInviteRequest {
  role?: Exclude<WorkspaceRole, 'owner'>;
  expiresInDays?: number;
}

export interface WorkspaceInvitesResponse {
  invites: WorkspaceInviteWithStatus[];
}

export interface WorkspaceActivityResponse {
  activities: WorkspaceActivity[];
}

export interface WorkspaceInviteResponse {
  invite: WorkspaceInviteWithStatus;
}

export interface DeleteWorkspaceInviteResponse extends OkResponse {}

export interface RevokeWorkspaceShareResponse extends OkResponse {}

export interface AcceptWorkspaceInviteResponse {
  workspace: Workspace;
  membership: WorkspaceMembership;
  acceptedInvite?: boolean;
}

import type {
  AcceptWorkspaceInviteResponse,
  CreateWorkspaceInviteRequest,
  CreateWorkspaceRequest,
  CreateWorkspaceResponse,
  DeleteWorkspaceInviteResponse,
  DeleteWorkspaceResponse,
  LeaveWorkspaceResponse,
  RemoveWorkspaceMemberRequest,
  RemoveWorkspaceMemberResponse,
  RevokeWorkspaceShareResponse,
  SetCurrentWorkspaceRequest,
  TransferWorkspaceOwnerRequest,
  TransferWorkspaceOwnerResponse,
  UpdateWorkspaceMemberRequest,
  UpdateWorkspaceRequest,
  Workspace,
  WorkspaceActivity,
  WorkspaceActivityResponse,
  WorkspaceInvite,
  WorkspaceInviteResponse,
  WorkspaceInviteWithStatus,
  WorkspaceInvitesResponse,
  WorkspaceMemberResponse,
  WorkspaceMembersResponse,
  WorkspaceMembership,
  WorkspaceResourceSharesResponse,
  WorkspaceResponse,
  ResourceShare,
  Routine,
  WorkspacesResponse,
} from '@open-design/contracts';

const fallbackWorkspace: Workspace = {
  id: 'local-personal',
  name: 'Personal Workspace',
  kind: 'local',
  currentUserRole: 'owner',
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

export type WorkspaceOperationResult<T = true> =
  | { ok: true; value: T }
  | { ok: false; error: string };

function fallbackWorkspacesResponse(): WorkspacesResponse {
  return {
    workspaces: [fallbackWorkspace],
    currentWorkspaceId: fallbackWorkspace.id,
    currentUserId: 'anonymous',
  };
}

function normalizeWorkspacesResponse(value: WorkspacesResponse): WorkspacesResponse {
  if (!Array.isArray(value.workspaces) || value.workspaces.length === 0) {
    return fallbackWorkspacesResponse();
  }
  const currentWorkspaceId =
    typeof value.currentWorkspaceId === 'string' && value.currentWorkspaceId
      ? value.currentWorkspaceId
      : value.workspaces[0]!.id;
  return {
    workspaces: value.workspaces,
    currentWorkspaceId: value.workspaces.some((workspace) => workspace.id === currentWorkspaceId)
      ? currentWorkspaceId
      : value.workspaces[0]!.id,
    currentUserId:
      typeof value.currentUserId === 'string' && value.currentUserId
        ? value.currentUserId
        : 'anonymous',
  };
}

function workspaceInviteUrl(token: string): string {
  if (typeof window === 'undefined') {
    return `/workspace-invites/${encodeURIComponent(token)}`;
  }
  return `${window.location.origin}/workspace-invites/${encodeURIComponent(token)}`;
}

function liveArtifactShareUrl(token: string): string {
  if (typeof window === 'undefined') {
    return `/share/live-artifact/${encodeURIComponent(token)}`;
  }
  return `${window.location.origin}/share/live-artifact/${encodeURIComponent(token)}`;
}

function normalizeWorkspaceInvite<T extends WorkspaceInvite>(invite: T): T {
  return {
    ...invite,
    inviteUrl: invite.inviteUrl || workspaceInviteUrl(invite.token),
  };
}

function normalizeResourceShare<T extends ResourceShare>(share: T): T {
  return {
    ...share,
    shareUrl: share.shareUrl || liveArtifactShareUrl(share.token),
  };
}

async function readApiError(resp: Response, fallback: string): Promise<string> {
  try {
    const json = (await resp.json()) as { error?: { message?: string; code?: string } };
    return json.error?.message || json.error?.code || fallback;
  } catch {
    return fallback;
  }
}

function networkError(fallback: string): WorkspaceOperationResult<never> {
  return { ok: false, error: fallback };
}

export async function listWorkspaces(): Promise<WorkspacesResponse> {
  try {
    const resp = await fetch('/api/workspaces');
    if (!resp.ok) throw new Error('workspace list failed');
    return normalizeWorkspacesResponse((await resp.json()) as WorkspacesResponse);
  } catch {
    return fallbackWorkspacesResponse();
  }
}

export async function setCurrentWorkspace(workspaceId: string): Promise<WorkspacesResponse | null> {
  try {
    const body: SetCurrentWorkspaceRequest = { workspaceId };
    const resp = await fetch('/api/workspaces/current', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) return null;
    return normalizeWorkspacesResponse((await resp.json()) as WorkspacesResponse);
  } catch {
    return null;
  }
}

export async function createWorkspace(name: string): Promise<Workspace | null> {
  const result = await createWorkspaceResult(name);
  return result.ok ? result.value : null;
}

export async function createWorkspaceResult(name: string): Promise<WorkspaceOperationResult<Workspace>> {
  try {
    const body: CreateWorkspaceRequest = { name };
    const resp = await fetch('/api/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) return { ok: false, error: await readApiError(resp, 'Could not create workspace.') };
    const json = (await resp.json()) as CreateWorkspaceResponse;
    return { ok: true, value: json.workspace };
  } catch {
    return networkError('Could not create workspace.');
  }
}

export async function updateWorkspaceName(workspaceId: string, name: string): Promise<Workspace | null> {
  const result = await updateWorkspaceNameResult(workspaceId, name);
  return result.ok ? result.value : null;
}

export async function updateWorkspaceNameResult(workspaceId: string, name: string): Promise<WorkspaceOperationResult<Workspace>> {
  try {
    const body: UpdateWorkspaceRequest = { name };
    const resp = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) return { ok: false, error: await readApiError(resp, 'Could not rename workspace.') };
    const json = (await resp.json()) as WorkspaceResponse;
    return json.workspace
      ? { ok: true, value: json.workspace }
      : { ok: false, error: 'Could not rename workspace.' };
  } catch {
    return networkError('Could not rename workspace.');
  }
}

export async function leaveWorkspace(workspaceId: string): Promise<boolean> {
  const result = await leaveWorkspaceResult(workspaceId);
  return result.ok;
}

export async function leaveWorkspaceResult(workspaceId: string): Promise<WorkspaceOperationResult> {
  try {
    const resp = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/membership`, {
      method: 'DELETE',
    });
    if (!resp.ok) return { ok: false, error: await readApiError(resp, 'Could not leave workspace.') };
    await resp.json() as LeaveWorkspaceResponse;
    return { ok: true, value: true };
  } catch {
    return networkError('Could not leave workspace.');
  }
}

export async function deleteWorkspace(workspaceId: string): Promise<boolean> {
  const result = await deleteWorkspaceResult(workspaceId);
  return result.ok;
}

export async function deleteWorkspaceResult(workspaceId: string): Promise<WorkspaceOperationResult> {
  try {
    const resp = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}`, {
      method: 'DELETE',
    });
    if (!resp.ok) return { ok: false, error: await readApiError(resp, 'Could not delete workspace.') };
    await resp.json() as DeleteWorkspaceResponse;
    return { ok: true, value: true };
  } catch {
    return networkError('Could not delete workspace.');
  }
}

export async function listWorkspaceMembers(workspaceId: string): Promise<WorkspaceMembership[]> {
  const result = await listWorkspaceMembersResult(workspaceId);
  return result.ok ? result.value : [];
}

export async function listWorkspaceMembersResult(workspaceId: string): Promise<WorkspaceOperationResult<WorkspaceMembership[]>> {
  try {
    const resp = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/members`);
    if (!resp.ok) return { ok: false, error: await readApiError(resp, 'Could not load workspace members.') };
    const json = (await resp.json()) as WorkspaceMembersResponse;
    return { ok: true, value: json.members ?? [] };
  } catch {
    return networkError('Could not load workspace members.');
  }
}

export async function listWorkspaceInvites(workspaceId: string): Promise<WorkspaceInviteWithStatus[]> {
  const result = await listWorkspaceInvitesResult(workspaceId);
  return result.ok ? result.value : [];
}

export async function listWorkspaceInvitesResult(workspaceId: string): Promise<WorkspaceOperationResult<WorkspaceInviteWithStatus[]>> {
  try {
    const resp = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/invites`);
    if (!resp.ok) return { ok: false, error: await readApiError(resp, 'Could not load workspace invites.') };
    const json = (await resp.json()) as WorkspaceInvitesResponse;
    const invites = (json.invites ?? []).map((invite) => ({
      ...normalizeWorkspaceInvite(invite),
      status: invite.status ?? (invite.revokedAt != null
        ? 'revoked'
        : invite.acceptedAt != null
          ? 'accepted'
          : invite.expiresAt != null && invite.expiresAt <= Date.now() ? 'expired' : 'pending'),
    }));
    return { ok: true, value: invites };
  } catch {
    return networkError('Could not load workspace invites.');
  }
}

export async function listWorkspaceShares(workspaceId: string): Promise<ResourceShare[]> {
  const result = await listWorkspaceSharesResult(workspaceId);
  return result.ok ? result.value : [];
}

export async function listWorkspaceSharesResult(workspaceId: string): Promise<WorkspaceOperationResult<ResourceShare[]>> {
  try {
    const resp = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/shares`);
    if (!resp.ok) return { ok: false, error: await readApiError(resp, 'Could not load viewer links.') };
    const json = (await resp.json()) as WorkspaceResourceSharesResponse;
    return { ok: true, value: (json.shares ?? []).map(normalizeResourceShare) };
  } catch {
    return networkError('Could not load viewer links.');
  }
}

export async function listWorkspaceActivity(workspaceId: string): Promise<WorkspaceActivity[]> {
  const result = await listWorkspaceActivityResult(workspaceId);
  return result.ok ? result.value : [];
}

export async function listWorkspaceActivityResult(workspaceId: string): Promise<WorkspaceOperationResult<WorkspaceActivity[]>> {
  try {
    const resp = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/activity`);
    if (!resp.ok) return { ok: false, error: await readApiError(resp, 'Could not load workspace activity.') };
    const json = (await resp.json()) as WorkspaceActivityResponse;
    return { ok: true, value: json.activities ?? [] };
  } catch {
    return networkError('Could not load workspace activity.');
  }
}

export async function listWorkspaceRoutinesResult(workspaceId: string): Promise<WorkspaceOperationResult<Routine[]>> {
  try {
    const resp = await fetch(`/api/routines?workspaceId=${encodeURIComponent(workspaceId)}`);
    if (!resp.ok) return { ok: false, error: await readApiError(resp, 'Could not load workspace automations.') };
    const json = (await resp.json()) as { routines: Routine[] };
    return { ok: true, value: json.routines ?? [] };
  } catch {
    return networkError('Could not load workspace automations.');
  }
}

export async function createWorkspaceInvite(
  workspaceId: string,
  options: CreateWorkspaceInviteRequest = {},
): Promise<WorkspaceInviteWithStatus | null> {
  const result = await createWorkspaceInviteResult(workspaceId, options);
  return result.ok ? result.value : null;
}

export async function createWorkspaceInviteResult(
  workspaceId: string,
  options: CreateWorkspaceInviteRequest = {},
): Promise<WorkspaceOperationResult<WorkspaceInviteWithStatus>> {
  try {
    const role = options.role ?? 'member';
    const body: CreateWorkspaceInviteRequest = {
      role,
      ...(typeof options.expiresInDays === 'number'
        ? { expiresInDays: options.expiresInDays }
        : {}),
    };
    const resp = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/invites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) return { ok: false, error: await readApiError(resp, 'Could not create invite link.') };
    const json = (await resp.json()) as WorkspaceInviteResponse;
    return json.invite
      ? {
          ok: true,
          value: {
            ...normalizeWorkspaceInvite(json.invite),
            status: json.invite.status ?? 'pending',
          },
        }
      : { ok: false, error: 'Could not create invite link.' };
  } catch {
    return networkError('Could not create invite link.');
  }
}

export async function updateWorkspaceMemberRole(
  workspaceId: string,
  userId: string,
  role: 'admin' | 'member',
): Promise<WorkspaceMembership | null> {
  const result = await updateWorkspaceMemberRoleResult(workspaceId, userId, role);
  return result.ok ? result.value : null;
}

export async function updateWorkspaceMemberRoleResult(
  workspaceId: string,
  userId: string,
  role: 'admin' | 'member',
): Promise<WorkspaceOperationResult<WorkspaceMembership>> {
  try {
    const body: UpdateWorkspaceMemberRequest = { role };
    const resp = await fetch(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(userId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    if (!resp.ok) return { ok: false, error: await readApiError(resp, 'Could not update member role.') };
    const json = (await resp.json()) as WorkspaceMemberResponse;
    return json.member
      ? { ok: true, value: json.member }
      : { ok: false, error: 'Could not update member role.' };
  } catch {
    return networkError('Could not update member role.');
  }
}

export async function transferWorkspaceOwner(
  workspaceId: string,
  userId: string,
): Promise<TransferWorkspaceOwnerResponse | null> {
  const result = await transferWorkspaceOwnerResult(workspaceId, userId);
  return result.ok ? result.value : null;
}

export async function transferWorkspaceOwnerResult(
  workspaceId: string,
  userId: string,
): Promise<WorkspaceOperationResult<TransferWorkspaceOwnerResponse>> {
  try {
    const body: TransferWorkspaceOwnerRequest = { userId };
    const resp = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/owner`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) return { ok: false, error: await readApiError(resp, 'Could not transfer ownership.') };
    return { ok: true, value: (await resp.json()) as TransferWorkspaceOwnerResponse };
  } catch {
    return networkError('Could not transfer ownership.');
  }
}

export async function removeWorkspaceMember(
  workspaceId: string,
  userId: string,
  options?: { transferToUserId?: string },
): Promise<boolean> {
  const result = await removeWorkspaceMemberResult(workspaceId, userId, options);
  return result.ok;
}

export async function removeWorkspaceMemberResult(
  workspaceId: string,
  userId: string,
  options?: { transferToUserId?: string },
): Promise<WorkspaceOperationResult> {
  try {
    const transferToUserId = options?.transferToUserId?.trim();
    const requestBody: RemoveWorkspaceMemberRequest | undefined = transferToUserId
      ? { transferToUserId }
      : undefined;
    const resp = await fetch(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(userId)}`,
      requestBody
        ? {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
          }
        : { method: 'DELETE' },
    );
    if (!resp.ok) return { ok: false, error: await readApiError(resp, 'Could not remove member.') };
    await resp.json() as RemoveWorkspaceMemberResponse;
    return { ok: true, value: true };
  } catch {
    return networkError('Could not remove member.');
  }
}

export async function deleteWorkspaceInvite(workspaceId: string, inviteId: string): Promise<boolean> {
  const result = await deleteWorkspaceInviteResult(workspaceId, inviteId);
  return result.ok;
}

export async function deleteWorkspaceInviteResult(workspaceId: string, inviteId: string): Promise<WorkspaceOperationResult> {
  try {
    const resp = await fetch(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/invites/${encodeURIComponent(inviteId)}`,
      { method: 'DELETE' },
    );
    if (!resp.ok) return { ok: false, error: await readApiError(resp, 'Could not revoke invite.') };
    await resp.json() as DeleteWorkspaceInviteResponse;
    return { ok: true, value: true };
  } catch {
    return networkError('Could not revoke invite.');
  }
}

export async function revokeWorkspaceShare(workspaceId: string, shareId: string): Promise<boolean> {
  const result = await revokeWorkspaceShareResult(workspaceId, shareId);
  return result.ok;
}

export async function revokeWorkspaceShareResult(workspaceId: string, shareId: string): Promise<WorkspaceOperationResult> {
  try {
    const resp = await fetch(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/shares/${encodeURIComponent(shareId)}`,
      { method: 'DELETE' },
    );
    if (!resp.ok) return { ok: false, error: await readApiError(resp, 'Could not revoke viewer link.') };
    await resp.json() as RevokeWorkspaceShareResponse;
    return { ok: true, value: true };
  } catch {
    return networkError('Could not revoke viewer link.');
  }
}

export async function acceptWorkspaceInvite(token: string): Promise<AcceptWorkspaceInviteResponse | null> {
  const result = await acceptWorkspaceInviteResult(token);
  return result.ok ? result.value : null;
}

export async function acceptWorkspaceInviteResult(token: string): Promise<WorkspaceOperationResult<AcceptWorkspaceInviteResponse>> {
  try {
    const resp = await fetch(`/api/workspace-invites/${encodeURIComponent(token)}/accept`, {
      method: 'POST',
    });
    if (!resp.ok) return { ok: false, error: await readApiError(resp, 'Invite link not found.') };
    return { ok: true, value: (await resp.json()) as AcceptWorkspaceInviteResponse };
  } catch {
    return networkError('Invite link not found.');
  }
}

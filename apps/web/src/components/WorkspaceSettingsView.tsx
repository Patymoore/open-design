import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Workspace,
  WorkspaceActivity,
  WorkspaceInviteWithStatus,
  WorkspaceMembership,
  ResourceShare,
  Routine,
} from '@open-design/contracts';
import type { Project } from '../types';
import { patchProjectResult } from '../state/projects';
import {
  createWorkspaceResult,
  deleteWorkspaceInviteResult,
  deleteWorkspaceResult,
  leaveWorkspaceResult,
  listWorkspaceInvitesResult,
  listWorkspaceActivityResult,
  listWorkspaceMembersResult,
  listWorkspaceSharesResult,
  listWorkspaceRoutinesResult,
  removeWorkspaceMemberResult,
  revokeWorkspaceShareResult,
  transferWorkspaceOwnerResult,
  updateWorkspaceNameResult,
  updateWorkspaceMemberRoleResult,
  type WorkspaceOperationResult,
} from '../state/workspaces';
import { Icon } from './Icon';

function isWorkspaceManagerRole(role: Workspace['currentUserRole']) {
  return role === 'owner' || role === 'admin';
}

interface Props {
  workspaces: Workspace[];
  currentWorkspaceId: string;
  currentUserId: string | null;
  projects: Project[];
  onWorkspaceChange: (workspaceId: string) => Promise<void> | void;
  onWorkspaceCreated: (workspace: Workspace) => Promise<void> | void;
  onWorkspaceRemoved: (workspaceId: string) => Promise<void> | void;
  onWorkspaceUpdated: (workspace: Workspace) => Promise<void> | void;
  onProjectsChanged: () => Promise<void> | void;
  onCreateWorkspaceInvite: (
    workspaceId: string,
    options?: { role?: 'admin' | 'member'; expiresInDays?: number },
  ) => Promise<WorkspaceOperationResult<WorkspaceInviteWithStatus>>;
}

function roleLabel(role: WorkspaceMembership['role']) {
  if (role === 'owner') return 'Owner';
  if (role === 'admin') return 'Admin';
  return 'Member';
}

function accessLabel(role: WorkspaceMembership['role'] | undefined) {
  return role ? roleLabel(role) : 'Loading access';
}

function capabilitySummary(role: WorkspaceMembership['role'] | undefined, isTeamWorkspace: boolean) {
  if (!isTeamWorkspace) return 'Personal workspace: create projects and start a team workspace when you need collaboration.';
  if (role === 'owner') return 'Owner: manage members, invites, viewer links, project moves, lifecycle, and ownership.';
  if (role === 'admin') return 'Admin: manage members, invites, viewer links, and project moves.';
  if (role === 'member') return 'Member: create and open workspace projects. Ask an admin for invites, viewer links, or management changes.';
  return 'You do not have access to manage this workspace.';
}

function managerOnlyHint(canManage: boolean) {
  return canManage ? null : <p className="workspace-settings__hint">Admin or owner access required.</p>;
}

function ownerOnlyHint(isOwner: boolean) {
  return isOwner ? null : <p className="workspace-settings__hint">Owner access required.</p>;
}

function viewerLinksHint(canManage: boolean) {
  return canManage
    ? null
    : <p className="workspace-settings__hint">Admin or owner access required to view, copy, or revoke external viewer links.</p>;
}

function activityLabel(activity: WorkspaceActivity) {
  const metadata = activity.metadata ?? {};
  const target = activity.targetId ? ` ${activity.targetId}` : '';
  const cleanup = activityCleanupLabel(metadata);
  if (activity.action === 'workspace.created') return 'Created workspace';
  if (activity.action === 'workspace.renamed') return `Renamed workspace to ${String(metadata.to ?? 'new name')}`;
  if (activity.action === 'member.left') return `Left workspace${cleanup}`;
  if (activity.action === 'member.removed') return `Removed member${target}${cleanup}`;
  if (activity.action === 'member.role_updated') return `Changed member role to ${String(metadata.to ?? 'member')}${cleanup}`;
  if (activity.action === 'owner.transferred') return `Transferred owner to ${String(metadata.ownerUserId ?? activity.targetId ?? 'member')}`;
  if (activity.action === 'invite.created') return `Created ${String(metadata.role ?? 'member')} invite`;
  if (activity.action === 'invite.revoked') {
    const role = metadata.role ? `${String(metadata.role)} ` : '';
    return `Revoked ${role}invite`;
  }
  if (activity.action === 'invite.accepted') return `Accepted invite as ${String(metadata.role ?? 'member')}`;
  if (activity.action === 'project.created') {
    const projectName = String(metadata.projectName ?? activity.targetId ?? 'project');
    const source = metadata.source ? ` from ${String(metadata.source)}` : '';
    return `Created ${projectName}${source}`;
  }
  if (activity.action === 'project.deleted') {
    const projectName = String(metadata.projectName ?? activity.targetId ?? 'project');
    return `Deleted ${projectName}`;
  }
  if (activity.action === 'project.imported') {
    const projectName = String(metadata.projectName ?? activity.targetId ?? 'project');
    const source = metadata.source ? ` from ${String(metadata.source)}` : '';
    return `Imported ${projectName}${source}`;
  }
  if (activity.action === 'project.moved') {
    const projectName = String(metadata.projectName ?? 'project');
    const movedDeploymentCount = Number(metadata.movedDeploymentCount);
    const movedShareCount = Number(metadata.movedShareCount);
    const movedResources = [];
    if (Number.isFinite(movedDeploymentCount) && movedDeploymentCount > 0) {
      movedResources.push(`${movedDeploymentCount} deployment${movedDeploymentCount === 1 ? '' : 's'}`);
    }
    if (Number.isFinite(movedShareCount) && movedShareCount > 0) {
      movedResources.push(`${movedShareCount} viewer link${movedShareCount === 1 ? '' : 's'}`);
    }
    return `Moved ${projectName}${movedResources.length > 0 ? ` with ${movedResources.join(', ')}` : ''}`;
  }
  if (activity.action === 'project.owner_transferred') {
    const projectName = String(metadata.projectName ?? activity.targetId ?? 'project');
    return `Transferred ${projectName} owner to ${String(metadata.toUserId ?? 'member')}`;
  }
  if (activity.action === 'routine.created') return `Created routine ${String(metadata.routineName ?? activity.targetId ?? '')}`.trim();
  if (activity.action === 'routine.updated') return `Updated routine ${String(metadata.routineName ?? activity.targetId ?? '')}`.trim();
  if (activity.action === 'routine.deleted') return `Deleted routine ${String(metadata.routineName ?? activity.targetId ?? '')}`.trim();
  if (activity.action === 'routine.owner_transferred') return `Transferred routine ${String(metadata.routineName ?? activity.targetId ?? '')} owner to ${String(metadata.toUserId ?? 'member')}`.trim();
  if (activity.action === 'routine.run_requested') return `Ran routine ${String(metadata.routineName ?? activity.targetId ?? '')}`.trim();
  if (activity.action === 'share.created') {
    return `Created viewer link for ${String(metadata.projectName ?? metadata.projectId ?? 'project')}`;
  }
  if (activity.action === 'share.revoked') {
    if (metadata.reason === 'project_deleted') {
      return `Revoked viewer link because ${String(metadata.projectName ?? metadata.projectId ?? 'project')} was deleted`;
    }
    if (metadata.reason === 'artifact_deleted') {
      return `Revoked viewer link because ${String(metadata.artifactId ?? 'artifact')} was deleted`;
    }
    return `Revoked viewer link for ${String(metadata.projectName ?? metadata.projectId ?? 'project')}`;
  }
  return activity.action;
}

function activityCleanupLabel(metadata: Record<string, unknown>) {
  const revokedInviteCount = Number(metadata.revokedInviteCount);
  const revokedShareCount = Number(metadata.revokedShareCount);
  const ownedRoutineCount = Number(metadata.ownedRoutineCount);
  const ownedProjectCount = Number(metadata.ownedProjectCount);
  const transferredRoutineCount = Number(metadata.transferredRoutineCount);
  const transferredProjectCount = Number(metadata.transferredProjectCount);
  const transferToUserId = typeof metadata.transferToUserId === 'string' ? metadata.transferToUserId : '';
  const parts = [];
  const revokedParts = [];
  const transferredParts = [];
  if (Number.isFinite(revokedInviteCount) && revokedInviteCount > 0) {
    revokedParts.push(`${revokedInviteCount} invite${revokedInviteCount === 1 ? '' : 's'}`);
  }
  if (Number.isFinite(revokedShareCount) && revokedShareCount > 0) {
    revokedParts.push(`${revokedShareCount} viewer link${revokedShareCount === 1 ? '' : 's'}`);
  }
  if (revokedParts.length > 0) {
    parts.push(`revoked ${revokedParts.join(', ')}`);
  }
  if (Number.isFinite(transferredProjectCount) && transferredProjectCount > 0) {
    transferredParts.push(`${transferredProjectCount} project${transferredProjectCount === 1 ? '' : 's'}`);
  }
  if (Number.isFinite(transferredRoutineCount) && transferredRoutineCount > 0) {
    transferredParts.push(`${transferredRoutineCount} routine${transferredRoutineCount === 1 ? '' : 's'}`);
  }
  if (transferredParts.length > 0) {
    parts.push(`transferred ${transferredParts.join(', ')}${transferToUserId ? ` to ${transferToUserId}` : ''}`);
  }
  if (transferredParts.length === 0 && Number.isFinite(ownedRoutineCount) && ownedRoutineCount > 0) {
    parts.push(`${ownedRoutineCount} routine${ownedRoutineCount === 1 ? '' : 's'} still owned`);
  }
  if (transferredParts.length === 0 && Number.isFinite(ownedProjectCount) && ownedProjectCount > 0) {
    parts.push(`${ownedProjectCount} project${ownedProjectCount === 1 ? '' : 's'} still owned`);
  }
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

function activityTimeLabel(createdAt: number) {
  if (!Number.isFinite(createdAt)) return '';
  return new Date(createdAt).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function activityActorLabel(activity: WorkspaceActivity, currentUserId: string | null) {
  return activity.actorUserId === currentUserId ? 'You' : activity.actorUserId;
}

function inviteMetaLabel(invite: WorkspaceInviteWithStatus) {
  const parts = [`${invite.role} · ${invite.status}`];
  parts.push(`created by ${invite.createdByUserId}`);
  parts.push(`created ${activityTimeLabel(invite.createdAt)}`);
  if (invite.expiresAt != null && invite.status !== 'revoked') {
    parts.push(`expires ${activityTimeLabel(invite.expiresAt)}`);
  }
  if (invite.revokedAt != null) {
    parts.push(`revoked ${activityTimeLabel(invite.revokedAt)}`);
  }
  if (invite.acceptedByUserId) {
    parts.push(`accepted by ${invite.acceptedByUserId}`);
  }
  return parts.filter(Boolean).join(' · ');
}

function shareMetaLabel(share: ResourceShare) {
  const parts = [`${share.projectName ?? share.projectId} · viewer`];
  if (share.artifactId) {
    parts.push(share.artifactId);
  }
  parts.push(`created by ${share.createdByUserId}`);
  parts.push(`created ${activityTimeLabel(share.createdAt)}`);
  if (share.revokedAt != null) {
    parts.push(`revoked ${activityTimeLabel(share.revokedAt)}`);
  }
  return parts.filter(Boolean).join(' · ');
}

function inviteTitle(invite: WorkspaceInviteWithStatus) {
  if (invite.status === 'pending') return invite.inviteUrl ?? 'Invite link';
  if (invite.status === 'accepted') return 'Invite accepted';
  if (invite.status === 'revoked') return 'Invite revoked';
  if (invite.status === 'expired') return 'Invite expired';
  return 'Invite link';
}

function memberTitle(member: WorkspaceMembership, currentUserId: string | null) {
  return member.userId === currentUserId ? 'You' : member.userId;
}

function memberSubtitle(member: WorkspaceMembership, currentUserId: string | null) {
  const parts = [member.userId === currentUserId ? member.userId : roleLabel(member.role)];
  const ownedProjectCount = Number(member.ownedProjectCount);
  const ownedRoutineCount = Number(member.ownedRoutineCount);
  const assetParts = [];
  if (Number.isFinite(ownedProjectCount) && ownedProjectCount > 0) {
    assetParts.push(`${ownedProjectCount} project${ownedProjectCount === 1 ? '' : 's'}`);
  }
  if (Number.isFinite(ownedRoutineCount) && ownedRoutineCount > 0) {
    assetParts.push(`${ownedRoutineCount} routine${ownedRoutineCount === 1 ? '' : 's'}`);
  }
  if (assetParts.length > 0) {
    parts.push(`owns ${assetParts.join(', ')}`);
  }
  if (member.joinedAt) {
    parts.push(`joined ${activityTimeLabel(member.joinedAt)}`);
  }
  return parts.join(' · ');
}

function memberInitial(member: WorkspaceMembership, currentUserId: string | null) {
  if (member.userId === currentUserId) return 'Y';
  return (member.userId.trim()[0] ?? '?').toUpperCase();
}

function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function joinImpactParts(parts: string[]) {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function leaveWorkspaceImpactLabel(member: WorkspaceMembership | undefined, ownerUserId: string | undefined) {
  const ownedProjectCount = Number(member?.ownedProjectCount);
  const ownedRoutineCount = Number(member?.ownedRoutineCount);
  const parts = [];
  if (Number.isFinite(ownedProjectCount) && ownedProjectCount > 0) {
    parts.push(countLabel(ownedProjectCount, 'project'));
  }
  if (Number.isFinite(ownedRoutineCount) && ownedRoutineCount > 0) {
    parts.push(countLabel(ownedRoutineCount, 'routine'));
  }
  if (parts.length === 0) return 'You will lose access until someone invites you again.';
  const recipient = ownerUserId ? ` to ${ownerUserId}` : '';
  return `You will lose access, and your ${joinImpactParts(parts)} will transfer${recipient}. Pending invites and viewer links you created will be revoked.`;
}

function removeMemberImpactLabel(member: WorkspaceMembership, transferToUserId: string) {
  const ownedProjectCount = Number(member.ownedProjectCount);
  const ownedRoutineCount = Number(member.ownedRoutineCount);
  const parts = [];
  if (Number.isFinite(ownedProjectCount) && ownedProjectCount > 0) {
    parts.push(countLabel(ownedProjectCount, 'project'));
  }
  if (Number.isFinite(ownedRoutineCount) && ownedRoutineCount > 0) {
    parts.push(countLabel(ownedRoutineCount, 'routine'));
  }
  const accessLoss = 'They will lose access.';
  const cleanup = 'Pending invites and viewer links they created will be revoked.';
  if (parts.length === 0) return `${accessLoss} ${cleanup}`;
  return `${accessLoss} Their ${joinImpactParts(parts)} will transfer to ${transferToUserId}. ${cleanup}`;
}

function memberRoleChangeImpactLabel(member: WorkspaceMembership, role: 'admin' | 'member') {
  if (role === 'admin') {
    return `${member.userId} will be able to manage members, invites, viewer links, and project ownership in this workspace.`;
  }
  return `${member.userId} will lose workspace management access. Pending invites and viewer links they created will be revoked.`;
}

function adminInviteImpactLabel(workspaceName: string, expiresInDays: number) {
  const expiry = Number.isFinite(expiresInDays) && expiresInDays > 0
    ? ` for ${expiresInDays} day${expiresInDays === 1 ? '' : 's'}`
    : '';
  return `Anyone with this link can join ${workspaceName} as an admin${expiry}. They will be able to manage members, invites, viewer links, project moves, and project ownership.`;
}

function transferWorkspaceOwnerImpactLabel(workspaceName: string, ownerUserId: string) {
  return `${ownerUserId} will become the only owner of ${workspaceName}. You will become an admin and lose owner-only actions like deleting the workspace or transferring ownership again.`;
}

function moveProjectImpactLabel(projectName: string, targetWorkspaceName: string) {
  return `${projectName} will move to ${targetWorkspaceName}. Existing deployments and viewer links stay attached to the project and move with it.`;
}

function transferProjectOwnerImpactLabel(projectName: string, ownerUserId: string) {
  return `${projectName} will stay in this workspace, but ${ownerUserId} will become responsible for it.`;
}

function revokeInviteImpactLabel(invite: WorkspaceInviteWithStatus) {
  return `This ${invite.role} invite link will stop letting new people join. Existing workspace members are not affected.`;
}

function revokeViewerLinkImpactLabel(share: ResourceShare) {
  const target = share.projectName ?? share.projectId;
  const artifact = share.artifactId ? ` for ${share.artifactId}` : '';
  return `External viewers will lose access to ${target}${artifact}. The artifact itself stays in the workspace.`;
}

function deleteWorkspaceImpactLabel(input: { memberCount: number; pendingInviteCount: number; shareCount: number }) {
  const parts = [];
  if (input.memberCount > 0) parts.push(countLabel(input.memberCount, 'member record'));
  if (input.pendingInviteCount > 0) parts.push(countLabel(input.pendingInviteCount, 'pending invite'));
  if (input.shareCount > 0) parts.push(countLabel(input.shareCount, 'viewer link'));
  parts.push('activity history');
  return `Deleting this workspace removes ${joinImpactParts(parts)}. It can only proceed after projects and automations are gone.`;
}

async function copyText(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function WorkspaceSettingsView({
  workspaces,
  currentWorkspaceId,
  currentUserId,
  projects,
  onWorkspaceChange,
  onWorkspaceCreated,
  onWorkspaceRemoved,
  onWorkspaceUpdated,
  onProjectsChanged,
  onCreateWorkspaceInvite,
}: Props) {
  const [members, setMembers] = useState<WorkspaceMembership[]>([]);
  const [invites, setInvites] = useState<WorkspaceInviteWithStatus[]>([]);
  const [shares, setShares] = useState<ResourceShare[]>([]);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [activities, setActivities] = useState<WorkspaceActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [workspaceName, setWorkspaceName] = useState('');
  const [renamingWorkspaceId, setRenamingWorkspaceId] = useState<string | null>(null);
  const [leavingWorkspaceId, setLeavingWorkspaceId] = useState<string | null>(null);
  const [deletingWorkspaceId, setDeletingWorkspaceId] = useState<string | null>(null);
  const [inviteRole, setInviteRole] = useState<'member' | 'admin'>('member');
  const [inviteExpiresInDays, setInviteExpiresInDays] = useState(7);
  const [creatingInviteWorkspaceId, setCreatingInviteWorkspaceId] = useState<string | null>(null);
  const [showInviteHistory, setShowInviteHistory] = useState(false);
  const [ownerTargetUserId, setOwnerTargetUserId] = useState('');
  const [transferringOwnerWorkspaceId, setTransferringOwnerWorkspaceId] = useState<string | null>(null);
  const [updatingMemberIds, setUpdatingMemberIds] = useState<Set<string>>(() => new Set());
  const [removingMemberIds, setRemovingMemberIds] = useState<Set<string>>(() => new Set());
  const [memberAssetTransferTargets, setMemberAssetTransferTargets] = useState<Record<string, string>>({});
  const [revokingInviteIds, setRevokingInviteIds] = useState<Set<string>>(() => new Set());
  const [revokingShareIds, setRevokingShareIds] = useState<Set<string>>(() => new Set());
  const [projectMoveTargets, setProjectMoveTargets] = useState<Record<string, string>>({});
  const [movingProjectIds, setMovingProjectIds] = useState<Set<string>>(() => new Set());
  const [projectOwnerTargets, setProjectOwnerTargets] = useState<Record<string, string>>({});
  const [transferringProjectOwnerIds, setTransferringProjectOwnerIds] = useState<Set<string>>(() => new Set());
  const currentWorkspaceIdRef = useRef(currentWorkspaceId);
  currentWorkspaceIdRef.current = currentWorkspaceId;
  const refreshSerialRef = useRef(0);
  const renamingWorkspace = renamingWorkspaceId === currentWorkspaceId;
  const leavingWorkspace = leavingWorkspaceId === currentWorkspaceId;
  const deletingWorkspace = deletingWorkspaceId === currentWorkspaceId;
  const creatingInvite = creatingInviteWorkspaceId === currentWorkspaceId;
  const transferringOwner = transferringOwnerWorkspaceId === currentWorkspaceId;
  const currentWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === currentWorkspaceId) ?? workspaces[0] ?? null,
    [currentWorkspaceId, workspaces],
  );
  const currentMembership = members.find((member) => member.userId === currentUserId);
  const currentWorkspaceRole = currentWorkspace?.currentUserRole ?? currentMembership?.role;
  const canManage = currentWorkspaceRole === 'owner' || currentWorkspaceRole === 'admin';
  const isOwner = currentWorkspaceRole === 'owner';
  const isTeamWorkspace = currentWorkspace?.kind === 'team';
  const pendingInviteCount = invites.filter((invite) => invite.status === 'pending').length;
  const inactiveInviteCount = invites.length - pendingInviteCount;
  const visibleInvites = showInviteHistory ? invites : invites.filter((invite) => invite.status === 'pending');
  const ownerMember = members.find((member) => member.role === 'owner');
  const transferableMembers = members.filter((member) => member.role !== 'owner');
  const canDeleteWorkspace = Boolean(isTeamWorkspace && isOwner && projects.length === 0 && routines.length === 0);
  const deleteWorkspaceImpact = deleteWorkspaceImpactLabel({
    memberCount: members.length,
    pendingInviteCount,
    shareCount: shares.length,
  });
  const statusItems = [
    { label: 'Members', value: String(members.length) },
    { label: 'Projects', value: String(projects.length) },
    { label: 'Automations', value: String(routines.length) },
    { label: 'Pending invites', value: String(pendingInviteCount) },
    { label: 'Viewer links', value: String(shares.length) },
  ];

  const refreshWorkspaceDetails = useCallback(async (workspaceId = currentWorkspaceId) => {
    if (workspaceId !== currentWorkspaceIdRef.current) return;
    const refreshSerial = refreshSerialRef.current + 1;
    refreshSerialRef.current = refreshSerial;
    setLoading(true);
    setLoadError(null);
    setMembers([]);
    setInvites([]);
    setShares([]);
    setRoutines([]);
    setActivities([]);
    const [membersResult, activitiesResult, routinesResult] = await Promise.all([
      listWorkspaceMembersResult(workspaceId),
      listWorkspaceActivityResult(workspaceId),
      listWorkspaceRoutinesResult(workspaceId),
    ]);
    if (workspaceId !== currentWorkspaceIdRef.current || refreshSerial !== refreshSerialRef.current) return;
    const detailError = [membersResult, activitiesResult, routinesResult].find((result) => !result.ok);
    if (detailError && !detailError.ok) {
      setLoadError(`Could not load workspace details. ${detailError.error}`);
      setLoading(false);
      return;
    }
    if (!membersResult.ok || !activitiesResult.ok || !routinesResult.ok) return;
    const nextMembers = membersResult.value;
    const nextActivities = activitiesResult.value;
    const nextRoutines = routinesResult.value;
    const workspace = workspaces.find((item) => item.id === workspaceId);
    const nextCurrentMembership = nextMembers.find((member) => member.userId === currentUserId);
    const nextCurrentRole = workspace?.currentUserRole ?? nextCurrentMembership?.role;
    const nextCanManage = isWorkspaceManagerRole(nextCurrentRole);
    let nextInvites: WorkspaceInviteWithStatus[] = [];
    let nextShares: ResourceShare[] = [];
    if (nextCanManage) {
      const sharesResult = await listWorkspaceSharesResult(workspaceId);
      if (workspaceId !== currentWorkspaceIdRef.current || refreshSerial !== refreshSerialRef.current) return;
      if (!sharesResult.ok) {
        setLoadError(`Could not load viewer links. ${sharesResult.error}`);
        setLoading(false);
        return;
      }
      nextShares = sharesResult.value;
    }
    if (workspace?.kind === 'team' && nextCanManage) {
      const invitesResult = await listWorkspaceInvitesResult(workspaceId);
      if (workspaceId !== currentWorkspaceIdRef.current || refreshSerial !== refreshSerialRef.current) return;
      if (!invitesResult.ok) {
        setLoadError(`Could not load workspace invites. ${invitesResult.error}`);
        setLoading(false);
        return;
      }
      nextInvites = invitesResult.value;
    }
    if (workspaceId !== currentWorkspaceIdRef.current || refreshSerial !== refreshSerialRef.current) return;
    setMembers(nextMembers);
    setInvites(nextInvites);
    setShares(nextShares);
    setRoutines(nextRoutines);
    setActivities(nextActivities);
    setLoading(false);
  }, [currentUserId, currentWorkspaceId, workspaces]);

  useEffect(() => {
    if (!currentWorkspaceId) return;
    void refreshWorkspaceDetails(currentWorkspaceId);
  }, [currentWorkspaceId, refreshWorkspaceDetails]);

  useEffect(() => {
    setNotice(null);
    setShowInviteHistory(false);
    setMemberAssetTransferTargets({});
    setProjectMoveTargets({});
    setProjectOwnerTargets({});
    setRevokingInviteIds(new Set());
    setRevokingShareIds(new Set());
    setUpdatingMemberIds(new Set());
    setRemovingMemberIds(new Set());
    setMovingProjectIds(new Set());
    setTransferringProjectOwnerIds(new Set());
  }, [currentWorkspaceId]);

  useEffect(() => {
    setWorkspaceName(currentWorkspace?.name ?? '');
  }, [currentWorkspace?.id, currentWorkspace?.name]);

  useEffect(() => {
    const firstTransferable = members.find((member) => member.role !== 'owner')?.userId ?? '';
    setOwnerTargetUserId(firstTransferable);
  }, [members]);

  async function handleCreateWorkspace() {
    if (creatingWorkspace) return;
    const name = newWorkspaceName.trim();
    if (!name) return;
    setCreatingWorkspace(true);
    try {
      const result = await createWorkspaceResult(name);
      if (!result.ok) {
        setNotice(result.error);
        return;
      }
      setNewWorkspaceName('');
      await onWorkspaceCreated(result.value);
      setNotice(`Created ${result.value.name}.`);
      await refreshWorkspaceDetails(result.value.id);
    } finally {
      setCreatingWorkspace(false);
    }
  }

  async function handleRenameWorkspace() {
    if (!currentWorkspace || renamingWorkspace) return;
    const name = workspaceName.trim();
    if (!name || name === currentWorkspace.name) return;
    const workspaceId = currentWorkspace.id;
    setRenamingWorkspaceId(workspaceId);
    try {
      const result = await updateWorkspaceNameResult(workspaceId, name);
      if (!result.ok) {
        if (currentWorkspaceIdRef.current === workspaceId) {
          setNotice(result.error);
        }
        return;
      }
      await onWorkspaceUpdated(result.value);
      if (currentWorkspaceIdRef.current !== workspaceId) return;
      setNotice('Workspace renamed.');
      await refreshWorkspaceDetails(result.value.id);
    } finally {
      setRenamingWorkspaceId((current) => (current === workspaceId ? null : current));
    }
  }

  async function handleLeaveWorkspace() {
    if (!currentWorkspace || leavingWorkspace) return;
    const workspace = currentWorkspace;
    const workspaceId = workspace.id;
    const impact = leaveWorkspaceImpactLabel(currentMembership, ownerMember?.userId);
    if (!window.confirm(`Leave ${workspace.name}? ${impact}`)) {
      return;
    }
    setLeavingWorkspaceId(workspaceId);
    try {
      const result = await leaveWorkspaceResult(workspaceId);
      if (!result.ok) {
        if (currentWorkspaceIdRef.current === workspaceId) {
          setNotice(result.error);
        }
        return;
      }
      await onWorkspaceRemoved(workspaceId);
      if (currentWorkspaceIdRef.current === workspaceId) {
        setNotice(`Left ${workspace.name}.`);
      }
    } finally {
      setLeavingWorkspaceId((current) => (current === workspaceId ? null : current));
    }
  }

  async function handleDeleteWorkspace() {
    if (!currentWorkspace || deletingWorkspace) return;
    const workspace = currentWorkspace;
    const workspaceId = workspace.id;
    if (!window.confirm(`Delete ${workspace.name}? ${deleteWorkspaceImpact}`)) {
      return;
    }
    setDeletingWorkspaceId(workspaceId);
    try {
      const result = await deleteWorkspaceResult(workspaceId);
      if (!result.ok) {
        if (currentWorkspaceIdRef.current === workspaceId) {
          setNotice(result.error);
        }
        return;
      }
      await onWorkspaceRemoved(workspaceId);
      if (currentWorkspaceIdRef.current === workspaceId) {
        setNotice(`Deleted ${workspace.name}.`);
      }
    } finally {
      setDeletingWorkspaceId((current) => (current === workspaceId ? null : current));
    }
  }

  async function handleInvite() {
    if (!currentWorkspace || creatingInvite) return;
    if (!isTeamWorkspace) {
      setNotice('Create or switch to a team workspace to invite members.');
      return;
    }
    const workspaceId = currentWorkspace.id;
    if (inviteRole === 'admin' && !window.confirm(`Create admin invite? ${adminInviteImpactLabel(currentWorkspace.name, inviteExpiresInDays)}`)) {
      return;
    }
    setCreatingInviteWorkspaceId(workspaceId);
    try {
      const result = await onCreateWorkspaceInvite(workspaceId, {
        role: inviteRole,
        expiresInDays: inviteExpiresInDays,
      });
      if (!result.ok) {
        if (currentWorkspaceIdRef.current === workspaceId) {
          setNotice(result.error);
        }
        return;
      }
      if (currentWorkspaceIdRef.current !== workspaceId) return;
      const invite = result.value;
      if (!invite.inviteUrl) {
        setNotice('Could not create invite link.');
        return;
      }
      const copied = await copyText(invite.inviteUrl);
      setNotice(copied ? 'Invite link copied.' : invite.inviteUrl);
      await refreshWorkspaceDetails(workspaceId);
    } finally {
      setCreatingInviteWorkspaceId((current) => (current === workspaceId ? null : current));
    }
  }

  async function handleRoleChange(member: WorkspaceMembership, role: 'admin' | 'member') {
    if (updatingMemberIds.has(member.userId)) return;
    if (role === member.role) return;
    const workspaceId = member.workspaceId;
    if (!window.confirm(`Change ${member.userId} to ${roleLabel(role)}? ${memberRoleChangeImpactLabel(member, role)}`)) {
      return;
    }
    setUpdatingMemberIds((current) => new Set(current).add(member.userId));
    try {
      const result = await updateWorkspaceMemberRoleResult(workspaceId, member.userId, role);
      if (currentWorkspaceIdRef.current !== workspaceId) return;
      if (!result.ok) {
        setNotice(result.error);
        return;
      }
      setMembers((current) => current.map((item) => (
        item.userId === member.userId ? result.value : item
      )));
      await refreshWorkspaceDetails(workspaceId);
    } finally {
      if (currentWorkspaceIdRef.current === workspaceId) {
        setUpdatingMemberIds((current) => {
          const next = new Set(current);
          next.delete(member.userId);
          return next;
        });
      }
    }
  }

  async function handleTransferOwner() {
    if (!currentWorkspace || !ownerTargetUserId || transferringOwner) return;
    if (!window.confirm(`Transfer ownership? ${transferWorkspaceOwnerImpactLabel(currentWorkspace.name, ownerTargetUserId)}`)) {
      return;
    }
    const workspace = currentWorkspace;
    const workspaceId = workspace.id;
    setTransferringOwnerWorkspaceId(workspaceId);
    try {
      const result = await transferWorkspaceOwnerResult(workspaceId, ownerTargetUserId);
      if (!result.ok) {
        if (currentWorkspaceIdRef.current === workspaceId) {
          setNotice(result.error);
        }
        return;
      }
      if (result.value.previousOwner.userId === currentUserId) {
        await onWorkspaceUpdated({
          ...workspace,
          currentUserRole: result.value.previousOwner.role,
        });
      } else if (result.value.owner.userId === currentUserId) {
        await onWorkspaceUpdated({
          ...workspace,
          currentUserRole: result.value.owner.role,
        });
      }
      if (currentWorkspaceIdRef.current !== workspaceId) return;
      setMembers((current) => current.map((member) => {
        if (member.userId === result.value.previousOwner.userId) return result.value.previousOwner;
        if (member.userId === result.value.owner.userId) return result.value.owner;
        return member;
      }));
      setNotice('Workspace ownership transferred.');
      await refreshWorkspaceDetails(workspaceId);
    } finally {
      setTransferringOwnerWorkspaceId((current) => (current === workspaceId ? null : current));
    }
  }

  async function handleRemoveMember(member: WorkspaceMembership) {
    if (removingMemberIds.has(member.userId)) return;
    const workspaceId = member.workspaceId;
    const transferToUserId = memberAssetTransferTargets[member.userId]
      ?? members.find((item) => item.userId !== member.userId && item.userId === currentUserId)?.userId
      ?? members.find((item) => item.userId !== member.userId && item.role === 'owner')?.userId
      ?? members.find((item) => item.userId !== member.userId)?.userId
      ?? '';
    if (!transferToUserId) {
      setNotice("Choose a workspace member to receive this member's projects and routines.");
      return;
    }
    const workspaceName = currentWorkspace?.name ?? 'this workspace';
    if (!window.confirm(`Remove ${member.userId} from ${workspaceName}? ${removeMemberImpactLabel(member, transferToUserId)}`)) {
      return;
    }
    setRemovingMemberIds((current) => new Set(current).add(member.userId));
    try {
      const result = await removeWorkspaceMemberResult(workspaceId, member.userId, { transferToUserId });
      if (currentWorkspaceIdRef.current !== workspaceId) return;
      if (!result.ok) {
        setNotice(result.error);
        return;
      }
      setMembers((current) => current.filter((item) => item.userId !== member.userId));
      await refreshWorkspaceDetails(workspaceId);
    } finally {
      if (currentWorkspaceIdRef.current === workspaceId) {
        setRemovingMemberIds((current) => {
          const next = new Set(current);
          next.delete(member.userId);
          return next;
        });
      }
    }
  }

  async function handleRevokeInvite(invite: WorkspaceInviteWithStatus) {
    if (revokingInviteIds.has(invite.id)) return;
    if (!window.confirm(`Revoke invite link? ${revokeInviteImpactLabel(invite)}`)) {
      return;
    }
    setRevokingInviteIds((current) => new Set(current).add(invite.id));
    try {
      const result = await deleteWorkspaceInviteResult(invite.workspaceId, invite.id);
      if (currentWorkspaceIdRef.current !== invite.workspaceId) return;
      if (!result.ok) {
        setNotice(result.error);
        return;
      }
      setInvites((current) => current.filter((item) => item.id !== invite.id));
      await refreshWorkspaceDetails(invite.workspaceId);
    } finally {
      setRevokingInviteIds((current) => {
        const next = new Set(current);
        next.delete(invite.id);
        return next;
      });
    }
  }

  async function handleCopyInvite(invite: WorkspaceInviteWithStatus) {
    if (invite.status !== 'pending') {
      setNotice('Only pending invite links can be copied.');
      return;
    }
    const workspaceId = currentWorkspaceId;
    const link = invite.inviteUrl ?? '';
    const copied = await copyText(link);
    if (currentWorkspaceIdRef.current !== workspaceId) return;
    setNotice(copied ? 'Invite link copied.' : link || 'No invite link available.');
  }

  async function handleRevokeShare(share: ResourceShare) {
    if (revokingShareIds.has(share.id)) return;
    const workspaceId = currentWorkspaceId;
    if (!window.confirm(`Revoke viewer link? ${revokeViewerLinkImpactLabel(share)}`)) {
      return;
    }
    setRevokingShareIds((current) => new Set(current).add(share.id));
    try {
      const result = await revokeWorkspaceShareResult(workspaceId, share.id);
      if (currentWorkspaceIdRef.current !== workspaceId) return;
      if (!result.ok) {
        setNotice(result.error);
        return;
      }
      setShares((current) => current.filter((item) => item.id !== share.id));
      setNotice('Viewer link revoked.');
      await refreshWorkspaceDetails(workspaceId);
    } finally {
      setRevokingShareIds((current) => {
        const next = new Set(current);
        next.delete(share.id);
        return next;
      });
    }
  }

  async function handleCopyShare(share: ResourceShare) {
    const workspaceId = currentWorkspaceId;
    const link = share.shareUrl ?? '';
    const copied = await copyText(link);
    if (currentWorkspaceIdRef.current !== workspaceId) return;
    setNotice(copied ? 'Viewer link copied.' : link || 'No viewer link available.');
  }

  async function handleMoveProject(project: Project) {
    if (movingProjectIds.has(project.id)) return;
    const workspaceId = currentWorkspaceId;
    const targetWorkspaceId = projectMoveTargets[project.id] ?? '';
    if (!targetWorkspaceId || targetWorkspaceId === project.workspaceId) return;
    const targetWorkspaceName = workspaces.find((workspace) => workspace.id === targetWorkspaceId)?.name ?? targetWorkspaceId;
    if (!window.confirm(`Move ${project.name}? ${moveProjectImpactLabel(project.name, targetWorkspaceName)}`)) {
      return;
    }
    setMovingProjectIds((current) => new Set(current).add(project.id));
    try {
      const result = await patchProjectResult(project.id, { workspaceId: targetWorkspaceId });
      if (!result.ok) {
        if (currentWorkspaceIdRef.current === workspaceId) {
          setNotice(result.error);
        }
        return;
      }
      await onProjectsChanged();
      if (currentWorkspaceIdRef.current !== workspaceId) return;
      setProjectMoveTargets((current) => {
        const next = { ...current };
        delete next[project.id];
        return next;
      });
      setNotice(`Moved ${project.name}.`);
      await refreshWorkspaceDetails(workspaceId);
    } finally {
      if (currentWorkspaceIdRef.current === workspaceId) {
        setMovingProjectIds((current) => {
          const next = new Set(current);
          next.delete(project.id);
          return next;
        });
      }
    }
  }

  async function handleTransferProjectOwner(project: Project) {
    if (transferringProjectOwnerIds.has(project.id)) return;
    const workspaceId = currentWorkspaceId;
    const ownedByUserId = projectOwnerTargets[project.id] ?? '';
    if (!ownedByUserId || ownedByUserId === project.ownedByUserId) return;
    if (!window.confirm(`Transfer ${project.name} owner? ${transferProjectOwnerImpactLabel(project.name, ownedByUserId)}`)) {
      return;
    }
    setTransferringProjectOwnerIds((current) => new Set(current).add(project.id));
    try {
      const result = await patchProjectResult(project.id, { ownedByUserId });
      if (!result.ok) {
        if (currentWorkspaceIdRef.current === workspaceId) {
          setNotice(result.error);
        }
        return;
      }
      await onProjectsChanged();
      if (currentWorkspaceIdRef.current !== workspaceId) return;
      setProjectOwnerTargets((current) => {
        const next = { ...current };
        delete next[project.id];
        return next;
      });
      setNotice(`Transferred ${project.name} owner.`);
      await refreshWorkspaceDetails(workspaceId);
    } finally {
      if (currentWorkspaceIdRef.current === workspaceId) {
        setTransferringProjectOwnerIds((current) => {
          const next = new Set(current);
          next.delete(project.id);
          return next;
        });
      }
    }
  }

  async function handleWorkspaceSelect(workspaceId: string) {
    if (workspaceId === currentWorkspaceId) return;
    setNotice(null);
    try {
      await onWorkspaceChange(workspaceId);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not switch workspace.');
    }
  }

  return (
    <div className="workspace-settings">
      <header className="workspace-settings__header">
        <div>
          <p className="workspace-settings__eyebrow">Workspace</p>
          <h1>{currentWorkspace?.name ?? 'Workspace'}</h1>
        </div>
        <select
          className="workspace-settings__select"
          value={currentWorkspaceId}
          onChange={(event) => void handleWorkspaceSelect(event.target.value)}
        >
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
          ))}
        </select>
      </header>

      <section className="workspace-settings__summary" aria-label="Workspace access">
        <span className="workspace-settings__pill">{accessLabel(currentWorkspaceRole)}</span>
        <p>{capabilitySummary(currentWorkspaceRole, Boolean(isTeamWorkspace))}</p>
      </section>

      {loadError ? (
        <section className="workspace-settings__load-error" aria-label="Workspace load status">
          <div>
            <strong>Workspace details unavailable</strong>
            <p>{loadError}</p>
          </div>
          <button type="button" onClick={() => void refreshWorkspaceDetails(currentWorkspaceId)}>
            <Icon name="refresh" size={13} />
            Retry
          </button>
        </section>
      ) : null}

      <section className="workspace-settings__status" aria-label="Workspace status">
        {statusItems.map((item) => (
          <div className="workspace-settings__status-item" key={item.label}>
            <strong>{item.value}</strong>
            <span>{item.label}</span>
          </div>
        ))}
        <div className="workspace-settings__status-item workspace-settings__status-item--wide">
          <strong>{ownerMember?.userId ?? 'No owner loaded'}</strong>
          <span>Owner</span>
        </div>
      </section>

      <section className="workspace-settings__section">
        <div>
          <h2>Workspace details</h2>
          <p>
            {isTeamWorkspace
              ? 'Rename the team workspace that projects and invites belong to.'
              : 'Your personal workspace stays available without account setup.'}
          </p>
          {!isTeamWorkspace ? (
            <p className="workspace-settings__hint">Personal workspace names stay fixed.</p>
          ) : managerOnlyHint(canManage)}
        </div>
        <div className="workspace-settings__inline-form">
          <input
            value={workspaceName}
            onChange={(event) => setWorkspaceName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void handleRenameWorkspace();
            }}
            placeholder="Workspace name"
            disabled={!canManage || !isTeamWorkspace}
          />
          <button
            type="button"
            onClick={() => void handleRenameWorkspace()}
            disabled={!canManage || !isTeamWorkspace || renamingWorkspace || workspaceName.trim() === currentWorkspace?.name}
          >
            <Icon name="check" size={13} />
            {renamingWorkspace ? 'Saving...' : 'Save'}
          </button>
        </div>
      </section>

      <section className="workspace-settings__section">
        <div>
          <h2>Create workspace</h2>
          <p>Start another team workspace without forcing account registration.</p>
        </div>
        <div className="workspace-settings__inline-form">
          <input
            value={newWorkspaceName}
            onChange={(event) => setNewWorkspaceName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void handleCreateWorkspace();
            }}
            placeholder="Workspace name"
          />
          <button
            type="button"
            onClick={() => void handleCreateWorkspace()}
            disabled={creatingWorkspace || !newWorkspaceName.trim()}
          >
            <Icon name="plus" size={13} />
            {creatingWorkspace ? 'Creating...' : 'Create'}
          </button>
        </div>
      </section>

      <section className="workspace-settings__section">
        <div className="workspace-settings__section-head">
          <div>
            <h2>Members</h2>
            <p>Members can open projects in this workspace. Admins can invite and manage members.</p>
            {!isTeamWorkspace ? (
              <p className="workspace-settings__hint">Create or switch to a team workspace to invite members.</p>
            ) : managerOnlyHint(canManage)}
          </div>
        </div>
        {loading ? (
          <div className="workspace-settings__empty">Loading members...</div>
        ) : (
          <div className="workspace-settings__list">
            {members.map((member) => (
              <div className="workspace-settings__row" key={member.userId}>
                <div className="workspace-settings__member">
                  <span className="workspace-settings__avatar" aria-hidden="true">
                    {memberInitial(member, currentUserId)}
                  </span>
                  <div className="workspace-settings__identity">
                    <strong>{memberTitle(member, currentUserId)}</strong>
                    <span>{memberSubtitle(member, currentUserId)}</span>
                  </div>
                </div>
                {member.role === 'owner' ? (
                  <div className="workspace-settings__actions">
                    <span className="workspace-settings__pill">Owner</span>
                    <span className="workspace-settings__action-note">Transfer ownership to change this role.</span>
                  </div>
                ) : (
                  <div className="workspace-settings__actions">
                    {(() => {
                      const updating = updatingMemberIds.has(member.userId);
                      const removing = removingMemberIds.has(member.userId);
                      const busy = updating || removing;
                      const assetTransferMembers = members.filter((item) => item.userId !== member.userId);
                      const assetTransferTarget = memberAssetTransferTargets[member.userId]
                        ?? assetTransferMembers.find((item) => item.userId === currentUserId)?.userId
                        ?? assetTransferMembers.find((item) => item.role === 'owner')?.userId
                        ?? assetTransferMembers[0]?.userId
                        ?? '';
                      return (
                        <>
                    <select
                      value={member.role}
                      disabled={!canManage || member.userId === currentUserId || busy}
                      onChange={(event) => void handleRoleChange(member, event.target.value as 'admin' | 'member')}
                    >
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                    </select>
                    <select
                      aria-label={`Transfer assets for ${memberTitle(member, currentUserId)}`}
                      value={assetTransferTarget}
                      disabled={!canManage || member.userId === currentUserId || busy || assetTransferMembers.length === 0}
                      onChange={(event) => setMemberAssetTransferTargets((current) => ({
                        ...current,
                        [member.userId]: event.target.value,
                      }))}
                    >
                      {assetTransferMembers.map((targetMember) => (
                        <option key={targetMember.userId} value={targetMember.userId}>
                          Assets to {memberTitle(targetMember, currentUserId)}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={!canManage || member.userId === currentUserId || busy || !assetTransferTarget}
                      onClick={() => void handleRemoveMember(member)}
                    >
                      <Icon name="trash" size={13} />
                      {removing ? 'Removing...' : 'Remove'}
                    </button>
                        </>
                      );
                    })()}
                    {member.userId === currentUserId ? (
                      <span className="workspace-settings__action-note">Ask another admin to change your access.</span>
                    ) : null}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="workspace-settings__section">
        <div className="workspace-settings__section-head">
          <div>
            <h2>Ownership</h2>
            <p>Transfer owner before the current owner leaves the workspace.</p>
            {!isTeamWorkspace ? (
              <p className="workspace-settings__hint">Personal workspace ownership cannot be transferred.</p>
            ) : !isOwner ? (
              ownerOnlyHint(isOwner)
            ) : transferableMembers.length === 0 ? (
              <p className="workspace-settings__hint">Invite another member before transferring ownership.</p>
            ) : null}
          </div>
          <div className="workspace-settings__actions">
            <select
              value={ownerTargetUserId}
              disabled={!isTeamWorkspace || !isOwner || transferableMembers.length === 0 || transferringOwner}
              onChange={(event) => setOwnerTargetUserId(event.target.value)}
            >
              {transferableMembers.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.userId}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!isTeamWorkspace || !isOwner || !ownerTargetUserId || transferringOwner}
              onClick={() => void handleTransferOwner()}
            >
              <Icon name="refresh" size={13} />
              {transferringOwner ? 'Transferring...' : 'Transfer owner'}
            </button>
          </div>
        </div>
      </section>

      <section className="workspace-settings__section">
        <div className="workspace-settings__section-head">
          <div>
            <h2>Invites</h2>
            <p>Invite links let anonymous or signed-in users join this workspace.</p>
            {!isTeamWorkspace ? (
              <p className="workspace-settings__hint">Personal workspace does not accept invite links.</p>
            ) : managerOnlyHint(canManage)}
          </div>
          <div className="workspace-settings__actions">
            <select
              aria-label="Invite role"
              value={inviteRole}
              disabled={!canManage || !isTeamWorkspace}
              onChange={(event) => setInviteRole(event.target.value as 'member' | 'admin')}
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <select
              aria-label="Invite expiry"
              value={inviteExpiresInDays}
              disabled={!canManage || !isTeamWorkspace}
              onChange={(event) => setInviteExpiresInDays(Number(event.target.value))}
            >
              <option value={1}>1 day</option>
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
            </select>
            <button
              type="button"
              disabled={!canManage || !isTeamWorkspace || creatingInvite}
              onClick={() => void handleInvite()}
            >
              <Icon name="link" size={13} />
              {creatingInvite ? 'Creating invite...' : 'Create invite'}
            </button>
            <button
              type="button"
              disabled={!canManage || !isTeamWorkspace || inactiveInviteCount === 0}
              onClick={() => setShowInviteHistory((value) => !value)}
            >
              <Icon name="history" size={13} />
              {showInviteHistory ? 'Hide history' : `Show history (${inactiveInviteCount})`}
            </button>
          </div>
        </div>
        <div className="workspace-settings__list">
          {!isTeamWorkspace ? (
            <div className="workspace-settings__empty">Personal workspace does not accept invite links.</div>
          ) : !canManage ? (
            <div className="workspace-settings__empty">Only admins and owners can view or create invite links.</div>
          ) : invites.length === 0 ? (
            <div className="workspace-settings__empty">No invites yet.</div>
          ) : visibleInvites.length === 0 ? (
            <div className="workspace-settings__empty">No active invite links. Show history to review accepted, expired, or revoked invites.</div>
          ) : visibleInvites.map((invite) => {
            const revoking = revokingInviteIds.has(invite.id);
            return (
              <div className="workspace-settings__row" key={invite.id}>
                <div>
                  <strong>{inviteTitle(invite)}</strong>
                  <span>{inviteMetaLabel(invite)}</span>
                </div>
                <div className="workspace-settings__actions">
                  <button
                    type="button"
                    disabled={invite.status !== 'pending' || !invite.inviteUrl || revoking}
                    onClick={() => void handleCopyInvite(invite)}
                  >
                    <Icon name="copy" size={13} />
                    Copy
                  </button>
                  <button
                    type="button"
                    disabled={!canManage || invite.status !== 'pending' || revoking}
                    onClick={() => void handleRevokeInvite(invite)}
                  >
                    <Icon name="trash" size={13} />
                    {revoking ? 'Revoking...' : 'Revoke'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="workspace-settings__section">
        <div className="workspace-settings__section-head">
          <div>
            <h2>Viewer links</h2>
            <p>External viewer links grant read-only access to one artifact, not the workspace.</p>
            {viewerLinksHint(canManage)}
          </div>
        </div>
        <div className="workspace-settings__list">
          {!canManage ? (
            <div className="workspace-settings__empty">Only admins and owners can view external viewer links.</div>
          ) : shares.length === 0 ? (
            <div className="workspace-settings__empty">No external viewer links yet.</div>
          ) : shares.map((share) => {
            const revoking = revokingShareIds.has(share.id);
            return (
              <div className="workspace-settings__row" key={share.id}>
                <div>
                  <strong>{share.shareUrl}</strong>
                  <span>{shareMetaLabel(share)}</span>
                </div>
                <div className="workspace-settings__actions">
                  <button
                    type="button"
                    disabled={!share.shareUrl || revoking}
                    onClick={() => void handleCopyShare(share)}
                  >
                    <Icon name="copy" size={13} />
                    Copy
                  </button>
                  <button
                    type="button"
                    disabled={!canManage || revoking}
                    onClick={() => void handleRevokeShare(share)}
                  >
                    <Icon name="trash" size={13} />
                    {revoking ? 'Revoking...' : 'Revoke'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="workspace-settings__section">
        <div className="workspace-settings__section-head">
          <div>
            <h2>Projects</h2>
            <p>Move projects to another workspace before deleting this workspace.</p>
            {managerOnlyHint(canManage)}
          </div>
        </div>
        <div className="workspace-settings__list">
          {projects.length === 0 ? (
            <div className="workspace-settings__empty">No projects in this workspace.</div>
          ) : projects.map((project) => {
            const targetWorkspaceId = projectMoveTargets[project.id] ?? '';
            const moving = movingProjectIds.has(project.id);
            const transferringOwner = transferringProjectOwnerIds.has(project.id);
            const projectOwnerMembers = members.filter((member) => member.workspaceId === project.workspaceId);
            const effectiveProjectOwnerUserId =
              project.ownedByUserId ?? project.createdByUserId ?? projectOwnerMembers[0]?.userId ?? '';
            const ownerTargetUserId = projectOwnerTargets[project.id] ?? effectiveProjectOwnerUserId;
            const movableWorkspaces = workspaces.filter((workspace) => (
              workspace.id !== project.workspaceId && isWorkspaceManagerRole(workspace.currentUserRole)
            ));
            return (
              <div className="workspace-settings__row" key={project.id}>
                <div className="workspace-settings__identity">
                  <strong>{project.name}</strong>
                  <span>
                    {project.id}
                    {project.ownedByUserId ? ` · owned by ${project.ownedByUserId}` : ''}
                    {project.createdByUserId && project.createdByUserId !== project.ownedByUserId
                      ? ` · created by ${project.createdByUserId}`
                      : ''}
                  </span>
                </div>
                <div className="workspace-settings__actions">
                  <select
                    aria-label={`Transfer owner for ${project.name}`}
                    value={ownerTargetUserId}
                    disabled={!canManage || transferringOwner || projectOwnerMembers.length === 0}
                    onChange={(event) => setProjectOwnerTargets((current) => ({
                      ...current,
                      [project.id]: event.target.value,
                    }))}
                  >
                    {projectOwnerMembers.map((member) => (
                      <option key={member.userId} value={member.userId}>
                        Owner: {memberTitle(member, currentUserId)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!canManage || !ownerTargetUserId || ownerTargetUserId === effectiveProjectOwnerUserId || transferringOwner}
                    onClick={() => void handleTransferProjectOwner(project)}
                  >
                    <Icon name="edit" size={13} />
                    {transferringOwner ? 'Transferring...' : 'Transfer'}
                  </button>
                  <select
                    aria-label={`Move ${project.name}`}
                    value={targetWorkspaceId}
                    disabled={!canManage || movableWorkspaces.length === 0 || moving}
                    onChange={(event) => setProjectMoveTargets((current) => ({
                      ...current,
                      [project.id]: event.target.value,
                    }))}
                  >
                    <option value="">Move to...</option>
                    {movableWorkspaces.map((workspace) => (
                      <option key={workspace.id} value={workspace.id}>
                        {workspace.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!canManage || !targetWorkspaceId || moving}
                    onClick={() => void handleMoveProject(project)}
                  >
                    <Icon name="arrow-left" size={13} />
                    {moving ? 'Moving...' : 'Move'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="workspace-settings__section workspace-settings__section--danger">
        <div className="workspace-settings__section-head">
          <div>
            <h2>Workspace lifecycle</h2>
            <p>Leave a team workspace, or delete an empty team workspace when you own it.</p>
            {!isTeamWorkspace ? (
              <p className="workspace-settings__hint">Personal workspace cannot be left or deleted.</p>
            ) : isOwner ? (
              <>
                <p className="workspace-settings__hint">Transfer ownership before leaving this workspace.</p>
                {projects.length > 0 ? (
                  <p className="workspace-settings__hint">Move or delete all workspace projects before deleting the workspace.</p>
                ) : null}
                {routines.length > 0 ? (
                  <p className="workspace-settings__hint">Delete all workspace automations before deleting the workspace.</p>
                ) : null}
                {projects.length === 0 && routines.length === 0 ? (
                  <p className="workspace-settings__hint">{deleteWorkspaceImpact}</p>
                ) : null}
              </>
            ) : null}
          </div>
          <div className="workspace-settings__actions">
            <button
              type="button"
              disabled={!isTeamWorkspace || !currentMembership || isOwner || leavingWorkspace || deletingWorkspace}
              onClick={() => void handleLeaveWorkspace()}
            >
              <Icon name="arrow-left" size={13} />
              {leavingWorkspace ? 'Leaving...' : 'Leave'}
            </button>
            <button
              type="button"
              disabled={!canDeleteWorkspace || leavingWorkspace || deletingWorkspace}
              onClick={() => void handleDeleteWorkspace()}
            >
              <Icon name="trash" size={13} />
              {deletingWorkspace ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        </div>
      </section>

      <section className="workspace-settings__section">
        <div className="workspace-settings__section-head">
          <div>
            <h2>Activity</h2>
            <p>Recent workspace actions across invites, members, projects, and viewer links.</p>
          </div>
        </div>
        <div className="workspace-settings__list">
          {activities.length === 0 ? (
            <div className="workspace-settings__empty">No workspace activity yet.</div>
          ) : activities.map((activity) => (
            <div className="workspace-settings__row workspace-settings__row--activity" key={activity.id}>
              <div className="workspace-settings__identity">
                <strong>{activityLabel(activity)}</strong>
                <span>{activityActorLabel(activity, currentUserId)}</span>
              </div>
              <span className="workspace-settings__time">{activityTimeLabel(activity.createdAt)}</span>
            </div>
          ))}
        </div>
      </section>
      {notice ? <div className="workspace-settings__notice">{notice}</div> : null}
    </div>
  );
}

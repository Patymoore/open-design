// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceSettingsView } from '../../src/components/WorkspaceSettingsView';
import { patchProjectResult } from '../../src/state/projects';
import {
  createWorkspaceResult,
  deleteWorkspaceInviteResult,
  deleteWorkspaceResult,
  leaveWorkspaceResult,
  listWorkspaceInvitesResult,
  listWorkspaceMembersResult,
  listWorkspaceRoutinesResult,
  listWorkspaceSharesResult,
  removeWorkspaceMemberResult,
  revokeWorkspaceShareResult,
  transferWorkspaceOwnerResult,
  updateWorkspaceMemberRoleResult,
  updateWorkspaceNameResult,
} from '../../src/state/workspaces';
import type { Project } from '../../src/types';

vi.mock('../../src/state/projects', () => ({
  patchProjectResult: vi.fn(),
}));

vi.mock('../../src/state/workspaces', () => ({
  createWorkspaceResult: vi.fn(),
  deleteWorkspaceResult: vi.fn(),
  deleteWorkspaceInviteResult: vi.fn(),
  leaveWorkspaceResult: vi.fn(),
  listWorkspaceActivityResult: vi.fn(async () => ({ ok: true, value: [{
    id: 'act-1',
    workspaceId: 'ws-1',
    actorUserId: 'owner-1',
    action: 'invite.created',
    targetType: 'invite',
    targetId: 'inv-1',
    metadata: { role: 'member' },
    createdAt: 1_700_000_000_000,
  }, {
    id: 'act-2',
    workspaceId: 'ws-1',
    actorUserId: 'owner-1',
    action: 'invite.revoked',
    targetType: 'invite',
    targetId: 'inv-2',
    metadata: { role: 'admin', reason: 'manual_revoke' },
    createdAt: 1_700_000_000_001,
  }, {
    id: 'act-3',
    workspaceId: 'ws-1',
    actorUserId: 'owner-1',
    action: 'share.created',
    targetType: 'share',
    targetId: 'share-1',
    metadata: { projectId: 'project-1', projectName: 'Workspace project', artifactId: 'artifact-1' },
    createdAt: 1_700_000_000_002,
  }, {
    id: 'act-4',
    workspaceId: 'ws-1',
    actorUserId: 'owner-1',
    action: 'share.revoked',
    targetType: 'share',
    targetId: 'share-1',
    metadata: { reason: 'artifact_deleted', projectId: 'project-1', projectName: 'Workspace project', artifactId: 'artifact-1' },
    createdAt: 1_700_000_000_003,
  }, {
    id: 'act-4b',
    workspaceId: 'ws-1',
    actorUserId: 'owner-1',
    action: 'share.revoked',
    targetType: 'share',
    targetId: 'share-2',
    metadata: {
      reason: 'project_deleted',
      projectId: 'project-1',
      projectName: 'Workspace project',
      artifactId: 'artifact-2',
    },
    createdAt: 1_700_000_000_004,
  }, {
    id: 'act-5',
    workspaceId: 'ws-1',
    actorUserId: 'owner-1',
    action: 'project.deleted',
    targetType: 'project',
    targetId: 'project-1',
    metadata: { projectName: 'Workspace project' },
    createdAt: 1_700_000_000_005,
  }, {
    id: 'act-6',
    workspaceId: 'ws-1',
    actorUserId: 'owner-1',
    action: 'routine.run_requested',
    targetType: 'routine',
    targetId: 'routine-1',
    metadata: { routineName: 'Daily digest' },
    createdAt: 1_700_000_000_006,
  }, {
    id: 'act-7',
    workspaceId: 'ws-1',
    actorUserId: 'owner-1',
    action: 'member.removed',
    targetType: 'member',
    targetId: 'member-1',
    metadata: {
      role: 'member',
      revokedInviteCount: 2,
      revokedShareCount: 1,
      createdRoutineCount: 1,
      createdProjectCount: 1,
      ownedRoutineCount: 1,
      ownedProjectCount: 1,
      transferredRoutineCount: 1,
      transferredProjectCount: 1,
      transferToUserId: 'owner-1',
    },
    createdAt: 1_700_000_000_007,
  }, {
    id: 'act-8',
    workspaceId: 'ws-1',
    actorUserId: 'owner-1',
    action: 'project.moved',
    targetType: 'project',
    targetId: 'project-1',
    metadata: { projectName: 'Workspace project', movedDeploymentCount: 1, movedShareCount: 1 },
    createdAt: 1_700_000_000_008,
  }] })),
  listWorkspaceInvitesResult: vi.fn(async () => ({ ok: true, value: [{
    id: 'inv-1',
    workspaceId: 'ws-1',
    token: 'token-1',
    role: 'member',
    createdByUserId: 'owner-1',
    createdAt: 1,
    status: 'pending',
    inviteUrl: 'http://localhost/workspace-invites/token-1',
  }, {
    id: 'inv-accepted',
    workspaceId: 'ws-1',
    token: 'token-accepted',
    role: 'admin',
    createdByUserId: 'owner-1',
    createdAt: 1,
    acceptedAt: 2,
    acceptedByUserId: 'admin-2',
    status: 'accepted',
    inviteUrl: 'http://localhost/workspace-invites/token-accepted',
  }] })),
  listWorkspaceMembersResult: vi.fn(async () => ({ ok: true, value: [
    {
      workspaceId: 'ws-1',
      userId: 'owner-1',
      role: 'owner',
      joinedAt: 1,
      ownedProjectCount: 1,
      ownedRoutineCount: 1,
    },
    {
      workspaceId: 'ws-1',
      userId: 'member-1',
      role: 'member',
      joinedAt: 2,
      ownedProjectCount: 2,
      ownedRoutineCount: 1,
    },
  ] })),
  listWorkspaceSharesResult: vi.fn(async () => ({ ok: true, value: [{
    id: 'share-1',
    token: 'share-token',
    targetType: 'live_artifact',
    projectId: 'project-1',
    projectName: 'Workspace project',
    artifactId: 'artifact-1',
    role: 'viewer',
    createdByUserId: 'owner-1',
    createdAt: 1,
    shareUrl: 'http://localhost/share/live-artifact/share-token',
  }] })),
  listWorkspaceRoutinesResult: vi.fn(async () => ({ ok: true, value: [] })),
  removeWorkspaceMemberResult: vi.fn(),
  revokeWorkspaceShareResult: vi.fn(),
  transferWorkspaceOwnerResult: vi.fn(),
  updateWorkspaceMemberRoleResult: vi.fn(),
  updateWorkspaceNameResult: vi.fn(),
}));

describe('WorkspaceSettingsView permissions', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('explains member access and disables manager-only actions', async () => {
    const project: Project = {
      id: 'project-1',
      workspaceId: 'ws-1',
      name: 'Workspace project',
      skillId: null,
      designSystemId: null,
      createdAt: 1,
      updatedAt: 1,
    };

    const { container } = render(
      <WorkspaceSettingsView
        workspaces={[
          { id: 'ws-1', name: 'Team workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
          { id: 'ws-2', name: 'Other workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
        ]}
        currentWorkspaceId="ws-1"
        currentUserId="member-1"
        projects={[project]}
        onWorkspaceChange={vi.fn()}
        onWorkspaceCreated={vi.fn()}
        onWorkspaceRemoved={vi.fn()}
        onWorkspaceUpdated={vi.fn()}
        onProjectsChanged={vi.fn()}
        onCreateWorkspaceInvite={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Member: create and open workspace projects. Ask an admin for invites, viewer links, or management changes.')).toBeTruthy();
    });

    expect(screen.getAllByText('Admin or owner access required.').length).toBeGreaterThanOrEqual(4);
    expect(listWorkspaceInvitesResult).not.toHaveBeenCalled();
    expect(listWorkspaceSharesResult).not.toHaveBeenCalled();
    const statusSection = screen.getByLabelText('Workspace status');
    expect(within(statusSection).getByText('Pending invites')).toBeTruthy();
    expect(within(statusSection).getByText('Viewer links')).toBeTruthy();
    expect(within(statusSection).getByText('Automations')).toBeTruthy();
    expect(within(statusSection).getByText('Owner')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Create invite' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Transfer owner' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Delete' }) as HTMLButtonElement).disabled).toBe(true);

    const membersSection = screen.getByRole('heading', { name: 'Members' }).closest('section');
    expect(membersSection).toBeTruthy();
    expect(within(membersSection as HTMLElement).getByText('You')).toBeTruthy();
    expect(within(membersSection as HTMLElement).getByText(/owns 1 project, 1 routine/)).toBeTruthy();
    expect(within(membersSection as HTMLElement).getByText(/owns 2 projects, 1 routine/)).toBeTruthy();
    expect(within(membersSection as HTMLElement).getByText('Transfer ownership to change this role.')).toBeTruthy();
    expect((within(membersSection as HTMLElement).getByRole('button', { name: 'Remove' }) as HTMLButtonElement).disabled).toBe(true);

    const viewerLinksSection = screen.getByRole('heading', { name: 'Viewer links' }).closest('section');
    expect(viewerLinksSection).toBeTruthy();
    expect(within(viewerLinksSection as HTMLElement).getByText('Admin or owner access required to view, copy, or revoke external viewer links.')).toBeTruthy();
    expect(within(viewerLinksSection as HTMLElement).getByText('Only admins and owners can view external viewer links.')).toBeTruthy();
    expect(within(viewerLinksSection as HTMLElement).queryByRole('button', { name: 'Copy' })).toBeNull();
    expect(within(viewerLinksSection as HTMLElement).queryByRole('button', { name: 'Revoke' })).toBeNull();

    const invitesSection = screen.getByText('Invites').closest('section');
    expect(invitesSection).toBeTruthy();
    expect(within(invitesSection as HTMLElement).getByText('Only admins and owners can view or create invite links.')).toBeTruthy();

    const projectsSection = screen.getByRole('heading', { name: 'Projects' }).closest('section');
    expect(projectsSection).toBeTruthy();
    expect((within(projectsSection as HTMLElement).getByRole('button', { name: 'Move' }) as HTMLButtonElement).disabled).toBe(true);

    expect(screen.getByText('Created member invite')).toBeTruthy();
    expect(screen.getByText('Revoked admin invite')).toBeTruthy();
    expect(screen.getByText('Removed member member-1 (revoked 2 invites, 1 viewer link, transferred 1 project, 1 routine to owner-1)')).toBeTruthy();
    expect(screen.getByText('Deleted Workspace project')).toBeTruthy();
    expect(screen.getByText('Moved Workspace project with 1 deployment, 1 viewer link')).toBeTruthy();
    expect(screen.queryByText(/accepted by admin-2/)).toBeNull();
  });

  it('trusts the current workspace role over stale member details', async () => {
    vi.mocked(listWorkspaceMembersResult).mockResolvedValueOnce({
      ok: true,
      value: [
        {
          workspaceId: 'ws-1',
          userId: 'owner-1',
          role: 'admin',
          joinedAt: 1,
        },
        {
          workspaceId: 'ws-1',
          userId: 'member-1',
          role: 'member',
          joinedAt: 2,
        },
      ],
    });

    render(
      <WorkspaceSettingsView
        workspaces={[
          {
            id: 'ws-1',
            name: 'Team workspace',
            kind: 'team',
            currentUserRole: 'member',
            createdAt: 1,
            updatedAt: 1,
          },
        ]}
        currentWorkspaceId="ws-1"
        currentUserId="owner-1"
        projects={[]}
        onWorkspaceChange={vi.fn()}
        onWorkspaceCreated={vi.fn()}
        onWorkspaceRemoved={vi.fn()}
        onWorkspaceUpdated={vi.fn()}
        onProjectsChanged={vi.fn()}
        onCreateWorkspaceInvite={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Member: create and open workspace projects. Ask an admin for invites, viewer links, or management changes.')).toBeTruthy();
    });

    expect(listWorkspaceSharesResult).not.toHaveBeenCalled();
    expect(listWorkspaceInvitesResult).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Create invite' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Only admins and owners can view or create invite links.')).toBeTruthy();
    expect(screen.getByText('Only admins and owners can view external viewer links.')).toBeTruthy();
  });

  it('keeps workspace details visible as an error instead of silently showing empty data', async () => {
    vi.mocked(listWorkspaceSharesResult).mockResolvedValueOnce({
      ok: false,
      error: 'workspace membership required',
    });

    const { container } = render(
      <WorkspaceSettingsView
        workspaces={[
          { id: 'ws-1', name: 'Team workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
        ]}
        currentWorkspaceId="ws-1"
        currentUserId="owner-1"
        projects={[]}
        onWorkspaceChange={vi.fn()}
        onWorkspaceCreated={vi.fn()}
        onWorkspaceRemoved={vi.fn()}
        onWorkspaceUpdated={vi.fn()}
        onProjectsChanged={vi.fn()}
        onCreateWorkspaceInvite={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Workspace details unavailable')).toBeTruthy();
    });
    expect(screen.getByText('Could not load viewer links. workspace membership required')).toBeTruthy();
    expect(screen.getByText('Loading access')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(listWorkspaceSharesResult).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.queryByText('Workspace details unavailable')).toBeNull();
    });
  });

  it('blocks workspace deletion while automations still belong to the workspace', async () => {
    vi.mocked(listWorkspaceRoutinesResult).mockResolvedValueOnce({
      ok: true,
      value: [{
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
    });

    render(
      <WorkspaceSettingsView
        workspaces={[
          { id: 'ws-1', name: 'Team workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
        ]}
        currentWorkspaceId="ws-1"
        currentUserId="owner-1"
        projects={[]}
        onWorkspaceChange={vi.fn()}
        onWorkspaceCreated={vi.fn()}
        onWorkspaceRemoved={vi.fn()}
        onWorkspaceUpdated={vi.fn()}
        onProjectsChanged={vi.fn()}
        onCreateWorkspaceInvite={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Delete all workspace automations before deleting the workspace.')).toBeTruthy();
    });

    const statusSection = screen.getByLabelText('Workspace status');
    expect(within(statusSection).getByText('Automations')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Delete' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('clears stale workspace details before showing a new workspace load failure', async () => {
    const { rerender } = render(
      <WorkspaceSettingsView
        workspaces={[
          { id: 'ws-1', name: 'Team workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
          { id: 'ws-2', name: 'Locked workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
        ]}
        currentWorkspaceId="ws-1"
        currentUserId="owner-1"
        projects={[]}
        onWorkspaceChange={vi.fn()}
        onWorkspaceCreated={vi.fn()}
        onWorkspaceRemoved={vi.fn()}
        onWorkspaceUpdated={vi.fn()}
        onProjectsChanged={vi.fn()}
        onCreateWorkspaceInvite={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByText(/Workspace project/).length).toBeGreaterThan(0);
      expect(screen.getByText('Created member invite')).toBeTruthy();
    });

    vi.mocked(listWorkspaceSharesResult).mockResolvedValueOnce({
      ok: false,
      error: 'workspace membership required',
    });

    rerender(
      <WorkspaceSettingsView
        workspaces={[
          { id: 'ws-1', name: 'Team workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
          { id: 'ws-2', name: 'Locked workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
        ]}
        currentWorkspaceId="ws-2"
        currentUserId="owner-1"
        projects={[]}
        onWorkspaceChange={vi.fn()}
        onWorkspaceCreated={vi.fn()}
        onWorkspaceRemoved={vi.fn()}
        onWorkspaceUpdated={vi.fn()}
        onProjectsChanged={vi.fn()}
        onCreateWorkspaceInvite={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Workspace details unavailable')).toBeTruthy();
    });
    expect(screen.queryAllByText(/Workspace project/)).toHaveLength(0);
    expect(screen.queryByText('Created member invite')).toBeNull();
  });

  it('shows workspace switch failures in settings without changing the controlled selection', async () => {
    const onWorkspaceChange = vi.fn(async () => {
      throw new Error('Could not switch workspace.');
    });

    const { container } = render(
      <WorkspaceSettingsView
        workspaces={[
          { id: 'ws-1', name: 'Team workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
          { id: 'ws-2', name: 'Other workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
        ]}
        currentWorkspaceId="ws-1"
        currentUserId="owner-1"
        projects={[]}
        onWorkspaceChange={onWorkspaceChange}
        onWorkspaceCreated={vi.fn()}
        onWorkspaceRemoved={vi.fn()}
        onWorkspaceUpdated={vi.fn()}
        onProjectsChanged={vi.fn()}
        onCreateWorkspaceInvite={vi.fn()}
      />,
    );

    const workspaceSelect = container.querySelector('.workspace-settings__select') as HTMLSelectElement;
    expect(workspaceSelect).toBeTruthy();
    fireEvent.change(workspaceSelect, { target: { value: 'ws-2' } });

    await waitFor(() => {
      expect(screen.getByText('Could not switch workspace.')).toBeTruthy();
    });
    expect(onWorkspaceChange).toHaveBeenCalledWith('ws-2');
    expect(workspaceSelect.value).toBe('ws-1');
  });

  it('loads manager invite data after the current user id arrives', async () => {
    const { rerender } = render(
      <WorkspaceSettingsView
        workspaces={[
          { id: 'ws-1', name: 'Team workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
        ]}
        currentWorkspaceId="ws-1"
        currentUserId={null}
        projects={[]}
        onWorkspaceChange={vi.fn()}
        onWorkspaceCreated={vi.fn()}
        onWorkspaceRemoved={vi.fn()}
        onWorkspaceUpdated={vi.fn()}
        onProjectsChanged={vi.fn()}
        onCreateWorkspaceInvite={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(listWorkspaceMembersResult).toHaveBeenCalled();
    });
    expect(listWorkspaceInvitesResult).not.toHaveBeenCalled();

    rerender(
      <WorkspaceSettingsView
        workspaces={[
          { id: 'ws-1', name: 'Team workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
        ]}
        currentWorkspaceId="ws-1"
        currentUserId="owner-1"
        projects={[]}
        onWorkspaceChange={vi.fn()}
        onWorkspaceCreated={vi.fn()}
        onWorkspaceRemoved={vi.fn()}
        onWorkspaceUpdated={vi.fn()}
        onProjectsChanged={vi.fn()}
        onCreateWorkspaceInvite={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(listWorkspaceInvitesResult).toHaveBeenCalledWith('ws-1');
    });
    expect(screen.getByText('http://localhost/workspace-invites/token-1')).toBeTruthy();
  });

  it('ignores stale workspace detail refreshes that resolve out of order', async () => {
    let releaseFirstMembers = () => {};
    const firstMembers = new Promise<{ ok: true; value: Array<{ workspaceId: string; userId: string; role: 'owner' | 'member'; joinedAt: number }> }>((resolve) => {
      releaseFirstMembers = () => resolve({ ok: true, value: [
        { workspaceId: 'ws-1', userId: 'owner-1', role: 'owner', joinedAt: 1 },
      ] });
    });
    vi.mocked(listWorkspaceMembersResult)
      .mockReturnValueOnce(firstMembers)
      .mockResolvedValue({ ok: true, value: [
        { workspaceId: 'ws-1', userId: 'owner-1', role: 'owner', joinedAt: 1 },
      ] });

    const { rerender } = render(
      <WorkspaceSettingsView
        workspaces={[
          { id: 'ws-1', name: 'Team workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
        ]}
        currentWorkspaceId="ws-1"
        currentUserId={null}
        projects={[]}
        onWorkspaceChange={vi.fn()}
        onWorkspaceCreated={vi.fn()}
        onWorkspaceRemoved={vi.fn()}
        onWorkspaceUpdated={vi.fn()}
        onProjectsChanged={vi.fn()}
        onCreateWorkspaceInvite={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(listWorkspaceMembersResult).toHaveBeenCalledTimes(1);
    });

    rerender(
      <WorkspaceSettingsView
        workspaces={[
          { id: 'ws-1', name: 'Team workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
        ]}
        currentWorkspaceId="ws-1"
        currentUserId="owner-1"
        projects={[]}
        onWorkspaceChange={vi.fn()}
        onWorkspaceCreated={vi.fn()}
        onWorkspaceRemoved={vi.fn()}
        onWorkspaceUpdated={vi.fn()}
        onProjectsChanged={vi.fn()}
        onCreateWorkspaceInvite={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('http://localhost/workspace-invites/token-1')).toBeTruthy();
    });

    releaseFirstMembers();

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.getByText('http://localhost/workspace-invites/token-1')).toBeTruthy();
    expect(screen.queryByText('Only admins and owners can view or create invite links.')).toBeNull();
  });

  it('keeps personal workspaces out of the invite flow', async () => {
    render(
      <WorkspaceSettingsView
        workspaces={[
          { id: 'local-personal', name: 'Personal Workspace', kind: 'local', createdAt: 1, updatedAt: 1 },
        ]}
        currentWorkspaceId="local-personal"
        currentUserId="owner-1"
        projects={[]}
        onWorkspaceChange={vi.fn()}
        onWorkspaceCreated={vi.fn()}
        onWorkspaceRemoved={vi.fn()}
        onWorkspaceUpdated={vi.fn()}
        onProjectsChanged={vi.fn()}
        onCreateWorkspaceInvite={vi.fn()}
      />,
    );

    const invitesSection = screen.getByText('Invites').closest('section');
    expect(invitesSection).toBeTruthy();
    const invitesList = (invitesSection as HTMLElement).querySelector('.workspace-settings__list');
    expect(invitesList).toBeTruthy();
    await waitFor(() => {
      expect(within(invitesList as HTMLElement).getByText('Personal workspace does not accept invite links.')).toBeTruthy();
    });
    expect(within(invitesList as HTMLElement).queryByText('No invites yet.')).toBeNull();
    expect(listWorkspaceInvitesResult).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Create invite' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps inactive invite history collapsed until requested', async () => {
    vi.mocked(listWorkspaceInvitesResult).mockResolvedValueOnce({ ok: true, value: [{
      id: 'inv-accepted-only',
      workspaceId: 'ws-1',
      token: 'token-accepted-only',
      role: 'member',
      createdByUserId: 'owner-1',
      createdAt: 1,
      acceptedAt: 2,
      acceptedByUserId: 'member-1',
      status: 'accepted',
      inviteUrl: 'http://localhost/workspace-invites/token-accepted-only',
    }] });

    render(
      <WorkspaceSettingsView
        workspaces={[
          { id: 'ws-1', name: 'Team workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
        ]}
        currentWorkspaceId="ws-1"
        currentUserId="owner-1"
        projects={[]}
        onWorkspaceChange={vi.fn()}
        onWorkspaceCreated={vi.fn()}
        onWorkspaceRemoved={vi.fn()}
        onWorkspaceUpdated={vi.fn()}
        onProjectsChanged={vi.fn()}
        onCreateWorkspaceInvite={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('No active invite links. Show history to review accepted, expired, or revoked invites.')).toBeTruthy();
    });
    const invitesSection = screen.getByText('Invites').closest('section');
    expect(invitesSection).toBeTruthy();
    expect(within(invitesSection as HTMLElement).queryByText('Invite accepted')).toBeNull();

    fireEvent.click(within(invitesSection as HTMLElement).getByRole('button', { name: 'Show history (1)' }));

    expect(within(invitesSection as HTMLElement).getByText('Invite accepted')).toBeTruthy();
    expect(within(invitesSection as HTMLElement).getByText(/accepted by member-1/)).toBeTruthy();
  });

  it('resets invite history when switching workspaces', async () => {
    const { rerender } = render(
      <WorkspaceSettingsView
        workspaces={[
          { id: 'ws-1', name: 'Team workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
          { id: 'ws-2', name: 'Second workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
        ]}
        currentWorkspaceId="ws-1"
        currentUserId="owner-1"
        projects={[]}
        onWorkspaceChange={vi.fn()}
        onWorkspaceCreated={vi.fn()}
        onWorkspaceRemoved={vi.fn()}
        onWorkspaceUpdated={vi.fn()}
        onProjectsChanged={vi.fn()}
        onCreateWorkspaceInvite={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('http://localhost/workspace-invites/token-1')).toBeTruthy();
    });
    const invitesSection = screen.getByText('Invites').closest('section');
    expect(invitesSection).toBeTruthy();
    fireEvent.click(within(invitesSection as HTMLElement).getByRole('button', { name: 'Show history (1)' }));
    expect(within(invitesSection as HTMLElement).getByText('Invite accepted')).toBeTruthy();

    rerender(
      <WorkspaceSettingsView
        workspaces={[
          { id: 'ws-1', name: 'Team workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
          { id: 'ws-2', name: 'Second workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
        ]}
        currentWorkspaceId="ws-2"
        currentUserId="owner-1"
        projects={[]}
        onWorkspaceChange={vi.fn()}
        onWorkspaceCreated={vi.fn()}
        onWorkspaceRemoved={vi.fn()}
        onWorkspaceUpdated={vi.fn()}
        onProjectsChanged={vi.fn()}
        onCreateWorkspaceInvite={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(listWorkspaceInvitesResult).toHaveBeenCalledWith('ws-2');
    });
    expect(within(invitesSection as HTMLElement).queryByText('Invite accepted')).toBeNull();
    expect(within(invitesSection as HTMLElement).getByRole('button', { name: 'Show history (1)' })).toBeTruthy();
  });

  it('prevents admins from changing their own workspace access in the member list', async () => {
    vi.mocked(listWorkspaceMembersResult).mockResolvedValueOnce({ ok: true, value: [
      { workspaceId: 'ws-1', userId: 'owner-1', role: 'owner', joinedAt: 1 },
      { workspaceId: 'ws-1', userId: 'admin-1', role: 'admin', joinedAt: 2 },
      { workspaceId: 'ws-1', userId: 'member-1', role: 'member', joinedAt: 3 },
    ] });

    render(
      <WorkspaceSettingsView
        workspaces={[
          { id: 'ws-1', name: 'Team workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
        ]}
        currentWorkspaceId="ws-1"
        currentUserId="admin-1"
        projects={[]}
        onWorkspaceChange={vi.fn()}
        onWorkspaceCreated={vi.fn()}
        onWorkspaceRemoved={vi.fn()}
        onWorkspaceUpdated={vi.fn()}
        onProjectsChanged={vi.fn()}
        onCreateWorkspaceInvite={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('You')).toBeTruthy();
    });

    const selfRow = screen.getByText('You').closest('.workspace-settings__row');
    expect(selfRow).toBeTruthy();
    expect((within(selfRow as HTMLElement).getAllByRole('combobox')[0] as HTMLSelectElement).disabled).toBe(true);
    expect((within(selfRow as HTMLElement).getByRole('button', { name: 'Remove' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(selfRow as HTMLElement).getByText('Ask another admin to change your access.')).toBeTruthy();

    const membersSection = screen.getByRole('heading', { name: 'Members' }).closest('section');
    expect(membersSection).toBeTruthy();
    const memberRow = within(membersSection as HTMLElement).getByText('member-1').closest('.workspace-settings__row');
    expect(memberRow).toBeTruthy();
    expect((within(memberRow as HTMLElement).getAllByRole('combobox')[0] as HTMLSelectElement).disabled).toBe(false);
  });

  it('prevents duplicate member role updates while a request is pending', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.mocked(listWorkspaceMembersResult).mockResolvedValue({
      ok: true,
      value: [
        { workspaceId: 'ws-1', userId: 'owner-1', role: 'owner', joinedAt: 1 },
        { workspaceId: 'ws-1', userId: 'member-1', role: 'member', joinedAt: 2 },
      ],
    });
    type RoleResult = {
      ok: true;
      value: {
        workspaceId: string;
        userId: string;
        role: 'admin';
        joinedAt: number;
      };
    };
    let resolveRole: (value: RoleResult) => void = () => {};
    vi.mocked(updateWorkspaceMemberRoleResult).mockReturnValue(new Promise<RoleResult>((resolve) => {
      resolveRole = resolve;
    }));

    render(
      <WorkspaceSettingsView
        workspaces={[
          { id: 'ws-1', name: 'Team workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
        ]}
        currentWorkspaceId="ws-1"
        currentUserId="owner-1"
        projects={[]}
        onWorkspaceChange={vi.fn()}
        onWorkspaceCreated={vi.fn()}
        onWorkspaceRemoved={vi.fn()}
        onWorkspaceUpdated={vi.fn()}
        onProjectsChanged={vi.fn()}
        onCreateWorkspaceInvite={vi.fn()}
      />,
    );

    const membersSection = screen.getByRole('heading', { name: 'Members' }).closest('section');
    expect(membersSection).toBeTruthy();
    await waitFor(() => {
      expect(within(membersSection as HTMLElement).getByText('member-1')).toBeTruthy();
    });
    const memberRow = within(membersSection as HTMLElement).getByText('member-1').closest('.workspace-settings__row');
    expect(memberRow).toBeTruthy();
    const roleSelect = within(memberRow as HTMLElement).getAllByRole('combobox')[0] as HTMLSelectElement;
    fireEvent.change(roleSelect, { target: { value: 'admin' } });

    await waitFor(() => {
      expect(roleSelect.disabled).toBe(true);
    });
    fireEvent.change(roleSelect, { target: { value: 'member' } });
    expect(updateWorkspaceMemberRoleResult).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(
      'Change member-1 to Admin? member-1 will be able to manage members, invites, viewer links, and project ownership in this workspace.',
    );

    resolveRole({
      ok: true,
      value: { workspaceId: 'ws-1', userId: 'member-1', role: 'admin', joinedAt: 2 },
    });
    await waitFor(() => {
      const updatedMemberRow = within(membersSection as HTMLElement).getByText('member-1').closest('.workspace-settings__row');
      expect(updatedMemberRow).toBeTruthy();
      expect((within(updatedMemberRow as HTMLElement).getAllByRole('combobox')[0] as HTMLSelectElement).disabled).toBe(false);
    });
  });

  it('does not change a member role when the confirmation is cancelled', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    vi.mocked(listWorkspaceMembersResult).mockResolvedValue({
      ok: true,
      value: [
        { workspaceId: 'ws-1', userId: 'owner-1', role: 'owner', joinedAt: 1 },
        { workspaceId: 'ws-1', userId: 'member-1', role: 'member', joinedAt: 2 },
      ],
    });

    render(
      <WorkspaceSettingsView
        workspaces={[
          { id: 'ws-1', name: 'Team workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
        ]}
        currentWorkspaceId="ws-1"
        currentUserId="owner-1"
        projects={[]}
        onWorkspaceChange={vi.fn()}
        onWorkspaceCreated={vi.fn()}
        onWorkspaceRemoved={vi.fn()}
        onWorkspaceUpdated={vi.fn()}
        onProjectsChanged={vi.fn()}
        onCreateWorkspaceInvite={vi.fn()}
      />,
    );

    const membersSection = screen.getByRole('heading', { name: 'Members' }).closest('section');
    expect(membersSection).toBeTruthy();
    await waitFor(() => {
      expect(within(membersSection as HTMLElement).getByText('member-1')).toBeTruthy();
    });
    const memberRow = within(membersSection as HTMLElement).getByText('member-1').closest('.workspace-settings__row');
    expect(memberRow).toBeTruthy();
    fireEvent.change(within(memberRow as HTMLElement).getAllByRole('combobox')[0] as HTMLSelectElement, {
      target: { value: 'admin' },
    });

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(updateWorkspaceMemberRoleResult).not.toHaveBeenCalled();
  });

  it('explains the cleanup impact before demoting an admin to member', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.mocked(listWorkspaceMembersResult).mockResolvedValue({
      ok: true,
      value: [
        { workspaceId: 'ws-1', userId: 'owner-1', role: 'owner', joinedAt: 1 },
        { workspaceId: 'ws-1', userId: 'admin-1', role: 'admin', joinedAt: 2 },
      ],
    });
    vi.mocked(updateWorkspaceMemberRoleResult).mockResolvedValue({
      ok: true,
      value: { workspaceId: 'ws-1', userId: 'admin-1', role: 'member', joinedAt: 2 },
    });

    render(
      <WorkspaceSettingsView
        workspaces={[
          { id: 'ws-1', name: 'Team workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
        ]}
        currentWorkspaceId="ws-1"
        currentUserId="owner-1"
        projects={[]}
        onWorkspaceChange={vi.fn()}
        onWorkspaceCreated={vi.fn()}
        onWorkspaceRemoved={vi.fn()}
        onWorkspaceUpdated={vi.fn()}
        onProjectsChanged={vi.fn()}
        onCreateWorkspaceInvite={vi.fn()}
      />,
    );

    const membersSection = screen.getByRole('heading', { name: 'Members' }).closest('section');
    expect(membersSection).toBeTruthy();
    await waitFor(() => {
      expect(within(membersSection as HTMLElement).getByText('admin-1')).toBeTruthy();
    });
    const adminRow = within(membersSection as HTMLElement).getByText('admin-1').closest('.workspace-settings__row');
    expect(adminRow).toBeTruthy();
    fireEvent.change(within(adminRow as HTMLElement).getAllByRole('combobox')[0] as HTMLSelectElement, {
      target: { value: 'member' },
    });

    await waitFor(() => {
      expect(updateWorkspaceMemberRoleResult).toHaveBeenCalledWith('ws-1', 'admin-1', 'member');
    });
    expect(confirm).toHaveBeenCalledWith(
      'Change admin-1 to Member? admin-1 will lose workspace management access. Pending invites and viewer links they created will be revoked.',
    );
  });

  it('ignores member role update completions after switching workspaces', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.mocked(listWorkspaceMembersResult).mockImplementation(async (workspaceId) => ({
      ok: true,
      value: [
        { workspaceId, userId: 'owner-1', role: 'owner', joinedAt: 1 },
        { workspaceId, userId: 'member-1', role: 'member', joinedAt: 2 },
      ],
    }));
    type RoleResult = {
      ok: true;
      value: {
        workspaceId: string;
        userId: string;
        role: 'admin';
        joinedAt: number;
      };
    };
    let resolveRole: (value: RoleResult) => void = () => {};
    vi.mocked(updateWorkspaceMemberRoleResult).mockReturnValue(new Promise<RoleResult>((resolve) => {
      resolveRole = resolve;
    }));

    const props = {
      workspaces: [
        { id: 'ws-1', name: 'Team workspace', kind: 'team' as const, createdAt: 1, updatedAt: 1 },
        { id: 'ws-2', name: 'Second workspace', kind: 'team' as const, createdAt: 1, updatedAt: 1 },
      ],
      currentUserId: 'owner-1',
      projects: [],
      onWorkspaceChange: vi.fn(),
      onWorkspaceCreated: vi.fn(),
      onWorkspaceRemoved: vi.fn(),
      onWorkspaceUpdated: vi.fn(),
      onProjectsChanged: vi.fn(),
      onCreateWorkspaceInvite: vi.fn(),
    };
    const { rerender } = render(
      <WorkspaceSettingsView
        {...props}
        currentWorkspaceId="ws-1"
      />,
    );

    const membersSection = screen.getByRole('heading', { name: 'Members' }).closest('section');
    expect(membersSection).toBeTruthy();
    await waitFor(() => {
      expect(within(membersSection as HTMLElement).getByText('member-1')).toBeTruthy();
    });
    const memberRow = within(membersSection as HTMLElement).getByText('member-1').closest('.workspace-settings__row');
    expect(memberRow).toBeTruthy();
    fireEvent.change(within(memberRow as HTMLElement).getAllByRole('combobox')[0] as HTMLSelectElement, {
      target: { value: 'admin' },
    });

    rerender(
      <WorkspaceSettingsView
        {...props}
        currentWorkspaceId="ws-2"
      />,
    );

    await waitFor(() => {
      expect(listWorkspaceMembersResult).toHaveBeenCalledWith('ws-2');
    });
    const ws1DetailRefreshCount = vi.mocked(listWorkspaceMembersResult).mock.calls
      .filter(([workspaceId]) => workspaceId === 'ws-1').length;
    resolveRole({
      ok: true,
      value: { workspaceId: 'ws-1', userId: 'member-1', role: 'admin', joinedAt: 2 },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(vi.mocked(listWorkspaceMembersResult).mock.calls
      .filter(([workspaceId]) => workspaceId === 'ws-1')).toHaveLength(ws1DetailRefreshCount);
  });

  it('prevents duplicate member removals while a request is pending', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.mocked(listWorkspaceMembersResult).mockResolvedValue({
      ok: true,
      value: [
        { workspaceId: 'ws-1', userId: 'owner-1', role: 'owner', joinedAt: 1 },
        {
          workspaceId: 'ws-1',
          userId: 'member-1',
          role: 'member',
          joinedAt: 2,
          ownedProjectCount: 1,
          ownedRoutineCount: 1,
        },
        { workspaceId: 'ws-1', userId: 'admin-2', role: 'admin', joinedAt: 3 },
      ],
    });
    let resolveRemove: (value: { ok: true; value: true }) => void = () => {};
    vi.mocked(removeWorkspaceMemberResult).mockReturnValue(new Promise<{ ok: true; value: true }>((resolve) => {
      resolveRemove = resolve;
    }));

    render(
      <WorkspaceSettingsView
        workspaces={[
          { id: 'ws-1', name: 'Team workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
        ]}
        currentWorkspaceId="ws-1"
        currentUserId="owner-1"
        projects={[]}
        onWorkspaceChange={vi.fn()}
        onWorkspaceCreated={vi.fn()}
        onWorkspaceRemoved={vi.fn()}
        onWorkspaceUpdated={vi.fn()}
        onProjectsChanged={vi.fn()}
        onCreateWorkspaceInvite={vi.fn()}
      />,
    );

    const membersSection = screen.getByRole('heading', { name: 'Members' }).closest('section');
    expect(membersSection).toBeTruthy();
    await waitFor(() => {
      expect(within(membersSection as HTMLElement).getByText('member-1')).toBeTruthy();
    });
    const memberRow = within(membersSection as HTMLElement).getByText('member-1').closest('.workspace-settings__row');
    expect(memberRow).toBeTruthy();
    fireEvent.change(within(memberRow as HTMLElement).getByLabelText('Transfer assets for member-1'), {
      target: { value: 'admin-2' },
    });
    fireEvent.click(within(memberRow as HTMLElement).getByRole('button', { name: 'Remove' }));

    await waitFor(() => {
      expect((within(memberRow as HTMLElement).getByRole('button', { name: 'Removing...' }) as HTMLButtonElement).disabled).toBe(true);
    });
    fireEvent.click(within(memberRow as HTMLElement).getByRole('button', { name: 'Removing...' }));
    expect(removeWorkspaceMemberResult).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(
      'Remove member-1 from Team workspace? They will lose access. Their 1 project and 1 routine will transfer to admin-2. Pending invites and viewer links they created will be revoked.',
    );
    expect(removeWorkspaceMemberResult).toHaveBeenCalledWith('ws-1', 'member-1', {
      transferToUserId: 'admin-2',
    });

    resolveRemove({ ok: true, value: true });
    await waitFor(() => {
      expect(removeWorkspaceMemberResult).toHaveBeenCalledTimes(1);
    });
  });

  it('does not remove a workspace member when the confirmation is cancelled', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    vi.mocked(listWorkspaceMembersResult).mockResolvedValue({
      ok: true,
      value: [
        { workspaceId: 'ws-1', userId: 'owner-1', role: 'owner', joinedAt: 1 },
        { workspaceId: 'ws-1', userId: 'member-1', role: 'member', joinedAt: 2 },
      ],
    });

    render(
      <WorkspaceSettingsView
        workspaces={[
          { id: 'ws-1', name: 'Team workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
        ]}
        currentWorkspaceId="ws-1"
        currentUserId="owner-1"
        projects={[]}
        onWorkspaceChange={vi.fn()}
        onWorkspaceCreated={vi.fn()}
        onWorkspaceRemoved={vi.fn()}
        onWorkspaceUpdated={vi.fn()}
        onProjectsChanged={vi.fn()}
        onCreateWorkspaceInvite={vi.fn()}
      />,
    );

    const membersSection = screen.getByRole('heading', { name: 'Members' }).closest('section');
    expect(membersSection).toBeTruthy();
    await waitFor(() => {
      expect(within(membersSection as HTMLElement).getByText('member-1')).toBeTruthy();
    });
    const memberRow = within(membersSection as HTMLElement).getByText('member-1').closest('.workspace-settings__row');
    expect(memberRow).toBeTruthy();

    fireEvent.click(within(memberRow as HTMLElement).getByRole('button', { name: 'Remove' }));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(removeWorkspaceMemberResult).not.toHaveBeenCalled();
    expect(within(memberRow as HTMLElement).getByRole('button', { name: 'Remove' })).toBeTruthy();
  });

  it('prevents duplicate ownership transfers while a request is pending', async () => {
    vi.mocked(listWorkspaceMembersResult).mockResolvedValue({
      ok: true,
      value: [
        { workspaceId: 'ws-1', userId: 'owner-1', role: 'owner', joinedAt: 1 },
        { workspaceId: 'ws-1', userId: 'member-1', role: 'member', joinedAt: 2 },
      ],
    });
    vi.stubGlobal('confirm', vi.fn(() => true));
    let resolveTransfer: (value: {
      ok: true;
      value: {
        previousOwner: { workspaceId: string; userId: string; role: 'admin'; joinedAt: number };
        owner: { workspaceId: string; userId: string; role: 'owner'; joinedAt: number };
      };
    }) => void = () => {};
    vi.mocked(transferWorkspaceOwnerResult).mockReturnValue(new Promise((resolve) => {
      resolveTransfer = resolve;
    }));
    const onWorkspaceUpdated = vi.fn();

    render(
      <WorkspaceSettingsView
        workspaces={[
          { id: 'ws-1', name: 'Team workspace', kind: 'team', currentUserRole: 'owner', createdAt: 1, updatedAt: 1 },
        ]}
        currentWorkspaceId="ws-1"
        currentUserId="owner-1"
        projects={[]}
        onWorkspaceChange={vi.fn()}
        onWorkspaceCreated={vi.fn()}
        onWorkspaceRemoved={vi.fn()}
        onWorkspaceUpdated={onWorkspaceUpdated}
        onProjectsChanged={vi.fn()}
        onCreateWorkspaceInvite={vi.fn()}
      />,
    );

    await waitFor(() => {
      const transferButton = screen.getByRole('button', { name: 'Transfer owner' }) as HTMLButtonElement;
      expect(transferButton.disabled).toBe(false);
    });
    const transferButton = screen.getByRole('button', { name: 'Transfer owner' }) as HTMLButtonElement;
    fireEvent.click(transferButton);

    await waitFor(() => {
      expect((screen.getByRole('button', { name: 'Transferring...' }) as HTMLButtonElement).disabled).toBe(true);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Transferring...' }));
    expect(transferWorkspaceOwnerResult).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(
      'Transfer ownership? member-1 will become the only owner of Team workspace. You will become an admin and lose owner-only actions like deleting the workspace or transferring ownership again.',
    );

    resolveTransfer({
      ok: true,
      value: {
        previousOwner: { workspaceId: 'ws-1', userId: 'owner-1', role: 'admin', joinedAt: 1 },
        owner: { workspaceId: 'ws-1', userId: 'member-1', role: 'owner', joinedAt: 2 },
      },
    });
    await waitFor(() => {
      expect(screen.getByText('Workspace ownership transferred.')).toBeTruthy();
    });
    expect(onWorkspaceUpdated).toHaveBeenCalledWith(expect.objectContaining({
      id: 'ws-1',
      currentUserRole: 'admin',
    }));
  });

  it('does not transfer workspace ownership when the confirmation is cancelled', async () => {
    vi.mocked(listWorkspaceMembersResult).mockResolvedValue({
      ok: true,
      value: [
        { workspaceId: 'ws-1', userId: 'owner-1', role: 'owner', joinedAt: 1 },
        { workspaceId: 'ws-1', userId: 'member-1', role: 'member', joinedAt: 2 },
      ],
    });
    vi.stubGlobal('confirm', vi.fn(() => false));

    render(
      <WorkspaceSettingsView
        workspaces={[
          { id: 'ws-1', name: 'Team workspace', kind: 'team', currentUserRole: 'owner', createdAt: 1, updatedAt: 1 },
        ]}
        currentWorkspaceId="ws-1"
        currentUserId="owner-1"
        projects={[]}
        onWorkspaceChange={vi.fn()}
        onWorkspaceCreated={vi.fn()}
        onWorkspaceRemoved={vi.fn()}
        onWorkspaceUpdated={vi.fn()}
        onProjectsChanged={vi.fn()}
        onCreateWorkspaceInvite={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect((screen.getByRole('button', { name: 'Transfer owner' }) as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Transfer owner' }));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(transferWorkspaceOwnerResult).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Transfer owner' })).toBeTruthy();
  });

  it('does not carry owner transfer pending state across workspace switches', async () => {
    vi.mocked(listWorkspaceMembersResult).mockImplementation(async (workspaceId) => ({
      ok: true,
      value: [
        { workspaceId, userId: 'owner-1', role: 'owner', joinedAt: 1 },
        { workspaceId, userId: 'member-1', role: 'member', joinedAt: 2 },
      ],
    }));
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.mocked(transferWorkspaceOwnerResult).mockReturnValue(new Promise(() => {}));
    const props = {
      workspaces: [
        { id: 'ws-1', name: 'Team workspace', kind: 'team' as const, currentUserRole: 'owner' as const, createdAt: 1, updatedAt: 1 },
        { id: 'ws-2', name: 'Second workspace', kind: 'team' as const, currentUserRole: 'owner' as const, createdAt: 1, updatedAt: 1 },
      ],
      currentUserId: 'owner-1',
      projects: [],
      onWorkspaceChange: vi.fn(),
      onWorkspaceCreated: vi.fn(),
      onWorkspaceRemoved: vi.fn(),
      onWorkspaceUpdated: vi.fn(),
      onProjectsChanged: vi.fn(),
      onCreateWorkspaceInvite: vi.fn(),
    };

    const { rerender } = render(
      <WorkspaceSettingsView
        {...props}
        currentWorkspaceId="ws-1"
      />,
    );

    await waitFor(() => {
      expect((screen.getByRole('button', { name: 'Transfer owner' }) as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Transfer owner' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Transferring...' })).toBeTruthy();
    });

    rerender(
      <WorkspaceSettingsView
        {...props}
        currentWorkspaceId="ws-2"
      />,
    );

    expect(screen.queryByRole('button', { name: 'Transferring...' })).toBeNull();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Transfer owner' })).toBeTruthy();
    });
  });

  it('creates configured invite links for team workspaces', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    const onCreateWorkspaceInvite = vi.fn(async () => ({
      ok: true as const,
      value: {
        id: 'inv-new',
        workspaceId: 'ws-1',
        token: 'token-new',
        role: 'admin' as const,
        createdByUserId: 'owner-1',
        createdAt: 1,
        status: 'pending' as const,
        inviteUrl: 'http://localhost/workspace-invites/token-new',
      },
    }));
    const clipboardWrite = vi.fn(async () => undefined);
    Object.assign(navigator, {
      clipboard: { writeText: clipboardWrite },
    });

    render(
      <WorkspaceSettingsView
        workspaces={[
          { id: 'ws-1', name: 'Team workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
        ]}
        currentWorkspaceId="ws-1"
        currentUserId="owner-1"
        projects={[]}
        onWorkspaceChange={vi.fn()}
        onWorkspaceCreated={vi.fn()}
        onWorkspaceRemoved={vi.fn()}
        onWorkspaceUpdated={vi.fn()}
        onProjectsChanged={vi.fn()}
        onCreateWorkspaceInvite={onCreateWorkspaceInvite}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Create invite' })).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText('Invite role'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByLabelText('Invite expiry'), { target: { value: '14' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create invite' }));

    await waitFor(() => {
      expect(onCreateWorkspaceInvite).toHaveBeenCalledWith('ws-1', {
        role: 'admin',
        expiresInDays: 14,
      });
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(
      'Create admin invite? Anyone with this link can join Team workspace as an admin for 14 days. They will be able to manage members, invites, viewer links, project moves, and project ownership.',
    );
    expect(clipboardWrite).toHaveBeenCalledWith('http://localhost/workspace-invites/token-new');
  });

  it('does not create admin invite links when the confirmation is cancelled', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    const onCreateWorkspaceInvite = vi.fn(async () => ({
      ok: true as const,
      value: {
        id: 'inv-new',
        workspaceId: 'ws-1',
        token: 'token-new',
        role: 'admin' as const,
        createdByUserId: 'owner-1',
        createdAt: 1,
        status: 'pending' as const,
        inviteUrl: 'http://localhost/workspace-invites/token-new',
      },
    }));

    render(
      <WorkspaceSettingsView
        workspaces={[
          { id: 'ws-1', name: 'Team workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
        ]}
        currentWorkspaceId="ws-1"
        currentUserId="owner-1"
        projects={[]}
        onWorkspaceChange={vi.fn()}
        onWorkspaceCreated={vi.fn()}
        onWorkspaceRemoved={vi.fn()}
        onWorkspaceUpdated={vi.fn()}
        onProjectsChanged={vi.fn()}
        onCreateWorkspaceInvite={onCreateWorkspaceInvite}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Create invite' })).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText('Invite role'), { target: { value: 'admin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create invite' }));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(onCreateWorkspaceInvite).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Create invite' })).toBeTruthy();
  });

  it('labels current-user activity as You', async () => {
    render(
      <WorkspaceSettingsView
        workspaces={[
          { id: 'ws-1', name: 'Team workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
        ]}
        currentWorkspaceId="ws-1"
        currentUserId="owner-1"
        projects={[]}
        onWorkspaceChange={vi.fn()}
        onWorkspaceCreated={vi.fn()}
        onWorkspaceRemoved={vi.fn()}
        onWorkspaceUpdated={vi.fn()}
        onProjectsChanged={vi.fn()}
        onCreateWorkspaceInvite={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Created member invite')).toBeTruthy();
    });
    expect(screen.getByText('Created viewer link for Workspace project')).toBeTruthy();
    expect(screen.getByText('Revoked viewer link because artifact-1 was deleted')).toBeTruthy();
    expect(screen.getByText('Revoked viewer link because Workspace project was deleted')).toBeTruthy();
    expect(screen.getByText('Ran routine Daily digest')).toBeTruthy();

    const activitySection = screen.getByRole('heading', { name: 'Activity' }).closest('section');
    expect(activitySection).toBeTruthy();
    expect(within(activitySection as HTMLElement).getAllByText('You').length).toBeGreaterThanOrEqual(1);
  });

  it('shows daemon error messages when invite creation fails', async () => {
    const onCreateWorkspaceInvite = vi.fn(async () => ({
      ok: false as const,
      error: 'Only admins can invite workspace members.',
    }));

    render(
      <WorkspaceSettingsView
        workspaces={[
          { id: 'ws-1', name: 'Team workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
        ]}
        currentWorkspaceId="ws-1"
        currentUserId="owner-1"
        projects={[]}
        onWorkspaceChange={vi.fn()}
        onWorkspaceCreated={vi.fn()}
        onWorkspaceRemoved={vi.fn()}
        onWorkspaceUpdated={vi.fn()}
        onProjectsChanged={vi.fn()}
        onCreateWorkspaceInvite={onCreateWorkspaceInvite}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Create invite' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Create invite' }));

    await waitFor(() => {
      expect(screen.getByText('Only admins can invite workspace members.')).toBeTruthy();
    });
  });

  it('prevents duplicate invite creation while a request is pending', async () => {
    type InviteResult = {
      ok: true;
      value: {
        id: string;
        workspaceId: string;
        token: string;
        role: 'member';
        createdByUserId: string;
        createdAt: number;
        status: 'pending';
        inviteUrl: string;
      };
    };
    let resolveInvite: (value: InviteResult) => void = () => {};
    const onCreateWorkspaceInvite = vi.fn(() => new Promise<InviteResult>((resolve) => {
      resolveInvite = resolve;
    }));

    render(
      <WorkspaceSettingsView
        workspaces={[
          { id: 'ws-1', name: 'Team workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
        ]}
        currentWorkspaceId="ws-1"
        currentUserId="owner-1"
        projects={[]}
        onWorkspaceChange={vi.fn()}
        onWorkspaceCreated={vi.fn()}
        onWorkspaceRemoved={vi.fn()}
        onWorkspaceUpdated={vi.fn()}
        onProjectsChanged={vi.fn()}
        onCreateWorkspaceInvite={onCreateWorkspaceInvite}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Create invite' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Create invite' }));

    await waitFor(() => {
      expect((screen.getByRole('button', { name: 'Creating invite...' }) as HTMLButtonElement).disabled).toBe(true);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Creating invite...' }));
    expect(onCreateWorkspaceInvite).toHaveBeenCalledTimes(1);

    resolveInvite({
      ok: true,
      value: {
        id: 'inv-new',
        workspaceId: 'ws-1',
        token: 'token-new',
        role: 'member',
        createdByUserId: 'owner-1',
        createdAt: 1,
        status: 'pending',
        inviteUrl: 'http://localhost/workspace-invites/token-new',
      },
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Create invite' })).toBeTruthy();
    });
  });

  it('ignores invite creation completions after switching workspaces', async () => {
    type InviteResult = {
      ok: true;
      value: {
        id: string;
        workspaceId: string;
        token: string;
        role: 'member';
        createdByUserId: string;
        createdAt: number;
        status: 'pending';
        inviteUrl: string;
      };
    };
    let resolveInvite: (value: InviteResult) => void = () => {};
    const onCreateWorkspaceInvite = vi.fn(() => new Promise<InviteResult>((resolve) => {
      resolveInvite = resolve;
    }));
    const clipboardWrite = vi.fn(async () => undefined);
    Object.assign(navigator, {
      clipboard: { writeText: clipboardWrite },
    });

    const props = {
      workspaces: [
        { id: 'ws-1', name: 'Team workspace', kind: 'team' as const, createdAt: 1, updatedAt: 1 },
        { id: 'ws-2', name: 'Second workspace', kind: 'team' as const, createdAt: 1, updatedAt: 1 },
      ],
      currentUserId: 'owner-1',
      projects: [],
      onWorkspaceChange: vi.fn(),
      onWorkspaceCreated: vi.fn(),
      onWorkspaceRemoved: vi.fn(),
      onWorkspaceUpdated: vi.fn(),
      onProjectsChanged: vi.fn(),
      onCreateWorkspaceInvite,
    };
    const { rerender } = render(
      <WorkspaceSettingsView
        {...props}
        currentWorkspaceId="ws-1"
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Create invite' })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create invite' }));

    rerender(
      <WorkspaceSettingsView
        {...props}
        currentWorkspaceId="ws-2"
      />,
    );

    expect(screen.queryByRole('button', { name: 'Creating invite...' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Create invite' })).toBeTruthy();
    await waitFor(() => {
      expect(listWorkspaceInvitesResult).toHaveBeenCalledWith('ws-2');
    });
    const ws1DetailRefreshCount = vi.mocked(listWorkspaceMembersResult).mock.calls
      .filter(([workspaceId]) => workspaceId === 'ws-1').length;
    resolveInvite({
      ok: true,
      value: {
        id: 'inv-new',
        workspaceId: 'ws-1',
        token: 'token-new',
        role: 'member',
        createdByUserId: 'owner-1',
        createdAt: 1,
        status: 'pending',
        inviteUrl: 'http://localhost/workspace-invites/token-new',
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(clipboardWrite).not.toHaveBeenCalled();
    expect(vi.mocked(listWorkspaceMembersResult).mock.calls
      .filter(([workspaceId]) => workspaceId === 'ws-1')).toHaveLength(ws1DetailRefreshCount);
  });

  it('prevents duplicate workspace creation while a request is pending', async () => {
    type CreateResult = {
      ok: true;
      value: {
        id: string;
        name: string;
        kind: 'team';
        createdAt: number;
        updatedAt: number;
      };
    };
    let resolveCreate: (value: CreateResult) => void = () => {};
    vi.mocked(createWorkspaceResult).mockReturnValue(new Promise<CreateResult>((resolve) => {
      resolveCreate = resolve;
    }));
    const onWorkspaceCreated = vi.fn(async () => undefined);

    render(
      <WorkspaceSettingsView
        workspaces={[
          { id: 'ws-1', name: 'Team workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
        ]}
        currentWorkspaceId="ws-1"
        currentUserId="owner-1"
        projects={[]}
        onWorkspaceChange={vi.fn()}
        onWorkspaceCreated={onWorkspaceCreated}
        onWorkspaceRemoved={vi.fn()}
        onWorkspaceUpdated={vi.fn()}
        onProjectsChanged={vi.fn()}
        onCreateWorkspaceInvite={vi.fn()}
      />,
    );

    const createSection = screen.getByRole('heading', { name: 'Create workspace' }).closest('section');
    expect(createSection).toBeTruthy();
    const nameInput = within(createSection as HTMLElement).getByPlaceholderText('Workspace name');
    fireEvent.change(nameInput, { target: { value: 'New team' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect((screen.getByRole('button', { name: 'Creating...' }) as HTMLButtonElement).disabled).toBe(true);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Creating...' }));
    expect(createWorkspaceResult).toHaveBeenCalledTimes(1);

    resolveCreate({
      ok: true,
      value: {
        id: 'ws-new',
        name: 'New team',
        kind: 'team',
        createdAt: 2,
        updatedAt: 2,
      },
    });

    await waitFor(() => {
      expect(onWorkspaceCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'ws-new' }));
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Create' })).toBeTruthy();
    });
  });

  it('prevents duplicate workspace renames while a request is pending', async () => {
    type RenameResult = {
      ok: true;
      value: {
        id: string;
        name: string;
        kind: 'team';
        createdAt: number;
        updatedAt: number;
      };
    };
    let resolveRename: (value: RenameResult) => void = () => {};
    vi.mocked(updateWorkspaceNameResult).mockReturnValue(new Promise<RenameResult>((resolve) => {
      resolveRename = resolve;
    }));
    const onWorkspaceUpdated = vi.fn(async () => undefined);

    render(
      <WorkspaceSettingsView
        workspaces={[
          { id: 'ws-1', name: 'Team workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
        ]}
        currentWorkspaceId="ws-1"
        currentUserId="owner-1"
        projects={[]}
        onWorkspaceChange={vi.fn()}
        onWorkspaceCreated={vi.fn()}
        onWorkspaceRemoved={vi.fn()}
        onWorkspaceUpdated={onWorkspaceUpdated}
        onProjectsChanged={vi.fn()}
        onCreateWorkspaceInvite={vi.fn()}
      />,
    );

    const detailsSection = screen.getByRole('heading', { name: 'Workspace details' }).closest('section');
    expect(detailsSection).toBeTruthy();
    fireEvent.change(within(detailsSection as HTMLElement).getByPlaceholderText('Workspace name'), {
      target: { value: 'Renamed team' },
    });
    await waitFor(() => {
      expect((within(detailsSection as HTMLElement).getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(within(detailsSection as HTMLElement).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect((within(detailsSection as HTMLElement).getByRole('button', { name: 'Saving...' }) as HTMLButtonElement).disabled).toBe(true);
    });
    fireEvent.click(within(detailsSection as HTMLElement).getByRole('button', { name: 'Saving...' }));
    expect(updateWorkspaceNameResult).toHaveBeenCalledTimes(1);

    resolveRename({
      ok: true,
      value: {
        id: 'ws-1',
        name: 'Renamed team',
        kind: 'team',
        createdAt: 1,
        updatedAt: 2,
      },
    });

    await waitFor(() => {
      expect(onWorkspaceUpdated).toHaveBeenCalledWith(expect.objectContaining({ name: 'Renamed team' }));
    });
  });

  it('does not carry rename pending state across workspace switches', async () => {
    type RenameResult = {
      ok: true;
      value: {
        id: string;
        name: string;
        kind: 'team';
        createdAt: number;
        updatedAt: number;
      };
    };
    vi.mocked(updateWorkspaceNameResult).mockReturnValue(new Promise<RenameResult>(() => {}));
    const props = {
      workspaces: [
        { id: 'ws-1', name: 'Team workspace', kind: 'team' as const, createdAt: 1, updatedAt: 1 },
        { id: 'ws-2', name: 'Second workspace', kind: 'team' as const, createdAt: 1, updatedAt: 1 },
      ],
      currentUserId: 'owner-1',
      projects: [],
      onWorkspaceChange: vi.fn(),
      onWorkspaceCreated: vi.fn(),
      onWorkspaceRemoved: vi.fn(),
      onWorkspaceUpdated: vi.fn(),
      onProjectsChanged: vi.fn(),
      onCreateWorkspaceInvite: vi.fn(),
    };

    const { rerender } = render(
      <WorkspaceSettingsView
        {...props}
        currentWorkspaceId="ws-1"
      />,
    );

    const detailsSection = screen.getByRole('heading', { name: 'Workspace details' }).closest('section');
    expect(detailsSection).toBeTruthy();
    fireEvent.change(within(detailsSection as HTMLElement).getByPlaceholderText('Workspace name'), {
      target: { value: 'Renaming team' },
    });
    await waitFor(() => {
      expect((within(detailsSection as HTMLElement).getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(within(detailsSection as HTMLElement).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(within(detailsSection as HTMLElement).getByRole('button', { name: 'Saving...' })).toBeTruthy();
    });

    rerender(
      <WorkspaceSettingsView
        {...props}
        currentWorkspaceId="ws-2"
      />,
    );

    expect(screen.queryByRole('button', { name: 'Saving...' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });

  it('prevents duplicate workspace leaves while a request is pending', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.mocked(listWorkspaceMembersResult).mockResolvedValue({
      ok: true,
      value: [
        {
          workspaceId: 'ws-1',
          userId: 'owner-1',
          role: 'owner',
          joinedAt: 1,
          ownedProjectCount: 1,
          ownedRoutineCount: 1,
        },
        {
          workspaceId: 'ws-1',
          userId: 'member-1',
          role: 'member',
          joinedAt: 2,
          ownedProjectCount: 2,
          ownedRoutineCount: 1,
        },
      ],
    });
    let resolveLeave: (value: { ok: true; value: true }) => void = () => {};
    vi.mocked(leaveWorkspaceResult).mockReturnValue(new Promise<{ ok: true; value: true }>((resolve) => {
      resolveLeave = resolve;
    }));
    const onWorkspaceRemoved = vi.fn(async () => undefined);

    render(
      <WorkspaceSettingsView
        workspaces={[
          { id: 'ws-1', name: 'Team workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
        ]}
        currentWorkspaceId="ws-1"
        currentUserId="member-1"
        projects={[]}
        onWorkspaceChange={vi.fn()}
        onWorkspaceCreated={vi.fn()}
        onWorkspaceRemoved={onWorkspaceRemoved}
        onWorkspaceUpdated={vi.fn()}
        onProjectsChanged={vi.fn()}
        onCreateWorkspaceInvite={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/owns 2 projects, 1 routine/)).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));

    await waitFor(() => {
      expect((screen.getByRole('button', { name: 'Leaving...' }) as HTMLButtonElement).disabled).toBe(true);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Leaving...' }));
    expect(leaveWorkspaceResult).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(
      'Leave Team workspace? You will lose access, and your 2 projects and 1 routine will transfer to owner-1. Pending invites and viewer links you created will be revoked.',
    );

    resolveLeave({ ok: true, value: true });

    await waitFor(() => {
      expect(onWorkspaceRemoved).toHaveBeenCalledWith('ws-1');
    });
  });

  it('does not leave a workspace when the confirmation is cancelled', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    vi.mocked(listWorkspaceMembersResult).mockResolvedValue({
      ok: true,
      value: [
        {
          workspaceId: 'ws-1',
          userId: 'owner-1',
          role: 'owner',
          joinedAt: 1,
          ownedProjectCount: 1,
          ownedRoutineCount: 1,
        },
        {
          workspaceId: 'ws-1',
          userId: 'member-1',
          role: 'member',
          joinedAt: 2,
          ownedProjectCount: 2,
          ownedRoutineCount: 1,
        },
      ],
    });

    render(
      <WorkspaceSettingsView
        workspaces={[
          { id: 'ws-1', name: 'Team workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
        ]}
        currentWorkspaceId="ws-1"
        currentUserId="member-1"
        projects={[]}
        onWorkspaceChange={vi.fn()}
        onWorkspaceCreated={vi.fn()}
        onWorkspaceRemoved={vi.fn()}
        onWorkspaceUpdated={vi.fn()}
        onProjectsChanged={vi.fn()}
        onCreateWorkspaceInvite={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/owns 2 projects, 1 routine/)).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(leaveWorkspaceResult).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Leave' })).toBeTruthy();
  });

  it('prevents duplicate workspace deletes while a request is pending', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    let resolveDelete: (value: { ok: true; value: true }) => void = () => {};
    vi.mocked(deleteWorkspaceResult).mockReturnValue(new Promise<{ ok: true; value: true }>((resolve) => {
      resolveDelete = resolve;
    }));
    const onWorkspaceRemoved = vi.fn(async () => undefined);

    render(
      <WorkspaceSettingsView
        workspaces={[
          { id: 'ws-1', name: 'Team workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
        ]}
        currentWorkspaceId="ws-1"
        currentUserId="owner-1"
        projects={[]}
        onWorkspaceChange={vi.fn()}
        onWorkspaceCreated={vi.fn()}
        onWorkspaceRemoved={onWorkspaceRemoved}
        onWorkspaceUpdated={vi.fn()}
        onProjectsChanged={vi.fn()}
        onCreateWorkspaceInvite={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
    });
    expect(screen.getByText(
      'Deleting this workspace removes 2 member records, 1 pending invite, 1 viewer link and activity history. It can only proceed after projects and automations are gone.',
    )).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect((screen.getByRole('button', { name: 'Deleting...' }) as HTMLButtonElement).disabled).toBe(true);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Deleting...' }));
    expect(deleteWorkspaceResult).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(
      'Delete Team workspace? Deleting this workspace removes 2 member records, 1 pending invite, 1 viewer link and activity history. It can only proceed after projects and automations are gone.',
    );

    resolveDelete({ ok: true, value: true });

    await waitFor(() => {
      expect(onWorkspaceRemoved).toHaveBeenCalledWith('ws-1');
    });
  });

  it('does not delete a workspace when the confirmation is cancelled', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false));

    render(
      <WorkspaceSettingsView
        workspaces={[
          { id: 'ws-1', name: 'Team workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
        ]}
        currentWorkspaceId="ws-1"
        currentUserId="owner-1"
        projects={[]}
        onWorkspaceChange={vi.fn()}
        onWorkspaceCreated={vi.fn()}
        onWorkspaceRemoved={vi.fn()}
        onWorkspaceUpdated={vi.fn()}
        onProjectsChanged={vi.fn()}
        onCreateWorkspaceInvite={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(deleteWorkspaceResult).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
  });

  it('explains owner-only lifecycle blockers before dangerous actions', async () => {
    const project: Project = {
      id: 'project-1',
      workspaceId: 'ws-1',
      name: 'Workspace project',
      skillId: null,
      designSystemId: null,
      createdAt: 1,
      updatedAt: 1,
    };

    render(
      <WorkspaceSettingsView
        workspaces={[
          { id: 'ws-1', name: 'Team workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
        ]}
        currentWorkspaceId="ws-1"
        currentUserId="owner-1"
        projects={[project]}
        onWorkspaceChange={vi.fn()}
        onWorkspaceCreated={vi.fn()}
        onWorkspaceRemoved={vi.fn()}
        onWorkspaceUpdated={vi.fn()}
        onProjectsChanged={vi.fn()}
        onCreateWorkspaceInvite={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Transfer ownership before leaving this workspace.')).toBeTruthy();
    });

    expect(screen.getByText('Move or delete all workspace projects before deleting the workspace.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Leave' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Delete' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('copies existing invite and viewer links with feedback', async () => {
    const clipboardWrite = vi.fn(async () => undefined);
    Object.assign(navigator, {
      clipboard: { writeText: clipboardWrite },
    });

    render(
      <WorkspaceSettingsView
        workspaces={[
          { id: 'ws-1', name: 'Team workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
        ]}
        currentWorkspaceId="ws-1"
        currentUserId="owner-1"
        projects={[]}
        onWorkspaceChange={vi.fn()}
        onWorkspaceCreated={vi.fn()}
        onWorkspaceRemoved={vi.fn()}
        onWorkspaceUpdated={vi.fn()}
        onProjectsChanged={vi.fn()}
        onCreateWorkspaceInvite={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('http://localhost/workspace-invites/token-1')).toBeTruthy();
    });

    const invitesSection = screen.getByText('Invites').closest('section');
    expect(invitesSection).toBeTruthy();
    let inviteCopyButtons = within(invitesSection as HTMLElement).getAllByRole('button', { name: 'Copy' });
    expect(within(invitesSection as HTMLElement).getByText(/member · pending · created by owner-1/)).toBeTruthy();
    expect(within(invitesSection as HTMLElement).queryByText('Invite accepted')).toBeNull();
    fireEvent.click(within(invitesSection as HTMLElement).getByRole('button', { name: 'Show history (1)' }));
    expect(within(invitesSection as HTMLElement).getByText('Invite accepted')).toBeTruthy();
    expect(within(invitesSection as HTMLElement).getByText(/admin · accepted · created by owner-1/)).toBeTruthy();
    expect(within(invitesSection as HTMLElement).getByRole('button', { name: 'Hide history' })).toBeTruthy();
    inviteCopyButtons = within(invitesSection as HTMLElement).getAllByRole('button', { name: 'Copy' });
    expect((inviteCopyButtons[1] as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(inviteCopyButtons[0]!);
    await waitFor(() => {
      expect(screen.getByText('Invite link copied.')).toBeTruthy();
    });
    expect(clipboardWrite).toHaveBeenCalledWith('http://localhost/workspace-invites/token-1');

    const viewerLinksSection = screen.getByRole('heading', { name: 'Viewer links' }).closest('section');
    expect(viewerLinksSection).toBeTruthy();
    expect(
      within(viewerLinksSection as HTMLElement).getByText(/Workspace project · viewer · artifact-1 · created by owner-1/),
    ).toBeTruthy();
    fireEvent.click(within(viewerLinksSection as HTMLElement).getByRole('button', { name: 'Copy' }));
    await waitFor(() => {
      expect(screen.getByText('Viewer link copied.')).toBeTruthy();
    });
    expect(clipboardWrite).toHaveBeenCalledWith('http://localhost/share/live-artifact/share-token');
  });

  it('ignores invite copy feedback after switching workspaces', async () => {
    let resolveClipboard: () => void = () => {};
    const clipboardWrite = vi.fn(() => new Promise<void>((resolve) => {
      resolveClipboard = resolve;
    }));
    Object.assign(navigator, {
      clipboard: { writeText: clipboardWrite },
    });

    const { rerender } = render(
      <WorkspaceSettingsView
        workspaces={[
          { id: 'ws-1', name: 'Team workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
          { id: 'ws-2', name: 'Other workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
        ]}
        currentWorkspaceId="ws-1"
        currentUserId="owner-1"
        projects={[]}
        onWorkspaceChange={vi.fn()}
        onWorkspaceCreated={vi.fn()}
        onWorkspaceRemoved={vi.fn()}
        onWorkspaceUpdated={vi.fn()}
        onProjectsChanged={vi.fn()}
        onCreateWorkspaceInvite={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('http://localhost/workspace-invites/token-1')).toBeTruthy();
    });

    const invitesSection = screen.getByText('Invites').closest('section');
    expect(invitesSection).toBeTruthy();
    fireEvent.click(within(invitesSection as HTMLElement).getAllByRole('button', { name: 'Copy' })[0]!);
    await waitFor(() => {
      expect(clipboardWrite).toHaveBeenCalledWith('http://localhost/workspace-invites/token-1');
    });

    rerender(
      <WorkspaceSettingsView
        workspaces={[
          { id: 'ws-1', name: 'Team workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
          { id: 'ws-2', name: 'Other workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
        ]}
        currentWorkspaceId="ws-2"
        currentUserId="owner-1"
        projects={[]}
        onWorkspaceChange={vi.fn()}
        onWorkspaceCreated={vi.fn()}
        onWorkspaceRemoved={vi.fn()}
        onWorkspaceUpdated={vi.fn()}
        onProjectsChanged={vi.fn()}
        onCreateWorkspaceInvite={vi.fn()}
      />,
    );

    resolveClipboard();

    await waitFor(() => {
      expect(screen.queryByText('Invite link copied.')).toBeNull();
    });
  });

  it('ignores viewer link copy feedback after switching workspaces', async () => {
    let resolveClipboard: () => void = () => {};
    const clipboardWrite = vi.fn(() => new Promise<void>((resolve) => {
      resolveClipboard = resolve;
    }));
    Object.assign(navigator, {
      clipboard: { writeText: clipboardWrite },
    });

    const { rerender } = render(
      <WorkspaceSettingsView
        workspaces={[
          { id: 'ws-1', name: 'Team workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
          { id: 'ws-2', name: 'Other workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
        ]}
        currentWorkspaceId="ws-1"
        currentUserId="owner-1"
        projects={[]}
        onWorkspaceChange={vi.fn()}
        onWorkspaceCreated={vi.fn()}
        onWorkspaceRemoved={vi.fn()}
        onWorkspaceUpdated={vi.fn()}
        onProjectsChanged={vi.fn()}
        onCreateWorkspaceInvite={vi.fn()}
      />,
    );

    const viewerLinksSection = await waitFor(() => {
      const section = screen.getByRole('heading', { name: 'Viewer links' }).closest('section');
      expect(section).toBeTruthy();
      expect(within(section as HTMLElement).getByText('http://localhost/share/live-artifact/share-token')).toBeTruthy();
      return section as HTMLElement;
    });
    fireEvent.click(within(viewerLinksSection).getByRole('button', { name: 'Copy' }));
    await waitFor(() => {
      expect(clipboardWrite).toHaveBeenCalledWith('http://localhost/share/live-artifact/share-token');
    });

    rerender(
      <WorkspaceSettingsView
        workspaces={[
          { id: 'ws-1', name: 'Team workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
          { id: 'ws-2', name: 'Other workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
        ]}
        currentWorkspaceId="ws-2"
        currentUserId="owner-1"
        projects={[]}
        onWorkspaceChange={vi.fn()}
        onWorkspaceCreated={vi.fn()}
        onWorkspaceRemoved={vi.fn()}
        onWorkspaceUpdated={vi.fn()}
        onProjectsChanged={vi.fn()}
        onCreateWorkspaceInvite={vi.fn()}
      />,
    );

    resolveClipboard();

    await waitFor(() => {
      expect(screen.queryByText('Viewer link copied.')).toBeNull();
    });
  });

  it('prevents duplicate invite revokes while a request is pending', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    let resolveRevoke: (value: { ok: true; value: true }) => void = () => {};
    vi.mocked(deleteWorkspaceInviteResult).mockReturnValue(new Promise<{ ok: true; value: true }>((resolve) => {
      resolveRevoke = resolve;
    }));

    render(
      <WorkspaceSettingsView
        workspaces={[
          { id: 'ws-1', name: 'Team workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
        ]}
        currentWorkspaceId="ws-1"
        currentUserId="owner-1"
        projects={[]}
        onWorkspaceChange={vi.fn()}
        onWorkspaceCreated={vi.fn()}
        onWorkspaceRemoved={vi.fn()}
        onWorkspaceUpdated={vi.fn()}
        onProjectsChanged={vi.fn()}
        onCreateWorkspaceInvite={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('http://localhost/workspace-invites/token-1')).toBeTruthy();
    });
    const invitesSection = screen.getByText('Invites').closest('section');
    expect(invitesSection).toBeTruthy();
    const revokeButtons = within(invitesSection as HTMLElement).getAllByRole('button', { name: 'Revoke' });
    fireEvent.click(revokeButtons[0]!);

    await waitFor(() => {
      expect((within(invitesSection as HTMLElement).getByRole('button', { name: 'Revoking...' }) as HTMLButtonElement).disabled).toBe(true);
    });
    fireEvent.click(within(invitesSection as HTMLElement).getByRole('button', { name: 'Revoking...' }));
    expect(deleteWorkspaceInviteResult).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(
      'Revoke invite link? This member invite link will stop letting new people join. Existing workspace members are not affected.',
    );

    resolveRevoke({ ok: true, value: true });
    await waitFor(() => {
      expect(deleteWorkspaceInviteResult).toHaveBeenCalledTimes(1);
    });
  });

  it('does not revoke an invite link when the confirmation is cancelled', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false));

    render(
      <WorkspaceSettingsView
        workspaces={[
          { id: 'ws-1', name: 'Team workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
        ]}
        currentWorkspaceId="ws-1"
        currentUserId="owner-1"
        projects={[]}
        onWorkspaceChange={vi.fn()}
        onWorkspaceCreated={vi.fn()}
        onWorkspaceRemoved={vi.fn()}
        onWorkspaceUpdated={vi.fn()}
        onProjectsChanged={vi.fn()}
        onCreateWorkspaceInvite={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('http://localhost/workspace-invites/token-1')).toBeTruthy();
    });
    const invitesSection = screen.getByText('Invites').closest('section');
    expect(invitesSection).toBeTruthy();
    fireEvent.click(within(invitesSection as HTMLElement).getAllByRole('button', { name: 'Revoke' })[0]!);

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(deleteWorkspaceInviteResult).not.toHaveBeenCalled();
    expect(within(invitesSection as HTMLElement).getAllByRole('button', { name: 'Revoke' })[0]).toBeTruthy();
  });

  it('ignores invite revoke completions after switching workspaces', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    let resolveRevoke: (value: { ok: true; value: true }) => void = () => {};
    vi.mocked(deleteWorkspaceInviteResult).mockReturnValue(new Promise<{ ok: true; value: true }>((resolve) => {
      resolveRevoke = resolve;
    }));

    const props = {
      workspaces: [
        { id: 'ws-1', name: 'Team workspace', kind: 'team' as const, createdAt: 1, updatedAt: 1 },
        { id: 'ws-2', name: 'Second workspace', kind: 'team' as const, createdAt: 1, updatedAt: 1 },
      ],
      currentUserId: 'owner-1',
      projects: [],
      onWorkspaceChange: vi.fn(),
      onWorkspaceCreated: vi.fn(),
      onWorkspaceRemoved: vi.fn(),
      onWorkspaceUpdated: vi.fn(),
      onProjectsChanged: vi.fn(),
      onCreateWorkspaceInvite: vi.fn(),
    };
    const { rerender } = render(
      <WorkspaceSettingsView
        {...props}
        currentWorkspaceId="ws-1"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('http://localhost/workspace-invites/token-1')).toBeTruthy();
    });
    const invitesSection = screen.getByText('Invites').closest('section');
    expect(invitesSection).toBeTruthy();
    fireEvent.click(within(invitesSection as HTMLElement).getAllByRole('button', { name: 'Revoke' })[0]!);

    rerender(
      <WorkspaceSettingsView
        {...props}
        currentWorkspaceId="ws-2"
      />,
    );

    await waitFor(() => {
      expect(listWorkspaceInvitesResult).toHaveBeenCalledWith('ws-2');
    });
    const ws1DetailRefreshCount = vi.mocked(listWorkspaceMembersResult).mock.calls
      .filter(([workspaceId]) => workspaceId === 'ws-1').length;
    resolveRevoke({ ok: true, value: true });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(vi.mocked(listWorkspaceMembersResult).mock.calls
      .filter(([workspaceId]) => workspaceId === 'ws-1')).toHaveLength(ws1DetailRefreshCount);
  });

  it('prevents duplicate viewer link revokes while a request is pending', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    let resolveRevoke: (value: { ok: true; value: true }) => void = () => {};
    vi.mocked(revokeWorkspaceShareResult).mockReturnValue(new Promise<{ ok: true; value: true }>((resolve) => {
      resolveRevoke = resolve;
    }));

    render(
      <WorkspaceSettingsView
        workspaces={[
          { id: 'ws-1', name: 'Team workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
        ]}
        currentWorkspaceId="ws-1"
        currentUserId="owner-1"
        projects={[]}
        onWorkspaceChange={vi.fn()}
        onWorkspaceCreated={vi.fn()}
        onWorkspaceRemoved={vi.fn()}
        onWorkspaceUpdated={vi.fn()}
        onProjectsChanged={vi.fn()}
        onCreateWorkspaceInvite={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('http://localhost/share/live-artifact/share-token')).toBeTruthy();
    });
    const viewerLinksSection = screen.getByRole('heading', { name: 'Viewer links' }).closest('section');
    expect(viewerLinksSection).toBeTruthy();
    fireEvent.click(within(viewerLinksSection as HTMLElement).getByRole('button', { name: 'Revoke' }));

    await waitFor(() => {
      expect((within(viewerLinksSection as HTMLElement).getByRole('button', { name: 'Revoking...' }) as HTMLButtonElement).disabled).toBe(true);
    });
    fireEvent.click(within(viewerLinksSection as HTMLElement).getByRole('button', { name: 'Revoking...' }));
    expect(revokeWorkspaceShareResult).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(
      'Revoke viewer link? External viewers will lose access to Workspace project for artifact-1. The artifact itself stays in the workspace.',
    );

    resolveRevoke({ ok: true, value: true });
    await waitFor(() => {
      expect(revokeWorkspaceShareResult).toHaveBeenCalledTimes(1);
    });
  });

  it('does not revoke a viewer link when the confirmation is cancelled', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false));

    render(
      <WorkspaceSettingsView
        workspaces={[
          { id: 'ws-1', name: 'Team workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
        ]}
        currentWorkspaceId="ws-1"
        currentUserId="owner-1"
        projects={[]}
        onWorkspaceChange={vi.fn()}
        onWorkspaceCreated={vi.fn()}
        onWorkspaceRemoved={vi.fn()}
        onWorkspaceUpdated={vi.fn()}
        onProjectsChanged={vi.fn()}
        onCreateWorkspaceInvite={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('http://localhost/share/live-artifact/share-token')).toBeTruthy();
    });
    const viewerLinksSection = screen.getByRole('heading', { name: 'Viewer links' }).closest('section');
    expect(viewerLinksSection).toBeTruthy();
    fireEvent.click(within(viewerLinksSection as HTMLElement).getByRole('button', { name: 'Revoke' }));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(revokeWorkspaceShareResult).not.toHaveBeenCalled();
    expect(within(viewerLinksSection as HTMLElement).getByRole('button', { name: 'Revoke' })).toBeTruthy();
  });

  it('ignores viewer link revoke completions after switching workspaces', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    let resolveRevoke: (value: { ok: true; value: true }) => void = () => {};
    vi.mocked(revokeWorkspaceShareResult).mockReturnValue(new Promise<{ ok: true; value: true }>((resolve) => {
      resolveRevoke = resolve;
    }));

    const props = {
      workspaces: [
        { id: 'ws-1', name: 'Team workspace', kind: 'team' as const, createdAt: 1, updatedAt: 1 },
        { id: 'ws-2', name: 'Second workspace', kind: 'team' as const, createdAt: 1, updatedAt: 1 },
      ],
      currentUserId: 'owner-1',
      projects: [],
      onWorkspaceChange: vi.fn(),
      onWorkspaceCreated: vi.fn(),
      onWorkspaceRemoved: vi.fn(),
      onWorkspaceUpdated: vi.fn(),
      onProjectsChanged: vi.fn(),
      onCreateWorkspaceInvite: vi.fn(),
    };
    const { rerender } = render(
      <WorkspaceSettingsView
        {...props}
        currentWorkspaceId="ws-1"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('http://localhost/share/live-artifact/share-token')).toBeTruthy();
    });
    const viewerLinksSection = screen.getByRole('heading', { name: 'Viewer links' }).closest('section');
    expect(viewerLinksSection).toBeTruthy();
    fireEvent.click(within(viewerLinksSection as HTMLElement).getByRole('button', { name: 'Revoke' }));

    rerender(
      <WorkspaceSettingsView
        {...props}
        currentWorkspaceId="ws-2"
      />,
    );

    await waitFor(() => {
      expect(listWorkspaceSharesResult).toHaveBeenCalledWith('ws-2');
    });
    const ws1DetailRefreshCount = vi.mocked(listWorkspaceMembersResult).mock.calls
      .filter(([workspaceId]) => workspaceId === 'ws-1').length;
    resolveRevoke({ ok: true, value: true });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(vi.mocked(listWorkspaceMembersResult).mock.calls
      .filter(([workspaceId]) => workspaceId === 'ws-1')).toHaveLength(ws1DetailRefreshCount);
  });

  it('surfaces project move errors from the daemon', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.mocked(patchProjectResult).mockResolvedValue({
      ok: false,
      error: 'Admin or owner access required to move projects.',
    });
    const project: Project = {
      id: 'project-1',
      workspaceId: 'ws-1',
      name: 'Workspace project',
      skillId: null,
      designSystemId: null,
      createdAt: 1,
      updatedAt: 1,
    };

    render(
      <WorkspaceSettingsView
        workspaces={[
          { id: 'ws-1', name: 'Team workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
          { id: 'ws-2', name: 'Other workspace', kind: 'team', currentUserRole: 'admin', createdAt: 1, updatedAt: 1 },
        ]}
        currentWorkspaceId="ws-1"
        currentUserId="owner-1"
        projects={[project]}
        onWorkspaceChange={vi.fn()}
        onWorkspaceCreated={vi.fn()}
        onWorkspaceRemoved={vi.fn()}
        onWorkspaceUpdated={vi.fn()}
        onProjectsChanged={vi.fn()}
        onCreateWorkspaceInvite={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Workspace project')).toBeTruthy();
    });
    const projectsSection = screen.getByRole('heading', { name: 'Projects' }).closest('section');
    expect(projectsSection).toBeTruthy();
    fireEvent.change(within(projectsSection as HTMLElement).getByLabelText('Move Workspace project'), { target: { value: 'ws-2' } });
    fireEvent.click(within(projectsSection as HTMLElement).getByRole('button', { name: 'Move' }));

    await waitFor(() => {
      expect(screen.getByText('Admin or owner access required to move projects.')).toBeTruthy();
    });
  });

  it('prevents duplicate project moves while a request is pending', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    type MoveResult = {
      ok: true;
      value: Project;
    };
    let resolveMove: (value: MoveResult) => void = () => {};
    const movedProject: Project = {
      id: 'project-1',
      workspaceId: 'ws-2',
      name: 'Workspace project',
      skillId: null,
      designSystemId: null,
      createdAt: 1,
      updatedAt: 2,
    };
    vi.mocked(patchProjectResult).mockReturnValue(new Promise<MoveResult>((resolve) => {
      resolveMove = resolve;
    }));
    const onProjectsChanged = vi.fn(async () => undefined);

    render(
      <WorkspaceSettingsView
        workspaces={[
          { id: 'ws-1', name: 'Team workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
          { id: 'ws-2', name: 'Other workspace', kind: 'team', currentUserRole: 'admin', createdAt: 1, updatedAt: 1 },
        ]}
        currentWorkspaceId="ws-1"
        currentUserId="owner-1"
        projects={[{ ...movedProject, workspaceId: 'ws-1', updatedAt: 1 }]}
        onWorkspaceChange={vi.fn()}
        onWorkspaceCreated={vi.fn()}
        onWorkspaceRemoved={vi.fn()}
        onWorkspaceUpdated={vi.fn()}
        onProjectsChanged={onProjectsChanged}
        onCreateWorkspaceInvite={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Workspace project')).toBeTruthy();
    });
    const projectsSection = screen.getByRole('heading', { name: 'Projects' }).closest('section');
    expect(projectsSection).toBeTruthy();
    fireEvent.change(within(projectsSection as HTMLElement).getByLabelText('Move Workspace project'), { target: { value: 'ws-2' } });
    fireEvent.click(within(projectsSection as HTMLElement).getByRole('button', { name: 'Move' }));

    await waitFor(() => {
      expect((within(projectsSection as HTMLElement).getByRole('button', { name: 'Moving...' }) as HTMLButtonElement).disabled).toBe(true);
    });
    fireEvent.click(within(projectsSection as HTMLElement).getByRole('button', { name: 'Moving...' }));
    expect(patchProjectResult).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(
      'Move Workspace project? Workspace project will move to Other workspace. Existing deployments and viewer links stay attached to the project and move with it.',
    );

    resolveMove({ ok: true, value: movedProject });

    await waitFor(() => {
      expect(onProjectsChanged).toHaveBeenCalled();
    });
  });

  it('does not move a project when the confirmation is cancelled', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    const project: Project = {
      id: 'project-1',
      workspaceId: 'ws-1',
      name: 'Workspace project',
      skillId: null,
      designSystemId: null,
      createdAt: 1,
      updatedAt: 1,
    };

    render(
      <WorkspaceSettingsView
        workspaces={[
          { id: 'ws-1', name: 'Team workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
          { id: 'ws-2', name: 'Other workspace', kind: 'team', currentUserRole: 'admin', createdAt: 1, updatedAt: 1 },
        ]}
        currentWorkspaceId="ws-1"
        currentUserId="owner-1"
        projects={[project]}
        onWorkspaceChange={vi.fn()}
        onWorkspaceCreated={vi.fn()}
        onWorkspaceRemoved={vi.fn()}
        onWorkspaceUpdated={vi.fn()}
        onProjectsChanged={vi.fn()}
        onCreateWorkspaceInvite={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Workspace project')).toBeTruthy();
    });
    const projectsSection = screen.getByRole('heading', { name: 'Projects' }).closest('section');
    expect(projectsSection).toBeTruthy();
    fireEvent.change(within(projectsSection as HTMLElement).getByLabelText('Move Workspace project'), { target: { value: 'ws-2' } });
    fireEvent.click(within(projectsSection as HTMLElement).getByRole('button', { name: 'Move' }));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(patchProjectResult).not.toHaveBeenCalled();
    expect(within(projectsSection as HTMLElement).getByRole('button', { name: 'Move' })).toBeTruthy();
  });

  it('ignores project move completions after switching workspaces', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    type MoveResult = {
      ok: true;
      value: Project;
    };
    let resolveMove: (value: MoveResult) => void = () => {};
    const movedProject: Project = {
      id: 'project-1',
      workspaceId: 'ws-2',
      name: 'Workspace project',
      skillId: null,
      designSystemId: null,
      createdAt: 1,
      updatedAt: 2,
    };
    vi.mocked(patchProjectResult).mockReturnValue(new Promise<MoveResult>((resolve) => {
      resolveMove = resolve;
    }));
    const onProjectsChanged = vi.fn(async () => undefined);
    const props = {
      workspaces: [
        { id: 'ws-1', name: 'Team workspace', kind: 'team' as const, createdAt: 1, updatedAt: 1 },
        { id: 'ws-2', name: 'Other workspace', kind: 'team' as const, currentUserRole: 'admin' as const, createdAt: 1, updatedAt: 1 },
      ],
      currentUserId: 'owner-1',
      projects: [{ ...movedProject, workspaceId: 'ws-1', updatedAt: 1 }],
      onWorkspaceChange: vi.fn(),
      onWorkspaceCreated: vi.fn(),
      onWorkspaceRemoved: vi.fn(),
      onWorkspaceUpdated: vi.fn(),
      onProjectsChanged,
      onCreateWorkspaceInvite: vi.fn(),
    };

    const { rerender } = render(
      <WorkspaceSettingsView
        {...props}
        currentWorkspaceId="ws-1"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Workspace project')).toBeTruthy();
    });
    const projectsSection = screen.getByRole('heading', { name: 'Projects' }).closest('section');
    expect(projectsSection).toBeTruthy();
    fireEvent.change(within(projectsSection as HTMLElement).getByLabelText('Move Workspace project'), { target: { value: 'ws-2' } });
    fireEvent.click(within(projectsSection as HTMLElement).getByRole('button', { name: 'Move' }));

    rerender(
      <WorkspaceSettingsView
        {...props}
        currentWorkspaceId="ws-2"
      />,
    );

    await waitFor(() => {
      expect(listWorkspaceMembersResult).toHaveBeenCalledWith('ws-2');
    });
    const ws1DetailRefreshCount = vi.mocked(listWorkspaceMembersResult).mock.calls
      .filter(([workspaceId]) => workspaceId === 'ws-1').length;
    resolveMove({ ok: true, value: movedProject });

    await waitFor(() => {
      expect(onProjectsChanged).toHaveBeenCalled();
    });
    expect(vi.mocked(listWorkspaceMembersResult).mock.calls
      .filter(([workspaceId]) => workspaceId === 'ws-1')).toHaveLength(ws1DetailRefreshCount);
  });

  it('ignores project move failures after switching workspaces', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    type MoveResult = {
      ok: false;
      error: string;
    };
    let resolveMove: (value: MoveResult) => void = () => {};
    const project: Project = {
      id: 'project-1',
      workspaceId: 'ws-1',
      name: 'Workspace project',
      skillId: null,
      designSystemId: null,
      createdAt: 1,
      updatedAt: 1,
    };
    vi.mocked(patchProjectResult).mockReturnValue(new Promise<MoveResult>((resolve) => {
      resolveMove = resolve;
    }));
    const props = {
      workspaces: [
        { id: 'ws-1', name: 'Team workspace', kind: 'team' as const, createdAt: 1, updatedAt: 1 },
        { id: 'ws-2', name: 'Other workspace', kind: 'team' as const, currentUserRole: 'admin' as const, createdAt: 1, updatedAt: 1 },
      ],
      currentUserId: 'owner-1',
      projects: [project],
      onWorkspaceChange: vi.fn(),
      onWorkspaceCreated: vi.fn(),
      onWorkspaceRemoved: vi.fn(),
      onWorkspaceUpdated: vi.fn(),
      onProjectsChanged: vi.fn(),
      onCreateWorkspaceInvite: vi.fn(),
    };

    const { rerender } = render(
      <WorkspaceSettingsView
        {...props}
        currentWorkspaceId="ws-1"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Workspace project')).toBeTruthy();
    });
    const projectsSection = screen.getByRole('heading', { name: 'Projects' }).closest('section');
    expect(projectsSection).toBeTruthy();
    fireEvent.change(within(projectsSection as HTMLElement).getByLabelText('Move Workspace project'), { target: { value: 'ws-2' } });
    fireEvent.click(within(projectsSection as HTMLElement).getByRole('button', { name: 'Move' }));

    rerender(
      <WorkspaceSettingsView
        {...props}
        currentWorkspaceId="ws-2"
      />,
    );

    await waitFor(() => {
      expect(listWorkspaceMembersResult).toHaveBeenCalledWith('ws-2');
    });
    resolveMove({ ok: false, error: 'Admin or owner access required to move projects.' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.queryByText('Admin or owner access required to move projects.')).toBeNull();
  });

  it('transfers project owner from workspace settings', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    const updatedProject: Project = {
      id: 'project-1',
      workspaceId: 'ws-1',
      name: 'Workspace project',
      ownedByUserId: 'member-1',
      skillId: null,
      designSystemId: null,
      createdAt: 1,
      updatedAt: 2,
    };
    vi.mocked(patchProjectResult).mockResolvedValue({ ok: true, value: updatedProject });
    const onProjectsChanged = vi.fn(async () => undefined);

    render(
      <WorkspaceSettingsView
        workspaces={[
          { id: 'ws-1', name: 'Team workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
        ]}
        currentWorkspaceId="ws-1"
        currentUserId="owner-1"
        projects={[{ ...updatedProject, ownedByUserId: 'owner-1', updatedAt: 1 }]}
        onWorkspaceChange={vi.fn()}
        onWorkspaceCreated={vi.fn()}
        onWorkspaceRemoved={vi.fn()}
        onWorkspaceUpdated={vi.fn()}
        onProjectsChanged={onProjectsChanged}
        onCreateWorkspaceInvite={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Workspace project')).toBeTruthy();
    });
    const projectsSection = screen.getByRole('heading', { name: 'Projects' }).closest('section');
    expect(projectsSection).toBeTruthy();
    fireEvent.change(within(projectsSection as HTMLElement).getByLabelText('Transfer owner for Workspace project'), {
      target: { value: 'member-1' },
    });
    fireEvent.click(within(projectsSection as HTMLElement).getByRole('button', { name: 'Transfer' }));

    await waitFor(() => {
      expect(patchProjectResult).toHaveBeenCalledWith('project-1', { ownedByUserId: 'member-1' });
      expect(onProjectsChanged).toHaveBeenCalled();
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(
      'Transfer Workspace project owner? Workspace project will stay in this workspace, but member-1 will become responsible for it.',
    );
  });

  it('uses the project creator as the current owner when ownedByUserId is absent', async () => {
    const project: Project = {
      id: 'project-1',
      workspaceId: 'ws-1',
      name: 'Legacy project',
      createdByUserId: 'owner-1',
      skillId: null,
      designSystemId: null,
      createdAt: 1,
      updatedAt: 1,
    };

    render(
      <WorkspaceSettingsView
        workspaces={[
          { id: 'ws-1', name: 'Team workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
        ]}
        currentWorkspaceId="ws-1"
        currentUserId="owner-1"
        projects={[project]}
        onWorkspaceChange={vi.fn()}
        onWorkspaceCreated={vi.fn()}
        onWorkspaceRemoved={vi.fn()}
        onWorkspaceUpdated={vi.fn()}
        onProjectsChanged={vi.fn()}
        onCreateWorkspaceInvite={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Legacy project')).toBeTruthy();
    });
    const projectsSection = screen.getByRole('heading', { name: 'Projects' }).closest('section');
    expect(projectsSection).toBeTruthy();
    const ownerSelect = within(projectsSection as HTMLElement).getByLabelText('Transfer owner for Legacy project') as HTMLSelectElement;
    expect(ownerSelect.value).toBe('owner-1');
    expect((within(projectsSection as HTMLElement).getByRole('button', { name: 'Transfer' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(ownerSelect, { target: { value: 'member-1' } });
    expect((within(projectsSection as HTMLElement).getByRole('button', { name: 'Transfer' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('does not transfer project owner when the confirmation is cancelled', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    const project: Project = {
      id: 'project-1',
      workspaceId: 'ws-1',
      name: 'Workspace project',
      ownedByUserId: 'owner-1',
      skillId: null,
      designSystemId: null,
      createdAt: 1,
      updatedAt: 1,
    };

    render(
      <WorkspaceSettingsView
        workspaces={[
          { id: 'ws-1', name: 'Team workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
        ]}
        currentWorkspaceId="ws-1"
        currentUserId="owner-1"
        projects={[project]}
        onWorkspaceChange={vi.fn()}
        onWorkspaceCreated={vi.fn()}
        onWorkspaceRemoved={vi.fn()}
        onWorkspaceUpdated={vi.fn()}
        onProjectsChanged={vi.fn()}
        onCreateWorkspaceInvite={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Workspace project')).toBeTruthy();
    });
    const projectsSection = screen.getByRole('heading', { name: 'Projects' }).closest('section');
    expect(projectsSection).toBeTruthy();
    fireEvent.change(within(projectsSection as HTMLElement).getByLabelText('Transfer owner for Workspace project'), {
      target: { value: 'member-1' },
    });
    fireEvent.click(within(projectsSection as HTMLElement).getByRole('button', { name: 'Transfer' }));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(patchProjectResult).not.toHaveBeenCalled();
    expect(within(projectsSection as HTMLElement).getByRole('button', { name: 'Transfer' })).toBeTruthy();
  });

  it('ignores project owner transfer failures after switching workspaces', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    type TransferResult = {
      ok: false;
      error: string;
    };
    let resolveTransfer: (value: TransferResult) => void = () => {};
    vi.mocked(patchProjectResult).mockReturnValue(new Promise<TransferResult>((resolve) => {
      resolveTransfer = resolve;
    }));
    const project: Project = {
      id: 'project-1',
      workspaceId: 'ws-1',
      name: 'Workspace project',
      ownedByUserId: 'owner-1',
      skillId: null,
      designSystemId: null,
      createdAt: 1,
      updatedAt: 1,
    };
    const props = {
      workspaces: [
        { id: 'ws-1', name: 'Team workspace', kind: 'team' as const, createdAt: 1, updatedAt: 1 },
        { id: 'ws-2', name: 'Other workspace', kind: 'team' as const, createdAt: 1, updatedAt: 1 },
      ],
      currentUserId: 'owner-1',
      projects: [project],
      onWorkspaceChange: vi.fn(),
      onWorkspaceCreated: vi.fn(),
      onWorkspaceRemoved: vi.fn(),
      onWorkspaceUpdated: vi.fn(),
      onProjectsChanged: vi.fn(),
      onCreateWorkspaceInvite: vi.fn(),
    };

    const { rerender } = render(
      <WorkspaceSettingsView
        {...props}
        currentWorkspaceId="ws-1"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Workspace project')).toBeTruthy();
    });
    const projectsSection = screen.getByRole('heading', { name: 'Projects' }).closest('section');
    expect(projectsSection).toBeTruthy();
    fireEvent.change(within(projectsSection as HTMLElement).getByLabelText('Transfer owner for Workspace project'), {
      target: { value: 'member-1' },
    });
    fireEvent.click(within(projectsSection as HTMLElement).getByRole('button', { name: 'Transfer' }));

    rerender(
      <WorkspaceSettingsView
        {...props}
        currentWorkspaceId="ws-2"
      />,
    );

    await waitFor(() => {
      expect(listWorkspaceMembersResult).toHaveBeenCalledWith('ws-2');
    });
    resolveTransfer({ ok: false, error: 'Admin or owner access required to transfer project ownership.' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.queryByText('Admin or owner access required to transfer project ownership.')).toBeNull();
  });

  it('shows daemon error messages for workspace lifecycle actions', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.mocked(deleteWorkspaceResult).mockResolvedValue({
      ok: false,
      error: 'Move or delete all projects before deleting this workspace.',
    });

    render(
      <WorkspaceSettingsView
        workspaces={[
          { id: 'ws-1', name: 'Team workspace', kind: 'team', createdAt: 1, updatedAt: 1 },
        ]}
        currentWorkspaceId="ws-1"
        currentUserId="owner-1"
        projects={[]}
        onWorkspaceChange={vi.fn()}
        onWorkspaceCreated={vi.fn()}
        onWorkspaceRemoved={vi.fn()}
        onWorkspaceUpdated={vi.fn()}
        onProjectsChanged={vi.fn()}
        onCreateWorkspaceInvite={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(screen.getByText('Move or delete all projects before deleting this workspace.')).toBeTruthy();
    });
  });
});

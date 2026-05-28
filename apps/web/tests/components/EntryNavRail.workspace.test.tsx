// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EntryNavRail } from '../../src/components/EntryNavRail';

vi.mock('../../src/i18n', () => ({
  useT: () => (key: string) => {
    const labels: Record<string, string> = {
      'app.brand': 'Open Design',
      'entry.helpAria': 'Help',
      'entry.navDesignSystems': 'Design systems',
      'entry.navHome': 'Home',
      'entry.navNewProject': 'New project',
      'entry.navProjects': 'Projects',
    };
    return labels[key] ?? key;
  },
}));

describe('EntryNavRail workspace popover', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('switches workspaces and enables invites for the selected team workspace immediately', async () => {
    const onWorkspaceChange = vi.fn();
    const clipboardWrite = vi.fn(async () => undefined);
    Object.assign(navigator, {
      clipboard: { writeText: clipboardWrite },
    });
    const onCreateWorkspaceInvite = vi.fn(async () => ({
      ok: true as const,
      value: {
        id: 'inv-1',
        workspaceId: 'team-1',
        token: 'token-1',
        role: 'member' as const,
        createdByUserId: 'owner-1',
        createdAt: 1,
        status: 'pending' as const,
        inviteUrl: 'http://localhost/workspace-invites/token-1',
      },
    }));

    render(
      <EntryNavRail
        view="home"
        workspaces={[
          { id: 'local-personal', name: 'Personal Workspace', kind: 'local', createdAt: 1, updatedAt: 1 },
          { id: 'team-1', name: 'Team Workspace', kind: 'team', currentUserRole: 'admin', createdAt: 1, updatedAt: 1 },
        ]}
        currentWorkspaceId="local-personal"
        onViewChange={vi.fn()}
        onNewProject={vi.fn()}
        onWorkspaceChange={onWorkspaceChange}
        onCreateWorkspaceInvite={onCreateWorkspaceInvite}
      />,
    );

    fireEvent.click(screen.getByTestId('entry-nav-logo'));
    const invite = screen.getByRole('button', { name: 'Invite members' }) as HTMLButtonElement;
    expect(invite.disabled).toBe(true);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'team-1' } });
    expect(onWorkspaceChange).toHaveBeenCalledWith('team-1');
    expect(onCreateWorkspaceInvite).not.toHaveBeenCalled();
    expect(invite.disabled).toBe(false);

    fireEvent.click(invite);
    await waitFor(() => {
      expect(onCreateWorkspaceInvite).toHaveBeenCalledWith('team-1');
    });
    expect(clipboardWrite).toHaveBeenCalledWith('http://localhost/workspace-invites/token-1');
    expect(screen.getByText('Invite link copied.')).toBeTruthy();
  });

  it('shows invite creation errors from the workspace popover', async () => {
    const onCreateWorkspaceInvite = vi.fn(async () => ({
      ok: false as const,
      error: 'Only admins can invite workspace members.',
    }));

    render(
      <EntryNavRail
        view="home"
        workspaces={[
          { id: 'team-1', name: 'Team Workspace', kind: 'team', currentUserRole: 'admin', createdAt: 1, updatedAt: 1 },
        ]}
        currentWorkspaceId="team-1"
        onViewChange={vi.fn()}
        onNewProject={vi.fn()}
        onWorkspaceChange={vi.fn()}
        onCreateWorkspaceInvite={onCreateWorkspaceInvite}
      />,
    );

    fireEvent.click(screen.getByTestId('entry-nav-logo'));
    fireEvent.click(screen.getByRole('button', { name: 'Invite members' }));

    await waitFor(() => {
      expect(screen.getByText('Only admins can invite workspace members.')).toBeTruthy();
    });
  });

  it('ignores invite creation completions after switching away in the workspace popover', async () => {
    let resolveInvite: (value: {
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
    }) => void = () => {};
    const onCreateWorkspaceInvite = vi.fn(() => new Promise<{
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
    }>((resolve) => {
      resolveInvite = resolve;
    }));
    const clipboardWrite = vi.fn(async () => undefined);
    Object.assign(navigator, {
      clipboard: { writeText: clipboardWrite },
    });

    render(
      <EntryNavRail
        view="home"
        workspaces={[
          { id: 'local-personal', name: 'Personal Workspace', kind: 'local', createdAt: 1, updatedAt: 1 },
          { id: 'team-1', name: 'Team Workspace', kind: 'team', currentUserRole: 'admin', createdAt: 1, updatedAt: 1 },
        ]}
        currentWorkspaceId="team-1"
        onViewChange={vi.fn()}
        onNewProject={vi.fn()}
        onWorkspaceChange={vi.fn()}
        onCreateWorkspaceInvite={onCreateWorkspaceInvite}
      />,
    );

    fireEvent.click(screen.getByTestId('entry-nav-logo'));
    fireEvent.click(screen.getByRole('button', { name: 'Invite members' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Creating invite...' })).toBeTruthy();
    });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'local-personal' } });

    resolveInvite({
      ok: true,
      value: {
        id: 'inv-1',
        workspaceId: 'team-1',
        token: 'token-1',
        role: 'member',
        createdByUserId: 'owner-1',
        createdAt: 1,
        status: 'pending',
        inviteUrl: 'http://localhost/workspace-invites/token-1',
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(clipboardWrite).not.toHaveBeenCalled();
    expect(screen.queryByText('Invite link copied.')).toBeNull();
  });

  it('rolls back optimistic workspace selection when switching fails', async () => {
    const onWorkspaceChange = vi.fn(async () => {
      throw new Error('Could not switch workspace.');
    });

    render(
      <EntryNavRail
        view="home"
        workspaces={[
          { id: 'local-personal', name: 'Personal Workspace', kind: 'local', createdAt: 1, updatedAt: 1 },
          { id: 'team-1', name: 'Team Workspace', kind: 'team', currentUserRole: 'admin', createdAt: 1, updatedAt: 1 },
        ]}
        currentWorkspaceId="local-personal"
        onViewChange={vi.fn()}
        onNewProject={vi.fn()}
        onWorkspaceChange={onWorkspaceChange}
        onCreateWorkspaceInvite={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('entry-nav-logo'));
    const workspaceSelect = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(workspaceSelect, { target: { value: 'team-1' } });

    expect(onWorkspaceChange).toHaveBeenCalledWith('team-1');
    await waitFor(() => {
      expect(screen.getByText('Could not switch workspace.')).toBeTruthy();
    });
    expect(workspaceSelect.value).toBe('local-personal');
  });

  it('does not let a stale switch failure overwrite a newer current workspace', async () => {
    let rejectSwitch: (error: Error) => void = () => {};
    const onWorkspaceChange = vi.fn(
      () =>
        new Promise<void>((_, reject) => {
          rejectSwitch = reject;
        }),
    );

    const props = {
      view: 'home' as const,
      workspaces: [
        { id: 'local-personal', name: 'Personal Workspace', kind: 'local' as const, createdAt: 1, updatedAt: 1 },
        { id: 'team-1', name: 'Team One', kind: 'team' as const, currentUserRole: 'admin' as const, createdAt: 1, updatedAt: 1 },
        { id: 'team-2', name: 'Team Two', kind: 'team' as const, currentUserRole: 'admin' as const, createdAt: 1, updatedAt: 1 },
      ],
      onViewChange: vi.fn(),
      onNewProject: vi.fn(),
      onWorkspaceChange,
      onCreateWorkspaceInvite: vi.fn(),
    };

    const { rerender } = render(
      <EntryNavRail
        {...props}
        currentWorkspaceId="local-personal"
      />,
    );

    fireEvent.click(screen.getByTestId('entry-nav-logo'));
    const workspaceSelect = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(workspaceSelect, { target: { value: 'team-1' } });

    expect(onWorkspaceChange).toHaveBeenCalledWith('team-1');
    rerender(
      <EntryNavRail
        {...props}
        currentWorkspaceId="team-2"
      />,
    );

    await waitFor(() => {
      expect(workspaceSelect.value).toBe('team-2');
    });

    rejectSwitch(new Error('Could not switch workspace.'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(workspaceSelect.value).toBe('team-2');
    expect(screen.queryByText('Could not switch workspace.')).toBeNull();
  });

  it('keeps member workspaces from creating invite links in the logo popover', () => {
    const onCreateWorkspaceInvite = vi.fn();

    render(
      <EntryNavRail
        view="home"
        workspaces={[
          { id: 'team-1', name: 'Team Workspace', kind: 'team', currentUserRole: 'member', createdAt: 1, updatedAt: 1 },
        ]}
        currentWorkspaceId="team-1"
        onViewChange={vi.fn()}
        onNewProject={vi.fn()}
        onWorkspaceChange={vi.fn()}
        onCreateWorkspaceInvite={onCreateWorkspaceInvite}
      />,
    );

    fireEvent.click(screen.getByTestId('entry-nav-logo'));
    expect((screen.getByRole('button', { name: 'Invite members' }) as HTMLButtonElement).disabled).toBe(true);
    expect(onCreateWorkspaceInvite).not.toHaveBeenCalled();
  });
});

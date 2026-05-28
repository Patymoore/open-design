// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceInviteView } from '../../src/components/WorkspaceInviteView';
import { acceptWorkspaceInviteResult } from '../../src/state/workspaces';

vi.mock('../../src/state/workspaces', () => ({
  acceptWorkspaceInviteResult: vi.fn(),
}));

describe('WorkspaceInviteView', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('accepts an invite and sends the user to the workspace page', async () => {
    vi.mocked(acceptWorkspaceInviteResult).mockResolvedValue({
      ok: true,
      value: {
        workspace: {
          id: 'ws-1',
          name: 'Team Workspace',
          kind: 'team',
          createdAt: 1,
          updatedAt: 1,
        },
        membership: {
          workspaceId: 'ws-1',
          userId: 'user-1',
          role: 'member',
          joinedAt: 1,
        },
      },
    });
    const onAccepted = vi.fn(async () => undefined);

    render(<WorkspaceInviteView token="token-1" onAccepted={onAccepted} />);

    await waitFor(() => {
      expect(onAccepted).toHaveBeenCalled();
    });
    expect(screen.getByText('Joined Team Workspace')).toBeTruthy();
    expect((screen.getByRole('link', { name: 'Open workspace' }) as HTMLAnchorElement).getAttribute('href')).toBe('/workspace');
  });

  it('shows an invalid invite state when acceptance fails', async () => {
    vi.mocked(acceptWorkspaceInviteResult).mockResolvedValue({
      ok: false,
      error: 'invite not found',
    });

    render(<WorkspaceInviteView token="bad-token" onAccepted={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Invite link not found')).toBeTruthy();
    });
    expect(screen.getByText('invite not found')).toBeTruthy();
  });

  it('explains revoked, expired, and already-used invite links', async () => {
    vi.mocked(acceptWorkspaceInviteResult).mockResolvedValueOnce({
      ok: false,
      error: 'invite link was revoked',
    });
    const { rerender } = render(<WorkspaceInviteView token="revoked-token" onAccepted={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Invite link revoked')).toBeTruthy();
    });
    expect(screen.getByText('This workspace invite was revoked by an admin or owner.')).toBeTruthy();

    vi.mocked(acceptWorkspaceInviteResult).mockResolvedValueOnce({
      ok: false,
      error: 'invite link expired',
    });
    rerender(<WorkspaceInviteView token="expired-token" onAccepted={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Invite link expired')).toBeTruthy();
    });
    expect(screen.getByText('Ask a workspace admin for a fresh invite link.')).toBeTruthy();

    vi.mocked(acceptWorkspaceInviteResult).mockResolvedValueOnce({
      ok: false,
      error: 'invite link was already used',
    });
    rerender(<WorkspaceInviteView token="used-token" onAccepted={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Invite link already used')).toBeTruthy();
    });
    expect(screen.getByText('This one-time invite has already been accepted. Ask a workspace admin for a new link.')).toBeTruthy();
    expect((screen.getByRole('link', { name: 'Open workspace' }) as HTMLAnchorElement).getAttribute('href')).toBe('/workspace');
  });

  it('explains when the user already belongs to the invited workspace', async () => {
    vi.mocked(acceptWorkspaceInviteResult).mockResolvedValue({
      ok: true,
      value: {
        workspace: {
          id: 'ws-1',
          name: 'Team Workspace',
          kind: 'team',
          createdAt: 1,
          updatedAt: 1,
        },
        membership: {
          workspaceId: 'ws-1',
          userId: 'owner-1',
          role: 'owner',
          joinedAt: 1,
        },
        acceptedInvite: false,
      },
    });
    const onAccepted = vi.fn(async () => undefined);

    render(<WorkspaceInviteView token="token-1" onAccepted={onAccepted} />);

    await waitFor(() => {
      expect(onAccepted).toHaveBeenCalled();
    });
    expect(screen.getByText('Already in Team Workspace')).toBeTruthy();
    expect(screen.getByText('This invite was not consumed. You can keep working in this workspace.')).toBeTruthy();
  });

  it('keeps a recovery path when workspace switching fails after accepting', async () => {
    vi.mocked(acceptWorkspaceInviteResult).mockResolvedValue({
      ok: true,
      value: {
        workspace: {
          id: 'ws-1',
          name: 'Team Workspace',
          kind: 'team',
          createdAt: 1,
          updatedAt: 1,
        },
        membership: {
          workspaceId: 'ws-1',
          userId: 'user-1',
          role: 'member',
          joinedAt: 1,
        },
      },
    });
    const onAccepted = vi.fn(async () => {
      throw new Error('switch failed');
    });

    render(<WorkspaceInviteView token="token-1" onAccepted={onAccepted} />);

    await waitFor(() => {
      expect(screen.getByText('Workspace joined')).toBeTruthy();
    });
    expect(screen.getByText('The invite was accepted, but Open Design could not switch to the workspace automatically.')).toBeTruthy();
    expect((screen.getByRole('link', { name: 'Open workspace' }) as HTMLAnchorElement).getAttribute('href')).toBe('/workspace');
  });
});

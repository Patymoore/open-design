import { useEffect, useState } from 'react';
import type { AcceptWorkspaceInviteResponse } from '@open-design/contracts';
import { acceptWorkspaceInviteResult } from '../state/workspaces';
import { Icon } from './Icon';

type InviteState =
  | { status: 'joining' }
  | { status: 'joined'; workspaceName: string }
  | { status: 'already-joined'; workspaceName: string }
  | { status: 'error'; title: string; message: string; actionLabel: string; actionHref: string };

function inviteErrorState(error: string): InviteState {
  const normalized = error.toLowerCase();
  if (normalized.includes('revoked')) {
    return {
      status: 'error',
      title: 'Invite link revoked',
      message: 'This workspace invite was revoked by an admin or owner.',
      actionLabel: 'Return to Open Design',
      actionHref: '/',
    };
  }
  if (normalized.includes('expired')) {
    return {
      status: 'error',
      title: 'Invite link expired',
      message: 'Ask a workspace admin for a fresh invite link.',
      actionLabel: 'Return to Open Design',
      actionHref: '/',
    };
  }
  if (normalized.includes('already used') || normalized.includes('already accepted')) {
    return {
      status: 'error',
      title: 'Invite link already used',
      message: 'This one-time invite has already been accepted. Ask a workspace admin for a new link.',
      actionLabel: 'Open workspace',
      actionHref: '/workspace',
    };
  }
  return {
    status: 'error',
    title: 'Invite link not found',
    message: error,
    actionLabel: 'Return to Open Design',
    actionHref: '/',
  };
}

export function WorkspaceInviteView({
  token,
  onAccepted,
}: {
  token: string;
  onAccepted: (result: AcceptWorkspaceInviteResponse) => Promise<void>;
}) {
  const [state, setState] = useState<InviteState>({ status: 'joining' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'joining' });
    void acceptWorkspaceInviteResult(token).then(async (result) => {
      if (cancelled) return;
      if (!result.ok) {
        setState(inviteErrorState(result.error));
        return;
      }
      try {
        await onAccepted(result.value);
      } catch {
        if (cancelled) return;
        setState({
          status: 'error',
          title: 'Workspace joined',
          message: 'The invite was accepted, but Open Design could not switch to the workspace automatically.',
          actionLabel: 'Open workspace',
          actionHref: '/workspace',
        });
        return;
      }
      if (cancelled) return;
      setState({
        status: result.value.acceptedInvite === false ? 'already-joined' : 'joined',
        workspaceName: result.value.workspace.name,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [onAccepted, token]);

  return (
    <main className="workspace-invite-view">
      <section className="workspace-invite-card">
        <a className="workspace-invite-brand" href="/" aria-label="Open Design">
          <Icon name="orbit" size={18} />
          <span>Open Design</span>
        </a>
        {state.status === 'joining' ? (
          <>
            <strong>Joining workspace...</strong>
            <span>We are accepting this invite and switching your workspace.</span>
          </>
        ) : state.status === 'joined' ? (
          <>
            <strong>Joined {state.workspaceName}</strong>
            <span>You can continue using Open Design in this workspace.</span>
            <a className="workspace-invite-action" href="/workspace">Open workspace</a>
          </>
        ) : state.status === 'already-joined' ? (
          <>
            <strong>Already in {state.workspaceName}</strong>
            <span>This invite was not consumed. You can keep working in this workspace.</span>
            <a className="workspace-invite-action" href="/workspace">Open workspace</a>
          </>
        ) : (
          <>
            <strong>{state.title}</strong>
            <span>{state.message}</span>
            <a className="workspace-invite-action" href={state.actionHref}>{state.actionLabel}</a>
          </>
        )}
      </section>
    </main>
  );
}

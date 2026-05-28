// Lovart-style left navigation rail for the entry view.
//
// Renders a narrow icon-only column. The first slot is the brand logo,
// followed by the primary destinations users expect to keep in reach:
// New project, home, projects, automations, design systems, plugins,
// and integrations. Footer controls are reserved for lower-frequency
// support affordances such as the help launcher.
// Language switching and other account-scoped controls live behind the
// floating settings cog in the top-right corner of the main content.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Workspace, WorkspaceInviteWithStatus } from '@open-design/contracts';
import type { WorkspaceOperationResult } from '../state/workspaces';
import { EntryHelpMenu } from './EntryHelpMenu';
import { Icon } from './Icon';
import { useT } from '../i18n';

export type EntryView =
  | 'home'
  | 'onboarding'
  | 'projects'
  | 'tasks'
  | 'plugins'
  | 'workspace'
  | 'design-systems'
  | 'integrations';

interface Props {
  view: EntryView;
  workspaces: Workspace[];
  currentWorkspaceId: string;
  onViewChange: (view: EntryView) => void;
  onNewProject: () => void;
  onWorkspaceChange: (workspaceId: string) => Promise<void> | void;
  onCreateWorkspaceInvite: (
    workspaceId: string,
    options?: { role?: 'admin' | 'member'; expiresInDays?: number },
  ) => Promise<WorkspaceOperationResult<WorkspaceInviteWithStatus>>;
}

interface NavButtonProps {
  active?: boolean;
  ariaLabel: string;
  tooltip: string;
  onClick: () => void;
  testId?: string;
  children: ReactNode;
}

function NavButton({ active, ariaLabel, tooltip, onClick, testId, children }: NavButtonProps) {
  return (
    <button
      type="button"
      className={`entry-nav-rail__btn${active ? ' is-active' : ''}`}
      onClick={onClick}
      aria-label={ariaLabel}
      aria-current={active ? 'page' : undefined}
      data-tooltip={tooltip}
      {...(testId ? { 'data-testid': testId } : {})}
    >
      {children}
    </button>
  );
}

export function EntryNavRail({
  view,
  workspaces,
  currentWorkspaceId,
  onViewChange,
  onNewProject,
  onWorkspaceChange,
  onCreateWorkspaceInvite,
}: Props) {
  const t = useT();
  const brandLabel = t('app.brand');
  const homeLabel = t('entry.navHome');
  const isHome = view === 'home';
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workspaceNotice, setWorkspaceNotice] = useState<string | null>(null);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(currentWorkspaceId);
  const [creatingInviteWorkspaceId, setCreatingInviteWorkspaceId] = useState<string | null>(null);
  const [switchingWorkspace, setSwitchingWorkspace] = useState(false);
  const selectedWorkspaceIdRef = useRef(selectedWorkspaceId);
  const switchSerialRef = useRef(0);
  selectedWorkspaceIdRef.current = selectedWorkspaceId;
  useEffect(() => {
    selectedWorkspaceIdRef.current = currentWorkspaceId;
    setSelectedWorkspaceId(currentWorkspaceId);
  }, [currentWorkspaceId]);
  const currentWorkspace =
    workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ??
    workspaces.find((workspace) => workspace.id === currentWorkspaceId) ??
    workspaces[0] ??
    null;
  const canInviteMembers =
    currentWorkspace?.kind === 'team' &&
    (currentWorkspace.currentUserRole === 'owner' || currentWorkspace.currentUserRole === 'admin');
  const creatingInvite = creatingInviteWorkspaceId === currentWorkspace?.id;

  async function handleInviteMembers() {
    if (!currentWorkspace || creatingInvite) return;
    if (currentWorkspace.kind !== 'team') {
      setWorkspaceNotice('Create or switch to a team workspace to invite members.');
      return;
    }
    if (!canInviteMembers) {
      setWorkspaceNotice('Admin or owner access required.');
      return;
    }
    const workspaceId = currentWorkspace.id;
    setCreatingInviteWorkspaceId(workspaceId);
    try {
      const result = await onCreateWorkspaceInvite(workspaceId);
      if (selectedWorkspaceIdRef.current !== workspaceId) return;
      if (!result.ok) {
        setWorkspaceNotice(result.error);
        return;
      }
      const link = result.value.inviteUrl;
      if (!link) {
        setWorkspaceNotice('Could not create invite link.');
        return;
      }
      try {
        await navigator.clipboard.writeText(link);
        setWorkspaceNotice('Invite link copied.');
      } catch {
        setWorkspaceNotice(link);
      }
    } finally {
      setCreatingInviteWorkspaceId((current) => (current === workspaceId ? null : current));
    }
  }

  async function handleWorkspaceSelect(nextWorkspaceId: string) {
    if (switchingWorkspace || nextWorkspaceId === currentWorkspaceId) return;
    const previousWorkspaceId = currentWorkspaceId;
    const switchSerial = switchSerialRef.current + 1;
    switchSerialRef.current = switchSerial;
    selectedWorkspaceIdRef.current = nextWorkspaceId;
    setSelectedWorkspaceId(nextWorkspaceId);
    setWorkspaceNotice(null);
    setSwitchingWorkspace(true);
    try {
      await onWorkspaceChange(nextWorkspaceId);
    } catch (error) {
      if (switchSerialRef.current === switchSerial && selectedWorkspaceIdRef.current === nextWorkspaceId) {
        selectedWorkspaceIdRef.current = previousWorkspaceId;
        setSelectedWorkspaceId(previousWorkspaceId);
        setWorkspaceNotice(error instanceof Error ? error.message : 'Could not switch workspace.');
      }
    } finally {
      if (switchSerialRef.current === switchSerial) {
        setSwitchingWorkspace(false);
      }
    }
  }

  return (
    <nav className="entry-nav-rail" aria-label="Primary">
      <div className="entry-nav-rail__group">
        <div className="entry-nav-workspace">
          <button
            type="button"
            className="entry-nav-rail__logo"
            onClick={() => setWorkspaceOpen((open) => !open)}
            aria-label={currentWorkspace?.name ?? brandLabel}
            aria-expanded={workspaceOpen}
            data-tooltip={currentWorkspace?.name ?? brandLabel}
            data-testid="entry-nav-logo"
          >
            <img
              src="/app-icon.svg"
              alt=""
              className="entry-nav-rail__logo-img"
              draggable={false}
            />
          </button>
          {workspaceOpen ? (
            <div className="entry-workspace-popover">
              <div className="entry-workspace-title">Workspace</div>
              <select
                className="entry-workspace-select"
                value={selectedWorkspaceId}
                disabled={switchingWorkspace}
                onChange={(event) => void handleWorkspaceSelect(event.target.value)}
              >
                {workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="entry-workspace-primary"
                disabled={!canInviteMembers || creatingInvite}
                onClick={() => void handleInviteMembers()}
              >
                <Icon name="link" size={13} />
                <span>{creatingInvite ? 'Creating invite...' : 'Invite members'}</span>
              </button>
              {workspaceNotice ? <div className="entry-workspace-notice">{workspaceNotice}</div> : null}
            </div>
          ) : null}
        </div>
        <div className="entry-nav-rail__logo-divider" role="separator" aria-hidden="true" />
        <NavButton
          ariaLabel={t('entry.navNewProject')}
          tooltip={t('entry.navNewProject')}
          onClick={onNewProject}
          testId="entry-nav-new-project"
        >
          <Icon name="plus" size={18} />
        </NavButton>
        <NavButton
          active={isHome}
          ariaLabel={homeLabel}
          tooltip={homeLabel}
          onClick={() => onViewChange('home')}
          testId="entry-nav-home"
        >
          <Icon name="home" size={18} />
        </NavButton>
        <NavButton
          active={view === 'projects'}
          ariaLabel={t('entry.navProjects')}
          tooltip={t('entry.navProjects')}
          onClick={() => onViewChange('projects')}
          testId="entry-nav-projects"
        >
          <Icon name="folder" size={18} />
        </NavButton>
        <NavButton
          active={view === 'tasks'}
          ariaLabel={t('entry.navTasks')}
          tooltip={t('entry.navTasks')}
          onClick={() => onViewChange('tasks')}
          testId="entry-nav-tasks"
        >
          <Icon name="kanban" size={18} />
        </NavButton>
        <NavButton
          active={view === 'workspace'}
          ariaLabel="Workspace"
          tooltip="Workspace"
          onClick={() => onViewChange('workspace')}
          testId="entry-nav-workspace"
        >
          <Icon name="settings" size={18} />
        </NavButton>
        <NavButton
          active={view === 'design-systems'}
          ariaLabel={t('entry.navDesignSystems')}
          tooltip={t('entry.navDesignSystems')}
          onClick={() => onViewChange('design-systems')}
          testId="entry-nav-design-systems"
        >
          <Icon name="blocks" size={18} />
        </NavButton>
        <NavButton
          active={view === 'plugins'}
          ariaLabel={t('entry.navPlugins')}
          tooltip={t('entry.navPlugins')}
          onClick={() => onViewChange('plugins')}
          testId="entry-nav-plugins"
        >
          <Icon name="grid" size={18} />
        </NavButton>
        <NavButton
          active={view === 'integrations'}
          ariaLabel={t('entry.navIntegrations')}
          tooltip={t('entry.navIntegrations')}
          onClick={() => onViewChange('integrations')}
          testId="entry-nav-integrations"
        >
          <Icon name="link" size={18} />
        </NavButton>
      </div>
      <div className="entry-nav-rail__footer">
        <div className="entry-nav-rail__divider" role="separator" />
        <EntryHelpMenu />
      </div>
    </nav>
  );
}

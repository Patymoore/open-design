// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Routine } from '@open-design/contracts';

import { RoutinesSection } from '../../src/components/RoutinesSection';
import * as router from '../../src/router';

const originalFetch = globalThis.fetch;
const originalConfirm = window.confirm;

describe('RoutinesSection', () => {
  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    window.confirm = originalConfirm;
    vi.restoreAllMocks();
  });

  it('creates a weekly routine that reuses an existing project', async () => {
    let routines: Routine[] = [];
    const projects = [{ id: 'proj-1', name: 'Routine Test Project' }];
    const createBodies: unknown[] = [];

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/routines' && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ routines }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/projects' && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ projects }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/routines' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        createBodies.push(body);
        routines = [{
          id: 'routine-1',
          name: body.name,
          prompt: body.prompt,
          schedule: body.schedule,
          target: body.target,
          skillId: null,
          agentId: null,
          enabled: true,
          nextRunAt: Date.now() + 3600_000,
          lastRun: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }];
        return new Response(JSON.stringify({ routine: routines[0] }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    }) as typeof fetch;

    render(<RoutinesSection />);

    fireEvent.click(await screen.findByRole('button', { name: 'New automation' }));
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Weekly digest' },
    });
    fireEvent.change(screen.getByLabelText('Prompt'), {
      target: { value: 'Summarize GitHub and design activity.' },
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Weekly' }));
    fireEvent.click(screen.getByRole('button', { name: 'Wed' }));
    fireEvent.click(screen.getAllByRole('radio')[1]!);
    fireEvent.change(screen.getAllByRole('combobox')[1]!, {
      target: { value: 'proj-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(screen.getByText('Weekly digest')).toBeTruthy();
    });
    expect(createBodies).toEqual([
      {
        name: 'Weekly digest',
        prompt: 'Summarize GitHub and design activity.',
        schedule: {
          kind: 'weekly',
          weekday: 3,
          time: '09:00',
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        },
        target: {
          mode: 'reuse',
          projectId: 'proj-1',
        },
        enabled: true,
      },
    ]);
  });

  it('scopes routine and project requests to the current workspace when provided', async () => {
    const fetchUrls: string[] = [];
    const createBodies: unknown[] = [];

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      fetchUrls.push(url);
      if (url === '/api/routines?workspaceId=team-ws' && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ routines: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/projects?workspaceId=team-ws' && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ projects: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/routines' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        createBodies.push(body);
        return new Response(JSON.stringify({
          routine: {
            id: 'routine-1',
            workspaceId: 'team-ws',
            name: body.name,
            prompt: body.prompt,
            schedule: body.schedule,
            target: body.target,
            skillId: null,
            agentId: null,
            enabled: true,
            nextRunAt: null,
            lastRun: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    }) as typeof fetch;

    render(
      <RoutinesSection
        currentWorkspaceId="team-ws"
        currentWorkspaceName="Team Workspace"
        currentWorkspaceRole="owner"
      />,
    );

    expect(await screen.findByText('Scheduled agent sessions for Team Workspace.')).toBeTruthy();
    expect(fetchUrls).toContain('/api/routines?workspaceId=team-ws');
    expect(fetchUrls).toContain('/api/projects?workspaceId=team-ws');

    fireEvent.click(screen.getByRole('button', { name: 'New automation' }));
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Team digest' },
    });
    fireEvent.change(screen.getByLabelText('Prompt'), {
      target: { value: 'Summarize team activity.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(createBodies).toHaveLength(1);
    });
    expect(createBodies[0]).toMatchObject({
      workspaceId: 'team-ws',
      name: 'Team digest',
      target: { mode: 'create_each_run' },
    });
  });

  it('does not allow managing workspace routines until the current role is known', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/routines?workspaceId=team-ws' && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ routines: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/projects?workspaceId=team-ws' && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ projects: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/workspaces/team-ws/members') {
        return new Response(JSON.stringify({ members: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    }) as typeof fetch;

    render(<RoutinesSection currentWorkspaceId="team-ws" currentWorkspaceName="Team Workspace" />);

    expect(await screen.findByText('Scheduled agent sessions for Team Workspace.')).toBeTruthy();
    expect(screen.getByText('Admin or owner access required to manage workspace routines.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'New automation' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders workspace routines as read-only for workspace members', async () => {
    const routines: Routine[] = [{
      id: 'routine-1',
      workspaceId: 'team-ws',
      createdByUserId: 'owner-1',
      ownedByUserId: 'owner-1',
      name: 'Team digest',
      prompt: 'Summarize team activity.',
      schedule: { kind: 'daily', time: '09:00', timezone: 'UTC' },
      target: { mode: 'create_each_run' },
      skillId: null,
      agentId: null,
      enabled: true,
      nextRunAt: Date.now() + 3600_000,
      lastRun: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/routines?workspaceId=team-ws' && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ routines }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/projects?workspaceId=team-ws' && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ projects: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    render(
      <RoutinesSection
        currentWorkspaceId="team-ws"
        currentWorkspaceName="Team Workspace"
        currentWorkspaceRole="member"
      />,
    );

    const card = (await screen.findByText('Team digest')).closest('li');
    expect(card).toBeTruthy();
    expect(within(card as HTMLElement).getByText('owned by owner-1')).toBeTruthy();
    expect(screen.getByText('Admin or owner access required to manage workspace routines.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'New automation' }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(card as HTMLElement).getByRole('button', { name: 'Run now' }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(card as HTMLElement).getByRole('button', { name: 'Edit' }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(card as HTMLElement).getByRole('button', { name: 'Pause' }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(card as HTMLElement).getByRole('button', { name: 'Delete' }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(card as HTMLElement).getByRole('button', { name: 'History' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('clears routine state when switching workspaces', async () => {
    let resolveSecondRoutines: (response: Response) => void = () => {};
    const secondRoutines = new Promise<Response>((resolve) => {
      resolveSecondRoutines = resolve;
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/routines?workspaceId=team-a' && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({
          routines: [{
            id: 'routine-a',
            workspaceId: 'team-a',
            name: 'Team A digest',
            prompt: 'Summarize team A.',
            schedule: { kind: 'daily', time: '09:00', timezone: 'UTC' },
            target: { mode: 'create_each_run' },
            skillId: null,
            agentId: null,
            enabled: true,
            nextRunAt: Date.now() + 3600_000,
            lastRun: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }],
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/routines?workspaceId=team-b' && (!init || init.method === undefined)) {
        return secondRoutines;
      }
      if (url === '/api/projects?workspaceId=team-a' || url === '/api/projects?workspaceId=team-b') {
        return new Response(JSON.stringify({ projects: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/workspaces/team-a/members' || url === '/api/workspaces/team-b/members') {
        return new Response(JSON.stringify({ members: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const { rerender } = render(
      <RoutinesSection
        currentWorkspaceId="team-a"
        currentWorkspaceName="Team A"
        currentWorkspaceRole="owner"
      />,
    );

    expect(await screen.findByText('Team A digest')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'New automation' }));
    expect(screen.getByLabelText('Name')).toBeTruthy();

    rerender(
      <RoutinesSection
        currentWorkspaceId="team-b"
        currentWorkspaceName="Team B"
        currentWorkspaceRole="owner"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Loading…')).toBeTruthy();
    });
    expect(screen.queryByText('Team A digest')).toBeNull();
    expect(screen.queryByLabelText('Name')).toBeNull();

    resolveSecondRoutines(new Response(JSON.stringify({ routines: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await waitFor(() => {
      expect(screen.getByText('No automations yet.')).toBeTruthy();
    });
  });

  it('ignores stale routine load failures after switching workspaces', async () => {
    let rejectFirstRoutines: (error: Error) => void = () => {};
    const firstRoutines = new Promise<Response>((_, reject) => {
      rejectFirstRoutines = reject;
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/routines?workspaceId=team-a' && (!init || init.method === undefined)) {
        return firstRoutines;
      }
      if (url === '/api/routines?workspaceId=team-b' && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ routines: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/projects?workspaceId=team-a' || url === '/api/projects?workspaceId=team-b') {
        return new Response(JSON.stringify({ projects: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/workspaces/team-a/members' || url === '/api/workspaces/team-b/members') {
        return new Response(JSON.stringify({ members: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const { rerender } = render(
      <RoutinesSection
        currentWorkspaceId="team-a"
        currentWorkspaceName="Team A"
        currentWorkspaceRole="owner"
      />,
    );

    rerender(
      <RoutinesSection
        currentWorkspaceId="team-b"
        currentWorkspaceName="Team B"
        currentWorkspaceRole="owner"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('No automations yet.')).toBeTruthy();
    });

    rejectFirstRoutines(new Error('team-a failed'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('team-a failed')).toBeNull();
  });

  it('ignores stale routine action failures after switching workspaces', async () => {
    let resolveRun: (response: Response) => void = () => {};
    const runResponse = new Promise<Response>((resolve) => {
      resolveRun = resolve;
    });
    const teamARoutines: Routine[] = [{
      id: 'routine-a',
      workspaceId: 'team-a',
      name: 'Team A digest',
      prompt: 'Summarize team A.',
      schedule: { kind: 'daily', time: '09:00', timezone: 'UTC' },
      target: { mode: 'create_each_run' },
      skillId: null,
      agentId: null,
      enabled: true,
      nextRunAt: null,
      lastRun: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/routines?workspaceId=team-a' && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ routines: teamARoutines }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/routines?workspaceId=team-b' && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ routines: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/routines/routine-a/run' && init?.method === 'POST') {
        return runResponse;
      }
      if (url === '/api/projects?workspaceId=team-a' || url === '/api/projects?workspaceId=team-b') {
        return new Response(JSON.stringify({ projects: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/workspaces/team-a/members' || url === '/api/workspaces/team-b/members') {
        return new Response(JSON.stringify({ members: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const { rerender } = render(
      <RoutinesSection
        currentWorkspaceId="team-a"
        currentWorkspaceName="Team A"
        currentWorkspaceRole="owner"
      />,
    );

    const card = (await screen.findByText('Team A digest')).closest('li');
    expect(card).toBeTruthy();
    fireEvent.click(within(card as HTMLElement).getByRole('button', { name: 'Run now' }));

    rerender(
      <RoutinesSection
        currentWorkspaceId="team-b"
        currentWorkspaceName="Team B"
        currentWorkspaceRole="owner"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('No automations yet.')).toBeTruthy();
    });

    resolveRun(new Response(JSON.stringify({ error: 'team-a run failed' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('team-a run failed')).toBeNull();
  });

  it('pauses and resumes an existing routine through PATCH updates', async () => {
    let routines: Routine[] = [{
      id: 'routine-1',
      name: 'Morning briefing',
      prompt: 'Morning summary',
      schedule: { kind: 'daily', time: '09:00', timezone: 'UTC' },
      target: { mode: 'create_each_run' },
      skillId: null,
      agentId: null,
      enabled: true,
      nextRunAt: Date.now() + 3600_000,
      lastRun: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }];
    const patchBodies: unknown[] = [];

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/routines' && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ routines }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/projects' && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ projects: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/routines/routine-1' && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body));
        patchBodies.push(body);
        const current = routines[0]!;
        routines = [{
          ...current,
          enabled: body.enabled,
          updatedAt: Date.now(),
        }];
        return new Response(JSON.stringify({ routine: routines[0] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    }) as typeof fetch;

    render(<RoutinesSection />);

    const row = await screen.findByText('Morning briefing');
    const card = row.closest('li')!;

    fireEvent.click(within(card).getByRole('button', { name: 'Pause' }));
    await waitFor(() => {
      expect(within(card).getByRole('button', { name: 'Resume' })).toBeTruthy();
    });

    fireEvent.click(within(card).getByRole('button', { name: 'Resume' }));
    await waitFor(() => {
      expect(within(card).getByRole('button', { name: 'Pause' })).toBeTruthy();
    });

    expect(patchBodies).toEqual([{ enabled: false }, { enabled: true }]);
  });

  it('transfers routine owner for workspace managers', async () => {
    let routines: Routine[] = [{
      id: 'routine-1',
      workspaceId: 'team-ws',
      name: 'Morning briefing',
      prompt: 'Morning summary',
      schedule: { kind: 'daily', time: '09:00', timezone: 'UTC' },
      target: { mode: 'create_each_run' },
      ownedByUserId: 'owner-1',
      skillId: null,
      agentId: null,
      enabled: true,
      nextRunAt: Date.now() + 3600_000,
      lastRun: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }];
    const patchBodies: unknown[] = [];

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/routines?workspaceId=team-ws' && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ routines }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/projects?workspaceId=team-ws' && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ projects: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/workspaces/team-ws/members') {
        return new Response(JSON.stringify({
          members: [
            { workspaceId: 'team-ws', userId: 'owner-1', role: 'owner', joinedAt: 1 },
            { workspaceId: 'team-ws', userId: 'member-1', role: 'member', joinedAt: 2 },
          ],
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/routines/routine-1' && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body));
        patchBodies.push(body);
        routines = [{ ...routines[0]!, ownedByUserId: body.ownedByUserId, updatedAt: Date.now() }];
        return new Response(JSON.stringify({ routine: routines[0] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    }) as typeof fetch;

    render(
      <RoutinesSection
        currentWorkspaceId="team-ws"
        currentWorkspaceRole="owner"
      />,
    );

    const card = (await screen.findByText('Morning briefing')).closest('li');
    expect(card).toBeTruthy();
    fireEvent.change(within(card as HTMLElement).getByLabelText('Transfer owner for Morning briefing'), {
      target: { value: 'member-1' },
    });
    fireEvent.click(within(card as HTMLElement).getByRole('button', { name: 'Transfer' }));

    await waitFor(() => {
      expect(patchBodies).toEqual([{ ownedByUserId: 'member-1' }]);
      expect(within(card as HTMLElement).getByText('owned by member-1')).toBeTruthy();
    });
  });

  it('runs a routine now and loads its history', async () => {
    let routines: Routine[] = [{
      id: 'routine-1',
      name: 'Morning briefing',
      prompt: 'Morning summary',
      schedule: { kind: 'daily', time: '09:00', timezone: 'UTC' },
      target: { mode: 'create_each_run' },
      skillId: null,
      agentId: null,
      enabled: true,
      nextRunAt: Date.now() + 3600_000,
      lastRun: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }];
    const runBodies: string[] = [];

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/routines' && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ routines }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/projects' && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ projects: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/routines/routine-1/run' && init?.method === 'POST') {
        runBodies.push(url);
        const current = routines[0]!;
        routines = [{
          ...current,
          lastRun: {
            runId: 'run-1',
            status: 'queued',
            trigger: 'manual',
            startedAt: Date.now(),
            projectId: 'proj-run',
            conversationId: 'conv-run',
            agentRunId: 'agent-run-1',
          },
        }];
        return new Response(JSON.stringify({
          routine: routines[0],
          run: routines[0]!.lastRun,
          projectId: 'proj-run',
          conversationId: 'conv-run',
          agentRunId: 'agent-run-1',
        }), {
          status: 202,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/routines/routine-1/runs?limit=10') {
        return new Response(JSON.stringify({
          runs: [
            {
              id: 'run-1',
              routineId: 'routine-1',
              trigger: 'manual',
              status: 'queued',
              projectId: 'proj-run',
              conversationId: 'conv-run',
              agentRunId: 'agent-run-1',
              startedAt: Date.now(),
              completedAt: null,
              summary: null,
              error: null,
            },
          ],
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    }) as typeof fetch;

    render(<RoutinesSection />);

    const row = await screen.findByText('Morning briefing');
    const card = row.closest('li')!;

    fireEvent.click(within(card).getByRole('button', { name: 'Run now' }));

    await waitFor(() => {
      expect(within(card).getByRole('button', { name: 'Hide history' })).toBeTruthy();
    });
    expect(await screen.findByText('manual')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open project' })).toBeTruthy();
    expect(runBodies).toEqual(['/api/routines/routine-1/run']);
  });

  it('shows a validation error when reuse mode is selected without a project', async () => {
    const postBodies: unknown[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/routines' && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ routines: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/projects' && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ projects: [{ id: 'proj-1', name: 'Routine Test Project' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/routines' && init?.method === 'POST') {
        postBodies.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({}), { status: 400, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    }) as typeof fetch;

    render(<RoutinesSection />);

    fireEvent.click(await screen.findByRole('button', { name: 'New automation' }));
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Weekly digest' },
    });
    fireEvent.change(screen.getByLabelText('Prompt'), {
      target: { value: 'Summarize GitHub and design activity.' },
    });
    fireEvent.click(screen.getAllByRole('radio')[1]!);
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Create' })).toBeTruthy();
    });
    expect(postBodies).toEqual([]);
  });

  it('deletes a routine after confirmation', async () => {
    let routines: Routine[] = [{
      id: 'routine-1',
      name: 'Morning briefing',
      prompt: 'Morning summary',
      schedule: { kind: 'daily', time: '09:00', timezone: 'UTC' },
      target: { mode: 'create_each_run' },
      skillId: null,
      agentId: null,
      enabled: true,
      nextRunAt: Date.now() + 3600_000,
      lastRun: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }];
    const deletedUrls: string[] = [];
    window.confirm = vi.fn(() => true);

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/routines' && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ routines }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/projects' && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ projects: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/routines/routine-1' && init?.method === 'DELETE') {
        deletedUrls.push(url);
        routines = [];
        return new Response(null, { status: 204 });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    }) as typeof fetch;

    render(<RoutinesSection />);

    const row = (await screen.findByText('Morning briefing')).closest('li')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(screen.getByText('No automations yet.')).toBeTruthy();
    });
    expect(deletedUrls).toEqual(['/api/routines/routine-1']);
  });

  it('opens the project referenced by a routine run from history', async () => {
    const navigateSpy = vi.spyOn(router, 'navigate').mockImplementation(() => {});
    const routines = [{
      id: 'routine-1',
      name: 'Morning briefing',
      prompt: 'Morning summary',
      schedule: { kind: 'daily', time: '09:00', timezone: 'UTC' },
      target: { mode: 'create_each_run' },
      enabled: true,
      nextRunAt: Date.now() + 3600_000,
      lastRun: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }];

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/routines' && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ routines }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/projects' && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ projects: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/routines/routine-1/runs?limit=10') {
        return new Response(JSON.stringify({
          runs: [
            {
              id: 'run-1',
              routineId: 'routine-1',
              trigger: 'manual',
              status: 'succeeded',
              projectId: 'proj-run',
              conversationId: 'conv-run',
              agentRunId: 'agent-run-1',
              startedAt: Date.now(),
              completedAt: Date.now() + 2000,
              summary: 'Done',
              error: null,
            },
          ],
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    }) as typeof fetch;

    render(<RoutinesSection />);

    const row = (await screen.findByText('Morning briefing')).closest('li')!;
    fireEvent.click(within(row).getByRole('button', { name: 'History' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open project' }));

    expect(navigateSpy).toHaveBeenCalledWith(
      {
        kind: 'project',
        projectId: 'proj-run',
        conversationId: 'conv-run',
        fileName: null,
      },
    );
  });

  it('shows persisted failure reasons in the last-run summary and history', async () => {
    const failure = 'Agent stalled without emitting any new output for 1s.';
    const routines: Routine[] = [{
      id: 'routine-1',
      name: 'Morning briefing',
      prompt: 'Morning summary',
      schedule: { kind: 'daily', time: '09:00', timezone: 'UTC' },
      target: { mode: 'create_each_run' },
      skillId: null,
      agentId: null,
      enabled: true,
      nextRunAt: Date.now() + 3600_000,
      lastRun: {
        runId: 'run-failed-1',
        status: 'failed',
        trigger: 'scheduled',
        startedAt: Date.now() - 1000,
        completedAt: Date.now(),
        projectId: 'proj-run',
        conversationId: 'conv-run',
        agentRunId: 'agent-run-1',
        error: failure,
        errorCode: 'AGENT_EXECUTION_FAILED',
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }];

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/routines' && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ routines }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/projects' && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ projects: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/routines/routine-1/runs?limit=10') {
        return new Response(JSON.stringify({
          runs: [
            {
              id: 'run-failed-1',
              routineId: 'routine-1',
              trigger: 'scheduled',
              status: 'failed',
              projectId: 'proj-run',
              conversationId: 'conv-run',
              agentRunId: 'agent-run-1',
              startedAt: Date.now() - 1000,
              completedAt: Date.now(),
              summary: null,
              error: failure,
              errorCode: 'AGENT_EXECUTION_FAILED',
            },
          ],
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    }) as typeof fetch;

    render(<RoutinesSection />);

    const row = (await screen.findByText('Morning briefing')).closest('li')!;
    expect(within(row).getByText(failure)).toBeTruthy();

    fireEvent.click(within(row).getByRole('button', { name: 'History' }));
    await waitFor(() => {
      expect(screen.getAllByText(failure)).toHaveLength(2);
    });
  });

  it('shows the empty history state when a routine has never run', async () => {
    const routines = [{
      id: 'routine-1',
      name: 'Morning briefing',
      prompt: 'Morning summary',
      schedule: { kind: 'daily', time: '09:00', timezone: 'UTC' },
      target: { mode: 'create_each_run' },
      enabled: true,
      nextRunAt: Date.now() + 3600_000,
      lastRun: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }];

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/routines' && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ routines }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/projects' && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ projects: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/routines/routine-1/runs?limit=10') {
        return new Response(JSON.stringify({ runs: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    }) as typeof fetch;

    render(<RoutinesSection />);

    const row = (await screen.findByText('Morning briefing')).closest('li')!;
    fireEvent.click(within(row).getByRole('button', { name: 'History' }));

    expect(await screen.findByText('No runs yet.')).toBeTruthy();
  });

  it('falls back to the empty history state when loading run history fails', async () => {
    const routines = [{
      id: 'routine-1',
      name: 'Morning briefing',
      prompt: 'Morning summary',
      schedule: { kind: 'daily', time: '09:00', timezone: 'UTC' },
      target: { mode: 'create_each_run' },
      enabled: true,
      nextRunAt: Date.now() + 3600_000,
      lastRun: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }];

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/routines' && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ routines }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/projects' && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ projects: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/routines/routine-1/runs?limit=10') {
        return new Response(JSON.stringify({ error: 'history unavailable' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    }) as typeof fetch;

    render(<RoutinesSection />);

    const row = (await screen.findByText('Morning briefing')).closest('li')!;
    fireEvent.click(within(row).getByRole('button', { name: 'History' }));

    expect(await screen.findByText('No runs yet.')).toBeTruthy();
  });

  it('shows an error alert when the initial routines load fails', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url === '/api/routines') {
        return new Response(JSON.stringify({ error: 'boom' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/projects') {
        return new Response(JSON.stringify({ projects: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    }) as typeof fetch;

    render(<RoutinesSection />);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('routines: 500');
  });

  it('shows an error alert when creating a routine fails', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/routines' && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ routines: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/projects' && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ projects: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/routines' && init?.method === 'POST') {
        return new Response(JSON.stringify({ error: 'provider unavailable' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    }) as typeof fetch;

    render(<RoutinesSection />);

    fireEvent.click(await screen.findByRole('button', { name: 'New automation' }));
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Weekly digest' },
    });
    fireEvent.change(screen.getByLabelText('Prompt'), {
      target: { value: 'Summarize GitHub and design activity.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect((await screen.findByRole('alert')).textContent).toContain('provider unavailable');
    expect(screen.getByDisplayValue('Weekly digest')).toBeTruthy();
  });

  it('shows an error alert when running a routine now fails', async () => {
    const routines: Routine[] = [{
      id: 'routine-1',
      name: 'Morning briefing',
      prompt: 'Morning summary',
      schedule: { kind: 'daily', time: '09:00', timezone: 'UTC' },
      target: { mode: 'create_each_run' },
      skillId: null,
      agentId: null,
      enabled: true,
      nextRunAt: Date.now() + 3600_000,
      lastRun: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }];

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/routines' && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ routines }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/projects' && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ projects: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/routines/routine-1/run' && init?.method === 'POST') {
        return new Response(JSON.stringify({ error: 'agent unavailable' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    }) as typeof fetch;

    render(<RoutinesSection />);

    const row = await screen.findByText('Morning briefing');
    const card = row.closest('li')!;
    fireEvent.click(within(card).getByRole('button', { name: 'Run now' }));

    expect((await screen.findByRole('alert')).textContent).toContain('agent unavailable');
    expect(within(card).queryByRole('button', { name: 'Hide history' })).toBeNull();
  });

  it('shows an error alert when pausing a routine fails and keeps the current action', async () => {
    const routines: Routine[] = [{
      id: 'routine-1',
      name: 'Morning briefing',
      prompt: 'Morning summary',
      schedule: { kind: 'daily', time: '09:00', timezone: 'UTC' },
      target: { mode: 'create_each_run' },
      skillId: null,
      agentId: null,
      enabled: true,
      nextRunAt: Date.now() + 3600_000,
      lastRun: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }];

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/routines' && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ routines }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/projects' && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ projects: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/routines/routine-1' && init?.method === 'PATCH') {
        return new Response(JSON.stringify({ error: 'scheduler unavailable' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    }) as typeof fetch;

    render(<RoutinesSection />);

    const row = await screen.findByText('Morning briefing');
    const card = row.closest('li')!;
    fireEvent.click(within(card).getByRole('button', { name: 'Pause' }));

    expect((await screen.findByRole('alert')).textContent).toContain('scheduler unavailable');
    expect(within(card).getByRole('button', { name: 'Pause' })).toBeTruthy();
    expect(within(card).queryByRole('button', { name: 'Resume' })).toBeNull();
  });

  it('edits an existing routine and PATCHes the updated fields', async () => {
    let routines: Routine[] = [{
      id: 'routine-1',
      name: 'Morning briefing',
      prompt: 'Morning summary',
      schedule: { kind: 'daily', time: '09:00', timezone: 'UTC' },
      target: { mode: 'reuse', projectId: 'proj-1' },
      skillId: null,
      agentId: null,
      enabled: true,
      nextRunAt: Date.now() + 3600_000,
      lastRun: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }];
    const patchBodies: unknown[] = [];

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/routines' && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ routines }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/projects' && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ projects: [{ id: 'proj-1', name: 'Routine Test Project' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/routines/routine-1' && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body));
        patchBodies.push(body);
        const current = routines[0]!;
        routines = [{
          ...current,
          name: body.name ?? current.name,
          prompt: body.prompt ?? current.prompt,
          schedule: body.schedule ?? current.schedule,
          target: body.target ?? current.target,
          updatedAt: Date.now(),
        }];
        return new Response(JSON.stringify({ routine: routines[0] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    }) as typeof fetch;

    render(<RoutinesSection />);

    const row = (await screen.findByText('Morning briefing')).closest('li')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }));

    const nameInput = screen.getByLabelText('Name') as HTMLInputElement;
    expect(nameInput.value).toBe('Morning briefing');
    const promptInput = screen.getByLabelText('Prompt') as HTMLTextAreaElement;
    expect(promptInput.value).toBe('Morning summary');

    fireEvent.change(nameInput, { target: { value: 'Renamed briefing' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(screen.getByText('Renamed briefing')).toBeTruthy();
    });
    expect(patchBodies).toHaveLength(1);
    const body = patchBodies[0] as Record<string, unknown>;
    expect(body.name).toBe('Renamed briefing');
    expect(body.prompt).toBe('Morning summary');
    expect(body.schedule).toEqual({ kind: 'daily', time: '09:00', timezone: 'UTC' });
    expect(body.target).toEqual({ mode: 'reuse', projectId: 'proj-1' });
  });

  it('shows an error alert when deleting a routine fails', async () => {
    const routines: Routine[] = [{
      id: 'routine-1',
      name: 'Morning briefing',
      prompt: 'Morning summary',
      schedule: { kind: 'daily', time: '09:00', timezone: 'UTC' },
      target: { mode: 'create_each_run' },
      skillId: null,
      agentId: null,
      enabled: true,
      nextRunAt: Date.now() + 3600_000,
      lastRun: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }];
    window.confirm = vi.fn(() => true);

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url === '/api/routines' && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ routines }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/projects' && (!init || init.method === undefined)) {
        return new Response(JSON.stringify({ projects: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === '/api/routines/routine-1' && init?.method === 'DELETE') {
        return new Response(JSON.stringify({ error: 'delete failed upstream' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    }) as typeof fetch;

    render(<RoutinesSection />);

    const row = (await screen.findByText('Morning briefing')).closest('li')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('delete failed upstream');
    expect(screen.getByText('Morning briefing')).toBeTruthy();
  });
});

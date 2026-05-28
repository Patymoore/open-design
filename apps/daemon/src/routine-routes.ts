import type { Express } from 'express';
import { randomUUID } from 'node:crypto';
import {
  getAnyAutomationTemplate,
  listAllAutomationTemplates,
} from './automation-templates.js';
import {
  deleteRoutine as dbDeleteRoutine,
  DEFAULT_WORKSPACE_ID,
  getCurrentWorkspaceId,
  getLatestRoutineRun,
  getLocalUserId,
  getProject,
  getRoutine,
  getRoutineRun,
  getWorkspace,
  getWorkspaceMembership,
  insertRoutine,
  insertWorkspaceActivity,
  listRoutineRuns,
  listRoutines,
  listWorkspaces,
  setCurrentWorkspaceId,
  updateRoutine,
} from './db.js';
import { ingestAutomationSource } from './automation-ingestions.js';
import {
  validateSchedule as validateRoutineSchedule,
  validateTarget as validateRoutineTarget,
  type RoutineService,
} from './routines.js';
import type { PathDeps, RouteDeps } from './server-context.js';

export interface RegisterRoutineRoutesDeps extends RouteDeps<'db' | 'routines'> {
  paths: Pick<PathDeps, 'RUNTIME_DATA_DIR'>;
}

export type RoutineRoutesService = Pick<
  RoutineService,
  'nextRunAt' | 'rescheduleOne' | 'runNow' | 'unschedule'
>;

function cleanStringList(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') throw new Error(`${field} must contain strings`);
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function normalizeRoutineContext(value: unknown) {
  if (value === undefined || value === null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('context must be an object');
  }
  const input = value as Record<string, unknown>;
  const context = {
    skillIds: cleanStringList(input.skillIds, 'context.skillIds'),
    pluginIds: cleanStringList(input.pluginIds, 'context.pluginIds'),
    mcpServerIds: cleanStringList(input.mcpServerIds, 'context.mcpServerIds'),
    connectorIds: cleanStringList(input.connectorIds, 'context.connectorIds'),
  };
  return Object.fromEntries(
    Object.entries(context).filter(([, ids]) => ids.length > 0),
  );
}

function parseStoredRoutineContext(row: any) {
  if (!row.contextJson) return {};
  try {
    return normalizeRoutineContext(JSON.parse(row.contextJson));
  } catch {
    return {};
  }
}

class RoutineRouteError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function routineErrorStatus(err: unknown, fallback: number) {
  return err instanceof RoutineRouteError ? err.status : fallback;
}

export function routineDbRowToContract(row: any, latestRun: any) {
  let schedule: any;
  if (row.scheduleJson) {
    try {
      schedule = JSON.parse(row.scheduleJson);
    } catch {
      schedule = null;
    }
  }
  if (!schedule) {
    schedule = {
      kind: row.scheduleKind || 'daily',
      time: row.scheduleValue || '09:00',
      timezone: 'UTC',
    };
  }
  const target = row.projectMode === 'reuse' && row.projectId
    ? { mode: 'reuse', projectId: row.projectId }
    : { mode: 'create_each_run' };
  const lastRun = latestRun
    ? {
        runId: latestRun.id,
        status: latestRun.status,
        trigger: latestRun.trigger,
        startedAt: latestRun.startedAt,
        ...(latestRun.completedAt == null ? {} : { completedAt: latestRun.completedAt }),
        projectId: latestRun.projectId,
        conversationId: latestRun.conversationId,
        agentRunId: latestRun.agentRunId,
        ...(latestRun.summary ? { summary: latestRun.summary } : {}),
        ...(latestRun.error ? { error: latestRun.error } : {}),
        ...(latestRun.errorCode ? { errorCode: latestRun.errorCode } : {}),
      }
    : null;
  return {
    id: row.id,
    workspaceId: row.workspaceId ?? DEFAULT_WORKSPACE_ID,
    ...(row.createdByUserId ? { createdByUserId: row.createdByUserId } : {}),
    ...(row.ownedByUserId ? { ownedByUserId: row.ownedByUserId } : {}),
    name: row.name,
    prompt: row.prompt,
    schedule,
    target,
    skillId: row.skillId ?? null,
    agentId: row.agentId ?? null,
    context: parseStoredRoutineContext(row),
    enabled: row.enabled === true || row.enabled === 1,
    nextRunAt: null as number | null,
    lastRun,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function registerRoutineRoutes(app: Express, ctx: RegisterRoutineRoutesDeps) {
  const { db } = ctx;
  const { routineService } = ctx.routines;

  app.get('/api/automation-templates', async (_req, res) => {
    try {
      res.json({
        templates: await listAllAutomationTemplates(ctx.paths.RUNTIME_DATA_DIR),
      });
    } catch (err: any) {
      res.status(500).json({ error: String(err?.message ?? err) });
    }
  });

  app.get('/api/automation-templates/:id', async (req, res) => {
    try {
      const template = await getAnyAutomationTemplate(
        ctx.paths.RUNTIME_DATA_DIR,
        req.params.id,
      );
      if (!template) return res.status(404).json({ error: 'automation template not found' });
      res.json({ template });
    } catch (err: any) {
      res.status(500).json({ error: String(err?.message ?? err) });
    }
  });

  function scheduleToDbCols(schedule: any) {
    const json = JSON.stringify(schedule);
    let value = '';
    if (schedule.kind === 'hourly') value = String(schedule.minute);
    else if (schedule.kind === 'weekly') value = `${schedule.weekday}:${schedule.time}`;
    else value = schedule.time;
    return { scheduleKind: schedule.kind, scheduleValue: value, scheduleJson: json };
  }

  function routineFromDb(id: string) {
    const row = getRoutine(db, id);
    if (!row) return null;
    const latest = getLatestRoutineRun(db, id);
    const contract = routineDbRowToContract(row, latest);
    const nextDate = routineService?.nextRunAt(id) ?? null;
    contract.nextRunAt = nextDate ? nextDate.getTime() : null;
    return contract;
  }

  function currentAccessibleWorkspaceId() {
    const userId = getLocalUserId(db);
    const savedWorkspaceId = getCurrentWorkspaceId(db, userId);
    if (getWorkspace(db, savedWorkspaceId) && getWorkspaceMembership(db, savedWorkspaceId, userId)) {
      return savedWorkspaceId;
    }
    const fallbackWorkspaceId = listWorkspaces(db, { userId })[0]?.id ?? DEFAULT_WORKSPACE_ID;
    setCurrentWorkspaceId(db, userId, fallbackWorkspaceId);
    return fallbackWorkspaceId;
  }

  function requireWorkspaceAccess(workspaceId: string) {
    const userId = getLocalUserId(db);
    if (!getWorkspace(db, workspaceId)) throw new RoutineRouteError(404, `workspace ${workspaceId} not found`);
    if (!getWorkspaceMembership(db, workspaceId, userId)) {
      throw new RoutineRouteError(403, `workspace ${workspaceId} membership required`);
    }
  }

  function requireWorkspaceManager(workspaceId: string) {
    const userId = getLocalUserId(db);
    if (!getWorkspace(db, workspaceId)) throw new RoutineRouteError(404, `workspace ${workspaceId} not found`);
    const membership = getWorkspaceMembership(db, workspaceId, userId);
    if (membership?.role !== 'owner' && membership?.role !== 'admin') {
      throw new RoutineRouteError(403, `workspace ${workspaceId} admin role required`);
    }
  }

  function workspaceIdFromBody(body: any) {
    const raw = typeof body?.workspaceId === 'string' && body.workspaceId.trim()
      ? body.workspaceId.trim()
      : currentAccessibleWorkspaceId();
    requireWorkspaceAccess(raw);
    return raw;
  }

  function routineIsAccessible(row: any) {
    const userId = getLocalUserId(db);
    return Boolean(getWorkspaceMembership(db, row.workspaceId ?? DEFAULT_WORKSPACE_ID, userId));
  }

  function requireRoutineManager(row: any) {
    requireWorkspaceManager(row.workspaceId ?? DEFAULT_WORKSPACE_ID);
  }

  function requireRoutineTargetWorkspaceInvariant(existing: any, patch: any) {
    const nextProjectMode = patch.projectMode ?? existing.projectMode;
    const nextProjectId = patch.projectId ?? existing.projectId;
    const nextWorkspaceId = patch.workspaceId ?? existing.workspaceId ?? DEFAULT_WORKSPACE_ID;
    if (nextProjectMode !== 'reuse' || !nextProjectId) return;
    const targetProject = getProject(db, nextProjectId);
    if (!targetProject) throw new Error(`target project ${nextProjectId} not found`);
    if (targetProject.workspaceId !== nextWorkspaceId) {
      throw new Error('reuse target project belongs to another workspace');
    }
  }

  function validateRoutineInput(body: any, partial: boolean) {
    if (!body || typeof body !== 'object') throw new Error('Request body must be an object');
    if (!partial || body.name !== undefined) {
      if (typeof body.name !== 'string' || !body.name.trim()) throw new Error('name is required');
    }
    if (!partial || body.prompt !== undefined) {
      if (typeof body.prompt !== 'string' || !body.prompt.trim()) throw new Error('prompt is required');
    }
    if (!partial || body.schedule !== undefined) validateRoutineSchedule(body.schedule);
    if (!partial || body.target !== undefined) {
      validateRoutineTarget(body.target);
      if (body.target.mode === 'reuse') {
        const project = getProject(db, body.target.projectId);
        if (!project) throw new Error(`target project ${body.target.projectId} not found`);
      }
    }
    if (!partial || body.context !== undefined) normalizeRoutineContext(body.context);
  }

  app.get('/api/routines', (req, res) => {
    try {
      const workspaceId =
        typeof req.query.workspaceId === 'string' && req.query.workspaceId.trim()
          ? req.query.workspaceId.trim()
          : currentAccessibleWorkspaceId();
      requireWorkspaceAccess(workspaceId);
      const routines = listRoutines(db, { workspaceId }).map((row) => {
        const latest = getLatestRoutineRun(db, row.id);
        const contract = routineDbRowToContract(row, latest);
        const nextDate = routineService?.nextRunAt(row.id) ?? null;
        contract.nextRunAt = nextDate ? nextDate.getTime() : null;
        return contract;
      });
      res.json({ routines });
    } catch (err: any) {
      res.status(routineErrorStatus(err, 500)).json({ error: String(err?.message ?? err) });
    }
  });

  app.post('/api/routines', (req, res) => {
    try {
      const body = req.body || {};
      const targetProject = body?.target?.mode === 'reuse' && typeof body.target.projectId === 'string'
        ? getProject(db, body.target.projectId)
        : null;
      const workspaceId = targetProject?.workspaceId ?? workspaceIdFromBody(body);
      requireWorkspaceManager(workspaceId);
      validateRoutineInput(body, false);
      const id = `routine-${randomUUID()}`;
      const now = Date.now();
      const scheduleCols = scheduleToDbCols(body.schedule);
      const actorUserId = getLocalUserId(db);
      db.transaction(() => {
        insertRoutine(db, {
          id,
          workspaceId,
          createdByUserId: actorUserId,
          ownedByUserId: actorUserId,
          name: body.name.trim(),
          prompt: body.prompt,
          ...scheduleCols,
          projectMode: body.target.mode,
          projectId: body.target.mode === 'reuse' ? body.target.projectId : null,
          skillId: body.skillId ?? null,
          agentId: body.agentId ?? null,
          contextJson: JSON.stringify(normalizeRoutineContext(body.context)),
          enabled: body.enabled !== false,
          createdAt: now,
          updatedAt: now,
        });
        insertWorkspaceActivity(db, {
          workspaceId,
          actorUserId,
          action: 'routine.created',
          targetType: 'routine',
          targetId: id,
          metadata: {
            routineName: body.name.trim(),
            createdByUserId: actorUserId,
            ownedByUserId: actorUserId,
            targetMode: body.target.mode,
            projectId: body.target.mode === 'reuse' ? body.target.projectId : undefined,
          },
        });
      })();
      routineService?.rescheduleOne(id);
      const routine = routineFromDb(id);
      res.status(201).json({ routine });
    } catch (err: any) {
      res.status(routineErrorStatus(err, 400)).json({ error: String(err?.message ?? err) });
    }
  });

  app.get('/api/routines/:id', (req, res) => {
    const existing = getRoutine(db, req.params.id);
    if (!existing) return res.status(404).json({ error: 'routine not found' });
    if (!routineIsAccessible(existing)) return res.status(403).json({ error: 'workspace membership required' });
    const routine = routineFromDb(req.params.id);
    res.json({ routine });
  });

  app.patch('/api/routines/:id', (req, res) => {
    try {
      const existing = getRoutine(db, req.params.id);
      if (!existing) return res.status(404).json({ error: 'routine not found' });
      if (!routineIsAccessible(existing)) return res.status(403).json({ error: 'workspace membership required' });
      requireRoutineManager(existing);
      const body = req.body || {};
      validateRoutineInput(body, true);
      const patch: any = {};
      if (body.workspaceId !== undefined) {
        patch.workspaceId = workspaceIdFromBody(body);
        requireWorkspaceManager(patch.workspaceId);
      }
      if (body.ownedByUserId !== undefined) {
        const ownedByUserId = typeof body.ownedByUserId === 'string' ? body.ownedByUserId.trim() : '';
        if (!ownedByUserId) throw new RoutineRouteError(400, 'ownedByUserId must be a string');
        const ownerWorkspaceId = patch.workspaceId ?? existing.workspaceId ?? DEFAULT_WORKSPACE_ID;
        requireWorkspaceManager(existing.workspaceId ?? DEFAULT_WORKSPACE_ID);
        if (ownerWorkspaceId !== (existing.workspaceId ?? DEFAULT_WORKSPACE_ID)) {
          requireWorkspaceManager(ownerWorkspaceId);
        }
        if (!getWorkspaceMembership(db, ownerWorkspaceId, ownedByUserId)) {
          throw new RoutineRouteError(404, 'asset owner must be a workspace member');
        }
        patch.ownedByUserId = ownedByUserId;
      }
      if (body.name !== undefined) patch.name = body.name.trim();
      if (body.prompt !== undefined) patch.prompt = body.prompt;
      if (body.schedule !== undefined) Object.assign(patch, scheduleToDbCols(body.schedule));
      if (body.target !== undefined) {
        patch.projectMode = body.target.mode;
        patch.projectId = body.target.mode === 'reuse' ? body.target.projectId : null;
        if (body.target.mode === 'reuse') {
          const targetProject = getProject(db, body.target.projectId);
          if (targetProject) {
            requireWorkspaceAccess(targetProject.workspaceId);
            requireWorkspaceManager(targetProject.workspaceId);
            patch.workspaceId = targetProject.workspaceId;
          }
        }
      }
      if (
        patch.ownedByUserId !== undefined &&
        !getWorkspaceMembership(db, patch.workspaceId ?? existing.workspaceId ?? DEFAULT_WORKSPACE_ID, patch.ownedByUserId)
      ) {
        throw new RoutineRouteError(404, 'asset owner must be a workspace member');
      }
      if (body.skillId !== undefined) patch.skillId = body.skillId ?? null;
      if (body.agentId !== undefined) patch.agentId = body.agentId ?? null;
      if (body.context !== undefined) patch.contextJson = JSON.stringify(normalizeRoutineContext(body.context));
      if (body.enabled !== undefined) patch.enabled = Boolean(body.enabled);
      const nextWorkspaceId = patch.workspaceId ?? existing.workspaceId ?? DEFAULT_WORKSPACE_ID;
      if (
        nextWorkspaceId !== (existing.workspaceId ?? DEFAULT_WORKSPACE_ID) &&
        !('ownedByUserId' in patch)
      ) {
        const currentOwnerUserId = existing.ownedByUserId ?? existing.createdByUserId;
        if (!currentOwnerUserId || !getWorkspaceMembership(db, nextWorkspaceId, currentOwnerUserId)) {
          patch.ownedByUserId = getLocalUserId(db);
        }
      }
      requireRoutineTargetWorkspaceInvariant(existing, patch);
      const updated = db.transaction(() => {
        const patched = updateRoutine(db, req.params.id, patch);
        if (!patched) return null;
        const actorUserId = getLocalUserId(db);
        const nextWorkspaceId = patched.workspaceId ?? DEFAULT_WORKSPACE_ID;
        const transferringOwner = patch.ownedByUserId !== undefined
          && (existing.ownedByUserId ?? existing.createdByUserId) !== patched.ownedByUserId;
        const metadata = {
          routineName: patched.name,
          fromWorkspaceId: existing.workspaceId ?? DEFAULT_WORKSPACE_ID,
          toWorkspaceId: nextWorkspaceId,
          enabled: patched.enabled,
          targetMode: patched.projectMode,
          projectId: patched.projectId ?? undefined,
        };
        insertWorkspaceActivity(db, {
          workspaceId: existing.workspaceId ?? DEFAULT_WORKSPACE_ID,
          actorUserId,
          action: 'routine.updated',
          targetType: 'routine',
          targetId: req.params.id,
          metadata,
        });
        if (nextWorkspaceId !== (existing.workspaceId ?? DEFAULT_WORKSPACE_ID)) {
          insertWorkspaceActivity(db, {
            workspaceId: nextWorkspaceId,
            actorUserId,
            action: 'routine.updated',
            targetType: 'routine',
            targetId: req.params.id,
            metadata,
          });
        }
        if (transferringOwner) {
          insertWorkspaceActivity(db, {
            workspaceId: nextWorkspaceId,
            actorUserId,
            action: 'routine.owner_transferred',
            targetType: 'routine',
            targetId: req.params.id,
            metadata: {
              routineName: patched.name,
              fromUserId: existing.ownedByUserId ?? existing.createdByUserId,
              toUserId: patched.ownedByUserId,
            },
          });
        }
        return patched;
      })();
      if (!updated) return res.status(404).json({ error: 'routine not found' });
      routineService?.rescheduleOne(req.params.id);
      res.json({ routine: routineFromDb(req.params.id) });
    } catch (err: any) {
      res.status(routineErrorStatus(err, 400)).json({ error: String(err?.message ?? err) });
    }
  });

  app.delete('/api/routines/:id', (req, res) => {
    try {
      const existing = getRoutine(db, req.params.id);
      if (!existing) return res.status(404).json({ error: 'routine not found' });
      if (!routineIsAccessible(existing)) return res.status(403).json({ error: 'workspace membership required' });
      requireRoutineManager(existing);
      const deleted = db.transaction(() => {
        const removed = dbDeleteRoutine(db, req.params.id);
        if (!removed) return false;
        insertWorkspaceActivity(db, {
          workspaceId: existing.workspaceId ?? DEFAULT_WORKSPACE_ID,
          actorUserId: getLocalUserId(db),
          action: 'routine.deleted',
          targetType: 'routine',
          targetId: req.params.id,
          metadata: {
            routineName: existing.name,
            targetMode: existing.projectMode,
            projectId: existing.projectId ?? undefined,
          },
        });
        return true;
      })();
      if (!deleted) return res.status(404).json({ error: 'routine not found' });
      routineService?.unschedule(req.params.id);
      res.status(204).end();
    } catch (err: any) {
      res.status(routineErrorStatus(err, 400)).json({ error: String(err?.message ?? err) });
    }
  });

  app.post('/api/routines/:id/run', async (req, res) => {
    try {
      const existing = getRoutine(db, req.params.id);
      if (!existing) return res.status(404).json({ error: 'routine not found' });
      if (!routineIsAccessible(existing)) return res.status(403).json({ error: 'workspace membership required' });
      requireRoutineManager(existing);
      const start = await routineService.runNow(req.params.id);
      insertWorkspaceActivity(db, {
        workspaceId: existing.workspaceId ?? DEFAULT_WORKSPACE_ID,
        actorUserId: getLocalUserId(db),
        action: 'routine.run_requested',
        targetType: 'routine',
        targetId: req.params.id,
        metadata: {
          routineName: existing.name,
          projectId: start.projectId,
          conversationId: start.conversationId,
          agentRunId: start.agentRunId,
        },
      });
      res.status(202).json({
        routine: routineFromDb(req.params.id),
        run: getLatestRoutineRun(db, req.params.id),
        projectId: start.projectId,
        conversationId: start.conversationId,
        agentRunId: start.agentRunId,
      });
    } catch (err: any) {
      res.status(routineErrorStatus(err, 500)).json({ error: String(err?.message ?? err) });
    }
  });

  app.get('/api/routines/:id/runs', (req, res) => {
    const existing = getRoutine(db, req.params.id);
    if (!existing) return res.status(404).json({ error: 'routine not found' });
    if (!routineIsAccessible(existing)) return res.status(403).json({ error: 'workspace membership required' });
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    res.json({ runs: listRoutineRuns(db, req.params.id, limit) });
  });

  app.post('/api/routines/:id/runs/:runId/crystallize', async (req, res) => {
    try {
      const routine = getRoutine(db, req.params.id);
      if (!routine) return res.status(404).json({ error: 'routine not found' });
      const run = getRoutineRun(db, req.params.runId);
      if (!run || run.routineId !== req.params.id) {
        return res.status(404).json({ error: 'routine run not found' });
      }
      if (run.status !== 'succeeded') {
        return res.status(400).json({ error: 'only succeeded routine runs can be crystallized' });
      }
      const bodyMarkdown = [
        `# ${routine.name} reusable workflow`,
        '',
        `Routine id: ${routine.id}`,
        `Routine run: ${run.id}`,
        `Project id: ${run.projectId}`,
        `Conversation id: ${run.conversationId}`,
        `Agent run id: ${run.agentRunId}`,
        '',
        '## Original Automation Prompt',
        '',
        routine.prompt,
        '',
        '## Run Summary',
        '',
        run.summary || 'No run summary was recorded; crystallize from the automation prompt and run metadata.',
      ].join('\n');
      const result = await ingestAutomationSource(ctx.paths.RUNTIME_DATA_DIR, {
        templateId: 'crystallize-run-into-skill',
        sourceKind: 'chat',
        sourceRef: `routine-run:${run.id}`,
        title: `${routine.name} run`,
        bodyMarkdown,
        projectId: run.projectId,
        conversationId: run.conversationId,
        tokenCompression: 'balanced',
        metadata: {
          routineId: routine.id,
          routineRunId: run.id,
          agentRunId: run.agentRunId,
        },
      });
      res.json({ ...result, routineId: routine.id, runId: run.id });
    } catch (err: any) {
      res.status(400).json({ error: String(err?.message ?? err) });
    }
  });
}

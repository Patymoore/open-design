import type { Express } from 'express';
import type { LiveArtifact, PublicLiveArtifactSummary, PublicResourceShare } from '@open-design/contracts';
import type { RouteDeps } from './server-context.js';

export interface RegisterLiveArtifactRoutesDeps extends RouteDeps<'db' | 'http' | 'paths' | 'auth' | 'liveArtifacts' | 'projectStore'> {}

export function registerLiveArtifactRoutes(app: Express, ctx: RegisterLiveArtifactRoutesDeps) {
  const { db } = ctx;
  const { sendApiError, sendLiveArtifactRouteError, requireLocalDaemonRequest } = ctx.http;
  const { PROJECTS_DIR } = ctx.paths;
  const { authorizeToolRequest, requestProjectOverride, requestRunOverride } = ctx.auth;
  const { createLiveArtifact, listLiveArtifacts, updateLiveArtifact, refreshLiveArtifact, emitLiveArtifactEvent, emitLiveArtifactRefreshEvent, readLiveArtifactCode, setLiveArtifactCodeHeaders, ensureLiveArtifactPreview, setLiveArtifactPreviewHeaders, getLiveArtifact, listLiveArtifactRefreshLogEntries, deleteLiveArtifact } = ctx.liveArtifacts;
  const { getLocalUserId, getProject, getResourceShareByToken, getWorkspaceMembership, insertLiveArtifactShare, insertWorkspaceActivity, revokeLiveArtifactShares, updateProject } = ctx.projectStore;

  function shareUrl(req: { protocol: string; get(name: string): string | undefined }, token: string) {
    const host = req.get('host') ?? '127.0.0.1';
    return `${req.protocol}://${host}/share/live-artifact/${encodeURIComponent(token)}`;
  }

  function publicArtifactSummary(artifact: LiveArtifact): PublicLiveArtifactSummary {
    return {
      schemaVersion: artifact.schemaVersion,
      title: artifact.title,
      slug: artifact.slug,
      status: artifact.status,
      pinned: artifact.pinned,
      preview: artifact.preview,
      refreshStatus: artifact.refreshStatus,
      createdAt: artifact.createdAt,
      updatedAt: artifact.updatedAt,
      hasDocument: artifact.document !== undefined,
    };
  }

  function publicShareSummary(share: {
    targetType: PublicResourceShare['targetType'];
    role: PublicResourceShare['role'];
    createdAt: number;
    projectName?: string;
  }): PublicResourceShare {
    return {
      targetType: share.targetType,
      role: share.role,
      createdAt: share.createdAt,
      ...(share.projectName ? { projectName: share.projectName } : {}),
    };
  }

  function requireProjectAccess(projectId: string | undefined, res: any) {
    if (!projectId) {
      sendApiError(res, 400, 'BAD_REQUEST', 'projectId query parameter is required');
      return false;
    }
    const project = getProject(db, projectId);
    if (!project) {
      sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      return false;
    }
    if (!getWorkspaceMembership(db, project.workspaceId, getLocalUserId(db))) {
      sendApiError(res, 403, 'FORBIDDEN', 'workspace membership required');
      return false;
    }
    return true;
  }

  function requireToolProjectAccess(projectId: string | undefined, res: any) {
    if (!projectId) {
      sendApiError(res, 400, 'BAD_REQUEST', 'tool token projectId is required');
      return false;
    }
    const project = getProject(db, projectId);
    if (!project) {
      sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      return false;
    }
    if (!getWorkspaceMembership(db, project.workspaceId, getLocalUserId(db))) {
      sendApiError(res, 403, 'FORBIDDEN', 'workspace membership required');
      return false;
    }
    return true;
  }

  function isWorkspaceManager(role: string | undefined) {
    return role === 'owner' || role === 'admin';
  }

  function requireProjectManager(projectId: string | undefined, res: any) {
    if (!projectId) {
      sendApiError(res, 400, 'BAD_REQUEST', 'projectId query parameter is required');
      return null;
    }
    const project = getProject(db, projectId);
    if (!project) {
      sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
      return null;
    }
    const membership = getWorkspaceMembership(db, project.workspaceId, getLocalUserId(db));
    if (!membership) {
      sendApiError(res, 403, 'FORBIDDEN', 'workspace membership required');
      return null;
    }
    if (!isWorkspaceManager(membership.role)) {
      sendApiError(res, 403, 'FORBIDDEN', 'workspace admin role required');
      return null;
    }
    return project;
  }

  app.get('/api/live-artifacts', async (req, res) => {
    try {
      const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
      if (!requireProjectAccess(projectId, res)) return;

      const artifacts = await listLiveArtifacts({
        projectsRoot: PROJECTS_DIR,
        projectId,
      });
      res.json({ artifacts });
    } catch (err: any) {
      sendLiveArtifactRouteError(res, err);
    }
  });

  app.options('/api/live-artifacts/:artifactId/preview', requireLocalDaemonRequest, (_req, res) => {
    res.status(204).end();
  });

  app.get('/api/live-artifacts/:artifactId/preview', requireLocalDaemonRequest, async (req, res) => {
    try {
      const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
      if (!requireProjectAccess(projectId, res)) return;

      const variant = typeof req.query.variant === 'string' ? req.query.variant : 'rendered';
      if (variant === 'template' || variant === 'rendered-source') {
        const html = await readLiveArtifactCode({
          projectsRoot: PROJECTS_DIR,
          projectId,
          artifactId: req.params.artifactId,
          variant: variant === 'template' ? 'template' : 'rendered',
        });
        setLiveArtifactCodeHeaders(res);
        return res.status(200).send(html);
      }
      if (variant !== 'rendered') {
        return sendApiError(res, 400, 'BAD_REQUEST', 'variant must be rendered, template, or rendered-source');
      }

      const record = await ensureLiveArtifactPreview({
        projectsRoot: PROJECTS_DIR,
        projectId,
        artifactId: req.params.artifactId,
      });
      setLiveArtifactPreviewHeaders(res);
      res.status(200).send(record.html);
    } catch (err: any) {
      sendLiveArtifactRouteError(res, err);
    }
  });

  app.get('/api/live-artifacts/:artifactId', async (req, res) => {
    try {
      const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
      if (!requireProjectAccess(projectId, res)) return;

      const record = await getLiveArtifact({
        projectsRoot: PROJECTS_DIR,
        projectId,
        artifactId: req.params.artifactId,
      });
      res.json({ artifact: record.artifact });
    } catch (err: any) {
      sendLiveArtifactRouteError(res, err);
    }
  });

  app.get('/api/live-artifacts/:artifactId/refreshes', async (req, res) => {
    try {
      const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
      if (!requireProjectAccess(projectId, res)) return;

      const refreshes = await listLiveArtifactRefreshLogEntries({
        projectsRoot: PROJECTS_DIR,
        projectId,
        artifactId: req.params.artifactId,
      });
      res.json({ refreshes });
    } catch (err: any) {
      sendLiveArtifactRouteError(res, err);
    }
  });

  app.post('/api/tools/live-artifacts/create', async (req, res) => {
    try {
      const toolGrant = authorizeToolRequest(req, res, 'live-artifacts:create');
      if (!toolGrant) return;
      const { projectId, input, templateHtml, provenanceJson, createdByRunId } = req.body || {};
      if (requestProjectOverride(projectId, toolGrant.projectId)) {
        return sendApiError(res, 403, 'FORBIDDEN', 'projectId is derived from the tool token', {
          details: { suppliedProjectId: projectId },
        });
      }
      if (requestRunOverride(createdByRunId, toolGrant.runId)) {
        return sendApiError(res, 403, 'FORBIDDEN', 'createdByRunId is derived from the tool token', {
          details: { suppliedRunId: createdByRunId },
        });
      }
      if (!requireToolProjectAccess(toolGrant.projectId, res)) return;

      const record = await createLiveArtifact({
        projectsRoot: PROJECTS_DIR,
        projectId: toolGrant.projectId,
        input: input ?? {},
        templateHtml,
        provenanceJson,
        createdByRunId: toolGrant.runId,
      });
      emitLiveArtifactEvent(toolGrant, 'created', record.artifact);
      res.json({ artifact: record.artifact });
    } catch (err: any) {
      sendLiveArtifactRouteError(res, err);
    }
  });

  app.get('/api/tools/live-artifacts/list', async (req, res) => {
    try {
      const toolGrant = authorizeToolRequest(req, res, 'live-artifacts:list');
      if (!toolGrant) return;
      const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
      if (requestProjectOverride(projectId, toolGrant.projectId)) {
        return sendApiError(res, 403, 'FORBIDDEN', 'projectId is derived from the tool token', {
          details: { suppliedProjectId: projectId },
        });
      }
      if (!requireToolProjectAccess(toolGrant.projectId, res)) return;

      const artifacts = await listLiveArtifacts({
        projectsRoot: PROJECTS_DIR,
        projectId: toolGrant.projectId,
      });
      res.json({ artifacts });
    } catch (err: any) {
      sendLiveArtifactRouteError(res, err);
    }
  });

  app.post('/api/tools/live-artifacts/update', async (req, res) => {
    try {
      const toolGrant = authorizeToolRequest(req, res, 'live-artifacts:update');
      if (!toolGrant) return;
      const { projectId, artifactId, input, templateHtml, provenanceJson } = req.body || {};
      if (requestProjectOverride(projectId, toolGrant.projectId)) {
        return sendApiError(res, 403, 'FORBIDDEN', 'projectId is derived from the tool token', {
          details: { suppliedProjectId: projectId },
        });
      }
      if (typeof artifactId !== 'string' || artifactId.length === 0) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'artifactId is required');
      }
      if (!requireToolProjectAccess(toolGrant.projectId, res)) return;

      const record = await updateLiveArtifact({
        projectsRoot: PROJECTS_DIR,
        projectId: toolGrant.projectId,
        artifactId,
        input: input ?? {},
        templateHtml,
        provenanceJson,
      });
      emitLiveArtifactEvent(toolGrant, 'updated', record.artifact);
      res.json({ artifact: record.artifact });
    } catch (err: any) {
      sendLiveArtifactRouteError(res, err);
    }
  });

  app.post('/api/tools/live-artifacts/refresh', async (req, res) => {
    try {
      const toolGrant = authorizeToolRequest(req, res, 'live-artifacts:refresh');
      if (!toolGrant) return;
      const { projectId, artifactId } = req.body || {};
      if (requestProjectOverride(projectId, toolGrant.projectId)) {
        return sendApiError(res, 403, 'FORBIDDEN', 'projectId is derived from the tool token', {
          details: { suppliedProjectId: projectId },
        });
      }
      if (typeof artifactId !== 'string' || artifactId.length === 0) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'artifactId is required');
      }
      if (!requireToolProjectAccess(toolGrant.projectId, res)) return;

      let result;
      try {
        result = await refreshLiveArtifact({
          projectsRoot: PROJECTS_DIR,
          projectId: toolGrant.projectId,
          artifactId,
          onStarted: ({ refreshId }: any) => {
            emitLiveArtifactRefreshEvent(toolGrant, { phase: 'started', artifactId, refreshId });
          },
        });
      } catch (refreshErr) {
        emitLiveArtifactRefreshEvent(toolGrant, {
          phase: 'failed',
          artifactId,
          error: refreshErr instanceof Error ? refreshErr.message : String(refreshErr),
        });
        throw refreshErr;
      }
      emitLiveArtifactRefreshEvent(toolGrant, {
        phase: 'succeeded',
        artifactId,
        refreshId: result.refresh.id,
        title: result.artifact.title,
        refreshedSourceCount: result.refresh.refreshedSourceCount,
      });
      res.json(result);
    } catch (err: any) {
      sendLiveArtifactRouteError(res, err);
    }
  });

  app.patch('/api/live-artifacts/:artifactId', async (req, res) => {
    try {
      const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
      if (!requireProjectAccess(projectId, res)) return;

      const record = await updateLiveArtifact({
        projectsRoot: PROJECTS_DIR,
        projectId,
        artifactId: req.params.artifactId,
        input: req.body ?? {},
      });
      emitLiveArtifactEvent({ projectId }, 'updated', record.artifact);
      res.json({ artifact: record.artifact });
    } catch (err: any) {
      sendLiveArtifactRouteError(res, err);
    }
  });

  app.delete('/api/live-artifacts/:artifactId', async (req, res) => {
    try {
      const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
      const project = requireProjectManager(projectId, res);
      if (!project) return;

      const existing = await getLiveArtifact({
        projectsRoot: PROJECTS_DIR,
        projectId: project.id,
        artifactId: req.params.artifactId,
      });
      await deleteLiveArtifact({
        projectsRoot: PROJECTS_DIR,
        projectId: project.id,
        artifactId: req.params.artifactId,
      });
      db.transaction(() => {
        const revokedShares = revokeLiveArtifactShares(db, {
          projectId: project.id,
          artifactId: req.params.artifactId,
        });
        const actorUserId = getLocalUserId(db);
        for (const share of revokedShares) {
          insertWorkspaceActivity(db, {
            workspaceId: project.workspaceId,
            actorUserId,
            action: 'share.revoked',
            targetType: 'share',
            targetId: share.id,
            metadata: {
              artifactId: req.params.artifactId,
              projectId: project.id,
              projectName: project.name,
              reason: 'artifact_deleted',
            },
          });
        }
        updateProject(db, project.id, {});
      })();
      emitLiveArtifactEvent({ projectId: project.id }, 'deleted', existing.artifact);
      res.json({ ok: true });
    } catch (err: any) {
      sendLiveArtifactRouteError(res, err);
    }
  });

  app.options('/api/live-artifacts/:artifactId/refresh', requireLocalDaemonRequest, (_req, res) => {
    res.status(204).end();
  });

  app.post('/api/live-artifacts/:artifactId/refresh', requireLocalDaemonRequest, async (req, res) => {
    try {
      const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
      if (!requireProjectAccess(projectId, res)) return;

      let result;
      try {
        result = await refreshLiveArtifact({
          projectsRoot: PROJECTS_DIR,
          projectId,
          artifactId: req.params.artifactId,
          onStarted: ({ refreshId }: any) => {
            emitLiveArtifactRefreshEvent({ projectId }, { phase: 'started', artifactId: req.params.artifactId, refreshId });
          },
        });
      } catch (refreshErr) {
        emitLiveArtifactRefreshEvent({ projectId }, {
          phase: 'failed',
          artifactId: req.params.artifactId,
          error: refreshErr instanceof Error ? refreshErr.message : String(refreshErr),
        });
        throw refreshErr;
      }
      emitLiveArtifactRefreshEvent({ projectId }, {
        phase: 'succeeded',
        artifactId: req.params.artifactId,
        refreshId: result.refresh.id,
        title: result.artifact.title,
        refreshedSourceCount: result.refresh.refreshedSourceCount,
      });
      res.json(result);
    } catch (err: any) {
      sendLiveArtifactRouteError(res, err);
    }
  });

  app.post('/api/live-artifacts/:artifactId/shares', async (req, res) => {
    try {
      const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
      const project = requireProjectManager(projectId, res);
      if (!project) return;
      const currentUserId = getLocalUserId(db);
      await getLiveArtifact({
        projectsRoot: PROJECTS_DIR,
        projectId: project.id,
        artifactId: req.params.artifactId,
      });
      const share = db.transaction(() => {
        const insertedShare = insertLiveArtifactShare(db, {
          projectId: project.id,
          artifactId: req.params.artifactId,
          userId: currentUserId,
        });
        const reused = Boolean((insertedShare as any)?.reused);
        if (insertedShare && !reused) {
          insertWorkspaceActivity(db, {
            workspaceId: project.workspaceId,
            actorUserId: currentUserId,
            action: 'share.created',
            targetType: 'share',
            targetId: insertedShare.id,
            metadata: { artifactId: req.params.artifactId, projectId: project.id, projectName: project.name },
          });
        }
        return insertedShare;
      })();
      if (!share) {
        res.json({ share: null });
        return;
      }
      const { reused: _reused, ...shareResponse } = share as any;
      res.json({ share: { ...shareResponse, shareUrl: shareUrl(req, share.token) } });
    } catch (err: any) {
      sendLiveArtifactRouteError(res, err);
    }
  });

  app.get('/api/shares/live-artifacts/:token', async (req, res) => {
    try {
      const share = getResourceShareByToken(db, req.params.token);
      if (!share || share.targetType !== 'live_artifact' || !share.artifactId) {
        return sendApiError(res, 404, 'SHARE_NOT_FOUND', 'share not found');
      }
      const record = await getLiveArtifact({
        projectsRoot: PROJECTS_DIR,
        projectId: share.projectId,
        artifactId: share.artifactId,
      });
      res.json({
        share: publicShareSummary(share),
        artifact: publicArtifactSummary(record.artifact),
        previewUrl: `/api/shares/live-artifacts/${encodeURIComponent(share.token)}/preview`,
      });
    } catch (err: any) {
      sendLiveArtifactRouteError(res, err);
    }
  });

  app.get('/api/shares/live-artifacts/:token/preview', async (req, res) => {
    try {
      const share = getResourceShareByToken(db, req.params.token);
      if (!share || share.targetType !== 'live_artifact' || !share.artifactId) {
        return sendApiError(res, 404, 'SHARE_NOT_FOUND', 'share not found');
      }
      const record = await ensureLiveArtifactPreview({
        projectsRoot: PROJECTS_DIR,
        projectId: share.projectId,
        artifactId: share.artifactId,
      });
      setLiveArtifactPreviewHeaders(res);
      res.status(200).send(record.html);
    } catch (err: any) {
      sendLiveArtifactRouteError(res, err);
    }
  });

}

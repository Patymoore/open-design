// OD Library HTTP surface.
//
// Three classes of caller:
//   - The OD web UI (loopback / same-origin): list, detail, raw, delete,
//     pairing start, connection status, live events.
//   - The browser extension (cross-origin `chrome-extension://…`, library
//     token): ingest. Its origin is allowlisted at pairing time so the
//     global `/api` origin middleware lets the POST through.
//   - The pairing handshake (`/pair/confirm`): reachable from the not-yet-
//     allowlisted extension origin, gated by the short-lived pairing code.
//
// Routes that mutate stay token- or loopback-gated; reads ride the daemon's
// loopback binding + same-origin middleware like the rest of `/api`.

import { createReadStream } from 'node:fs';
import { copyFile, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { Express, Request, Response } from 'express';
import type {
  LibraryAsset,
  LibraryAssetFilter,
  LibraryAssetKind,
  LibrarySourceKind,
} from '@open-design/contracts';
import type { RouteDeps } from '../server-context.js';
import {
  addLibraryAssetSource,
  deleteLibraryAsset,
  getLibraryAsset,
  listLibraryAssets,
  type LibraryAssetRecord,
} from '../library-store.js';
import {
  extForMime,
  registerLibraryAsset,
  resolveAssetBytesPath,
} from '../library.js';
import { ensureProjectSubdir } from '../projects.js';
import {
  confirmPairing,
  isAllowedExtensionOrigin,
  libraryConnectionStatus,
  startPairing,
  validateLibraryToken,
} from '../library-tokens.js';

export interface RegisterLibraryRoutesDeps
  extends RouteDeps<'db' | 'http' | 'paths' | 'projectStore' | 'auth'> {}

const MAX_REMOTE_BYTES = 25 * 1024 * 1024;

/** Strip the internal absolute `filePath` before returning an asset to a client. */
function toPublicAsset(record: LibraryAssetRecord): LibraryAsset {
  const { filePath: _filePath, ...rest } = record;
  return rest;
}

function bearerToken(req: Request): string | undefined {
  const header = req.get('authorization') ?? '';
  return /^Bearer\s+(.+)$/i.exec(header.trim())?.[1];
}

/**
 * Echo an extension Origin back as the CORS allow-origin. MV3 service-worker
 * fetches with host_permissions bypass CORS, but desktop/Firefox paths and
 * preflights are happier with an explicit allow-origin, so set it whenever the
 * caller presents an extension origin.
 */
function applyExtensionCors(req: Request, res: Response): void {
  const origin = req.get('origin');
  if (origin && (origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://'))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  }
}

function parseDataUrl(dataUrl: string): { bytes: Buffer; mime: string | undefined } | null {
  const match = /^data:([^;,]*)(;base64)?,([\s\S]*)$/.exec(dataUrl);
  if (!match) return null;
  const mime = match[1] || undefined;
  const isBase64 = Boolean(match[2]);
  const payload = match[3] ?? '';
  const bytes = isBase64
    ? Buffer.from(payload, 'base64')
    : Buffer.from(decodeURIComponent(payload), 'utf8');
  return { bytes, mime };
}

async function fetchRemoteBytes(url: string): Promise<{ bytes: Buffer; mime: string | undefined }> {
  const resp = await fetch(url, { redirect: 'follow' });
  if (!resp.ok) throw new Error(`remote fetch failed: ${resp.status}`);
  const declared = Number(resp.headers.get('content-length') ?? '0');
  if (declared && declared > MAX_REMOTE_BYTES) throw new Error('remote resource too large');
  const buf = Buffer.from(await resp.arrayBuffer());
  if (buf.length > MAX_REMOTE_BYTES) throw new Error('remote resource too large');
  const mime = resp.headers.get('content-type')?.split(';')[0]?.trim() || undefined;
  return { bytes: buf, mime };
}

export function registerLibraryRoutes(app: Express, ctx: RegisterLibraryRoutesDeps): void {
  const { db } = ctx;
  const { sendApiError, createSseResponse, requireLocalDaemonRequest, isLocalSameOrigin, resolvedPortRef } =
    ctx.http;
  const { LIBRARY_DIR, PROJECTS_DIR } = ctx.paths;
  const { getProject } = ctx.projectStore;
  const { authorizeToolRequest } = ctx.auth;

  // Copy an asset's bytes into a project (under a `library/` subdir) and record
  // the project usage as a source back-link. Shared by the loopback apply route
  // and the agent tool-token route.
  async function applyAssetToProject(
    asset: LibraryAssetRecord,
    projectId: string,
    sourceKind: LibrarySourceKind,
    dir?: string,
  ): Promise<string> {
    const bytesPath = resolveAssetBytesPath(asset, PROJECTS_DIR);
    if (!bytesPath) throw new Error('asset bytes not available');
    const project = getProject(db, projectId);
    if (!project) throw new Error('project not found');
    const subdir = dir && dir.trim() ? dir.trim() : 'library';
    const { absDir, relDir } = await ensureProjectSubdir(
      PROJECTS_DIR,
      projectId,
      subdir,
      project.metadata,
    );
    const ext = extForMime(asset.mime, undefined);
    const name = `${asset.contentHash.slice(0, 12)}${ext}`;
    await copyFile(bytesPath, path.join(absDir, name));
    addLibraryAssetSource(db, { assetId: asset.id, sourceKind, projectId });
    return relDir ? `${relDir}/${name}` : name;
  }

  // Live ingest/enrichment feed. Clipper captures flow through this route, so
  // the web grid can update without polling.
  const sseClients = new Set<(event: string, data: unknown) => void>();
  const emit = (event: string, data: unknown) => {
    for (const send of sseClients) {
      try {
        send(event, data);
      } catch {
        // a dead client must not block the rest
      }
    }
  };

  // --- pairing -------------------------------------------------------------

  // Loopback-only: the OD UI mints a pairing code to show the user.
  app.post('/api/library/pair', requireLocalDaemonRequest, (_req, res) => {
    const { code, expiresAt } = startPairing();
    res.json({ code, expiresAt });
  });

  // Reachable from the (not-yet-allowlisted) extension origin — gated by the
  // pairing code. server.ts exempts this exact path from the global origin
  // middleware. CORS preflight handled below.
  app.options('/api/library/pair/confirm', (req, res) => {
    applyExtensionCors(req, res);
    res.status(204).end();
  });
  app.post('/api/library/pair/confirm', (req, res) => {
    applyExtensionCors(req, res);
    const body = req.body ?? {};
    const code = String(body.code ?? '');
    const extensionOrigin = String(body.extensionOrigin ?? '');
    if (!code || !extensionOrigin) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'code and extensionOrigin are required');
    }
    const result = confirmPairing(db, { code, extensionOrigin, label: body.label });
    if (!result.ok) {
      return sendApiError(res, 401, 'PAIRING_FAILED', result.error);
    }
    res.json({ token: result.token, label: result.label });
  });

  // Loopback-only: web UI connection status.
  app.get('/api/library/connection', requireLocalDaemonRequest, (_req, res) => {
    res.json(libraryConnectionStatus(db));
  });

  // --- ingest --------------------------------------------------------------

  app.options('/api/library/ingest', (req, res) => {
    applyExtensionCors(req, res);
    res.status(204).end();
  });
  app.post('/api/library/ingest', async (req, res) => {
    applyExtensionCors(req, res);
    // Two trusted callers: the browser extension (library token) and the local
    // CLI / web UI (loopback / same-origin). Token → 'clipper'; trusted local
    // → 'manual-upload'.
    const token = bearerToken(req);
    const validation = validateLibraryToken(db, token);
    let sourceKind: LibrarySourceKind;
    if (validation.ok) {
      sourceKind = 'clipper';
    } else if (isLocalSameOrigin(req, resolvedPortRef.current)) {
      sourceKind = 'manual-upload';
    } else {
      return sendApiError(res, 401, 'LIBRARY_TOKEN_INVALID', 'a valid library token is required');
    }

    const body = req.body ?? {};
    let bytes: Buffer | undefined;
    let mime: string | undefined = typeof body.mime === 'string' ? body.mime : undefined;
    const text = typeof body.text === 'string' ? body.text : undefined;

    try {
      if (typeof body.dataUrl === 'string') {
        const parsed = parseDataUrl(body.dataUrl);
        if (!parsed) return sendApiError(res, 400, 'BAD_REQUEST', 'invalid dataUrl');
        bytes = parsed.bytes;
        mime = mime ?? parsed.mime;
      } else if (typeof body.url === 'string') {
        const fetched = await fetchRemoteBytes(body.url);
        bytes = fetched.bytes;
        mime = mime ?? fetched.mime;
      } else if (text === undefined) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'one of dataUrl, url, or text is required');
      }
    } catch (err) {
      return sendApiError(res, 502, 'INGEST_FETCH_FAILED', err instanceof Error ? err.message : String(err));
    }

    try {
      const result = await registerLibraryAsset({
        db,
        libraryDir: LIBRARY_DIR,
        storage: 'owned',
        bytes,
        text,
        kind: typeof body.kind === 'string' ? (body.kind as LibraryAssetKind) : undefined,
        mime,
        filename: typeof body.filename === 'string' ? body.filename : undefined,
        sourceUrl: typeof body.sourceUrl === 'string' ? body.sourceUrl : undefined,
        sourceTitle: typeof body.sourceTitle === 'string' ? body.sourceTitle : undefined,
        tags: Array.isArray(body.tags) ? body.tags.filter((t: unknown) => typeof t === 'string') : undefined,
        source: { sourceKind },
      });
      const asset = toPublicAsset(result.asset);
      emit('ingest', { assetId: asset.id, deduped: result.deduped });
      res.json({ asset, taskId: result.taskId, deduped: result.deduped });
    } catch (err) {
      return sendApiError(res, 500, 'INGEST_FAILED', err instanceof Error ? err.message : String(err));
    }
  });

  // --- assets --------------------------------------------------------------

  app.get('/api/library/assets', (req, res) => {
    const q = req.query;
    const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length ? v : undefined);
    // Build conditionally — exactOptionalPropertyTypes rejects explicit
    // `undefined` on the optional filter fields.
    const filter: LibraryAssetFilter = {};
    if (str(q.kind)) filter.kind = str(q.kind) as LibraryAssetKind;
    if (str(q.tag)) filter.tag = str(q.tag)!;
    if (str(q.domain)) filter.domain = str(q.domain)!;
    if (str(q.date)) filter.date = str(q.date)!;
    if (str(q.q)) filter.q = str(q.q)!;
    if (str(q.source)) filter.source = str(q.source) as LibrarySourceKind;
    if (str(q.projectId)) filter.projectId = str(q.projectId)!;
    if (str(q.designSystemId)) filter.designSystemId = str(q.designSystemId)!;
    if (q.limit) filter.limit = Number(q.limit);
    const assets = listLibraryAssets(db, filter).map(toPublicAsset);
    res.json({ assets });
  });

  app.get('/api/library/assets/:id', (req, res) => {
    const asset = getLibraryAsset(db, req.params.id);
    if (!asset) return sendApiError(res, 404, 'NOT_FOUND', 'asset not found');
    res.json({ asset: toPublicAsset(asset) });
  });

  app.delete('/api/library/assets/:id', requireLocalDaemonRequest, async (req, res) => {
    const asset = getLibraryAsset(db, req.params.id);
    if (!asset) return sendApiError(res, 404, 'NOT_FOUND', 'asset not found');
    // Only unlink bytes we own and that live under LIBRARY_DIR.
    if (asset.storage === 'owned' && asset.filePath) {
      const abs = path.resolve(asset.filePath);
      if (abs.startsWith(path.resolve(LIBRARY_DIR))) {
        await unlink(abs).catch(() => {});
      }
    }
    deleteLibraryAsset(db, asset.id);
    emit('delete', { assetId: asset.id });
    res.json({ ok: true });
  });

  app.get('/api/library/assets/:id/raw', async (req, res) => {
    const asset = getLibraryAsset(db, req.params.id);
    if (!asset) return sendApiError(res, 404, 'NOT_FOUND', 'asset not found');
    const abs = resolveAssetBytesPath(asset, PROJECTS_DIR);
    if (!abs) return sendApiError(res, 404, 'NOT_FOUND', 'asset bytes not available');
    try {
      const info = await stat(abs);
      if (!info.isFile()) return sendApiError(res, 404, 'NOT_FOUND', 'asset bytes not available');
      res.setHeader('Content-Type', asset.mime ?? 'application/octet-stream');
      res.setHeader('Content-Length', String(info.size));
      res.setHeader('Cache-Control', 'private, max-age=3600');
      createReadStream(abs).pipe(res);
    } catch {
      return sendApiError(res, 404, 'NOT_FOUND', 'asset bytes not available');
    }
  });

  // --- apply to project (web / Insert from Library) ------------------------

  app.post('/api/library/assets/:id/apply', requireLocalDaemonRequest, async (req, res) => {
    const asset = getLibraryAsset(db, req.params.id);
    if (!asset) return sendApiError(res, 404, 'NOT_FOUND', 'asset not found');
    const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId : '';
    if (!projectId) return sendApiError(res, 400, 'BAD_REQUEST', 'projectId is required');
    try {
      const relPath = await applyAssetToProject(asset, projectId, 'manual-upload', req.body?.dir);
      res.json({ relPath });
    } catch (err) {
      return sendApiError(res, 500, 'APPLY_FAILED', err instanceof Error ? err.message : String(err));
    }
  });

  // --- agent tool track (tool-token) ---------------------------------------
  // Lets a chat agent search and apply library assets mid-task. Mirrors the
  // /api/tools/media/* authorizer shape.

  app.post('/api/tools/library/search', async (req, res) => {
    const grant = authorizeToolRequest(req, res, 'library:search');
    if (!grant) return;
    const body = req.body ?? {};
    const filter: LibraryAssetFilter = {};
    if (typeof body.query === 'string' && body.query.trim()) filter.q = body.query.trim();
    if (typeof body.kind === 'string') filter.kind = body.kind as LibraryAssetKind;
    if (typeof body.date === 'string') filter.date = body.date;
    filter.limit = Number.isFinite(body.limit) ? Number(body.limit) : 20;
    const results = listLibraryAssets(db, filter).map((asset) => ({ asset: toPublicAsset(asset), score: 0 }));
    res.json({ results, semantic: false });
  });

  app.post('/api/tools/library/apply', async (req, res) => {
    const grant = authorizeToolRequest(req, res, 'library:apply');
    if (!grant) return;
    const assetId = typeof req.body?.assetId === 'string' ? req.body.assetId : '';
    if (!assetId) return sendApiError(res, 400, 'BAD_REQUEST', 'assetId is required');
    const asset = getLibraryAsset(db, assetId);
    if (!asset) return sendApiError(res, 404, 'NOT_FOUND', 'asset not found');
    const projectId = grant.projectId ?? (typeof req.body?.projectId === 'string' ? req.body.projectId : '');
    if (!projectId) return sendApiError(res, 400, 'BAD_REQUEST', 'projectId is required');
    try {
      const relPath = await applyAssetToProject(asset, projectId, 'agent-task', req.body?.dir);
      res.json({ relPath });
    } catch (err) {
      return sendApiError(res, 500, 'APPLY_FAILED', err instanceof Error ? err.message : String(err));
    }
  });

  // --- live events ---------------------------------------------------------

  app.get('/api/library/events', (req, res) => {
    const sse = createSseResponse(res);
    const listener = (event: string, data: unknown) => sse.send(event, data);
    sseClients.add(listener);
    sse.send('ready', { ok: true });
    req.on('close', () => {
      sseClients.delete(listener);
      sse.cleanup();
    });
  });
}

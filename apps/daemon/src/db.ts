// SQLite-backed persistence for projects, conversations, messages, and the
// per-project set of open file tabs. The on-disk project folder under
// .od/projects/<id>/ is still the single owner of the user's actual files
// (HTML artifacts, sketches, uploads); this database tracks the metadata
// that used to live in localStorage.

import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { migrateCritique } from './critique/persistence.js';
import { migrateMediaTasks } from './media-tasks.js';
import { migratePlugins } from './plugins/persistence.js';

type SqliteDb = Database.Database;
type DbRow = Record<string, any>;
type JsonObject = Record<string, unknown>;

export const DEFAULT_WORKSPACE_ID = 'local-personal';
export const DEFAULT_WORKSPACE_NAME = 'Personal Workspace';
export const DEFAULT_WORKSPACE_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

let dbInstance: SqliteDb | null = null;
let dbFile: string | null = null;

function row(value: unknown): DbRow | null {
  return value && typeof value === 'object' ? value as DbRow : null;
}

function rows(value: unknown[]): DbRow[] {
  return value.map((item) => row(item) ?? {});
}

export function openDatabase(projectRoot: string, { dataDir }: { dataDir?: string } = {}): SqliteDb {
  const dir = dataDir ? path.resolve(dataDir) : path.join(projectRoot, '.od');
  const file = path.join(dir, 'app.sqlite');
  if (dbInstance && dbFile === file) return dbInstance;
  if (dbInstance) closeDatabase();
  fs.mkdirSync(dir, { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  dbInstance = db;
  dbFile = file;
  return db;
}

export function closeDatabase() {
  if (!dbInstance) return;
  dbInstance.close();
  dbInstance = null;
  dbFile = null;
}

function migrate(db: SqliteDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL DEFAULT 'local-personal',
      created_by_user_id TEXT,
      owned_by_user_id TEXT,
      name TEXT NOT NULL,
      skill_id TEXT,
      design_system_id TEXT,
      pending_prompt TEXT,
      metadata_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS local_identity (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspace_memberships (
      workspace_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      joined_at INTEGER NOT NULL,
      PRIMARY KEY(workspace_id, user_id),
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS workspace_invites (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL,
      created_by_user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER,
      revoked_at INTEGER,
      accepted_at INTEGER,
      accepted_by_user_id TEXT,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS workspace_activity (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      actor_user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      metadata_json TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_workspace_activity
      ON workspace_activity(workspace_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS resource_shares (
      id TEXT PRIMARY KEY,
      token TEXT NOT NULL UNIQUE,
      target_type TEXT NOT NULL,
      project_id TEXT NOT NULL,
      artifact_id TEXT,
      role TEXT NOT NULL,
      created_by_user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      revoked_at INTEGER,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      source_project_id TEXT,
      files_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_conv_project
      ON conversations(project_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      agent_id TEXT,
      agent_name TEXT,
      events_json TEXT,
      attachments_json TEXT,
      produced_files_json TEXT,
      feedback_json TEXT,
      pre_turn_file_names_json TEXT,
      started_at INTEGER,
      ended_at INTEGER,
      position INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conv
      ON messages(conversation_id, position);

    CREATE TABLE IF NOT EXISTS preview_comments (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      element_id TEXT NOT NULL,
      selector TEXT NOT NULL,
      label TEXT NOT NULL,
      text TEXT NOT NULL,
      position_json TEXT NOT NULL,
      html_hint TEXT NOT NULL,
      note TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(project_id, conversation_id, file_path, element_id),
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_preview_comments_conversation
      ON preview_comments(project_id, conversation_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS tabs (
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      position INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(project_id, name),
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_tabs_project
      ON tabs(project_id, position);

    CREATE TABLE IF NOT EXISTS deployments (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      url TEXT NOT NULL,
      deployment_id TEXT,
      deployment_count INTEGER NOT NULL DEFAULT 1,
      target TEXT NOT NULL DEFAULT 'preview',
      status TEXT NOT NULL DEFAULT 'ready',
      status_message TEXT,
      reachable_at INTEGER,
      provider_metadata_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(project_id, file_name, provider_id),
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_deployments_project
      ON deployments(project_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS routines (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL DEFAULT 'local-personal',
      created_by_user_id TEXT,
      owned_by_user_id TEXT,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      schedule_kind TEXT NOT NULL,
      schedule_value TEXT NOT NULL,
      schedule_json TEXT,
      project_mode TEXT NOT NULL,
      project_id TEXT,
      skill_id TEXT,
      agent_id TEXT,
      context_json TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS routine_runs (
      id TEXT PRIMARY KEY,
      routine_id TEXT NOT NULL,
      trigger TEXT NOT NULL,
      status TEXT NOT NULL,
      project_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      agent_run_id TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      summary TEXT,
      error TEXT,
      error_code TEXT,
      FOREIGN KEY(routine_id) REFERENCES routines(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_routine_runs_routine
      ON routine_runs(routine_id, started_at DESC);
  `);
  // Forward-compatible column add for databases created before metadata_json.
  // SQLite has no IF NOT EXISTS for ALTER, so we check pragma_table_info.
  const cols = db.prepare(`PRAGMA table_info(projects)`).all() as DbRow[];
  if (!cols.some((c: DbRow) => c.name === 'metadata_json')) {
    db.exec(`ALTER TABLE projects ADD COLUMN metadata_json TEXT`);
  }
  if (!cols.some((c: DbRow) => c.name === 'custom_instructions')) {
    db.exec(`ALTER TABLE projects ADD COLUMN custom_instructions TEXT`);
  }
  if (!cols.some((c: DbRow) => c.name === 'workspace_id')) {
    db.exec(`ALTER TABLE projects ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'local-personal'`);
  }
  if (!cols.some((c: DbRow) => c.name === 'created_by_user_id')) {
    db.exec(`ALTER TABLE projects ADD COLUMN created_by_user_id TEXT`);
  }
  if (!cols.some((c: DbRow) => c.name === 'owned_by_user_id')) {
    db.exec(`ALTER TABLE projects ADD COLUMN owned_by_user_id TEXT`);
  }
  const workspaceInviteCols = db.prepare(`PRAGMA table_info(workspace_invites)`).all() as DbRow[];
  if (!workspaceInviteCols.some((c: DbRow) => c.name === 'expires_at')) {
    db.exec(`ALTER TABLE workspace_invites ADD COLUMN expires_at INTEGER`);
  }
  if (!workspaceInviteCols.some((c: DbRow) => c.name === 'revoked_at')) {
    db.exec(`ALTER TABLE workspace_invites ADD COLUMN revoked_at INTEGER`);
  }
  const routineWorkspaceCols = db.prepare(`PRAGMA table_info(routines)`).all() as DbRow[];
  if (!routineWorkspaceCols.some((c: DbRow) => c.name === 'workspace_id')) {
    db.exec(`ALTER TABLE routines ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'local-personal'`);
  }
  if (!routineWorkspaceCols.some((c: DbRow) => c.name === 'created_by_user_id')) {
    db.exec(`ALTER TABLE routines ADD COLUMN created_by_user_id TEXT`);
  }
  if (!routineWorkspaceCols.some((c: DbRow) => c.name === 'owned_by_user_id')) {
    db.exec(`ALTER TABLE routines ADD COLUMN owned_by_user_id TEXT`);
  }
  const messageCols = db.prepare(`PRAGMA table_info(messages)`).all() as DbRow[];
  if (!messageCols.some((c: DbRow) => c.name === 'agent_id')) {
    db.exec(`ALTER TABLE messages ADD COLUMN agent_id TEXT`);
  }
  if (!messageCols.some((c: DbRow) => c.name === 'agent_name')) {
    db.exec(`ALTER TABLE messages ADD COLUMN agent_name TEXT`);
  }
  if (!messageCols.some((c: DbRow) => c.name === 'run_id')) {
    db.exec(`ALTER TABLE messages ADD COLUMN run_id TEXT`);
  }
  if (!messageCols.some((c: DbRow) => c.name === 'run_status')) {
    db.exec(`ALTER TABLE messages ADD COLUMN run_status TEXT`);
  }
  if (!messageCols.some((c: DbRow) => c.name === 'last_run_event_id')) {
    db.exec(`ALTER TABLE messages ADD COLUMN last_run_event_id TEXT`);
  }
  if (!messageCols.some((c: DbRow) => c.name === 'comment_attachments_json')) {
    db.exec(`ALTER TABLE messages ADD COLUMN comment_attachments_json TEXT`);
  }
  if (!messageCols.some((c: DbRow) => c.name === 'feedback_json')) {
    db.exec(`ALTER TABLE messages ADD COLUMN feedback_json TEXT`);
  }
  if (!messageCols.some((c: DbRow) => c.name === 'pre_turn_file_names_json')) {
    db.exec(`ALTER TABLE messages ADD COLUMN pre_turn_file_names_json TEXT`);
  }
  const routineRunCols = db.prepare(`PRAGMA table_info(routine_runs)`).all() as DbRow[];
  if (!routineRunCols.some((c: DbRow) => c.name === 'error_code')) {
    db.exec(`ALTER TABLE routine_runs ADD COLUMN error_code TEXT`);
  }

  const previewCommentCols = db.prepare(`PRAGMA table_info(preview_comments)`).all() as DbRow[];
  if (!previewCommentCols.some((c: DbRow) => c.name === 'selection_kind')) {
    db.exec(`ALTER TABLE preview_comments ADD COLUMN selection_kind TEXT`);
  }
  if (!previewCommentCols.some((c: DbRow) => c.name === 'member_count')) {
    db.exec(`ALTER TABLE preview_comments ADD COLUMN member_count INTEGER`);
  }
  if (!previewCommentCols.some((c: DbRow) => c.name === 'pod_members_json')) {
    db.exec(`ALTER TABLE preview_comments ADD COLUMN pod_members_json TEXT`);
  }
  const deploymentCols = db.prepare(`PRAGMA table_info(deployments)`).all() as DbRow[];
  if (!deploymentCols.some((c: DbRow) => c.name === 'status')) {
    db.exec(`ALTER TABLE deployments ADD COLUMN status TEXT NOT NULL DEFAULT 'ready'`);
  }
  if (!deploymentCols.some((c: DbRow) => c.name === 'status_message')) {
    db.exec(`ALTER TABLE deployments ADD COLUMN status_message TEXT`);
  }
  if (!deploymentCols.some((c: DbRow) => c.name === 'reachable_at')) {
    db.exec(`ALTER TABLE deployments ADD COLUMN reachable_at INTEGER`);
  }
  if (!deploymentCols.some((c: DbRow) => c.name === 'provider_metadata_json')) {
    db.exec(`ALTER TABLE deployments ADD COLUMN provider_metadata_json TEXT`);
  }
  // schedule_json holds the full RoutineSchedule object (kind discriminator
  // plus kind-specific fields like time/timezone/weekday). The legacy
  // schedule_kind/schedule_value columns are kept populated for query
  // convenience and as a fallback when reading rows written before this
  // column existed.
  const routineCols = db.prepare(`PRAGMA table_info(routines)`).all() as DbRow[];
  if (routineCols.length > 0 && !routineCols.some((c: DbRow) => c.name === 'schedule_json')) {
    db.exec(`ALTER TABLE routines ADD COLUMN schedule_json TEXT`);
  }
  if (routineCols.length > 0 && !routineCols.some((c: DbRow) => c.name === 'context_json')) {
    db.exec(`ALTER TABLE routines ADD COLUMN context_json TEXT`);
  }
  migrateCritique(db);
  migrateMediaTasks(db);
  migratePlugins(db);
  ensureDefaultWorkspace(db);
}

// ---------- deployments ----------

const DEPLOYMENT_COLS = `id, project_id AS projectId, file_name AS fileName,
  provider_id AS providerId, url, deployment_id AS deploymentId,
  deployment_count AS deploymentCount, target, status,
  status_message AS statusMessage, reachable_at AS reachableAt,
  provider_metadata_json AS providerMetadataJson,
  created_at AS createdAt, updated_at AS updatedAt`;

export function listDeployments(db: SqliteDb, projectId: string) {
  return (db
    .prepare(
      `SELECT ${DEPLOYMENT_COLS}
         FROM deployments
        WHERE project_id = ?
        ORDER BY updated_at DESC`,
    )
    .all(projectId) as DbRow[])
    .map(normalizeDeployment);
}

export function getDeployment(db: SqliteDb, projectId: string, fileName: string, providerId: string) {
  const row = db
    .prepare(
      `SELECT ${DEPLOYMENT_COLS}
         FROM deployments
        WHERE project_id = ? AND file_name = ? AND provider_id = ?`,
    )
    .get(projectId, fileName, providerId) as DbRow | undefined;
  return row ? normalizeDeployment(row) : null;
}

export function getDeploymentById(db: SqliteDb, projectId: string, id: string) {
  const row = db
    .prepare(
      `SELECT ${DEPLOYMENT_COLS}
         FROM deployments
        WHERE project_id = ? AND id = ?`,
    )
    .get(projectId, id) as DbRow | undefined;
  return row ? normalizeDeployment(row) : null;
}

export function upsertDeployment(db: SqliteDb, deployment: DbRow) {
  const existing = getDeployment(
    db,
    deployment.projectId,
    deployment.fileName,
    deployment.providerId,
  );
  const now = Date.now();
  const inputProviderMetadata =
    deployment.providerMetadata === undefined
      ? existing?.providerMetadata
      : deployment.providerMetadata;
  const providerMetadata =
    deployment.cloudflarePages && typeof deployment.cloudflarePages === 'object'
      ? {
          ...(inputProviderMetadata && typeof inputProviderMetadata === 'object' && !Array.isArray(inputProviderMetadata)
            ? inputProviderMetadata
            : {}),
          cloudflarePages: deployment.cloudflarePages,
        }
      : inputProviderMetadata;
  const next = {
    id: existing?.id ?? deployment.id,
    projectId: deployment.projectId,
    fileName: deployment.fileName,
    providerId: deployment.providerId,
    url: deployment.url,
    deploymentId: deployment.deploymentId ?? null,
    deploymentCount:
      typeof deployment.deploymentCount === 'number'
        ? deployment.deploymentCount
        : (existing?.deploymentCount ?? 0) + 1,
    target: deployment.target ?? 'preview',
    status: deployment.status ?? existing?.status ?? 'ready',
    statusMessage: deployment.statusMessage ?? null,
    reachableAt: deployment.reachableAt ?? null,
    providerMetadata,
    createdAt: existing?.createdAt ?? deployment.createdAt ?? now,
    updatedAt: deployment.updatedAt ?? now,
  };
  const providerMetadataJson = stringifyJsonObjectOrNull(next.providerMetadata);
  db.prepare(
    `INSERT INTO deployments
       (id, project_id, file_name, provider_id, url, deployment_id,
        deployment_count, target, status, status_message, reachable_at,
        provider_metadata_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, file_name, provider_id) DO UPDATE SET
       url = excluded.url,
       deployment_id = excluded.deployment_id,
       deployment_count = excluded.deployment_count,
       target = excluded.target,
       status = excluded.status,
       status_message = excluded.status_message,
       reachable_at = excluded.reachable_at,
       provider_metadata_json = excluded.provider_metadata_json,
       updated_at = excluded.updated_at`,
  ).run(
    next.id,
    next.projectId,
    next.fileName,
    next.providerId,
    next.url,
    next.deploymentId,
    next.deploymentCount,
    next.target,
    next.status,
    next.statusMessage,
    next.reachableAt,
    providerMetadataJson,
    next.createdAt,
    next.updatedAt,
  );
  return getDeployment(db, next.projectId, next.fileName, next.providerId);
}

function normalizeDeployment(row: DbRow) {
  const providerMetadata = parseJsonOrUndef(row.providerMetadataJson);
  const normalizedProviderMetadata =
    providerMetadata && typeof providerMetadata === 'object' && !Array.isArray(providerMetadata)
      ? providerMetadata
      : undefined;
  return {
    id: row.id,
    projectId: row.projectId,
    fileName: row.fileName,
    providerId: row.providerId,
    url: row.url,
    deploymentId: row.deploymentId ?? undefined,
    deploymentCount: Number(row.deploymentCount ?? 1),
    target: 'preview',
    status: row.status || 'ready',
    statusMessage: row.statusMessage ?? undefined,
    reachableAt: row.reachableAt == null ? undefined : Number(row.reachableAt),
    cloudflarePages:
      normalizedProviderMetadata?.cloudflarePages &&
      typeof normalizedProviderMetadata.cloudflarePages === 'object' &&
      !Array.isArray(normalizedProviderMetadata.cloudflarePages)
        ? normalizedProviderMetadata.cloudflarePages
        : undefined,
    providerMetadata: normalizedProviderMetadata,
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
}

function stringifyJsonObjectOrNull(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return Object.keys(value).length > 0 ? JSON.stringify(value) : null;
}

// ---------- projects ----------

const PROJECT_COLS = `id, name, skill_id AS skillId,
  workspace_id AS workspaceId,
  created_by_user_id AS createdByUserId,
  owned_by_user_id AS ownedByUserId,
  design_system_id AS designSystemId,
  pending_prompt AS pendingPrompt,
  metadata_json AS metadataJson,
  applied_plugin_snapshot_id AS appliedPluginSnapshotId,
  custom_instructions AS customInstructions,
  created_at AS createdAt,
  updated_at AS updatedAt`;

export function listProjects(db: SqliteDb, options: { workspaceId?: string } = {}) {
  const workspaceId = options.workspaceId?.trim();
  const rows = db
    .prepare(
      `SELECT ${PROJECT_COLS}
         FROM projects
        ${workspaceId ? 'WHERE workspace_id = ?' : ''}
        ORDER BY updated_at DESC`,
    )
    .all(...(workspaceId ? [workspaceId] : [])) as DbRow[];
  return rows.map(normalizeProject);
}

export function listLatestProjectRunStatuses(db: SqliteDb) {
  const rows = db
    .prepare(
      `SELECT c.project_id AS projectId,
              m.run_id AS runId,
              m.run_status AS status,
              COALESCE(m.ended_at, m.started_at, m.created_at) AS updatedAt
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
        WHERE m.run_status IS NOT NULL
        ORDER BY updatedAt DESC`,
    )
    .all() as DbRow[];
  const latestByProject = new Map<string, DbRow>();
  for (const row of rows) {
    if (!latestByProject.has(row.projectId)) {
      latestByProject.set(row.projectId, {
        value: normalizeProjectRunStatus(row.status),
        updatedAt: Number(row.updatedAt),
        runId: row.runId ?? undefined,
      });
    }
  }
  return latestByProject;
}

export function listProjectsAwaitingInput(db: SqliteDb) {
  const rows = db
    .prepare(
      `SELECT latest.projectId
         FROM (
           SELECT c.project_id AS projectId,
                  m.conversation_id AS conversationId,
                  m.created_at AS createdAt,
                  m.position AS position,
                  ROW_NUMBER() OVER (
                    PARTITION BY c.project_id
                    ORDER BY m.created_at DESC, m.position DESC
                  ) AS rowNum
             FROM messages m
             JOIN conversations c ON c.id = m.conversation_id
            WHERE m.role = 'assistant'
              AND LOWER(m.content) LIKE '%<question-form%'
         ) latest
        WHERE latest.rowNum = 1
          AND NOT EXISTS (
            SELECT 1
              FROM messages reply
             WHERE reply.conversation_id = latest.conversationId
               AND reply.role = 'user'
               AND (
                 reply.created_at > latest.createdAt
                 OR (reply.created_at = latest.createdAt AND reply.position > latest.position)
               )
          )`,
    )
    .all() as DbRow[];
  return new Set((rows as DbRow[]).map((row: DbRow) => row.projectId));
}

export function getProject(db: SqliteDb, id: string) {
  const row = db
    .prepare(`SELECT ${PROJECT_COLS} FROM projects WHERE id = ?`)
    .get(id) as DbRow | undefined;
  return row ? normalizeProject(row) : null;
}

export function insertProject(db: SqliteDb, p: DbRow) {
  db.prepare(
    `INSERT INTO projects
       (id, workspace_id, created_by_user_id, owned_by_user_id, name, skill_id, design_system_id, pending_prompt,
        metadata_json, custom_instructions, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    p.id,
    p.workspaceId ?? DEFAULT_WORKSPACE_ID,
    p.createdByUserId ?? null,
    p.ownedByUserId ?? p.createdByUserId ?? null,
    p.name,
    p.skillId ?? null,
    p.designSystemId ?? null,
    p.pendingPrompt ?? null,
    p.metadata ? JSON.stringify(p.metadata) : null,
    p.customInstructions ?? null,
    p.createdAt,
    p.updatedAt,
  );
  return getProject(db, p.id);
}

export function updateProject(db: SqliteDb, id: string, patch: DbRow) {
  const existing = getProject(db, id);
  if (!existing) return null;
  const merged = {
    ...existing,
    ...patch,
    updatedAt: typeof patch.updatedAt === 'number' ? patch.updatedAt : Date.now(),
  };
  db.prepare(
    `UPDATE projects
        SET name = ?,
            workspace_id = ?,
            owned_by_user_id = ?,
            skill_id = ?,
            design_system_id = ?,
            pending_prompt = ?,
            metadata_json = ?,
            custom_instructions = ?,
            updated_at = ?
      WHERE id = ?`,
  ).run(
    merged.name,
    merged.workspaceId ?? DEFAULT_WORKSPACE_ID,
    merged.ownedByUserId ?? null,
    merged.skillId ?? null,
    merged.designSystemId ?? null,
    merged.pendingPrompt ?? null,
    merged.metadata ? JSON.stringify(merged.metadata) : null,
    merged.customInstructions ?? null,
    merged.updatedAt,
    id,
  );
  return getProject(db, id);
}

export function deleteProject(db: SqliteDb, id: string) {
  db.prepare(`DELETE FROM resource_shares WHERE project_id = ?`).run(id);
  db.prepare(`DELETE FROM projects WHERE id = ?`).run(id);
}

function normalizeProject(row: DbRow) {
  let metadata;
  if (row.metadataJson) {
    try {
      metadata = JSON.parse(row.metadataJson);
    } catch {
      metadata = undefined;
    }
  }
  return {
    id: row.id,
    workspaceId: row.workspaceId ?? DEFAULT_WORKSPACE_ID,
    createdByUserId: row.createdByUserId ?? undefined,
    ownedByUserId: row.ownedByUserId ?? row.createdByUserId ?? undefined,
    name: row.name,
    skillId: row.skillId,
    designSystemId: row.designSystemId,
    pendingPrompt: row.pendingPrompt ?? undefined,
    metadata,
    appliedPluginSnapshotId: row.appliedPluginSnapshotId ?? undefined,
    customInstructions: row.customInstructions ?? undefined,
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
}

function normalizeProjectRunStatus(status: unknown) {
  if (status === 'starting') return 'running';
  if (status === 'cancelled') return 'canceled';
  if (
    status === 'queued' ||
    status === 'running' ||
    status === 'succeeded' ||
    status === 'failed' ||
    status === 'canceled'
  ) {
    return status;
  }
  return 'not_started';
}

// ---------- workspaces ----------

function normalizeWorkspaceRole(value: unknown) {
  return value === 'owner' || value === 'admin' ? value : 'member';
}

function normalizeWorkspace(row: DbRow) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind === 'team' ? 'team' : 'local',
    ...(row.currentUserRole ? { currentUserRole: normalizeWorkspaceRole(row.currentUserRole) } : {}),
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
}

function normalizeWorkspaceMembership(row: DbRow) {
  return {
    workspaceId: row.workspaceId,
    userId: row.userId,
    role: normalizeWorkspaceRole(row.role),
    joinedAt: Number(row.joinedAt),
  };
}

function normalizeWorkspaceInvite(row: DbRow) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    token: row.token,
    role: row.role === 'admin' ? 'admin' : 'member',
    createdByUserId: row.createdByUserId,
    createdAt: Number(row.createdAt),
    expiresAt: row.expiresAt == null ? undefined : Number(row.expiresAt),
    revokedAt: row.revokedAt == null ? undefined : Number(row.revokedAt),
    acceptedAt: row.acceptedAt == null ? undefined : Number(row.acceptedAt),
    acceptedByUserId: row.acceptedByUserId ?? undefined,
  };
}

function normalizeWorkspaceActivity(row: DbRow) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    actorUserId: row.actorUserId,
    action: row.action,
    targetType: row.targetType ?? undefined,
    targetId: row.targetId ?? undefined,
    metadata: parseJsonOrUndef(row.metadataJson) ?? {},
    createdAt: Number(row.createdAt),
  };
}

function normalizeResourceShare(row: DbRow) {
  return {
    id: row.id,
    token: row.token,
    targetType: row.targetType,
    projectId: row.projectId,
    projectName: row.projectName ?? undefined,
    artifactId: row.artifactId ?? undefined,
    role: 'viewer',
    createdByUserId: row.createdByUserId,
    createdAt: Number(row.createdAt),
    revokedAt: row.revokedAt == null ? undefined : Number(row.revokedAt),
  };
}

export function getLocalUserId(db: SqliteDb) {
  const existing = db.prepare(`SELECT value FROM local_identity WHERE key = 'localUserId'`).get() as DbRow | undefined;
  if (typeof existing?.value === 'string' && existing.value) return existing.value;
  const userId = `anon_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  db.prepare(`INSERT OR REPLACE INTO local_identity (key, value) VALUES ('localUserId', ?)`).run(userId);
  return userId;
}

export function getCurrentWorkspaceId(db: SqliteDb, userId: string) {
  const key = `currentWorkspaceId:${userId}`;
  const existing = db.prepare(`SELECT value FROM local_identity WHERE key = ?`).get(key) as DbRow | undefined;
  if (typeof existing?.value === 'string' && existing.value) return existing.value;
  return DEFAULT_WORKSPACE_ID;
}

export function setCurrentWorkspaceId(db: SqliteDb, userId: string, workspaceId: string) {
  const key = `currentWorkspaceId:${userId}`;
  db.prepare(`INSERT OR REPLACE INTO local_identity (key, value) VALUES (?, ?)`).run(key, workspaceId);
  return workspaceId;
}

export function clearCurrentWorkspaceIfMatches(db: SqliteDb, input: { userId: string; workspaceId: string }) {
  const key = `currentWorkspaceId:${input.userId}`;
  const result = db.prepare(`DELETE FROM local_identity WHERE key = ? AND value = ?`).run(key, input.workspaceId);
  return result.changes > 0;
}

export function clearCurrentWorkspaceForWorkspace(db: SqliteDb, workspaceId: string) {
  const result = db.prepare(
    `DELETE FROM local_identity
      WHERE key LIKE 'currentWorkspaceId:%'
        AND value = ?`,
  ).run(workspaceId);
  return Number(result.changes ?? 0);
}

export function ensureDefaultWorkspace(db: SqliteDb) {
  const now = Date.now();
  db.prepare(
    `INSERT OR IGNORE INTO workspaces (id, name, kind, created_at, updated_at)
     VALUES (?, ?, 'local', ?, ?)`,
  ).run(DEFAULT_WORKSPACE_ID, DEFAULT_WORKSPACE_NAME, now, now);
  const userId = getLocalUserId(db);
  db.prepare(
    `INSERT OR IGNORE INTO workspace_memberships (workspace_id, user_id, role, joined_at)
     VALUES (?, ?, 'owner', ?)`,
  ).run(DEFAULT_WORKSPACE_ID, userId, now);
}

export function listWorkspaces(db: SqliteDb, options: { userId?: string } = {}) {
  ensureDefaultWorkspace(db);
  const userId = options.userId?.trim();
  if (userId) {
    return (db.prepare(
      `SELECT w.id, w.name, w.kind, w.created_at AS createdAt, w.updated_at AS updatedAt
              , m.role AS currentUserRole
         FROM workspaces w
         JOIN workspace_memberships m ON m.workspace_id = w.id
        WHERE m.user_id = ?
        ORDER BY CASE WHEN w.id = ? THEN 0 ELSE 1 END, w.updated_at DESC`,
    ).all(userId, DEFAULT_WORKSPACE_ID) as DbRow[]).map(normalizeWorkspace);
  }
  return (db.prepare(
    `SELECT id, name, kind, created_at AS createdAt, updated_at AS updatedAt
       FROM workspaces
      ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, updated_at DESC`,
  ).all(DEFAULT_WORKSPACE_ID) as DbRow[]).map(normalizeWorkspace);
}

export function getWorkspace(db: SqliteDb, id: string) {
  const row = db.prepare(
    `SELECT id, name, kind, created_at AS createdAt, updated_at AS updatedAt
       FROM workspaces WHERE id = ?`,
  ).get(id) as DbRow | undefined;
  return row ? normalizeWorkspace(row) : null;
}

export function insertWorkspace(db: SqliteDb, input: { name: string; userId: string }) {
  const now = Date.now();
  const id = `ws_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  db.prepare(
    `INSERT INTO workspaces (id, name, kind, created_at, updated_at)
     VALUES (?, ?, 'team', ?, ?)`,
  ).run(id, input.name, now, now);
  db.prepare(
    `INSERT INTO workspace_memberships (workspace_id, user_id, role, joined_at)
     VALUES (?, ?, 'owner', ?)`,
  ).run(id, input.userId, now);
  return getWorkspace(db, id);
}

export function updateWorkspace(db: SqliteDb, input: { id: string; name: string }) {
  const now = Date.now();
  db.prepare(
    `UPDATE workspaces
        SET name = ?, updated_at = ?
      WHERE id = ?`,
  ).run(input.name, now, input.id);
  return getWorkspace(db, input.id);
}

export function insertWorkspaceActivity(db: SqliteDb, input: {
  workspaceId: string;
  actorUserId: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: JsonObject;
}) {
  const activity = {
    id: `act_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
    createdAt: Date.now(),
  };
  db.prepare(
    `INSERT INTO workspace_activity
       (id, workspace_id, actor_user_id, action, target_type, target_id, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    activity.id,
    input.workspaceId,
    input.actorUserId,
    input.action,
    input.targetType ?? null,
    input.targetId ?? null,
    JSON.stringify(input.metadata ?? {}),
    activity.createdAt,
  );
  return activity;
}

export function listWorkspaceActivity(db: SqliteDb, workspaceId: string, limit = 50) {
  return (db.prepare(
    `SELECT id, workspace_id AS workspaceId, actor_user_id AS actorUserId,
            action, target_type AS targetType, target_id AS targetId,
            metadata_json AS metadataJson, created_at AS createdAt
       FROM workspace_activity
      WHERE workspace_id = ?
      ORDER BY created_at DESC
      LIMIT ?`,
  ).all(workspaceId, Math.max(1, Math.min(100, limit))) as DbRow[]).map(normalizeWorkspaceActivity);
}

export function countWorkspaceProjects(db: SqliteDb, workspaceId: string) {
  const row = db.prepare(
    `SELECT COUNT(*) AS count FROM projects WHERE workspace_id = ?`,
  ).get(workspaceId) as DbRow | undefined;
  return Number(row?.count ?? 0);
}

export function countWorkspaceProjectsByCreator(db: SqliteDb, input: { workspaceId: string; userId: string }) {
  const row = db.prepare(
    `SELECT COUNT(*) AS count
       FROM projects
      WHERE workspace_id = ?
        AND created_by_user_id = ?`,
  ).get(input.workspaceId, input.userId) as DbRow | undefined;
  return Number(row?.count ?? 0);
}

export function countWorkspaceProjectsByOwner(db: SqliteDb, input: { workspaceId: string; userId: string }) {
  const row = db.prepare(
    `SELECT COUNT(*) AS count
       FROM projects
      WHERE workspace_id = ?
        AND COALESCE(owned_by_user_id, created_by_user_id) = ?`,
  ).get(input.workspaceId, input.userId) as DbRow | undefined;
  return Number(row?.count ?? 0);
}

export function transferWorkspaceProjectsByOwner(db: SqliteDb, input: { workspaceId: string; fromUserId: string; toUserId: string }) {
  const result = db.prepare(
    `UPDATE projects
        SET owned_by_user_id = ?,
            updated_at = ?
      WHERE workspace_id = ?
        AND COALESCE(owned_by_user_id, created_by_user_id) = ?`,
  ).run(input.toUserId, Date.now(), input.workspaceId, input.fromUserId);
  return Number(result.changes ?? 0);
}

export function countWorkspaceRoutines(db: SqliteDb, workspaceId: string) {
  const row = db.prepare(
    `SELECT COUNT(*) AS count FROM routines WHERE workspace_id = ?`,
  ).get(workspaceId) as DbRow | undefined;
  return Number(row?.count ?? 0);
}

export function countWorkspaceRoutinesByCreator(db: SqliteDb, input: { workspaceId: string; userId: string }) {
  const row = db.prepare(
    `SELECT COUNT(*) AS count
       FROM routines
      WHERE workspace_id = ?
        AND created_by_user_id = ?`,
  ).get(input.workspaceId, input.userId) as DbRow | undefined;
  return Number(row?.count ?? 0);
}

export function countWorkspaceRoutinesByOwner(db: SqliteDb, input: { workspaceId: string; userId: string }) {
  const row = db.prepare(
    `SELECT COUNT(*) AS count
       FROM routines
      WHERE workspace_id = ?
        AND COALESCE(owned_by_user_id, created_by_user_id) = ?`,
  ).get(input.workspaceId, input.userId) as DbRow | undefined;
  return Number(row?.count ?? 0);
}

export function transferWorkspaceRoutinesByOwner(db: SqliteDb, input: { workspaceId: string; fromUserId: string; toUserId: string }) {
  const result = db.prepare(
    `UPDATE routines
        SET owned_by_user_id = ?,
            updated_at = ?
      WHERE workspace_id = ?
        AND COALESCE(owned_by_user_id, created_by_user_id) = ?`,
  ).run(input.toUserId, Date.now(), input.workspaceId, input.fromUserId);
  return Number(result.changes ?? 0);
}

export function deleteWorkspace(db: SqliteDb, workspaceId: string) {
  if (workspaceId === DEFAULT_WORKSPACE_ID) return false;
  const result = db.prepare(`DELETE FROM workspaces WHERE id = ?`).run(workspaceId);
  return result.changes > 0;
}

export function listWorkspaceMembers(db: SqliteDb, workspaceId: string) {
  return (db.prepare(
    `SELECT workspace_id AS workspaceId, user_id AS userId, role, joined_at AS joinedAt
       FROM workspace_memberships WHERE workspace_id = ? ORDER BY joined_at ASC`,
  ).all(workspaceId) as DbRow[]).map(normalizeWorkspaceMembership);
}

export function getWorkspaceMembership(db: SqliteDb, workspaceId: string, userId: string) {
  const row = db.prepare(
    `SELECT workspace_id AS workspaceId, user_id AS userId, role, joined_at AS joinedAt
       FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?`,
  ).get(workspaceId, userId) as DbRow | undefined;
  return row ? normalizeWorkspaceMembership(row) : null;
}

export function updateWorkspaceMemberRole(db: SqliteDb, input: { workspaceId: string; userId: string; role: 'admin' | 'member' }) {
  db.prepare(
    `UPDATE workspace_memberships
        SET role = ?
      WHERE workspace_id = ? AND user_id = ? AND role != 'owner'`,
  ).run(input.role, input.workspaceId, input.userId);
  return getWorkspaceMembership(db, input.workspaceId, input.userId);
}

export function transferWorkspaceOwner(db: SqliteDb, input: { workspaceId: string; fromUserId: string; toUserId: string }) {
  const currentOwner = getWorkspaceMembership(db, input.workspaceId, input.fromUserId);
  const nextOwner = getWorkspaceMembership(db, input.workspaceId, input.toUserId);
  if (currentOwner?.role !== 'owner' || !nextOwner || nextOwner.role === 'owner') return null;
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE workspace_memberships
          SET role = 'admin'
        WHERE workspace_id = ? AND user_id = ?`,
    ).run(input.workspaceId, input.fromUserId);
    db.prepare(
      `UPDATE workspace_memberships
          SET role = 'owner'
        WHERE workspace_id = ? AND user_id = ?`,
    ).run(input.workspaceId, input.toUserId);
  });
  tx();
  return {
    previousOwner: getWorkspaceMembership(db, input.workspaceId, input.fromUserId),
    owner: getWorkspaceMembership(db, input.workspaceId, input.toUserId),
  };
}

export function deleteWorkspaceMember(db: SqliteDb, input: { workspaceId: string; userId: string }) {
  const existing = getWorkspaceMembership(db, input.workspaceId, input.userId);
  if (!existing || existing.role === 'owner') return false;
  const result = db.prepare(
    `DELETE FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?`,
  ).run(input.workspaceId, input.userId);
  return result.changes > 0;
}

export function insertWorkspaceInvite(db: SqliteDb, input: {
  workspaceId: string;
  userId: string;
  role: 'admin' | 'member';
  expiresAt?: number;
}) {
  const now = Date.now();
  const expiresAt = input.expiresAt ?? now + DEFAULT_WORKSPACE_INVITE_TTL_MS;
  const invite = {
    id: `inv_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
    token: randomUUID().replace(/-/g, ''),
  };
  db.prepare(
    `INSERT INTO workspace_invites
       (id, workspace_id, token, role, created_by_user_id, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(invite.id, input.workspaceId, invite.token, input.role, input.userId, now, expiresAt);
  return getWorkspaceInviteByToken(db, invite.token);
}

export function listWorkspaceInvites(db: SqliteDb, workspaceId: string) {
  return (db.prepare(
    `SELECT id, workspace_id AS workspaceId, token, role,
            created_by_user_id AS createdByUserId, created_at AS createdAt,
            expires_at AS expiresAt, revoked_at AS revokedAt,
            accepted_at AS acceptedAt, accepted_by_user_id AS acceptedByUserId
       FROM workspace_invites
      WHERE workspace_id = ?
      ORDER BY created_at DESC`,
  ).all(workspaceId) as DbRow[]).map(normalizeWorkspaceInvite);
}

export function getWorkspaceInviteByToken(db: SqliteDb, token: string) {
  const row = db.prepare(
    `SELECT id, workspace_id AS workspaceId, token, role,
            created_by_user_id AS createdByUserId, created_at AS createdAt,
            expires_at AS expiresAt, revoked_at AS revokedAt,
            accepted_at AS acceptedAt, accepted_by_user_id AS acceptedByUserId
       FROM workspace_invites WHERE token = ?`,
  ).get(token) as DbRow | undefined;
  return row ? normalizeWorkspaceInvite(row) : null;
}

export function getWorkspaceInviteById(db: SqliteDb, input: { workspaceId: string; inviteId: string }) {
  const row = db.prepare(
    `SELECT id, workspace_id AS workspaceId, token, role,
            created_by_user_id AS createdByUserId, created_at AS createdAt,
            expires_at AS expiresAt, revoked_at AS revokedAt,
            accepted_at AS acceptedAt, accepted_by_user_id AS acceptedByUserId
       FROM workspace_invites WHERE workspace_id = ? AND id = ?`,
  ).get(input.workspaceId, input.inviteId) as DbRow | undefined;
  return row ? normalizeWorkspaceInvite(row) : null;
}

export function deleteWorkspaceInvite(db: SqliteDb, input: { workspaceId: string; inviteId: string }) {
  const now = Date.now();
  const result = db.prepare(
    `UPDATE workspace_invites
        SET revoked_at = COALESCE(revoked_at, ?)
      WHERE workspace_id = ?
        AND id = ?
        AND revoked_at IS NULL
        AND accepted_at IS NULL
        AND (expires_at IS NULL OR expires_at > ?)`,
  ).run(now, input.workspaceId, input.inviteId, now);
  return result.changes > 0;
}

export function revokePendingWorkspaceInvitesByCreator(db: SqliteDb, input: { workspaceId: string; userId: string }) {
  const now = Date.now();
  const rows = db.prepare(
    `SELECT id, workspace_id AS workspaceId, token, role,
            created_by_user_id AS createdByUserId, created_at AS createdAt,
            expires_at AS expiresAt, revoked_at AS revokedAt,
            accepted_at AS acceptedAt, accepted_by_user_id AS acceptedByUserId
       FROM workspace_invites
      WHERE workspace_id = ?
        AND created_by_user_id = ?
        AND revoked_at IS NULL
        AND accepted_at IS NULL
        AND (expires_at IS NULL OR expires_at > ?)`,
  ).all(input.workspaceId, input.userId, now) as DbRow[];
  if (rows.length === 0) return [];
  db.prepare(
    `UPDATE workspace_invites
        SET revoked_at = COALESCE(revoked_at, ?)
      WHERE workspace_id = ?
        AND created_by_user_id = ?
        AND revoked_at IS NULL
        AND accepted_at IS NULL
        AND (expires_at IS NULL OR expires_at > ?)`,
  ).run(now, input.workspaceId, input.userId, now);
  return rows.map((row) => normalizeWorkspaceInvite({ ...row, revokedAt: now }));
}

export function acceptWorkspaceInvite(db: SqliteDb, token: string, userId: string) {
  const invite = getWorkspaceInviteByToken(db, token);
  if (!invite) return null;
  const now = Date.now();
  if (invite.revokedAt != null || (invite.expiresAt != null && invite.expiresAt <= now)) return null;
  if (invite.acceptedAt != null) return null;
  const existingMembership = getWorkspaceMembership(db, invite.workspaceId, userId);
  if (existingMembership) {
    return {
      workspace: getWorkspace(db, invite.workspaceId),
      membership: existingMembership,
      acceptedInvite: false,
    };
  }
  db.prepare(
    `INSERT OR IGNORE INTO workspace_memberships (workspace_id, user_id, role, joined_at)
     VALUES (?, ?, ?, ?)`,
  ).run(invite.workspaceId, userId, invite.role, now);
  db.prepare(
    `UPDATE workspace_invites
        SET accepted_at = COALESCE(accepted_at, ?),
            accepted_by_user_id = COALESCE(accepted_by_user_id, ?)
      WHERE token = ?`,
  ).run(now, userId, token);
  return {
    workspace: getWorkspace(db, invite.workspaceId),
    membership: getWorkspaceMembership(db, invite.workspaceId, userId),
    acceptedInvite: true,
  };
}

export function insertLiveArtifactShare(db: SqliteDb, input: { projectId: string; artifactId: string; userId: string }) {
  const existing = db.prepare(
    `SELECT s.id, s.token, s.target_type AS targetType, s.project_id AS projectId,
            p.name AS projectName,
            s.artifact_id AS artifactId, s.role, s.created_by_user_id AS createdByUserId,
            s.created_at AS createdAt, s.revoked_at AS revokedAt
       FROM resource_shares s
       JOIN projects p ON p.id = s.project_id
      WHERE s.project_id = ?
        AND s.artifact_id = ?
        AND s.target_type = 'live_artifact'
        AND s.role = 'viewer'
        AND s.revoked_at IS NULL
      ORDER BY s.created_at DESC
      LIMIT 1`,
  ).get(input.projectId, input.artifactId) as DbRow | undefined;
  if (existing) return { ...normalizeResourceShare(existing), reused: true };
  const now = Date.now();
  const id = `share_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const token = randomUUID().replace(/-/g, '');
  db.prepare(
    `INSERT INTO resource_shares
       (id, token, target_type, project_id, artifact_id, role, created_by_user_id, created_at)
     VALUES (?, ?, 'live_artifact', ?, ?, 'viewer', ?, ?)`,
  ).run(id, token, input.projectId, input.artifactId, input.userId, now);
  return getResourceShareByToken(db, token);
}

export function getResourceShareByToken(db: SqliteDb, token: string) {
  const row = db.prepare(
    `SELECT s.id, s.token, s.target_type AS targetType, s.project_id AS projectId,
            p.name AS projectName,
            s.artifact_id AS artifactId, s.role, s.created_by_user_id AS createdByUserId,
            s.created_at AS createdAt, s.revoked_at AS revokedAt
       FROM resource_shares s
       JOIN projects p ON p.id = s.project_id
      WHERE s.token = ? AND s.revoked_at IS NULL`,
  ).get(token) as DbRow | undefined;
  return row ? normalizeResourceShare(row) : null;
}

export function listWorkspaceResourceShares(db: SqliteDb, workspaceId: string) {
  return (db.prepare(
    `SELECT s.id, s.token, s.target_type AS targetType, s.project_id AS projectId,
            p.name AS projectName,
            s.artifact_id AS artifactId, s.role, s.created_by_user_id AS createdByUserId,
            s.created_at AS createdAt, s.revoked_at AS revokedAt
       FROM resource_shares s
       JOIN projects p ON p.id = s.project_id
      WHERE p.workspace_id = ?
        AND s.revoked_at IS NULL
      ORDER BY s.created_at DESC`,
  ).all(workspaceId) as DbRow[]).map(normalizeResourceShare);
}

export function revokeResourceShare(db: SqliteDb, input: { workspaceId: string; shareId: string }) {
  const now = Date.now();
  const row = db.prepare(
    `SELECT s.id, s.token, s.target_type AS targetType, s.project_id AS projectId,
            p.name AS projectName,
            s.artifact_id AS artifactId, s.role, s.created_by_user_id AS createdByUserId,
            s.created_at AS createdAt, s.revoked_at AS revokedAt
       FROM resource_shares s
       JOIN projects p ON p.id = s.project_id
      WHERE s.id = ?
        AND p.workspace_id = ?
        AND s.revoked_at IS NULL`,
  ).get(input.shareId, input.workspaceId) as DbRow | undefined;
  if (!row) return null;
  const result = db.prepare(
    `UPDATE resource_shares
        SET revoked_at = COALESCE(revoked_at, ?)
      WHERE id = ?
        AND project_id IN (
          SELECT id FROM projects WHERE workspace_id = ?
        )
        AND revoked_at IS NULL`,
  ).run(now, input.shareId, input.workspaceId);
  return result.changes > 0
    ? normalizeResourceShare({ ...row, revokedAt: now })
    : null;
}

export function revokeResourceSharesByCreator(db: SqliteDb, input: { workspaceId: string; userId: string }) {
  const now = Date.now();
  const rows = db.prepare(
    `SELECT s.id, s.token, s.target_type AS targetType, s.project_id AS projectId,
            p.name AS projectName,
            s.artifact_id AS artifactId, s.role, s.created_by_user_id AS createdByUserId,
            s.created_at AS createdAt, s.revoked_at AS revokedAt
       FROM resource_shares s
       JOIN projects p ON p.id = s.project_id
      WHERE p.workspace_id = ?
        AND s.created_by_user_id = ?
        AND s.revoked_at IS NULL`,
  ).all(input.workspaceId, input.userId) as DbRow[];
  if (rows.length === 0) return [];
  db.prepare(
    `UPDATE resource_shares
        SET revoked_at = COALESCE(revoked_at, ?)
      WHERE created_by_user_id = ?
        AND revoked_at IS NULL
        AND project_id IN (
          SELECT id FROM projects WHERE workspace_id = ?
        )`,
  ).run(now, input.userId, input.workspaceId);
  return rows.map((row) => normalizeResourceShare({ ...row, revokedAt: now }));
}

export function revokeLiveArtifactShares(db: SqliteDb, input: { projectId: string; artifactId: string }) {
  const now = Date.now();
  const rows = db.prepare(
    `SELECT s.id, s.token, s.target_type AS targetType, s.project_id AS projectId,
            p.name AS projectName,
            s.artifact_id AS artifactId, s.role, s.created_by_user_id AS createdByUserId,
            s.created_at AS createdAt, s.revoked_at AS revokedAt
       FROM resource_shares s
       JOIN projects p ON p.id = s.project_id
      WHERE s.project_id = ?
        AND s.artifact_id = ?
        AND s.target_type = 'live_artifact'
        AND s.revoked_at IS NULL`,
  ).all(input.projectId, input.artifactId) as DbRow[];
  if (rows.length === 0) return [];
  db.prepare(
    `UPDATE resource_shares
        SET revoked_at = COALESCE(revoked_at, ?)
      WHERE project_id = ?
        AND artifact_id = ?
        AND target_type = 'live_artifact'
        AND revoked_at IS NULL`,
  ).run(now, input.projectId, input.artifactId);
  return rows.map((row) => normalizeResourceShare({ ...row, revokedAt: now }));
}

// ---------- templates ----------

export function listTemplates(db: SqliteDb) {
  return (db
    .prepare(
      `SELECT id, name, description, source_project_id AS sourceProjectId,
              files_json AS filesJson, created_at AS createdAt
         FROM templates
        ORDER BY created_at DESC`,
    )
    .all() as DbRow[])
    .map(normalizeTemplate);
}

export function getTemplate(db: SqliteDb, id: string) {
  const row = db
    .prepare(
      `SELECT id, name, description, source_project_id AS sourceProjectId,
              files_json AS filesJson, created_at AS createdAt
         FROM templates WHERE id = ?`,
    )
    .get(id) as DbRow | undefined;
  return row ? normalizeTemplate(row) : null;
}

export function findTemplateByNameAndProject(
  db: SqliteDb,
  name: string,
  sourceProjectId: string,
) {
  const row = db
    .prepare(
      `SELECT id, name, description, source_project_id AS sourceProjectId,
              files_json AS filesJson, created_at AS createdAt
         FROM templates
        WHERE name = ? AND source_project_id = ?`,
    )
    .get(name, sourceProjectId) as DbRow | undefined;
  return row ? normalizeTemplate(row) : null;
}

export function insertTemplate(db: SqliteDb, t: DbRow) {
  db.prepare(
    `INSERT INTO templates (id, name, description, source_project_id, files_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    t.id,
    t.name,
    t.description ?? null,
    t.sourceProjectId ?? null,
    JSON.stringify(t.files ?? []),
    t.createdAt,
  );
  return getTemplate(db, t.id);
}

export function updateTemplate(
  db: SqliteDb,
  id: string,
  t: { description: string | null; files: unknown[] },
) {
  db.prepare(
    `UPDATE templates SET description = ?, files_json = ? WHERE id = ?`,
  ).run(t.description, JSON.stringify(t.files), id);
  return getTemplate(db, id);
}

export function deleteTemplate(db: SqliteDb, id: string) {
  db.prepare(`DELETE FROM templates WHERE id = ?`).run(id);
}

function normalizeTemplate(row: DbRow) {
  let files = [];
  try {
    files = JSON.parse(row.filesJson || '[]');
  } catch {
    files = [];
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    sourceProjectId: row.sourceProjectId ?? undefined,
    files,
    createdAt: Number(row.createdAt),
  };
}

// ---------- conversations ----------

export function listConversations(db: SqliteDb, projectId: string) {
  return rows(db
    .prepare(
      `WITH project_conversations AS (
          SELECT id, project_id AS projectId, title,
                 created_at AS createdAt, updated_at AS updatedAt
            FROM conversations
           WHERE project_id = ?
        ),
        latest_runs AS (
          SELECT conversation_id AS conversationId,
                 run_status AS latestRunStatus,
                 started_at AS latestRunStartedAt,
                 ended_at AS latestRunEndedAt,
                 events_json AS latestRunEventsJson
            FROM (
              SELECT m.conversation_id,
                     m.run_status,
                     m.started_at,
                     m.ended_at,
                     m.events_json,
                     ROW_NUMBER() OVER (
                       PARTITION BY m.conversation_id
                       ORDER BY m.position DESC
                     ) AS rn
                FROM messages m
                JOIN project_conversations c ON c.id = m.conversation_id
               WHERE m.role = 'assistant'
                 AND m.run_status IS NOT NULL
            )
           WHERE rn = 1
        )
        SELECT c.id, c.projectId, c.title, c.createdAt, c.updatedAt,
               lr.latestRunStatus, lr.latestRunStartedAt,
               lr.latestRunEndedAt, lr.latestRunEventsJson
          FROM project_conversations c
          LEFT JOIN latest_runs lr ON lr.conversationId = c.id
         ORDER BY c.updatedAt DESC`,
    )
    .all(projectId)).map(normalizeConversation);
}

export function getConversation(db: SqliteDb, id: string) {
  const r = db
    .prepare(
      `SELECT id, project_id AS projectId, title,
              created_at AS createdAt, updated_at AS updatedAt
         FROM conversations WHERE id = ?`,
    )
    .get(id) as DbRow | undefined;
  if (!r) return null;
  return {
    ...normalizeConversation(r),
    latestRun: latestConversationRunSummary(db, r.id) ?? undefined,
  };
}

function normalizeConversation(r: DbRow) {
  const latestRun = conversationRunSummaryFromRow({
    runStatus: r.latestRunStatus,
    startedAt: r.latestRunStartedAt,
    endedAt: r.latestRunEndedAt,
    eventsJson: r.latestRunEventsJson,
  });
  return {
    id: r.id,
    projectId: r.projectId,
    title: r.title ?? null,
    createdAt: Number(r.createdAt),
    updatedAt: Number(r.updatedAt),
    latestRun: latestRun ?? undefined,
  };
}

function latestConversationRunSummary(db: SqliteDb, conversationId: string) {
  const row = db
    .prepare(
      `SELECT run_status AS runStatus,
              started_at AS startedAt,
              ended_at AS endedAt,
              events_json AS eventsJson
         FROM messages
        WHERE conversation_id = ?
          AND role = 'assistant'
          AND run_status IS NOT NULL
        ORDER BY position DESC
        LIMIT 1`,
    )
    .get(conversationId) as DbRow | undefined;
  return conversationRunSummaryFromRow(row);
}

function conversationRunSummaryFromRow(row: DbRow | undefined) {
  if (!row || typeof row.runStatus !== 'string') return null;
  const startedAt = row.startedAt == null ? undefined : Number(row.startedAt);
  const endedAt = row.endedAt == null ? undefined : Number(row.endedAt);
  const usageDurationMs = latestUsageDurationMs(row.eventsJson);
  const durationMs =
    Number.isFinite(startedAt) && Number.isFinite(endedAt)
      ? Math.max(0, (endedAt as number) - (startedAt as number))
      : usageDurationMs;
  return {
    status: row.runStatus,
    ...(Number.isFinite(startedAt) ? { startedAt } : {}),
    ...(Number.isFinite(endedAt) ? { endedAt } : {}),
    ...(typeof durationMs === 'number' && Number.isFinite(durationMs)
      ? { durationMs }
      : {}),
  };
}

function latestUsageDurationMs(eventsJson: unknown): number | undefined {
  if (typeof eventsJson !== 'string' || eventsJson.length === 0) return undefined;
  try {
    const events = JSON.parse(eventsJson);
    if (!Array.isArray(events)) return undefined;
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i];
      if (
        event &&
        typeof event === 'object' &&
        event.kind === 'usage' &&
        typeof event.durationMs === 'number' &&
        Number.isFinite(event.durationMs)
      ) {
        return Math.max(0, event.durationMs);
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function insertConversation(db: SqliteDb, c: DbRow) {
  db.prepare(
    `INSERT INTO conversations
       (id, project_id, title, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(c.id, c.projectId, c.title ?? null, c.createdAt, c.updatedAt);
  return getConversation(db, c.id);
}

export function updateConversation(db: SqliteDb, id: string, patch: DbRow) {
  const existing = getConversation(db, id);
  if (!existing) return null;
  const merged = {
    ...existing,
    ...patch,
    updatedAt: typeof patch.updatedAt === 'number' ? patch.updatedAt : Date.now(),
  };
  db.prepare(
    `UPDATE conversations
        SET title = ?, updated_at = ? WHERE id = ?`,
  ).run(merged.title ?? null, merged.updatedAt, id);
  return getConversation(db, id);
}

export function deleteConversation(db: SqliteDb, id: string) {
  db.prepare(`DELETE FROM conversations WHERE id = ?`).run(id);
}

// ---------- messages ----------

export function listMessages(db: SqliteDb, conversationId: string) {
  return (db
    .prepare(
      `SELECT id, role, content, agent_id AS agentId, agent_name AS agentName,
              run_id AS runId, run_status AS runStatus,
              last_run_event_id AS lastRunEventId,
              events_json AS eventsJson,
              attachments_json AS attachmentsJson,
              comment_attachments_json AS commentAttachmentsJson,
              produced_files_json AS producedFilesJson,
              feedback_json AS feedbackJson,
              pre_turn_file_names_json AS preTurnFileNamesJson,
              created_at AS createdAt, started_at AS startedAt, ended_at AS endedAt,
              position
         FROM messages
        WHERE conversation_id = ?
        ORDER BY position ASC`,
    )
    .all(conversationId) as DbRow[])
    .map(normalizeMessage);
}

export function upsertMessage(db: SqliteDb, conversationId: string, m: DbRow) {
  const existing = db
    .prepare(`SELECT position FROM messages WHERE id = ?`)
    .get(m.id) as DbRow | undefined;
  const now = Date.now();
  if (existing) {
    db.prepare(
      `UPDATE messages
          SET role = ?, content = ?, agent_id = ?, agent_name = ?,
              run_id = ?, run_status = ?, last_run_event_id = ?,
              events_json = ?, attachments_json = ?, comment_attachments_json = ?,
              produced_files_json = ?, feedback_json = ?,
              pre_turn_file_names_json = ?,
              started_at = ?, ended_at = ?
        WHERE id = ?`,
    ).run(
      m.role,
      m.content,
      m.agentId ?? null,
      m.agentName ?? null,
      m.runId ?? null,
      m.runStatus ?? null,
      m.lastRunEventId ?? null,
      m.events ? JSON.stringify(m.events) : null,
      m.attachments ? JSON.stringify(m.attachments) : null,
      m.commentAttachments ? JSON.stringify(m.commentAttachments) : null,
      m.producedFiles ? JSON.stringify(m.producedFiles) : null,
      m.feedback ? JSON.stringify(m.feedback) : null,
      m.preTurnFileNames ? JSON.stringify(m.preTurnFileNames) : null,
      m.startedAt ?? null,
      m.endedAt ?? null,
      m.id,
    );
  } else {
    const max = db
      .prepare(
        `SELECT COALESCE(MAX(position), -1) AS m FROM messages WHERE conversation_id = ?`,
      )
      .get(conversationId) as DbRow | undefined;
    const position = (max?.m ?? -1) + 1;
    // 19 values: id, conversation_id, role, content, agent_id, agent_name,
    // run_id, run_status, last_run_event_id, events_json, attachments_json,
    // comment_attachments_json, produced_files_json, feedback_json,
    // pre_turn_file_names_json, started_at, ended_at, position, created_at.
    db.prepare(
      `INSERT INTO messages
         (id, conversation_id, role, content, agent_id, agent_name,
          run_id, run_status, last_run_event_id, events_json,
          attachments_json, comment_attachments_json, produced_files_json,
          feedback_json, pre_turn_file_names_json,
          started_at, ended_at, position, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      m.id,
      conversationId,
      m.role,
      m.content,
      m.agentId ?? null,
      m.agentName ?? null,
      m.runId ?? null,
      m.runStatus ?? null,
      m.lastRunEventId ?? null,
      m.events ? JSON.stringify(m.events) : null,
      m.attachments ? JSON.stringify(m.attachments) : null,
      m.commentAttachments ? JSON.stringify(m.commentAttachments) : null,
      m.producedFiles ? JSON.stringify(m.producedFiles) : null,
      m.feedback ? JSON.stringify(m.feedback) : null,
      m.preTurnFileNames ? JSON.stringify(m.preTurnFileNames) : null,
      m.startedAt ?? null,
      m.endedAt ?? null,
      position,
      now,
    );
  }
  // Bump conversation activity so the sidebar's recency sort works.
  db.prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`).run(
    now,
    conversationId,
  );
  const row = db
    .prepare(
      `SELECT id, role, content, agent_id AS agentId, agent_name AS agentName,
              run_id AS runId, run_status AS runStatus,
              last_run_event_id AS lastRunEventId,
              events_json AS eventsJson,
              attachments_json AS attachmentsJson,
              comment_attachments_json AS commentAttachmentsJson,
              produced_files_json AS producedFilesJson,
              feedback_json AS feedbackJson,
              pre_turn_file_names_json AS preTurnFileNamesJson,
              created_at AS createdAt, started_at AS startedAt, ended_at AS endedAt,
              position
         FROM messages WHERE id = ?`,
    )
    .get(m.id) as DbRow | undefined;
  return row ? normalizeMessage(row) : null;
}

export function appendMessageStatusEvent(db: SqliteDb, messageId: string, event: DbRow) {
  const label = typeof event?.label === 'string' ? event.label.trim() : '';
  const detail = typeof event?.detail === 'string' ? event.detail.trim() : '';
  if (!label) return null;
  const row = db
    .prepare(`SELECT events_json AS eventsJson FROM messages WHERE id = ?`)
    .get(messageId) as DbRow | undefined;
  if (!row) return null;
  const parsed = parseJsonOrUndef(row.eventsJson);
  const events = Array.isArray(parsed) ? parsed : [];
  const last = events[events.length - 1];
  if (last?.kind === 'status' && last.label === label && (last.detail ?? '') === detail) {
    return events;
  }
  const nextEvent = detail
    ? { kind: 'status', label, detail }
    : { kind: 'status', label };
  const next = [...events, nextEvent];
  db.prepare(`UPDATE messages SET events_json = ? WHERE id = ?`)
    .run(JSON.stringify(next), messageId);
  return next;
}

export function appendMessageAgentEvent(db: SqliteDb, messageId: string, event: DbRow) {
  if (!event || typeof event !== 'object') return null;
  const kind = typeof event.kind === 'string' ? event.kind : '';
  if (!kind) return null;
  const row = db
    .prepare(`SELECT content, events_json AS eventsJson FROM messages WHERE id = ?`)
    .get(messageId) as DbRow | undefined;
  if (!row) return null;
  const parsed = parseJsonOrUndef(row.eventsJson);
  const events = Array.isArray(parsed) ? parsed : [];
  const last = events[events.length - 1];
  if (last && JSON.stringify(last) === JSON.stringify(event)) {
    return events;
  }
  const next = [...events, event];
  const textDelta = kind === 'text' && typeof event.text === 'string' ? event.text : '';
  db.prepare(`UPDATE messages SET content = COALESCE(content, '') || ?, events_json = ? WHERE id = ?`)
    .run(textDelta, JSON.stringify(next), messageId);
  return next;
}

export function deleteMessage(db: SqliteDb, id: string) {
  db.prepare(`DELETE FROM messages WHERE id = ?`).run(id);
}

// ---------- preview comments ----------

const PREVIEW_COMMENT_STATUSES = new Set([
  'open',
  'attached',
  'applying',
  'needs_review',
  'resolved',
  'failed',
]);

export function listPreviewComments(db: SqliteDb, projectId: string, conversationId: string) {
  return (db
    .prepare(
      `SELECT id, project_id AS projectId, conversation_id AS conversationId,
              file_path AS filePath, element_id AS elementId, selector, label,
              text, position_json AS positionJson, html_hint AS htmlHint,
              selection_kind AS selectionKind, member_count AS memberCount,
              pod_members_json AS podMembersJson,
              note, status, created_at AS createdAt, updated_at AS updatedAt
         FROM preview_comments
        WHERE project_id = ? AND conversation_id = ?
        ORDER BY updated_at DESC`,
    )
    .all(projectId, conversationId) as DbRow[])
    .map(normalizePreviewComment);
}

export function upsertPreviewComment(db: SqliteDb, projectId: string, conversationId: string, input: DbRow) {
  const target = input?.target ?? {};
  const note = typeof input?.note === 'string' ? input.note.trim() : '';
  if (!note) throw new Error('comment note required');
  const filePath = cleanRequiredString(target.filePath, 'filePath');
  const elementId = cleanRequiredString(target.elementId, 'elementId');
  const selector = cleanRequiredString(target.selector, 'selector');
  const label = cleanRequiredString(target.label, 'label');
  const text = typeof target.text === 'string' ? compactWhitespace(target.text).slice(0, 160) : '';
  const htmlHint = typeof target.htmlHint === 'string' ? compactWhitespace(target.htmlHint).slice(0, 180) : '';
  const position = normalizePosition(target.position);
  const selectionKind = target.selectionKind === 'pod' ? 'pod' : 'element';
  const podMembers = selectionKind === 'pod' ? normalizePodMembers(target.podMembers) : [];
  const memberCount = selectionKind === 'pod'
    ? (podMembers.length > 0
        ? podMembers.length
        : Number.isFinite(target.memberCount)
          ? Math.max(0, Math.round(target.memberCount))
          : 0)
    : 0;
  const now = Date.now();
  const existing = db
    .prepare(
      `SELECT id, created_at AS createdAt
         FROM preview_comments
        WHERE project_id = ? AND conversation_id = ? AND file_path = ? AND element_id = ?`,
    )
    .get(projectId, conversationId, filePath, elementId) as DbRow | undefined;
  const id = existing?.id ?? randomCommentId();
  const createdAt = existing?.createdAt ?? now;
  db.prepare(
    `INSERT INTO preview_comments
       (id, project_id, conversation_id, file_path, element_id, selector, label,
        text, position_json, html_hint, selection_kind, member_count, pod_members_json,
        note, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, conversation_id, file_path, element_id) DO UPDATE SET
       selector = excluded.selector,
       label = excluded.label,
       text = excluded.text,
       position_json = excluded.position_json,
       html_hint = excluded.html_hint,
       selection_kind = excluded.selection_kind,
       member_count = excluded.member_count,
       pod_members_json = excluded.pod_members_json,
       note = excluded.note,
       status = 'open',
       updated_at = excluded.updated_at`,
  ).run(
    id,
    projectId,
    conversationId,
    filePath,
    elementId,
    selector,
    label,
    text,
    JSON.stringify(position),
    htmlHint,
    selectionKind,
    selectionKind === 'pod' ? memberCount : null,
    selectionKind === 'pod' ? JSON.stringify(podMembers) : null,
    note,
    'open',
    createdAt,
    now,
  );
  return getPreviewComment(db, projectId, conversationId, id);
}

export function updatePreviewCommentStatus(db: SqliteDb, projectId: string, conversationId: string, id: string, status: string) {
  if (!PREVIEW_COMMENT_STATUSES.has(status)) throw new Error('invalid comment status');
  const now = Date.now();
  db.prepare(
    `UPDATE preview_comments
        SET status = ?, updated_at = ?
      WHERE id = ? AND project_id = ? AND conversation_id = ?`,
  ).run(status, now, id, projectId, conversationId);
  return getPreviewComment(db, projectId, conversationId, id);
}

export function deletePreviewComment(db: SqliteDb, projectId: string, conversationId: string, id: string) {
  const result = db
    .prepare(
      `DELETE FROM preview_comments
        WHERE id = ? AND project_id = ? AND conversation_id = ?`,
    )
    .run(id, projectId, conversationId);
  return result.changes > 0;
}

function getPreviewComment(db: SqliteDb, projectId: string, conversationId: string, id: string) {
  const row = db
    .prepare(
      `SELECT id, project_id AS projectId, conversation_id AS conversationId,
              file_path AS filePath, element_id AS elementId, selector, label,
              text, position_json AS positionJson, html_hint AS htmlHint,
              selection_kind AS selectionKind, member_count AS memberCount,
              pod_members_json AS podMembersJson,
              note, status, created_at AS createdAt, updated_at AS updatedAt
         FROM preview_comments
        WHERE id = ? AND project_id = ? AND conversation_id = ?`,
    )
    .get(id, projectId, conversationId) as DbRow | undefined;
  return row ? normalizePreviewComment(row) : null;
}

function normalizePreviewComment(row: DbRow) {
  const podMembers = parseJsonOrUndef(row.podMembersJson);
  const normalizedPodMembers = Array.isArray(podMembers) ? podMembers : undefined;
  return {
    id: row.id,
    projectId: row.projectId,
    conversationId: row.conversationId,
    filePath: row.filePath,
    elementId: row.elementId,
    selector: row.selector,
    label: row.label,
    text: row.text,
    position: parseJsonOrUndef(row.positionJson) ?? { x: 0, y: 0, width: 0, height: 0 },
    htmlHint: row.htmlHint,
    selectionKind: row.selectionKind === 'pod' ? 'pod' : 'element',
    memberCount:
      normalizedPodMembers && normalizedPodMembers.length > 0
        ? normalizedPodMembers.length
        : Number.isFinite(row.memberCount)
          ? row.memberCount
          : undefined,
    podMembers: normalizedPodMembers,
    note: row.note,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function cleanRequiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} required`);
  return value.trim();
}

function normalizePodMembers(input: unknown) {
  if (!Array.isArray(input)) return [];
  return input
    .map((member) => {
      if (!member || typeof member !== 'object') return null;
      const elementId = cleanRequiredString(member.elementId, 'podMember.elementId');
      const selector = cleanRequiredString(member.selector, 'podMember.selector');
      const label = cleanRequiredString(member.label, 'podMember.label');
      return {
        elementId,
        selector,
        label,
        text:
          typeof member.text === 'string'
            ? compactWhitespace(member.text).slice(0, 160)
            : '',
        position: normalizePosition(member.position),
        htmlHint:
          typeof member.htmlHint === 'string'
            ? compactWhitespace(member.htmlHint).slice(0, 180)
            : '',
      };
    })
    .filter(Boolean);
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizePosition(input: unknown) {
  const value: DbRow = input && typeof input === 'object' ? input as DbRow : {};
  return {
    x: finiteNumber(value.x),
    y: finiteNumber(value.y),
    width: finiteNumber(value.width),
    height: finiteNumber(value.height),
  };
}

function finiteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 0;
}

function randomCommentId(): string {
  return `cmt_${randomUUID().slice(0, 8)}`;
}

function normalizeMessage(row: DbRow) {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    agentId: row.agentId ?? undefined,
    agentName: row.agentName ?? undefined,
    runId: row.runId ?? undefined,
    runStatus: row.runStatus ?? undefined,
    lastRunEventId: row.lastRunEventId ?? undefined,
    events: parseJsonOrUndef(row.eventsJson),
    attachments: parseJsonOrUndef(row.attachmentsJson),
    commentAttachments: parseJsonOrUndef(row.commentAttachmentsJson),
    producedFiles: parseJsonOrUndef(row.producedFilesJson),
    feedback: parseJsonOrUndef(row.feedbackJson),
    preTurnFileNames: parseJsonOrUndef(row.preTurnFileNamesJson),
    createdAt: row.createdAt ?? undefined,
    startedAt: row.startedAt ?? undefined,
    endedAt: row.endedAt ?? undefined,
  };
}

function parseJsonOrUndef(s: unknown): any {
  if (typeof s !== 'string' || !s) return undefined;
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

// ---------- routines ----------

const ROUTINE_COLS = `id, workspace_id AS workspaceId, name, prompt,
  created_by_user_id AS createdByUserId,
  owned_by_user_id AS ownedByUserId,
  schedule_kind AS scheduleKind, schedule_value AS scheduleValue,
  schedule_json AS scheduleJson,
  project_mode AS projectMode, project_id AS projectId,
  skill_id AS skillId, agent_id AS agentId,
  context_json AS contextJson,
  enabled, created_at AS createdAt, updated_at AS updatedAt`;

const ROUTINE_RUN_COLS = `id, routine_id AS routineId, trigger, status,
  project_id AS projectId, conversation_id AS conversationId,
  agent_run_id AS agentRunId, started_at AS startedAt,
  completed_at AS completedAt, summary, error, error_code AS errorCode`;

export function listRoutines(db: SqliteDb, options: { workspaceId?: string } = {}) {
  const workspaceId = options.workspaceId?.trim();
  return (db
    .prepare(
      `SELECT ${ROUTINE_COLS} FROM routines
       ${workspaceId ? 'WHERE workspace_id = ?' : ''}
       ORDER BY created_at ASC`,
    )
    .all(...(workspaceId ? [workspaceId] : [])) as DbRow[])
    .map(normalizeRoutine);
}

export function getRoutine(db: SqliteDb, id: string) {
  const r = db
    .prepare(`SELECT ${ROUTINE_COLS} FROM routines WHERE id = ?`)
    .get(id) as DbRow | undefined;
  return r ? normalizeRoutine(r) : null;
}

export function insertRoutine(db: SqliteDb, r: DbRow) {
  db.prepare(
    `INSERT INTO routines
       (id, workspace_id, created_by_user_id, owned_by_user_id, name, prompt, schedule_kind, schedule_value, schedule_json,
        project_mode, project_id, skill_id, agent_id, context_json, enabled,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    r.id,
    r.workspaceId ?? DEFAULT_WORKSPACE_ID,
    r.createdByUserId ?? null,
    r.ownedByUserId ?? r.createdByUserId ?? null,
    r.name,
    r.prompt,
    r.scheduleKind,
    r.scheduleValue,
    r.scheduleJson ?? null,
    r.projectMode,
    r.projectId ?? null,
    r.skillId ?? null,
    r.agentId ?? null,
    r.contextJson ?? null,
    r.enabled ? 1 : 0,
    r.createdAt,
    r.updatedAt,
  );
  return getRoutine(db, r.id);
}

export function updateRoutine(db: SqliteDb, id: string, patch: DbRow) {
  const existing = getRoutine(db, id);
  if (!existing) return null;
  const merged = {
    ...existing,
    ...patch,
    updatedAt: typeof patch.updatedAt === 'number' ? patch.updatedAt : Date.now(),
  };
  db.prepare(
    `UPDATE routines
        SET workspace_id = ?, name = ?, prompt = ?,
            owned_by_user_id = ?,
            schedule_kind = ?, schedule_value = ?, schedule_json = ?,
            project_mode = ?, project_id = ?,
            skill_id = ?, agent_id = ?, context_json = ?,
            enabled = ?, updated_at = ?
      WHERE id = ?`,
  ).run(
    merged.workspaceId ?? DEFAULT_WORKSPACE_ID,
    merged.name,
    merged.prompt,
    merged.ownedByUserId ?? null,
    merged.scheduleKind,
    merged.scheduleValue,
    merged.scheduleJson ?? null,
    merged.projectMode,
    merged.projectId ?? null,
    merged.skillId ?? null,
    merged.agentId ?? null,
    merged.contextJson ?? null,
    merged.enabled ? 1 : 0,
    merged.updatedAt,
    id,
  );
  return getRoutine(db, id);
}

export function updateReuseRoutinesWorkspaceForProject(db: SqliteDb, input: { projectId: string; workspaceId: string; fallbackOwnerUserId?: string }) {
  const now = Date.now();
  const result = db.prepare(
    `UPDATE routines
        SET workspace_id = ?,
            owned_by_user_id = CASE
              WHEN ? IS NOT NULL
               AND NOT EXISTS (
                 SELECT 1
                   FROM workspace_memberships
                  WHERE workspace_id = ?
                    AND user_id = COALESCE(routines.owned_by_user_id, routines.created_by_user_id)
               )
              THEN ?
              ELSE owned_by_user_id
            END,
            updated_at = ?
      WHERE project_mode = 'reuse'
        AND project_id = ?`,
  ).run(
    input.workspaceId,
    input.fallbackOwnerUserId ?? null,
    input.workspaceId,
    input.fallbackOwnerUserId ?? null,
    now,
    input.projectId,
  );
  return result.changes;
}

export function listReuseRoutinesForProject(db: SqliteDb, projectId: string) {
  return (db
    .prepare(
      `SELECT ${ROUTINE_COLS} FROM routines
        WHERE project_mode = 'reuse'
          AND project_id = ?
        ORDER BY created_at ASC`,
    )
    .all(projectId) as DbRow[])
    .map(normalizeRoutine);
}

export function deleteRoutine(db: SqliteDb, id: string): boolean {
  const result = db.prepare(`DELETE FROM routines WHERE id = ?`).run(id);
  return result.changes > 0;
}

function normalizeRoutine(row: DbRow) {
  return {
    id: row.id,
    workspaceId: row.workspaceId ?? DEFAULT_WORKSPACE_ID,
    createdByUserId: row.createdByUserId ?? undefined,
    ownedByUserId: row.ownedByUserId ?? row.createdByUserId ?? undefined,
    name: row.name,
    prompt: row.prompt,
    scheduleKind: row.scheduleKind,
    scheduleValue: row.scheduleValue,
    scheduleJson: row.scheduleJson ?? null,
    projectMode: row.projectMode,
    projectId: row.projectId ?? null,
    skillId: row.skillId ?? null,
    agentId: row.agentId ?? null,
    contextJson: row.contextJson ?? null,
    enabled: Number(row.enabled) === 1,
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
}

export function listRoutineRuns(db: SqliteDb, routineId: string, limit = 20) {
  return (db
    .prepare(
      `SELECT ${ROUTINE_RUN_COLS}
         FROM routine_runs
        WHERE routine_id = ?
        ORDER BY started_at DESC
        LIMIT ?`,
    )
    .all(routineId, limit) as DbRow[])
    .map(normalizeRoutineRun);
}

export function getLatestRoutineRun(db: SqliteDb, routineId: string) {
  const r = db
    .prepare(
      `SELECT ${ROUTINE_RUN_COLS}
         FROM routine_runs
        WHERE routine_id = ?
        ORDER BY started_at DESC
        LIMIT 1`,
    )
    .get(routineId) as DbRow | undefined;
  return r ? normalizeRoutineRun(r) : null;
}

export function getRoutineRun(db: SqliteDb, id: string) {
  const r = db
    .prepare(`SELECT ${ROUTINE_RUN_COLS} FROM routine_runs WHERE id = ?`)
    .get(id) as DbRow | undefined;
  return r ? normalizeRoutineRun(r) : null;
}

export function insertRoutineRun(db: SqliteDb, r: DbRow) {
  db.prepare(
    `INSERT INTO routine_runs
       (id, routine_id, trigger, status, project_id, conversation_id,
        agent_run_id, started_at, completed_at, summary, error, error_code)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    r.id,
    r.routineId,
    r.trigger,
    r.status,
    r.projectId,
    r.conversationId,
    r.agentRunId,
    r.startedAt,
    r.completedAt ?? null,
    r.summary ?? null,
    r.error ?? null,
    r.errorCode ?? null,
  );
  return getRoutineRun(db, r.id);
}

export function updateRoutineRun(db: SqliteDb, id: string, patch: DbRow) {
  const existing = getRoutineRun(db, id);
  if (!existing) return null;
  const merged = {
    ...existing,
    ...patch,
  };
  db.prepare(
    `UPDATE routine_runs
        SET status = ?, completed_at = ?, summary = ?, error = ?, error_code = ?
      WHERE id = ?`,
  ).run(
    merged.status,
    merged.completedAt ?? null,
    merged.summary ?? null,
    merged.error ?? null,
    merged.errorCode ?? null,
    id,
  );
  return getRoutineRun(db, id);
}

function normalizeRoutineRun(row: DbRow) {
  return {
    id: row.id,
    routineId: row.routineId,
    trigger: row.trigger,
    status: row.status,
    projectId: row.projectId,
    conversationId: row.conversationId,
    agentRunId: row.agentRunId,
    startedAt: Number(row.startedAt),
    completedAt: row.completedAt == null ? null : Number(row.completedAt),
    summary: row.summary ?? null,
    error: row.error ?? null,
    errorCode: row.errorCode ?? null,
  };
}

// ---------- tabs ----------

export function listTabs(db: SqliteDb, projectId: string) {
  const rows = db
    .prepare(
      `SELECT name, position, is_active AS isActive
         FROM tabs WHERE project_id = ? ORDER BY position ASC`,
    )
    .all(projectId) as DbRow[];
  const active = (rows as DbRow[]).find((r: DbRow) => r.isActive) ?? null;
  return {
    tabs: (rows as DbRow[]).map((r: DbRow) => r.name),
    active: active ? active.name : null,
  };
}

export function setTabs(db: SqliteDb, projectId: string, names: string[], activeName: string | null) {
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM tabs WHERE project_id = ?`).run(projectId);
    const ins = db.prepare(
      `INSERT INTO tabs (project_id, name, position, is_active)
       VALUES (?, ?, ?, ?)`,
    );
    names.forEach((name: string, i: number) => {
      ins.run(projectId, name, i, name === activeName ? 1 : 0);
    });
  });
  tx();
  return listTabs(db, projectId);
}

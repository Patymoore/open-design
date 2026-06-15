// OD Library — global asset registry contracts.
//
// The library is the system-wide asset registration center: every asset that
// enters Open Design (clipper capture, manual upload, agent-task upload or
// generation, design-system staging) is indexed here through a single
// `registerLibraryAsset` hook. Each logical asset is deduped by content hash
// and may carry many source records (1 asset : N sources) so the same image
// used in two tasks collapses to one asset with two back-links.
//
// These DTOs are the shared web/daemon contract. Keep this file pure
// TypeScript — no Node, browser, or daemon imports.

/** What the asset fundamentally is. */
export type LibraryAssetKind =
  | 'image'
  | 'color'
  | 'font'
  | 'html'
  | 'text'
  | 'url'
  | 'video';

/**
 * Storage model:
 * - `owned`: the library holds its own content-addressed copy under
 *   LIBRARY_DIR (clipper capture, `od library import`, independent sources).
 * - `referenced`: the bytes already live inside a project / design-system
 *   directory; the library only stores a pointer + metadata + embedding.
 */
export type LibraryStorage = 'owned' | 'referenced';

/** Where a given source record came from — drives the back-link UI. */
export type LibrarySourceKind =
  | 'clipper'
  | 'manual-upload'
  | 'agent-task'
  | 'design-system'
  | 'generated';

/** A single provenance record for an asset (1 asset : N sources). */
export interface LibraryAssetSource {
  id: string;
  assetId: string;
  sourceKind: LibrarySourceKind;
  /** Project the asset was captured/used in, when applicable. */
  projectId?: string;
  /** Conversation/run that produced or uploaded the asset (agent-task). */
  conversationId?: string;
  runId?: string;
  /** Design system this asset was staged for. */
  designSystemId?: string;
  /** Path of the underlying file relative to its origin project, when referenced. */
  relPath?: string;
  createdAt: number;
}

export interface LibraryAsset {
  id: string;
  kind: LibraryAssetKind;
  storage: LibraryStorage;
  /** Originating page/resource URL (clipper / import). */
  sourceUrl?: string;
  /** Originating page/document title. */
  sourceTitle?: string;
  /** Host of `sourceUrl`, denormalized for cheap domain filtering. */
  sourceDomain?: string;
  /** Unix ms the asset was first captured/registered. */
  capturedAt: number;
  /** `YYYY-MM-DD` local date, drives the daily archive feed. */
  archivedDate: string;
  mime?: string;
  width?: number;
  height?: number;
  size?: number;
  contentHash: string;
  /** AI-enriched (vision) one-line description; absent until enriched. */
  caption?: string;
  /** AI-enriched OCR text; absent until enriched. */
  ocrText?: string;
  /** Programmatic dominant-color palette (hex strings). */
  palette?: string[];
  tags: string[];
  metadata?: Record<string, unknown>;
  /** referenced-only: project that physically owns the bytes. */
  originProjectId?: string;
  /** referenced-only: file path relative to the origin project root. */
  relPath?: string;
  sources: LibraryAssetSource[];
  createdAt: number;
  updatedAt: number;
}

/** Summary projection used by list/grid surfaces (same shape, may omit body text). */
export type LibraryAssetSummary = LibraryAsset;

// ---------------------------------------------------------------------------
// Enrichment tasks
// ---------------------------------------------------------------------------

export type LibraryEnrichmentStage =
  | 'normalize'
  | 'palette'
  | 'text'
  | 'tags'
  | 'caption'
  | 'ocr'
  | 'embedding';

export type LibraryTaskStatus =
  | 'queued'
  | 'running'
  | 'done'
  | 'failed'
  | 'skipped';

export interface LibraryTaskError {
  message: string;
  code?: string;
}

export interface LibraryTask {
  id: string;
  assetId: string;
  status: LibraryTaskStatus;
  /** Human-readable progress lines, append-only. */
  progress: string[];
  error?: LibraryTaskError | null;
  startedAt: number;
  endedAt?: number | null;
}

export interface LibraryTaskWaitRequest {
  since?: number;
  timeoutMs?: number;
}

export interface LibraryTaskSnapshot {
  taskId: string;
  status: LibraryTaskStatus;
  progress: string[];
  nextSince: number;
  startedAt: number;
  endedAt?: number | null;
  error?: LibraryTaskError | null;
}

// ---------------------------------------------------------------------------
// Ingest / list / search / apply
// ---------------------------------------------------------------------------

export interface LibraryIngestRequest {
  kind?: LibraryAssetKind;
  /** Remote resource the daemon should fetch and store (owned). */
  url?: string;
  /** Inline `data:` URI (e.g. a captured screenshot PNG). */
  dataUrl?: string;
  /** Inline text payload for `text`/`html`/`color`/`url` kinds. */
  text?: string;
  sourceUrl?: string;
  sourceTitle?: string;
  tags?: string[];
  filename?: string;
}

export interface LibraryIngestResponse {
  asset: LibraryAsset;
  /** Enrichment task id (absent when nothing to enrich). */
  taskId?: string;
  /** True when the content hash already existed and a source was appended. */
  deduped: boolean;
}

export interface LibraryAssetFilter {
  kind?: LibraryAssetKind;
  tag?: string;
  domain?: string;
  /** `YYYY-MM-DD` archive date. */
  date?: string;
  /** Free-text query (keyword fallback when no embeddings). */
  q?: string;
  source?: LibrarySourceKind;
  projectId?: string;
  designSystemId?: string;
  limit?: number;
}

export interface LibraryAssetListResponse {
  assets: LibraryAsset[];
}

export interface LibraryAssetDetailResponse {
  asset: LibraryAsset;
}

export interface LibrarySearchRequest {
  query: string;
  kind?: LibraryAssetKind;
  date?: string;
  limit?: number;
}

export interface LibrarySearchResultItem {
  asset: LibraryAsset;
  score: number;
}

export interface LibrarySearchResponse {
  results: LibrarySearchResultItem[];
  /** True when results came from embedding cosine search; false for keyword fallback. */
  semantic: boolean;
}

export interface LibraryApplyRequest {
  projectId: string;
  /** Optional subdirectory inside the project to copy into. */
  dir?: string;
}

export interface LibraryApplyResponse {
  relPath: string;
}

// ---------------------------------------------------------------------------
// Daily archive
// ---------------------------------------------------------------------------

export interface LibraryDigest {
  date: string;
  projectId?: string;
  artifactPath?: string;
  summary?: string;
}

export interface LibraryArchiveResponse {
  date: string;
  assets: LibraryAsset[];
  digest?: LibraryDigest;
}

// ---------------------------------------------------------------------------
// Browser-extension pairing
// ---------------------------------------------------------------------------

export interface LibraryPairingStartResponse {
  /** Short human-typeable pairing code, shown in the OD UI. */
  code: string;
  /** Unix ms the code stops being valid. */
  expiresAt: number;
}

export interface LibraryPairingConfirmRequest {
  code: string;
  /** `chrome-extension://<id>` origin to allowlist. */
  extensionOrigin: string;
  label?: string;
}

export interface LibraryPairingConfirmResponse {
  /** Long-lived `odlt_…` bearer token for the extension. */
  token: string;
  label: string;
}

export interface LibraryConnectionStatus {
  paired: boolean;
  tokens: Array<{
    label: string;
    extensionOrigin: string;
    createdAt: number;
    lastUsedAt: number;
  }>;
}

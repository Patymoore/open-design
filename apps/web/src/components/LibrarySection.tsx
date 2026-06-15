// OD Library tab — the global asset registry grid.
//
// Shows every asset that has entered the system (clipper capture, manual
// upload, agent task, design-system staging, AI generation) with a source
// badge and back-links. Captures from the browser extension stream in live
// over the `/api/library/events` SSE feed. Pairing the extension is a
// one-click affordance here: mint a code, type it into the clipper popup.
//
// Copy is intentionally inline (not yet i18n-keyed) — localization of the
// Library surface is a tracked follow-up.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LibraryAsset, LibrarySourceKind } from '@open-design/contracts';
import {
  deleteLibraryAsset,
  fetchLibraryAssets,
  fetchLibraryConnection,
  libraryAssetRawUrl,
  startLibraryPairing,
  type LibraryAssetQuery,
} from '../providers/registry';
import { Button } from '@open-design/components';
import styles from './LibrarySection.module.css';

interface Props {
  active: boolean;
  onOpenProject: (projectId: string) => void;
}

const SOURCE_LABELS: Record<LibrarySourceKind, string> = {
  clipper: 'Clipper',
  'manual-upload': 'Upload',
  'agent-task': 'Agent',
  'design-system': 'Design system',
  generated: 'Generated',
};

const KIND_FILTERS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All kinds' },
  { value: 'image', label: 'Images' },
  { value: 'video', label: 'Video' },
  { value: 'html', label: 'HTML' },
  { value: 'text', label: 'Text' },
];

const SOURCE_FILTERS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All sources' },
  { value: 'clipper', label: 'Clipper' },
  { value: 'manual-upload', label: 'Upload' },
  { value: 'agent-task', label: 'Agent' },
  { value: 'design-system', label: 'Design system' },
  { value: 'generated', label: 'Generated' },
];

function primarySource(asset: LibraryAsset): LibrarySourceKind | null {
  return asset.sources?.[0]?.sourceKind ?? null;
}

function originProjectId(asset: LibraryAsset): string | null {
  if (asset.originProjectId) return asset.originProjectId;
  const fromSource = asset.sources?.find((s) => s.projectId)?.projectId;
  return fromSource ?? null;
}

export function LibrarySection({ active, onOpenProject }: Props) {
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [kind, setKind] = useState('');
  const [source, setSource] = useState('');
  const [search, setSearch] = useState('');
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [paired, setPaired] = useState(false);
  const loadedOnce = useRef(false);

  const query = useMemo<LibraryAssetQuery>(() => {
    const q: LibraryAssetQuery = {};
    if (kind) q.kind = kind;
    if (source) q.source = source;
    if (search.trim()) q.q = search.trim();
    return q;
  }, [kind, source, search]);

  const load = useCallback(async () => {
    setLoading(true);
    const [next, connection] = await Promise.all([
      fetchLibraryAssets(query),
      fetchLibraryConnection(),
    ]);
    setAssets(next);
    setPaired(Boolean(connection?.paired));
    setLoading(false);
  }, [query]);

  // Fetch when the tab becomes active or filters change.
  useEffect(() => {
    if (!active) return;
    loadedOnce.current = true;
    void load();
  }, [active, load]);

  // Live updates: clipper captures and deletes refresh the grid.
  useEffect(() => {
    if (!active) return;
    let es: EventSource | null = null;
    try {
      es = new EventSource('/api/library/events');
      const refresh = () => void load();
      es.addEventListener('ingest', refresh);
      es.addEventListener('delete', refresh);
    } catch {
      // EventSource unavailable — fall back to manual refresh.
    }
    return () => es?.close();
  }, [active, load]);

  const onPair = useCallback(async () => {
    const result = await startLibraryPairing();
    if (result) setPairingCode(result.code);
  }, []);

  const onDelete = useCallback(
    async (id: string) => {
      const ok = await deleteLibraryAsset(id);
      if (ok) setAssets((prev) => prev.filter((a) => a.id !== id));
    },
    [],
  );

  return (
    <div className="entry-section">
      <header className="entry-section__head">
        <h1 className="entry-section__title">Library</h1>
        <div className={styles.headerActions}>
          <span className={styles.connStatus} data-paired={paired ? 'true' : 'false'}>
            {paired ? '● Extension paired' : '○ Extension not paired'}
          </span>
          <Button variant="primary" onClick={onPair}>
            Connect extension
          </Button>
        </div>
      </header>

      {pairingCode ? (
        <div className={styles.pairPanel} role="status">
          <div className={styles.pairCode}>{pairingCode}</div>
          <p className={styles.pairHint}>
            Open the OD Clipper popup, paste this code, and confirm within 5 minutes to pair this
            browser.
          </p>
        </div>
      ) : null}

      <div className={styles.toolbar}>
        <input
          className={styles.search}
          type="search"
          placeholder="Search captions, tags, titles…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className={styles.select} value={kind} onChange={(e) => setKind(e.target.value)}>
          {KIND_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <select className={styles.select} value={source} onChange={(e) => setSource(e.target.value)}>
          {SOURCE_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <Button variant="ghost" onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      {loading && assets.length === 0 ? (
        <p className={styles.empty}>Loading…</p>
      ) : assets.length === 0 ? (
        <div className={styles.empty}>
          <p>No assets yet.</p>
          <p className={styles.emptyHint}>
            Capture from any page with the OD Clipper, run <code>od library import &lt;file&gt;</code>,
            or upload inside a project — everything lands here.
          </p>
        </div>
      ) : (
        <div className={styles.grid}>
          {assets.map((asset) => {
            const src = primarySource(asset);
            const projectId = originProjectId(asset);
            const isImage = asset.kind === 'image';
            return (
              <figure key={asset.id} className={styles.card}>
                <div className={styles.thumb}>
                  {isImage ? (
                    <img src={libraryAssetRawUrl(asset.id)} alt={asset.caption ?? asset.sourceTitle ?? ''} loading="lazy" />
                  ) : (
                    <div className={styles.thumbFallback}>{asset.kind.toUpperCase()}</div>
                  )}
                  {src ? <span className={styles.badge} data-source={src}>{SOURCE_LABELS[src]}</span> : null}
                </div>
                <figcaption className={styles.meta}>
                  <span className={styles.title} title={asset.sourceTitle ?? asset.sourceUrl ?? asset.id}>
                    {asset.sourceTitle || asset.sourceDomain || asset.caption || asset.id.slice(0, 8)}
                  </span>
                  <span className={styles.sub}>
                    {asset.width && asset.height ? `${asset.width}×${asset.height}` : asset.kind}
                  </span>
                </figcaption>
                <div className={styles.cardActions}>
                  {projectId ? (
                    <button type="button" className={styles.linkBtn} onClick={() => onOpenProject(projectId)}>
                      Open project
                    </button>
                  ) : asset.sourceUrl ? (
                    <a className={styles.linkBtn} href={asset.sourceUrl} target="_blank" rel="noreferrer">
                      Source
                    </a>
                  ) : (
                    <span />
                  )}
                  <button type="button" className={styles.deleteBtn} onClick={() => void onDelete(asset.id)}>
                    Remove
                  </button>
                </div>
              </figure>
            );
          })}
        </div>
      )}
    </div>
  );
}

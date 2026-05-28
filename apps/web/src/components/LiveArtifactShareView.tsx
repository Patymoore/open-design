import { useEffect, useState } from 'react';
import type { PublicLiveArtifactShareResponse } from '@open-design/contracts';
import {
  fetchPublicLiveArtifactShareResult,
  publicLiveArtifactSharePreviewUrl,
  type PublicLiveArtifactShareResult,
} from '../providers/registry';
import { Icon } from './Icon';

export function LiveArtifactShareView({ token }: { token: string }) {
  const [data, setData] = useState<PublicLiveArtifactShareResponse | null>(null);
  const [error, setError] = useState<Extract<PublicLiveArtifactShareResult, { ok: false }> | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setData(null);
    setError(null);
    void fetchPublicLiveArtifactShareResult(token).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setData(result.value);
        setError(null);
      } else {
        setData(null);
        setError(result);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [token, reloadKey]);

  if (loading) {
    return (
      <main className="share-view">
        <section className="share-view-state">Loading viewer...</section>
      </main>
    );
  }

  if (!data) {
    const isMissing = error?.status === 404;
    return (
      <main className="share-view">
        <section className="share-view-state">
          <strong>{isMissing ? 'Share link not found' : 'Could not load viewer link'}</strong>
          <span>{isMissing ? 'This viewer link may have been removed.' : (error?.error ?? 'Check your connection and try again.')}</span>
          <div className="share-view-state-actions">
            {!isMissing ? (
              <button type="button" onClick={() => setReloadKey((current) => current + 1)}>
                <Icon name="refresh" size={13} />
                Retry
              </button>
            ) : null}
            <a href="/">Return to Open Design</a>
          </div>
        </section>
      </main>
    );
  }

  const previewUrl = data.previewUrl || publicLiveArtifactSharePreviewUrl(token);

  return (
    <main className="share-view">
      <header className="share-view-topbar">
        <a className="share-view-brand" href="/" aria-label="Open Design">
          <Icon name="orbit" size={17} />
          <span>Open Design</span>
        </a>
        <div className="share-view-title">
          <strong>{data.artifact.title}</strong>
          <span>Viewer</span>
        </div>
      </header>
      <section className="share-view-frame-wrap">
        <iframe
          className="share-view-frame"
          title={data.artifact.title}
          sandbox="allow-scripts allow-forms allow-popups allow-downloads allow-modals"
          src={previewUrl}
        />
      </section>
    </main>
  );
}

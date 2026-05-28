// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LiveArtifactShareView } from '../../src/components/LiveArtifactShareView';
import { fetchPublicLiveArtifactShareResult } from '../../src/providers/registry';

vi.mock('../../src/providers/registry', () => ({
  fetchPublicLiveArtifactShareResult: vi.fn(),
  publicLiveArtifactSharePreviewUrl: vi.fn((token: string) => `/api/shares/live-artifacts/${token}/preview`),
}));

describe('LiveArtifactShareView', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('loads a public viewer link into the preview frame', async () => {
    vi.mocked(fetchPublicLiveArtifactShareResult).mockResolvedValue({
      ok: true,
      value: {
        share: {
          targetType: 'live_artifact',
          projectName: 'Project One',
          role: 'viewer',
          createdAt: 1,
        },
        artifact: {
          schemaVersion: 1,
          title: 'Launch deck',
          slug: 'launch-deck',
          status: 'active',
          pinned: false,
          preview: { type: 'html', entry: 'index.html' },
          refreshStatus: 'idle',
          createdAt: '2026-05-18T00:00:00.000Z',
          updatedAt: '2026-05-18T00:00:00.000Z',
          hasDocument: true,
        },
        previewUrl: '/api/shares/live-artifacts/token-1/preview?from=api',
      },
    });

    render(<LiveArtifactShareView token="token-1" />);

    expect(screen.getByText('Loading viewer...')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByTitle('Launch deck')).toBeTruthy();
    });
    expect((screen.getByTitle('Launch deck') as HTMLIFrameElement).src).toContain('/api/shares/live-artifacts/token-1/preview?from=api');
  });

  it('falls back to the token preview route when old daemons omit previewUrl', async () => {
    vi.mocked(fetchPublicLiveArtifactShareResult).mockResolvedValue({
      ok: true,
      value: {
        share: {
          targetType: 'live_artifact',
          projectName: 'Project One',
          role: 'viewer',
          createdAt: 1,
        },
        artifact: {
          schemaVersion: 1,
          title: 'Legacy share',
          slug: 'legacy-share',
          status: 'active',
          pinned: false,
          preview: { type: 'html', entry: 'index.html' },
          refreshStatus: 'idle',
          createdAt: '2026-05-18T00:00:00.000Z',
          updatedAt: '2026-05-18T00:00:00.000Z',
          hasDocument: true,
        },
        previewUrl: '',
      },
    });

    render(<LiveArtifactShareView token="legacy-token" />);

    await waitFor(() => {
      expect(screen.getByTitle('Legacy share')).toBeTruthy();
    });
    expect((screen.getByTitle('Legacy share') as HTMLIFrameElement).src).toContain('/api/shares/live-artifacts/legacy-token/preview');
  });

  it('distinguishes a missing viewer link from a retryable load failure', async () => {
    vi.mocked(fetchPublicLiveArtifactShareResult).mockResolvedValue({
      ok: false,
      error: 'Viewer link not found.',
      status: 404,
    });

    render(<LiveArtifactShareView token="missing-token" />);

    await waitFor(() => {
      expect(screen.getByText('Share link not found')).toBeTruthy();
    });
    expect(screen.getByText('This viewer link may have been removed.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('lets users retry transient viewer link failures', async () => {
    vi.mocked(fetchPublicLiveArtifactShareResult)
      .mockResolvedValueOnce({ ok: false, error: 'Could not load viewer link.' })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          share: {
            targetType: 'live_artifact',
            projectName: 'Project One',
            role: 'viewer',
            createdAt: 1,
          },
          artifact: {
            schemaVersion: 1,
            title: 'Recovered artifact',
            slug: 'recovered-artifact',
            status: 'active',
            pinned: false,
            preview: { type: 'html', entry: 'index.html' },
            refreshStatus: 'idle',
            createdAt: '2026-05-18T00:00:00.000Z',
            updatedAt: '2026-05-18T00:00:00.000Z',
            hasDocument: true,
          },
          previewUrl: '/api/shares/live-artifacts/token-1/preview',
        },
      });

    render(<LiveArtifactShareView token="token-1" />);

    await waitFor(() => {
      expect(screen.getByText('Could not load viewer link')).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(fetchPublicLiveArtifactShareResult).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.getByTitle('Recovered artifact')).toBeTruthy();
    });
  });
});

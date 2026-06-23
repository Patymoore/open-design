// `useBrandReadyPrompt` — surface a one-shot "your design system is ready"
// prompt when a brand-extraction project finishes.
//
// Brand extraction runs as an agent inside a backing `brand-extraction` project
// (see apps/daemon/src/brands/index.ts). When the agent calls `od brand
// finalize`, the brand's `meta.status` flips to `ready` and a `user:<id>` design
// system is registered — but that happens out of band and there is no SSE
// channel for brand status. Without a nudge the user is left in the project view
// with no idea the extracted design system is now waiting in the Design systems
// tab. This hook watches for that completion and hands ProjectView a prompt to
// guide the user there.
//
// We poll `/api/brands` while the backing project is a brand-extraction project
// and stop the moment it reaches a terminal state. The prompt is shown at most
// once per brand (a sessionStorage flag) so re-opening a finished project never
// nags.

import { useEffect, useState } from 'react';
import type { ProjectMetadata } from '@open-design/contracts';
import { fetchBrands } from './brands';

const POLL_INTERVAL_MS = 5000;
// Ceiling so a stuck / abandoned extraction stops polling after ~25 minutes.
const MAX_POLLS = 300;

function shownStorageKey(brandId: string): string {
  return `od:brand-ready-prompt:${brandId}`;
}

function alreadyShown(brandId: string): boolean {
  try {
    return window.sessionStorage.getItem(shownStorageKey(brandId)) === '1';
  } catch {
    return false;
  }
}

function markShown(brandId: string): void {
  try {
    window.sessionStorage.setItem(shownStorageKey(brandId), '1');
  } catch {
    // sessionStorage unavailable — the prompt may re-show on a later visit,
    // which is a far smaller problem than never showing it at all.
  }
}

export interface BrandReadyPromptState {
  /** The registered `user:<id>` design system to preview. */
  designSystemId: string;
  /** Display name for the prompt copy; null falls back to a generic title. */
  brandName: string | null;
}

export interface UseBrandReadyPrompt {
  prompt: BrandReadyPromptState | null;
  dismiss: () => void;
}

/**
 * Watch a project's metadata; when it is a brand-extraction project whose brand
 * has reached `ready`, expose a one-shot prompt. No-op for every other project.
 */
export function useBrandReadyPrompt(
  metadata: ProjectMetadata | null | undefined,
): UseBrandReadyPrompt {
  const brandId =
    metadata?.importedFrom === 'brand-extraction' ? metadata?.brandId ?? null : null;
  const [prompt, setPrompt] = useState<BrandReadyPromptState | null>(null);

  useEffect(() => {
    setPrompt(null);
    if (!brandId) return undefined;
    // Already nudged this brand in this session — don't nag on revisit.
    if (alreadyShown(brandId)) return undefined;

    let cancelled = false;
    let timer: number | undefined;
    let polls = 0;

    const check = async (): Promise<void> => {
      polls += 1;
      const brands = await fetchBrands();
      if (cancelled) return;
      const summary = brands.find((b) => b.meta.id === brandId);
      const status = summary?.meta.status;
      const designSystemId = summary?.meta.designSystemId;
      if (status === 'ready' && designSystemId) {
        markShown(brandId);
        setPrompt({ designSystemId, brandName: summary?.brand?.name ?? null });
        return; // terminal — stop polling
      }
      if (status === 'failed') return; // terminal — no prompt
      if (polls >= MAX_POLLS) return;
      timer = window.setTimeout(() => void check(), POLL_INTERVAL_MS);
    };

    void check();

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [brandId]);

  return {
    prompt,
    dismiss: () => setPrompt(null),
  };
}

import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createUserDesignSystem,
  readDesignSystemAssets,
} from '../../src/design-systems/index.js';

// Red spec for EXISTING self-built design systems (created before the
// path-B tokens.css change). PR1 makes new self-built systems write a
// schema-aligned `tokens.css`, but packages already on disk only have
// `colors_and_type.css` and no `tokens.css`, so the pull still returns an
// empty `tokensCss` and generation stays brand-blind for them.
//
// The invariant: pulling a self-built design system that has no `tokens.css`
// on disk must still yield a non-empty, schema-aligned token contract, derived
// on read from the package's DESIGN.md palette. This backfills every legacy
// package automatically without a migration run or touching the data dir.
describe('legacy self-built design system token backfill', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'od-legacy-tokens-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('derives a schema-aligned tokens.css on read when none is on disk', async () => {
    const created = await createUserDesignSystem(root, {
      title: 'Acme Product',
      summary: 'Dense product UI.',
      category: 'Custom',
    });

    // Simulate a package created before tokens.css was written for path B.
    const tokensPath = path.join(root, 'acme-product', 'tokens.css');
    await rm(tokensPath, { force: true });
    await expect(stat(tokensPath)).rejects.toThrow();

    const assets = await readDesignSystemAssets(root, created.id);

    expect(
      assets.tokensCss,
      'legacy self-built DS must still pull a non-empty token contract',
    ).toBeTruthy();
    expect(assets.tokensCss).toContain('--bg');
    expect(assets.tokensCss).toContain('--accent');
  });

  // Regression: the backfill must not fire for agent-managed packages, which
  // intentionally skip generated artifacts and stay DESIGN.md-only until the
  // agent writes them. Synthesizing tokens for them would mask that missing
  // step and change the prompt assets for agent-managed reviews.
  it('does not synthesize tokens for agent-managed user packages', async () => {
    const created = await createUserDesignSystem(root, {
      title: 'Agent Managed',
      summary: 'The agent writes review artifacts itself.',
      category: 'Custom',
      artifactMode: 'agent-managed',
    });

    const assets = await readDesignSystemAssets(root, created.id);

    expect(assets.tokensCss).toBeUndefined();
  });
});

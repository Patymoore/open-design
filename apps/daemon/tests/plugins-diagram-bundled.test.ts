import path from 'node:path';
import url from 'node:url';
import { readFile, stat } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(__dirname, '../../../plugins/_official/examples/diagram');

describe('bundled Diagram plugin', () => {
  it('ships a valid manifest, skill, templates, and referenced context assets', async () => {
    const manifestPath = path.join(pluginRoot, 'open-design.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

    expect(manifest.name).toBe('example-diagram');
    expect(manifest.od.kind).toBe('scenario');
    expect(manifest.od.taskKind).toBe('new-generation');
    expect(manifest.od.mode).toBe('prototype');
    expect(manifest.od.surface).toBe('web');
    expect(manifest.od.capabilities).toEqual(expect.arrayContaining(['prompt:inject', 'fs:write']));
    expect(manifest.od.pipeline.stages.map((stage: { id: string }) => stage.id)).toEqual([
      'discovery',
      'generate',
    ]);

    await expect(stat(path.join(pluginRoot, 'SKILL.md'))).resolves.toMatchObject({});
    await expect(stat(path.join(pluginRoot, 'example.html'))).resolves.toMatchObject({});
    for (const asset of manifest.od.context.assets as string[]) {
      await expect(stat(path.join(pluginRoot, asset))).resolves.toMatchObject({});
    }
  });
});

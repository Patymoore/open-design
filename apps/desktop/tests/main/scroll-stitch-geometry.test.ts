import { describe, expect, test } from 'vitest';

import {
  imageSignature,
  scrollStitchGeometry,
  scrollStitchRowOffset,
  shouldCaptureAsDeck,
  tallPageChunkHeights,
} from '../../src/main/deck-capture.js';

// A non-deck page taller than one image is paginated into a multi-page raster
// PDF; tallPageChunkHeights computes the per-page chunk heights (logical px).
describe('tallPageChunkHeights', () => {
  test('splits a tall page into texture/RAM-bounded chunks, remainder last', () => {
    // maxChunkDevH 8192 @2x => 4096 logical per page; 10000 -> [4096,4096,1808].
    const chunks = tallPageChunkHeights(10000, 8192, 2);
    expect(chunks).toEqual([4096, 4096, 1808]);
    expect(chunks.reduce((a, b) => a + b, 0)).toBe(10000);
  });

  test('a page that fits in one chunk yields a single page', () => {
    expect(tallPageChunkHeights(3000, 8192, 2)).toEqual([3000]);
  });

  test('never yields a zero-height chunk', () => {
    for (const c of tallPageChunkHeights(5000, 0, 0)) expect(c).toBeGreaterThan(0);
  });
});

// imageSignature distinguishes two slide captures so the deck loop can detect a
// stale-frame race (capturePage returning the previous slide's frame) and
// re-capture instead of emitting a duplicate page.
describe('imageSignature', () => {
  const fakeImage = (bytes: number[]) => ({ toBitmap: () => Buffer.from(bytes) }) as unknown as Electron.NativeImage;

  test('identical bitmaps hash equal', () => {
    const a = fakeImage([10, 20, 30, 40, 50, 60, 70, 80]);
    const b = fakeImage([10, 20, 30, 40, 50, 60, 70, 80]);
    expect(imageSignature(a)).toBe(imageSignature(b));
  });

  test('different content hashes differently', () => {
    // Differ at byte 0 (sampled by the stride) so the checksum must change.
    const a = fakeImage(new Array(8192).fill(0).map((_, i) => (i === 0 ? 1 : 0)));
    const b = fakeImage(new Array(8192).fill(0).map((_, i) => (i === 0 ? 2 : 0)));
    expect(imageSignature(a)).not.toBe(imageSignature(b));
  });

  test('different length hashes differently', () => {
    expect(imageSignature(fakeImage([1, 2, 3, 4]))).not.toBe(imageSignature(fakeImage([1, 2, 3, 4, 5, 6, 7, 8])));
  });
});

// Full-page scroll-stitch geometry must use the REAL captured device width and
// its true (possibly fractional) pixel ratio. A previous version rounded the
// ratio to an integer, which corrupted output width + row placement on non-
// retina display scaling (125% / 150%).
const PAGE_W = 1440;

describe('scrollStitchGeometry', () => {
  test('retina (2x) — integer ratio', () => {
    const g = scrollStitchGeometry(2880, 5000, PAGE_W);
    expect(g.dpr).toBe(2);
    expect(g.width).toBe(2880);
    expect(g.height).toBe(10000);
  });

  test('125% scaling (1.25x) — fractional ratio is NOT rounded to 1', () => {
    const g = scrollStitchGeometry(1800, 5000, PAGE_W);
    expect(g.dpr).toBeCloseTo(1.25, 5);
    expect(g.width).toBe(1800); // real device width, not PAGE_W*round(1.25)=1440
    expect(g.height).toBe(6250); // round(5000 * 1.25)
  });

  test('150% scaling (1.5x)', () => {
    const g = scrollStitchGeometry(2160, 4000, PAGE_W);
    expect(g.dpr).toBeCloseTo(1.5, 5);
    expect(g.width).toBe(2160);
    expect(g.height).toBe(6000);
  });

  test('1x (no scaling)', () => {
    const g = scrollStitchGeometry(1440, 3000, PAGE_W);
    expect(g.dpr).toBe(1);
    expect(g.width).toBe(1440);
    expect(g.height).toBe(3000);
  });
});

describe('shouldCaptureAsDeck', () => {
  test('an ordinary page with .slide markup but deck:false captures as a page', () => {
    // The regression: a non-deck HTML page (carousel/testimonial `.slide`) sent
    // with an explicit deck:false must NOT be captured per-slide.
    expect(shouldCaptureAsDeck(true, false)).toBe(false);
  });
  test('an explicit deck with slides captures as a deck', () => {
    expect(shouldCaptureAsDeck(true, true)).toBe(true);
  });
  test('no slides is never a deck', () => {
    expect(shouldCaptureAsDeck(false, true)).toBe(false);
    expect(shouldCaptureAsDeck(false, undefined)).toBe(false);
  });
  test('no signal falls back to the slide-count heuristic', () => {
    expect(shouldCaptureAsDeck(true, undefined)).toBe(true);
  });
});

describe('scrollStitchRowOffset', () => {
  test('places chunks at the true fractional pixel offset', () => {
    // At 1.25x, a chunk scrolled to logical y=1000 lands at device row 1250 —
    // exactly one chunk height (1000 * 1.25) below the previous, so chunks tile
    // without the gaps/overlap an integer-rounded scale produced.
    expect(scrollStitchRowOffset(0, 1.25)).toBe(0);
    expect(scrollStitchRowOffset(1000, 1.25)).toBe(1250);
    expect(scrollStitchRowOffset(2000, 1.25)).toBe(2500);
    expect(scrollStitchRowOffset(1000, 1.5)).toBe(1500);
    expect(scrollStitchRowOffset(1000, 2)).toBe(2000);
  });
});

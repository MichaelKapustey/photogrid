import test from 'node:test';
import assert from 'node:assert/strict';
import { BASE_SHORT, DEFAULT_STEP, PAGE, SIZE_STEPS, layoutPages, photoSize } from '../src/layout.js';

const photos = (count, width, height, start = 0) =>
  Array.from({ length: count }, (_, index) => ({ id: start + index, width, height }));

const close = (a, b) => Math.abs(a - b) < 1e-6;

function rowSizes(placements) {
  const rows = [];
  for (const placement of placements) {
    const center = placement.y + placement.height / 2;
    const row = rows.find((candidate) => close(candidate.center, center));
    if (row) row.count += 1;
    else rows.push({ center, count: 1 });
  }
  return rows.map((row) => row.count);
}

test('nine 3:4 portraits fill one page in three rows of three', () => {
  const pages = layoutPages(photos(9, 3024, 4032), 1);
  assert.equal(pages.length, 1);
  assert.deepEqual(rowSizes(pages[0]), [3, 3, 3]);
  const right = Math.max(...pages[0].map((p) => p.x + p.width));
  assert.ok(close(right, PAGE.width - PAGE.margin));
});

test('nine portraits of other common ratios still fit one page', () => {
  for (const [width, height] of [[4000, 6000], [2160, 3840], [3000, 3750]]) {
    const pages = layoutPages(photos(9, width, height), 1);
    assert.equal(pages.length, 1, `${width}x${height}`);
    assert.deepEqual(rowSizes(pages[0]), [3, 3, 3]);
  }
});

test('landscape photos use the portrait size turned sideways', () => {
  const portrait = photoSize(3024, 4032, 1);
  const landscape = photoSize(4032, 3024, 1);
  assert.ok(close(portrait.width, landscape.height));
  assert.ok(close(portrait.height, landscape.width));
});

test('landscapes go two per row', () => {
  const pages = layoutPages(photos(9, 4032, 3024), 1);
  assert.equal(pages.length, 2);
  assert.deepEqual(rowSizes(pages[0]), [2, 2, 2, 2]);
  assert.deepEqual(rowSizes(pages[1]), [1]);
});

test('square photos keep the portrait column width', () => {
  const size = photoSize(1000, 1000, 1);
  assert.ok(close(size.width, BASE_SHORT));
  assert.ok(close(size.height, BASE_SHORT));
});

test('the multiplier scales every photo', () => {
  assert.ok(close(photoSize(3024, 4032, 0.5).width, BASE_SHORT / 2));
  assert.ok(close(photoSize(4032, 3024, 1.5).height, BASE_SHORT * 1.5));
});

test('photos never exceed the printable area', () => {
  const largest = SIZE_STEPS[SIZE_STEPS.length - 1];
  for (const [width, height] of [[4032, 3024], [3024, 4032], [8000, 1000], [1000, 8000]]) {
    const size = photoSize(width, height, largest);
    assert.ok(size.width <= PAGE.width - 2 * PAGE.margin + 1e-9);
    assert.ok(size.height <= PAGE.height - 2 * PAGE.margin + 1e-9);
    assert.ok(close(size.width / size.height, width / height));
  }
});

test('placements stay inside the margins and never overlap', () => {
  const ratios = [[3024, 4032], [4032, 3024], [1000, 1000], [4000, 6000], [6000, 4000], [3840, 2160], [1080, 1350]];
  let seed = 42;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (const multiplier of SIZE_STEPS) {
    const items = Array.from({ length: 23 }, (_, id) => {
      const [width, height] = ratios[Math.floor(random() * ratios.length)];
      return { id, width, height };
    });
    const pages = layoutPages(items, multiplier);
    assert.equal(pages.flat().length, items.length);
    for (const placements of pages) {
      for (const p of placements) {
        assert.ok(p.x >= PAGE.margin - 1e-6 && p.x + p.width <= PAGE.width - PAGE.margin + 1e-6);
        assert.ok(p.y >= PAGE.margin - 1e-6 && p.y + p.height <= PAGE.height - PAGE.margin + 1e-6);
      }
      for (let i = 0; i < placements.length; i += 1) {
        for (let j = i + 1; j < placements.length; j += 1) {
          const a = placements[i];
          const b = placements[j];
          const apart =
            a.x + a.width <= b.x + 1e-6 || b.x + b.width <= a.x + 1e-6 || a.y + a.height <= b.y + 1e-6 || b.y + b.height <= a.y + 1e-6;
          assert.ok(apart, `overlap at ${multiplier}`);
        }
      }
    }
  }
});

test('portraits come before landscapes and keep their own order', () => {
  const items = [
    { id: 'l1', width: 4, height: 3 },
    { id: 'p1', width: 3, height: 4 },
    { id: 'l2', width: 4, height: 3 },
    { id: 'p2', width: 3, height: 4 },
  ];
  assert.deepEqual(layoutPages(items, 1).flat().map((p) => p.id), ['p1', 'p2', 'l1', 'l2']);
  assert.deepEqual(layoutPages(items, 1, { group: false }).flat().map((p) => p.id), ['l1', 'p1', 'l2', 'p2']);
});

test('size steps run from 20% to 300% with 100% as the default', () => {
  assert.equal(SIZE_STEPS[0], 0.2);
  assert.equal(SIZE_STEPS[SIZE_STEPS.length - 1], 3);
  assert.equal(SIZE_STEPS[DEFAULT_STEP], 1);
});

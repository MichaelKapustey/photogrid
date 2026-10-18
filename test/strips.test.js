import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_CANVAS_AREA, STRIP_OVERLAP, planStrips } from '../src/photos.js';

test('photos within the canvas limit stay whole', () => {
  assert.deepEqual(planStrips(4032, 3024), [{ top: 0, height: 3024 }]);
  assert.deepEqual(planStrips(4096, 4096), [{ top: 0, height: 4096 }]);
});

test('larger photos are cut into overlapping strips that cover every row', () => {
  for (const [width, height] of [[5712, 4284], [4284, 5712], [8064, 6048], [6048, 8064], [4000, 5000], [16000, 4000]]) {
    const strips = planStrips(width, height);
    assert.ok(strips.length > 1, `${width}x${height}`);
    assert.equal(strips[0].top, 0);
    assert.equal(strips.at(-1).top + strips.at(-1).height, height);
    for (const strip of strips) assert.ok(width * strip.height <= MAX_CANVAS_AREA);
    for (let index = 1; index < strips.length; index += 1) {
      const previousEnd = strips[index - 1].top + strips[index - 1].height;
      assert.equal(previousEnd - strips[index].top, STRIP_OVERLAP);
      assert.equal((strips[index].top + STRIP_OVERLAP) % 16, 0);
    }
  }
});

test('a custom limit is respected', () => {
  const strips = planStrips(1000, 1000, 300000);
  assert.deepEqual(strips.map((strip) => strip.height), [272, 288, 288, 200]);
  assert.ok(strips.every((strip) => strip.height * 1000 <= 300000));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdjustment, toneCurve } from '../src/adjust.js';

const run = (amount, ...colors) => {
  const source = Uint8ClampedArray.from(colors.flatMap((color) => [...color, 255]));
  const target = createAdjustment(amount)(source, new Uint8ClampedArray(source.length));
  return colors.map((_, index) => [...target.subarray(index * 4, index * 4 + 3)]);
};

const luma = ([red, green, blue]) => 0.2126 * red + 0.7152 * green + 0.0722 * blue;
const chroma = (color) => Math.max(...color) - Math.min(...color);

test('zero means no adjustment', () => {
  assert.equal(createAdjustment(0), null);
  const curve = toneCurve(0);
  for (let value = 0; value < 256; value += 1) assert.ok(Math.abs(curve[value] - value) < 1e-4);
});

test('black and white stay where they are', () => {
  for (const amount of [0.25, 0.5, 1]) {
    const curve = toneCurve(amount);
    assert.equal(curve[0], 0);
    assert.equal(curve[255], 255);
  }
  assert.deepEqual(run(1, [0, 0, 0], [255, 255, 255]), [[0, 0, 0], [255, 255, 255]]);
});

test('the tone curve only ever brightens and never reverses', () => {
  for (const amount of [0.05, 0.3, 0.6, 1]) {
    const curve = toneCurve(amount);
    for (let value = 1; value < 256; value += 1) {
      assert.ok(curve[value] > curve[value - 1], `${amount} at ${value}`);
      assert.ok(curve[value] >= value - 1e-4);
    }
  }
});

test('mid-tones lift most, deep shadows and highlights least', () => {
  const curve = toneCurve(1);
  const lift = (value) => curve[value] - value;
  assert.ok(lift(128) > 25 && lift(128) < 35);
  assert.ok(lift(10) < 4);
  assert.ok(lift(245) < 5);
  assert.ok(Math.abs(toneCurve(0.5)[128] - 128 - lift(128) / 2) < 0.01);
});

test('grays stay neutral', () => {
  for (const value of [12, 64, 128, 200, 250]) {
    const [[red, green, blue]] = run(1, [value, value, value]);
    assert.equal(red, green);
    assert.equal(green, blue);
  }
});

test('saturation keeps brightness and hue', () => {
  const colors = [[40, 90, 160], [120, 160, 60], [90, 60, 140], [70, 140, 150]];
  const curve = toneCurve(0.8);
  const output = run(0.8, ...colors);
  colors.forEach((color, index) => {
    const curved = color.map((value) => curve[value]);
    const result = output[index];
    assert.ok(Math.abs(luma(result) - luma(curved)) < 1);
    const scale = (result[0] - luma(curved)) / (curved[0] - luma(curved));
    for (let channel = 1; channel < 3; channel += 1) {
      assert.ok(Math.abs(luma(curved) + (curved[channel] - luma(curved)) * scale - result[channel]) < 1.5);
    }
    assert.ok(chroma(result) > chroma(curved));
  });
});

test('muted colors gain more than vivid ones', () => {
  const [muted, vivid] = run(1, [110, 128, 150], [20, 70, 230]);
  const curve = toneCurve(1);
  const gain = (before, after) => chroma(after) / chroma(before.map((value) => curve[value]));
  assert.ok(gain([110, 128, 150], muted) > gain([20, 70, 230], vivid) + 0.15);
});

test('skin tones gain less than other colors of the same strength', () => {
  const skin = [224, 172, 138];
  const sky = [138, 172, 224];
  const curve = toneCurve(1);
  const [skinOut, skyOut] = run(1, skin, sky);
  const gain = (before, after) => chroma(after) / chroma(before.map((value) => curve[value]));
  assert.ok(gain(skin, skinOut) < gain(sky, skyOut) - 0.08);
  assert.ok(gain(skin, skinOut) > 1);
});

test('colors already at the edge are not pushed past it', () => {
  assert.deepEqual(run(1, [255, 0, 0], [0, 0, 255], [255, 255, 0]), [[255, 0, 0], [0, 0, 255], [255, 255, 0]]);
  for (const color of [[250, 30, 8], [8, 240, 30], [30, 8, 250], [252, 200, 4]]) {
    const [result] = run(1, color);
    assert.ok(Math.max(...result) < 255, `${color} → ${result}`);
    assert.ok(Math.min(...result) > 0, `${color} → ${result}`);
  }
});

test('alpha passes through and in-place adjustment matches a copy', () => {
  const source = Uint8ClampedArray.from([10, 120, 200, 77, 200, 100, 50, 0]);
  const adjust = createAdjustment(0.6);
  const copy = adjust(source, new Uint8ClampedArray(source.length));
  assert.equal(copy[3], 77);
  assert.equal(copy[7], 0);
  assert.deepEqual([...adjust(Uint8ClampedArray.from(source))], [...copy]);
});

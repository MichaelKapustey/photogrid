import test from 'node:test';
import assert from 'node:assert/strict';
import { displaySize, isJpeg, parseJpeg } from '../src/jpeg.js';
import { ascii, buildJpeg, iccProfile } from './fixtures.js';

const keep = (bytes, ranges) => Uint8Array.from(ranges.flatMap(([from, to]) => [...bytes.subarray(from, to)]));

test('reads frame size and components', () => {
  const info = parseJpeg(buildJpeg({ width: 4032, height: 3024 }));
  assert.equal(info.width, 4032);
  assert.equal(info.height, 3024);
  assert.equal(info.components, 3);
  assert.equal(info.orientation, 1);
  assert.equal(info.embeddable, true);
});

test('reads EXIF orientation in both byte orders', () => {
  for (const littleEndian of [true, false]) {
    for (let orientation = 1; orientation <= 8; orientation += 1) {
      assert.equal(parseJpeg(buildJpeg({ orientation, littleEndian })).orientation, orientation);
    }
  }
});

test('swaps display size for rotated orientations', () => {
  assert.deepEqual(displaySize({ width: 4032, height: 3024, orientation: 6 }), { width: 3024, height: 4032 });
  assert.deepEqual(displaySize({ width: 4032, height: 3024, orientation: 3 }), { width: 4032, height: 3024 });
});

test('assembles split ICC profiles in sequence order', () => {
  const profile = iccProfile('RGB ', 300);
  const info = parseJpeg(buildJpeg({ icc: profile, iccChunks: 3, iccReverse: true }));
  assert.deepEqual([...info.icc], profile);
});

test('ignores an ICC profile that does not match the image components', () => {
  assert.equal(parseJpeg(buildJpeg({ icc: iccProfile('GRAY') })).icc, null);
  assert.notEqual(parseJpeg(buildJpeg({ components: 1, icc: iccProfile('GRAY') })).icc, null);
});

test('strips metadata and keeps a decodable stream', () => {
  const bytes = buildJpeg({ orientation: 6, icc: iccProfile(), comment: 'GPS secrets', adobe: true });
  const info = parseJpeg(bytes);
  const stripped = keep(bytes, info.ranges);
  assert.equal(stripped.length, info.length);
  assert.ok(stripped.length < bytes.length);
  assert.equal(Buffer.from(stripped).includes(Buffer.from(ascii('Exif'))), false);
  assert.equal(Buffer.from(stripped).includes(Buffer.from(ascii('GPS secrets'))), false);
  const reparsed = parseJpeg(stripped);
  assert.equal(reparsed.width, info.width);
  assert.equal(reparsed.orientation, 1);
  assert.equal(reparsed.icc, null);
  assert.equal(reparsed.adobe, true);
  assert.deepEqual([...stripped.subarray(-2)], [0xff, 0xd9]);
});

test('stops at the end of the primary image', () => {
  const trailing = [0, 0, 0, 0x18, ...ascii('ftypmp42'), 0xff, 0xd8, 0xff, 0xd9];
  const bytes = buildJpeg({ trailing });
  const info = parseJpeg(bytes);
  assert.equal(info.ranges[info.ranges.length - 1][1], bytes.length - trailing.length);
});

test('keeps every scan of a progressive image', () => {
  const bytes = buildJpeg({ progressive: true, frameMarker: 0xc2 });
  const info = parseJpeg(bytes);
  assert.equal(info.embeddable, true);
  assert.equal(info.ranges[info.ranges.length - 1][1], bytes.length);
});

test('marks frames PDF readers may not decode as not embeddable', () => {
  assert.equal(parseJpeg(buildJpeg({ precision: 12, frameMarker: 0xc1 })).embeddable, false);
  assert.equal(parseJpeg(buildJpeg({ frameMarker: 0xc3 })).embeddable, false);
  assert.equal(parseJpeg(buildJpeg({ frameMarker: 0xc9 })).embeddable, false);
});

test('rejects data that is not a usable JPEG', () => {
  assert.equal(isJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), false);
  assert.throws(() => parseJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47])));
  assert.throws(() => parseJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xd9])));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPdf, orientationMatrix } from '../src/pdf.js';
import { parseJpeg } from '../src/jpeg.js';
import { buildJpeg, embedFrom, iccProfile } from './fixtures.js';

async function pdfText(blob) {
  return Buffer.from(await blob.arrayBuffer()).toString('latin1');
}

function samplePdf() {
  const profile = iccProfile();
  const images = new Map([
    ['a', embedFrom(buildJpeg({ icc: profile }), parseJpeg)],
    ['b', embedFrom(buildJpeg({ icc: profile, orientation: 6, comment: 'private' }), parseJpeg)],
    ['c', embedFrom(buildJpeg({ components: 1 }), parseJpeg)],
  ]);
  const pages = [
    [
      { id: 'a', x: 10, y: 10, width: 60, height: 80 },
      { id: 'b', x: 74, y: 10, width: 60, height: 80 },
    ],
    [{ id: 'c', x: 10, y: 10, width: 80, height: 60 }],
  ];
  return buildPdf(pages, images, { created: new Date(Date.UTC(2026, 9, 18, 3, 55)) });
}

test('every cross-reference offset points at its object', async () => {
  const pdf = await pdfText(samplePdf());
  assert.ok(pdf.startsWith('%PDF-1.4\n%'));
  const startxref = Number(pdf.match(/startxref\n(\d+)\n%%EOF\n$/)[1]);
  const table = pdf.slice(startxref);
  const [, count] = table.match(/^xref\n0 (\d+)\n/).map(Number);
  const lines = table.split('\n').slice(2, 2 + count);
  assert.equal(lines[0], '0000000000 65535 f ');
  for (let ref = 1; ref < count; ref += 1) {
    assert.match(lines[ref], /^\d{10} 00000 n $/);
    const offset = Number(lines[ref].slice(0, 10));
    assert.equal(pdf.slice(offset, offset + `${ref} 0 obj\n`.length), `${ref} 0 obj\n`);
  }
  assert.match(table, new RegExp(`trailer\\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>`));
});

test('stream lengths match their data', async () => {
  const pdf = await pdfText(samplePdf());
  const streams = [...pdf.matchAll(/\/Length (\d+) >>\nstream\n/g)];
  assert.equal(streams.length, 6);
  for (const match of streams) {
    const start = match.index + match[0].length;
    assert.equal(pdf.slice(start + Number(match[1]), start + Number(match[1]) + 10), '\nendstream');
  }
});

test('shares one ICC profile object and keeps grayscale images gray', async () => {
  const pdf = await pdfText(samplePdf());
  assert.equal(pdf.match(/\/N 3 \/Alternate \/DeviceRGB/g).length, 1);
  assert.equal(pdf.match(/\/ColorSpace \[\/ICCBased 4 0 R\]/g).length, 2);
  assert.match(pdf, /\/ColorSpace \/DeviceGray/);
  assert.match(pdf, /\/Type \/Pages \/Kids \[\d+ 0 R \d+ 0 R\] \/Count 2/);
  assert.equal(pdf.includes('private'), false);
});

test('draws rotated photos with a rotation matrix', async () => {
  const pdf = await pdfText(samplePdf());
  const x = 74 * (72 / 25.4);
  const width = 60 * (72 / 25.4);
  const height = 80 * (72 / 25.4);
  const top = (297 - 10) * (72 / 25.4);
  const fixed = (value) => String(Math.round(value * 1000) / 1000);
  assert.ok(pdf.includes(`q 0 ${fixed(-height)} ${fixed(width)} 0 ${fixed(x)} ${fixed(top)} cm`));
});

test('each EXIF orientation lands the stored corners where viewers show them', () => {
  const x = 10;
  const y = 20;
  const width = 30;
  const height = 40;
  const apply = ([a, b, c, d, e, f], u, v) => [a * u + c * v + e, b * u + d * v + f];
  const corner = (column, row) => [x + column * width, y + (1 - row) * height];
  const storedTopLeft = { 1: [0, 0], 2: [1, 0], 3: [1, 1], 4: [0, 1], 5: [0, 0], 6: [1, 0], 7: [1, 1], 8: [0, 1] };
  const storedTopRight = { 1: [1, 0], 2: [0, 0], 3: [0, 1], 4: [1, 1], 5: [0, 1], 6: [1, 1], 7: [1, 0], 8: [0, 0] };
  for (let orientation = 1; orientation <= 8; orientation += 1) {
    const matrix = orientationMatrix(orientation, x, y, width, height);
    assert.deepEqual(apply(matrix, 0, 1), corner(...storedTopLeft[orientation]), `top-left ${orientation}`);
    assert.deepEqual(apply(matrix, 1, 1), corner(...storedTopRight[orientation]), `top-right ${orientation}`);
  }
});

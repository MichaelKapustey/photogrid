export function ascii(text) {
  return [...text].map((char) => char.charCodeAt(0));
}

export function segment(marker, payload) {
  const length = payload.length + 2;
  return [0xff, marker, length >> 8, length & 0xff, ...payload];
}

export function exifSegment(orientation, littleEndian = true) {
  const u16 = (value) => (littleEndian ? [value & 0xff, value >> 8] : [value >> 8, value & 0xff]);
  const u32 = (value) => {
    const bytes = [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
    return littleEndian ? bytes.reverse() : bytes;
  };
  const tiff = [
    ...(littleEndian ? [0x49, 0x49] : [0x4d, 0x4d]),
    ...u16(42),
    ...u32(8),
    ...u16(1),
    ...u16(0x0112),
    ...u16(3),
    ...u32(1),
    ...u16(orientation),
    0,
    0,
    ...u32(0),
  ];
  return segment(0xe1, [...ascii('Exif\0\0'), ...tiff]);
}

export function iccProfile(space = 'RGB ', size = 200, seed = 7) {
  const profile = Array.from({ length: size }, (_, index) => (index * seed) & 0xff);
  ascii(space).forEach((code, index) => {
    profile[16 + index] = code;
  });
  return profile;
}

export function iccSegments(profile, count, reverse = false) {
  const size = Math.ceil(profile.length / count);
  const segments = Array.from({ length: count }, (_, index) =>
    segment(0xe2, [...ascii('ICC_PROFILE\0'), index + 1, count, ...profile.slice(index * size, (index + 1) * size)]),
  );
  return reverse ? segments.reverse() : segments;
}

export const ENTROPY = [0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56, 0xff, 0xff, 0xd1, 0x78];

export function buildJpeg({
  width = 40,
  height = 30,
  components = 3,
  precision = 8,
  frameMarker = 0xc0,
  orientation,
  littleEndian = true,
  icc,
  iccChunks = 1,
  iccReverse = false,
  adobe = false,
  comment,
  progressive = false,
  trailing = [],
} = {}) {
  const bytes = [0xff, 0xd8];
  bytes.push(...segment(0xe0, [...ascii('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0]));
  if (orientation) bytes.push(...exifSegment(orientation, littleEndian));
  if (icc) iccSegments(icc, iccChunks, iccReverse).forEach((part) => bytes.push(...part));
  if (comment) bytes.push(...segment(0xfe, ascii(comment)));
  if (adobe) bytes.push(...segment(0xee, [...ascii('Adobe'), 0, 100, 0, 0, 0, 0, 0]));
  bytes.push(...segment(0xdb, new Array(65).fill(1)));
  const specs = [];
  for (let index = 1; index <= components; index += 1) specs.push(index, 0x11, 0);
  bytes.push(...segment(frameMarker, [precision, height >> 8, height & 0xff, width >> 8, width & 0xff, components, ...specs]));
  bytes.push(...segment(0xc4, new Array(20).fill(0)));
  const scan = () => {
    const selectors = [];
    for (let index = 1; index <= components; index += 1) selectors.push(index, 0);
    return [...segment(0xda, [components, ...selectors, 0, 63, 0]), ...ENTROPY];
  };
  bytes.push(...scan());
  if (progressive) bytes.push(...segment(0xc4, new Array(20).fill(0)), ...scan());
  bytes.push(0xff, 0xd9, ...trailing);
  return new Uint8Array(bytes);
}

export function embedFrom(bytes, parse) {
  const info = parse(bytes);
  const blob = new Blob([bytes]);
  return { ...info, parts: info.ranges.map(([from, to]) => blob.slice(from, to)) };
}

const EMBEDDABLE_FRAMES = new Set([0xc0, 0xc1, 0xc2]);
const ICC_SIGNATURE = 'ICC_PROFILE\0';
const ICC_SPACES = { 'RGB ': 3, GRAY: 1, CMYK: 4 };

export function isJpeg(bytes) {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

export function parseJpeg(source) {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (!isJpeg(bytes)) throw new Error('Not a JPEG file');
  const info = {
    width: 0,
    height: 0,
    components: 0,
    precision: 0,
    frame: 0,
    orientation: 1,
    adobe: false,
    icc: null,
    ranges: [[0, 2]],
    length: 0,
    embeddable: false,
  };
  const iccChunks = [];
  let orientationFound = false;
  let end = -1;
  let pos = 2;
  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xff) throw new Error('Corrupt JPEG');
    const marker = bytes[pos + 1];
    if (marker === 0xff) {
      pos += 1;
      continue;
    }
    if (marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      pos += 2;
      continue;
    }
    const segmentEnd = pos + 2 + view.getUint16(pos + 2);
    if (segmentEnd <= pos + 3 || segmentEnd > bytes.length) throw new Error('Corrupt JPEG');
    if (marker === 0xda) {
      end = findEndOfImage(bytes, view, segmentEnd);
      info.ranges.push([pos, end]);
      break;
    }
    const start = pos + 4;
    if (isFrameMarker(marker) && segmentEnd - start >= 6) {
      info.frame = marker;
      info.precision = bytes[start];
      info.height = view.getUint16(start + 1);
      info.width = view.getUint16(start + 3);
      info.components = bytes[start + 5];
    } else if (marker === 0xe1 && !orientationFound && hasSignature(bytes, start, segmentEnd, 'Exif\0\0')) {
      const orientation = readOrientation(view, start + 6, segmentEnd);
      if (orientation) {
        info.orientation = orientation;
        orientationFound = true;
      }
    } else if (marker === 0xe2 && hasSignature(bytes, start, segmentEnd, ICC_SIGNATURE)) {
      const offset = start + ICC_SIGNATURE.length;
      if (offset + 2 <= segmentEnd) {
        iccChunks.push({ index: bytes[offset], total: bytes[offset + 1], data: bytes.subarray(offset + 2, segmentEnd) });
      }
    } else if (marker === 0xee && hasSignature(bytes, start, segmentEnd, 'Adobe')) {
      info.adobe = true;
    }
    if (keepSegment(marker)) info.ranges.push([pos, segmentEnd]);
    pos = segmentEnd;
  }
  if (end < 0) throw new Error('JPEG has no image data');
  info.icc = assembleIcc(iccChunks);
  if (info.icc && iccComponents(info.icc) !== info.components) info.icc = null;
  info.ranges = mergeRanges(info.ranges);
  info.length = info.ranges.reduce((sum, [from, to]) => sum + to - from, 0);
  info.embeddable =
    EMBEDDABLE_FRAMES.has(info.frame) &&
    info.precision === 8 &&
    [1, 3, 4].includes(info.components) &&
    info.width > 0 &&
    info.height > 0;
  return info;
}

export function displaySize({ width, height, orientation }) {
  return orientation >= 5 ? { width: height, height: width } : { width, height };
}

export function iccComponents(profile) {
  if (!profile || profile.length < 128) return 0;
  return ICC_SPACES[String.fromCharCode(...profile.subarray(16, 20))] ?? 0;
}

function isFrameMarker(marker) {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function keepSegment(marker) {
  if (marker === 0xfe) return false;
  if (marker >= 0xe0 && marker <= 0xef) return marker === 0xe0 || marker === 0xee;
  return true;
}

function findEndOfImage(bytes, view, start) {
  const last = bytes.length - 1;
  let index = start;
  while (index < last) {
    index = bytes.indexOf(0xff, index);
    if (index < 0 || index >= last) break;
    const next = bytes[index + 1];
    if (next === 0xff) {
      index += 1;
    } else if (next === 0x00 || next === 0x01 || (next >= 0xd0 && next <= 0xd7)) {
      index += 2;
    } else if (next === 0xd9) {
      return index + 2;
    } else if (index + 4 <= bytes.length) {
      index += 2 + view.getUint16(index + 2);
    } else {
      break;
    }
  }
  return bytes.length;
}

function hasSignature(bytes, start, end, signature) {
  if (end - start < signature.length) return false;
  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[start + index] !== signature.charCodeAt(index)) return false;
  }
  return true;
}

function readOrientation(view, tiff, end) {
  if (tiff + 8 > end) return null;
  const order = view.getUint16(tiff);
  const little = order === 0x4949;
  if (!little && order !== 0x4d4d) return null;
  if (view.getUint16(tiff + 2, little) !== 42) return null;
  const directory = tiff + view.getUint32(tiff + 4, little);
  if (directory + 2 > end) return null;
  const count = view.getUint16(directory, little);
  for (let index = 0; index < count; index += 1) {
    const entry = directory + 2 + index * 12;
    if (entry + 12 > end) return null;
    if (view.getUint16(entry, little) === 0x0112) {
      const value = view.getUint16(entry + 8, little);
      return value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}

function assembleIcc(chunks) {
  if (chunks.length === 0) return null;
  const total = chunks[0].total;
  if (chunks.length !== total || chunks.some((chunk) => chunk.total !== total)) return null;
  const ordered = [...chunks].sort((a, b) => a.index - b.index);
  if (ordered.some((chunk, position) => chunk.index !== position + 1)) return null;
  const profile = new Uint8Array(ordered.reduce((sum, chunk) => sum + chunk.data.length, 0));
  let offset = 0;
  for (const chunk of ordered) {
    profile.set(chunk.data, offset);
    offset += chunk.data.length;
  }
  return profile;
}

function mergeRanges(ranges) {
  const merged = [];
  for (const [from, to] of ranges) {
    const previous = merged[merged.length - 1];
    if (previous && previous[1] === from) previous[1] = to;
    else merged.push([from, to]);
  }
  return merged;
}

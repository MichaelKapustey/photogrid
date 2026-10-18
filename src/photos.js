import { createAdjustment } from './adjust.js';
import { displaySize, isJpeg, parseJpeg } from './jpeg.js';

export const MAX_CANVAS_AREA = 16777216;
export const STRIP_OVERLAP = 16;
const STRIP_ALIGN = 16;
const CHUNK_AREA = 1048576;
const THUMBNAIL_EDGE = 640;
const JPEG_QUALITY = 0.95;
const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);
const IMAGE_NAME = /\.(jpe?g|png|webp|avif|gif|bmp|heic|heif)$/i;

export function isImageFile(file) {
  return file.type.startsWith('image/') || IMAGE_NAME.test(file.name);
}

export function planStrips(width, height, maxArea = MAX_CANVAS_AREA) {
  if (width * height <= maxArea) return [{ top: 0, height }];
  const rows = Math.floor((maxArea / width - STRIP_OVERLAP) / STRIP_ALIGN) * STRIP_ALIGN;
  if (rows < STRIP_ALIGN) throw new Error('Image too wide');
  const strips = [];
  for (let start = 0; start < height; start += rows) {
    const top = start === 0 ? 0 : start - STRIP_OVERLAP;
    strips.push({ top, height: Math.min(start + rows, height) - top });
  }
  return strips;
}

export async function probePhoto(file) {
  const jpeg = await readJpeg(file);
  if (jpeg) return { ...displaySize(jpeg), embed: wholeImage(file, jpeg) };
  const size = await naturalSize(file);
  return { width: size?.width ?? 0, height: size?.height ?? 0, embed: null };
}

export async function preparePhoto(file, embed) {
  let source = file;
  let original = embed;
  let image = await decodeImage(file).catch(() => null);
  if (!image) {
    if (original || !(await looksLikeHeif(file))) throw new Error('Unsupported image');
    const { heicToJpeg } = await import('./heic.js');
    source = await heicToJpeg(file);
    original = await jpegEmbed(source);
    image = await decodeImage(source);
  }
  try {
    const result = original ?? (await renderImage(image, null));
    return { width: result.width, height: result.height, embed: result, source, thumbnail: thumbnailPixels(image) };
  } finally {
    releaseImage(image);
  }
}

export async function renderAdjusted(source, amount, signal) {
  const image = await decodeImage(source);
  try {
    return await renderImage(image, createAdjustment(amount), signal);
  } finally {
    releaseImage(image);
  }
}

async function readJpeg(blob) {
  const head = new Uint8Array(await blob.slice(0, 3).arrayBuffer());
  if (!isJpeg(head)) return null;
  try {
    const jpeg = parseJpeg(await blob.arrayBuffer());
    return jpeg.embeddable ? jpeg : null;
  } catch {
    return null;
  }
}

function wholeImage(blob, jpeg) {
  return { ...displaySize(jpeg), pieces: [{ top: 0, height: 1, image: jpegImage(blob, jpeg) }] };
}

function jpegImage(blob, jpeg) {
  const { width, height, components, adobe, icc, orientation, length } = jpeg;
  return {
    width,
    height,
    components,
    adobe,
    icc,
    orientation,
    length,
    parts: jpeg.ranges.map(([from, to]) => blob.slice(from, to)),
  };
}

async function jpegEmbed(blob) {
  const jpeg = await readJpeg(blob);
  if (!jpeg) throw new Error('Conversion failed');
  return wholeImage(blob, jpeg);
}

async function renderImage(image, adjust, signal) {
  const { naturalWidth: width, naturalHeight: height } = image;
  const pieces = [];
  for (const strip of planStrips(width, height)) {
    const blob = await renderStrip(image, width, height, strip, adjust, signal);
    const jpeg = await readJpeg(blob);
    if (!jpeg) throw new Error('Encoding failed');
    pieces.push({ top: strip.top / height, height: strip.height / height, image: jpegImage(blob, jpeg) });
  }
  return { width, height, pieces };
}

async function renderStrip(image, width, height, strip, adjust, signal) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = strip.height;
  try {
    const context = canvas.getContext('2d', { willReadFrequently: Boolean(adjust) });
    if (!context) throw new Error('Canvas unavailable');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, strip.height);
    context.drawImage(image, 0, -strip.top, width, height);
    if (adjust) {
      const rows = Math.max(1, Math.floor(CHUNK_AREA / width));
      for (let top = 0; top < strip.height; top += rows) {
        signal?.throwIfAborted();
        const pixels = context.getImageData(0, top, width, Math.min(rows, strip.height - top));
        adjust(pixels.data);
        context.putImageData(pixels, 0, top);
        await pause();
      }
    }
    signal?.throwIfAborted();
    return await encodeJpeg(canvas);
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

function thumbnailPixels(image) {
  const { naturalWidth, naturalHeight } = image;
  const scale = Math.min(1, THUMBNAIL_EDGE / Math.max(naturalWidth, naturalHeight));
  const width = Math.max(1, Math.round(naturalWidth * scale));
  const height = Math.max(1, Math.round(naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  try {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Canvas unavailable');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, width, height);
    return context.getImageData(0, 0, width, height);
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

function encodeJpeg(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Canvas export failed'))), 'image/jpeg', JPEG_QUALITY);
  });
}

function pause() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function decodeImage(blob) {
  const image = new Image();
  image.src = URL.createObjectURL(blob);
  try {
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('Empty image');
    return image;
  } catch (error) {
    releaseImage(image);
    throw error;
  }
}

function naturalSize(blob) {
  return new Promise((resolve) => {
    const image = new Image();
    const finish = (size) => {
      image.onload = null;
      image.onerror = null;
      releaseImage(image);
      resolve(size);
    };
    image.onload = () => finish(image.naturalWidth && image.naturalHeight ? { width: image.naturalWidth, height: image.naturalHeight } : null);
    image.onerror = () => finish(null);
    image.src = URL.createObjectURL(blob);
  });
}

function releaseImage(image) {
  if (image.src.startsWith('blob:')) URL.revokeObjectURL(image.src);
  image.removeAttribute('src');
}

async function looksLikeHeif(file) {
  if (/\.(heic|heif)$/i.test(file.name) || /^image\/hei[cf]/i.test(file.type)) return true;
  const head = String.fromCharCode(...new Uint8Array(await file.slice(4, 12).arrayBuffer()));
  return head.startsWith('ftyp') && HEIF_BRANDS.has(head.slice(4));
}

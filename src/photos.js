import { displaySize, isJpeg, parseJpeg } from './jpeg.js';

const THUMBNAIL_EDGE = 640;
const SAFE_CANVAS_AREA = 16777216;
const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);
const IMAGE_NAME = /\.(jpe?g|png|webp|avif|gif|bmp|heic|heif)$/i;

export function isImageFile(file) {
  return file.type.startsWith('image/') || IMAGE_NAME.test(file.name);
}

export async function probePhoto(file) {
  const jpeg = await readJpeg(file);
  if (jpeg) return { ...displaySize(jpeg), embed: embedFrom(file, jpeg) };
  const size = await naturalSize(file);
  return { width: size?.width ?? 0, height: size?.height ?? 0, embed: null };
}

export async function preparePhoto(file, embed) {
  const converted = embed ? null : await convertToJpeg(file);
  const source = converted ? converted.embed : embed;
  const image = converted ? converted.image : await decodeImage(file);
  try {
    const thumbnail = await makeThumbnail(image);
    return { ...displaySize(source), embed: source, thumbnail, reduced: converted?.reduced ?? false };
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

function embedFrom(blob, jpeg) {
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

async function convertToJpeg(file) {
  const image = await decodeImage(file).catch(() => null);
  if (image) {
    try {
      const { blob, reduced } = await encodeJpeg(image);
      return { image, embed: await embedJpeg(blob), reduced };
    } catch (error) {
      releaseImage(image);
      throw error;
    }
  }
  if (!(await looksLikeHeif(file))) throw new Error('Unsupported image');
  const { heicToJpeg } = await import('./heic.js');
  const blob = await heicToJpeg(file);
  const embed = await embedJpeg(blob);
  return { image: await decodeImage(blob), embed, reduced: false };
}

async function embedJpeg(blob) {
  const jpeg = await readJpeg(blob);
  if (!jpeg) throw new Error('Conversion failed');
  return embedFrom(blob, jpeg);
}

async function encodeJpeg(image) {
  const { naturalWidth: width, naturalHeight: height } = image;
  for (const area of [width * height, SAFE_CANVAS_AREA]) {
    const scale = Math.min(1, Math.sqrt(area / (width * height)));
    const blob = await render(image, Math.round(width * scale), Math.round(height * scale), 0.95).catch(() => null);
    if (blob) return { blob, reduced: scale < 1 };
  }
  throw new Error('Image too large for this browser');
}

async function makeThumbnail(image) {
  const { naturalWidth: width, naturalHeight: height } = image;
  const scale = Math.min(1, THUMBNAIL_EDGE / Math.max(width, height));
  const blob = await render(image, Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)), 0.85);
  return URL.createObjectURL(blob);
}

async function render(image, width, height, quality) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  try {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, width, height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) throw new Error('Canvas export failed');
    return blob;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
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

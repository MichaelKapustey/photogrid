import { heicTo } from '../vendor/heic-to/heic-to.js';

export function heicToJpeg(blob) {
  return heicTo({ blob, type: 'image/jpeg', quality: 0.95 });
}

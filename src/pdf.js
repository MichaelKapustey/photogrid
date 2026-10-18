import { PAGE } from './layout.js';
import { iccComponents } from './jpeg.js';

const POINTS_PER_MM = 72 / 25.4;
const PAGE_WIDTH = PAGE.width * POINTS_PER_MM;
const PAGE_HEIGHT = PAGE.height * POINTS_PER_MM;
const HEADER = new Uint8Array([...'%PDF-1.4\n%'].map((char) => char.charCodeAt(0)).concat([0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
const DEVICE_SPACES = { 1: 'DeviceGray', 3: 'DeviceRGB', 4: 'DeviceCMYK' };

export function buildPdf(pages, images, { created = new Date() } = {}) {
  const writer = createWriter();
  const used = [...new Set(pages.flat().map((placement) => placement.id))];
  let next = 4;
  const profiles = [];
  const profileRefs = new Map();
  for (const id of used) {
    const { icc } = images.get(id);
    if (!icc) continue;
    let profile = profiles.find((candidate) => sameBytes(candidate.icc, icc));
    if (!profile) {
      profile = { icc, ref: next };
      profiles.push(profile);
      next += 1;
    }
    profileRefs.set(id, profile.ref);
  }
  const imageRefs = new Map();
  for (const id of used) {
    imageRefs.set(id, next);
    next += 1;
  }
  const pageRefs = pages.map((_, index) => next + index * 2);
  next += pages.length * 2;

  writer.write(HEADER);
  writer.object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  writer.object(2, `<< /Type /Pages /Kids [${pageRefs.map((ref) => `${ref} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  writer.object(3, `<< /Producer (PhotoGrid) /CreationDate (D:${pdfDate(created)}) >>`);
  for (const { icc, ref } of profiles) {
    const components = iccComponents(icc);
    writer.stream(ref, `/N ${components} /Alternate /${DEVICE_SPACES[components]}`, [icc], icc.length);
  }
  for (const id of used) {
    const image = images.get(id);
    const colorSpace = profileRefs.has(id) ? `[/ICCBased ${profileRefs.get(id)} 0 R]` : `/${DEVICE_SPACES[image.components]}`;
    const decode = image.components === 4 && image.adobe ? ' /Decode [1 0 1 0 1 0 1 0]' : '';
    writer.stream(
      imageRefs.get(id),
      `/Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace ${colorSpace} /BitsPerComponent 8 /Filter /DCTDecode${decode}`,
      image.parts,
      image.length,
    );
  }
  pages.forEach((placements, index) => {
    const ref = pageRefs[index];
    const ids = [...new Set(placements.map((placement) => placement.id))];
    const xObjects = ids.map((id) => `/Im${imageRefs.get(id)} ${imageRefs.get(id)} 0 R`).join(' ');
    const content = placements.map((placement) => drawCommand(placement, images.get(placement.id), imageRefs.get(placement.id))).join('');
    writer.object(
      ref,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${number(PAGE_WIDTH)} ${number(PAGE_HEIGHT)}] /Resources << /XObject << ${xObjects} >> >> /Contents ${ref + 1} 0 R >>`,
    );
    writer.stream(ref + 1, '', [content], content.length);
  });
  return writer.finish(next);
}

export function orientationMatrix(orientation, x, y, width, height) {
  switch (orientation) {
    case 2:
      return [-width, 0, 0, height, x + width, y];
    case 3:
      return [-width, 0, 0, -height, x + width, y + height];
    case 4:
      return [width, 0, 0, -height, x, y + height];
    case 5:
      return [0, -height, -width, 0, x + width, y + height];
    case 6:
      return [0, -height, width, 0, x, y + height];
    case 7:
      return [0, height, width, 0, x, y];
    case 8:
      return [0, height, -width, 0, x + width, y];
    default:
      return [width, 0, 0, height, x, y];
  }
}

function drawCommand(placement, image, ref) {
  const width = placement.width * POINTS_PER_MM;
  const height = placement.height * POINTS_PER_MM;
  const x = placement.x * POINTS_PER_MM;
  const y = PAGE_HEIGHT - (placement.y + placement.height) * POINTS_PER_MM;
  const matrix = orientationMatrix(image.orientation, x, y, width, height);
  return `q ${matrix.map(number).join(' ')} cm /Im${ref} Do Q\n`;
}

function createWriter() {
  const parts = [];
  const offsets = [];
  let size = 0;
  const write = (part) => {
    parts.push(part);
    size += typeof part === 'string' ? part.length : (part.byteLength ?? part.size);
  };
  return {
    write,
    object(ref, body) {
      offsets[ref] = size;
      write(`${ref} 0 obj\n${body}\nendobj\n`);
    },
    stream(ref, dictionary, data, length) {
      offsets[ref] = size;
      write(`${ref} 0 obj\n<< ${dictionary} /Length ${length} >>\nstream\n`);
      data.forEach(write);
      write('\nendstream\nendobj\n');
    },
    finish(count) {
      const xref = size;
      const entries = offsets.slice(1, count).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`);
      write(`xref\n0 ${count}\n0000000000 65535 f \n${entries.join('')}`);
      write(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
      return new Blob(parts, { type: 'application/pdf' });
    },
  };
}

function number(value) {
  return String(Math.round(value * 1000) / 1000);
}

function pdfDate(date) {
  return `${date.toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z`;
}

function sameBytes(a, b) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

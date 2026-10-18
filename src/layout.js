export const PAGE = Object.freeze({ width: 210, height: 297, margin: 10, gap: 4 });

const usableWidth = PAGE.width - 2 * PAGE.margin;
const usableHeight = PAGE.height - 2 * PAGE.margin;
const EPSILON = 1e-6;

export const BASE_SHORT = (usableWidth - 2 * PAGE.gap) / 3;
export const BASE_LONG = (BASE_SHORT * 4) / 3;

export const SIZE_STEPS = Object.freeze(Array.from({ length: 29 }, (_, index) => (20 + index * 10) / 100));
export const DEFAULT_STEP = SIZE_STEPS.indexOf(1);

export function boxSize(multiplier) {
  return { short: BASE_SHORT * multiplier, long: BASE_LONG * multiplier };
}

export function photoSize(width, height, multiplier) {
  const { short, long } = boxSize(multiplier);
  const portrait = height >= width;
  const scale = Math.min((portrait ? short : long) / width, (portrait ? long : short) / height);
  const fit = Math.min(1, usableWidth / (width * scale), usableHeight / (height * scale));
  return { width: width * scale * fit, height: height * scale * fit };
}

export function orderByOrientation(items) {
  return [...items.filter((item) => item.height >= item.width), ...items.filter((item) => item.height < item.width)];
}

export function layoutPages(items, multiplier, { group = true } = {}) {
  const ordered = group ? orderByOrientation(items) : items;
  const rows = [];
  for (const item of ordered) {
    const size = photoSize(item.width, item.height, multiplier);
    const row = rows[rows.length - 1];
    if (row && row.width + PAGE.gap + size.width <= usableWidth + EPSILON) {
      row.cells.push({ item, size });
      row.width += PAGE.gap + size.width;
      row.height = Math.max(row.height, size.height);
    } else {
      rows.push({ cells: [{ item, size }], width: size.width, height: size.height });
    }
  }
  const pages = [];
  for (const row of rows) {
    const page = pages[pages.length - 1];
    if (page && page.height + PAGE.gap + row.height <= usableHeight + EPSILON) {
      page.rows.push(row);
      page.height += PAGE.gap + row.height;
    } else {
      pages.push({ rows: [row], height: row.height });
    }
  }
  return pages.map(placePage);
}

function placePage(page) {
  const blockWidth = Math.max(...page.rows.map((row) => row.width));
  const left = PAGE.margin + (usableWidth - blockWidth) / 2;
  let top = PAGE.margin;
  const placements = [];
  for (const row of page.rows) {
    let x = left;
    for (const { item, size } of row.cells) {
      placements.push({
        id: item.id,
        x,
        y: top + (row.height - size.height) / 2,
        width: size.width,
        height: size.height,
      });
      x += size.width + PAGE.gap;
    }
    top += row.height + PAGE.gap;
  }
  return placements;
}

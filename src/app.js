import { createAdjustment } from './adjust.js';
import { BASE_LONG, BASE_SHORT, DEFAULT_STEP, PAGE, SIZE_STEPS, layoutPages } from './layout.js';
import { buildPdf } from './pdf.js';
import { isImageFile, preparePhoto, probePhoto, renderAdjusted } from './photos.js';

const $ = (selector) => document.querySelector(selector);
const BOOST_KEY = 'photogrid.boost';
const SETTLE_MS = 600;
const PAINT_BUDGET_MS = 12;

const ui = {
  intro: $('#intro'),
  blank: $('#blank'),
  choose: $('#choose'),
  workspace: $('#workspace'),
  notice: $('#notice'),
  noticeText: $('#notice-text'),
  pages: $('#pages'),
  toolbar: $('#toolbar'),
  summary: $('#summary'),
  boost: $('#boost'),
  boostValue: $('#boost-value'),
  smaller: $('#smaller'),
  larger: $('#larger'),
  percent: $('#size-percent'),
  dimensions: $('#size-dimensions'),
  add: $('#add'),
  download: $('#download'),
  clear: $('#clear'),
  picker: $('#picker'),
};

const state = { photos: [], step: DEFAULT_STEP, boost: readBoost(), notices: [], failed: [], downloaded: false };
const figures = new Map();
const scratch = new Map();
let adjustment = { boost: 0, apply: null };
let nextId = 1;
let working = false;
let workTimer = 0;
let paintFrame = 0;
let boostChangedAt = -Infinity;
let boostRun = new AbortController();
let downloadUrl = null;
let dragDepth = 0;

ui.boost.value = String(state.boost);
drawBlankSheet();
render();

ui.choose.addEventListener('click', openPicker);
ui.add.addEventListener('click', openPicker);
ui.picker.addEventListener('change', () => {
  const files = [...ui.picker.files];
  ui.picker.value = '';
  addFiles(files);
});
ui.clear.addEventListener('click', clearAll);
ui.smaller.addEventListener('click', () => resize(-1));
ui.larger.addEventListener('click', () => resize(1));
ui.boost.addEventListener('input', () => setBoost(Number(ui.boost.value)));
ui.boost.addEventListener('change', () => saveBoost(state.boost));
ui.download.addEventListener('click', download);
ui.pages.addEventListener('click', (event) => {
  const button = event.target.closest('[data-remove]');
  if (button) removePhoto(Number(button.dataset.remove));
});
ui.notice.addEventListener('click', (event) => {
  if (!event.target.closest('[data-dismiss]')) return;
  state.notices = [];
  render();
});

document.addEventListener('dragenter', (event) => {
  if (!carriesFiles(event)) return;
  dragDepth += 1;
  document.body.classList.add('is-dragging');
});
document.addEventListener('dragleave', (event) => {
  if (!carriesFiles(event)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) document.body.classList.remove('is-dragging');
});
document.addEventListener('dragover', (event) => {
  if (carriesFiles(event)) event.preventDefault();
});
document.addEventListener('drop', (event) => {
  if (!carriesFiles(event)) return;
  event.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('is-dragging');
  addFiles([...event.dataTransfer.files]);
});

function openPicker() {
  ui.picker.click();
}

function carriesFiles(event) {
  return [...(event.dataTransfer?.types ?? [])].includes('Files');
}

function addFiles(files) {
  const images = files.filter(isImageFile);
  const ignored = files.filter((file) => !isImageFile(file));
  if (ignored.length) state.notices.push(`${listNames(ignored.map((file) => file.name))} ${ignored.length === 1 ? "isn't a photo" : "aren't photos"}, so ${ignored.length === 1 ? 'it was' : 'they were'} left out.`);
  const photos = images.map((file) => ({ id: nextId++, file, name: file.name, status: 'probing', width: 0, height: 0, embed: null, source: null, thumbnail: null, shownBoost: null, adjusted: null }));
  state.photos.push(...photos);
  state.downloaded = false;
  render();
  work();
}

function work() {
  clearTimeout(workTimer);
  if (working) return;
  working = true;
  runJobs().finally(() => {
    working = false;
  });
}

async function runJobs() {
  for (;;) {
    const job = nextJob();
    if (!job) return;
    if (job.delay) {
      workTimer = setTimeout(work, job.delay);
      return;
    }
    await job.run();
    reportFailures();
    render();
  }
}

function nextJob() {
  const probing = state.photos.find((photo) => photo.status === 'probing');
  if (probing) return { run: () => probe(probing) };
  const pending = state.photos.find((photo) => photo.status === 'pending');
  if (pending) return { run: () => prepare(pending) };
  if (!state.boost) return null;
  const stale = state.photos.find((photo) => photo.status === 'ready' && !photo.adjusted);
  if (!stale) return null;
  const wait = boostChangedAt + SETTLE_MS - performance.now();
  if (wait > 0) return { delay: wait };
  return { run: () => adjust(stale, state.boost, boostRun.signal) };
}

async function probe(photo) {
  const result = await probePhoto(photo.file).catch(() => ({}));
  if (photo.removed) return;
  Object.assign(photo, result, { status: 'pending' });
}

async function prepare(photo) {
  try {
    const prepared = await preparePhoto(photo.file, photo.embed);
    if (photo.removed) return;
    Object.assign(photo, prepared, { status: 'ready', shownBoost: null });
  } catch {
    if (photo.removed) return;
    state.failed.push(photo.name);
    dropPhoto(photo);
  }
}

async function adjust(photo, boost, signal) {
  let embed = null;
  try {
    embed = await renderAdjusted(photo.source, boost / 100, signal);
  } catch {
    if (signal.aborted) return;
  }
  if (photo.removed || boost !== state.boost) return;
  if (!embed) state.notices.push(`Couldn't adjust the colors of ${photo.name}, so it will print as it is.`);
  photo.adjusted = { embed: embed ?? photo.embed };
}

function reportFailures() {
  if (!state.failed.length || state.photos.some((photo) => photo.status !== 'ready')) return;
  state.notices.push(`Couldn't open ${listNames(state.failed)}. PhotoGrid reads JPEG, PNG, HEIC and WebP photos.`);
  state.failed = [];
}

function setBoost(value) {
  if (value === state.boost) return;
  state.boost = value;
  boostChangedAt = performance.now();
  boostRun.abort();
  boostRun = new AbortController();
  state.downloaded = false;
  for (const photo of state.photos) photo.adjusted = null;
  render();
  schedulePaint();
  work();
}

function readBoost() {
  try {
    const value = Number(localStorage.getItem(BOOST_KEY));
    return Number.isInteger(value) && value >= 0 && value <= 100 && value % 5 === 0 ? value : 0;
  } catch {
    return 0;
  }
}

function saveBoost(value) {
  try {
    localStorage.setItem(BOOST_KEY, String(value));
  } catch {
    return;
  }
}

function removePhoto(id) {
  const photo = state.photos.find((candidate) => candidate.id === id);
  if (!photo) return;
  dropPhoto(photo);
  state.downloaded = false;
  render();
}

function dropPhoto(photo) {
  photo.removed = true;
  photo.thumbnail = null;
  photo.adjusted = null;
  state.photos = state.photos.filter((candidate) => candidate !== photo);
  figures.get(photo.id)?.remove();
  figures.delete(photo.id);
}

function clearAll() {
  [...state.photos].forEach(dropPhoto);
  state.notices = [];
  state.failed = [];
  state.downloaded = false;
  scratch.clear();
  ui.pages.replaceChildren();
  render();
  ui.choose.focus();
}

function resize(delta) {
  state.step = Math.min(SIZE_STEPS.length - 1, Math.max(0, state.step + delta));
  state.downloaded = false;
  render();
}

function canDownload() {
  return state.photos.length > 0 && state.photos.every((photo) => photo.status === 'ready' && (!state.boost || photo.adjusted));
}

function download() {
  if (!canDownload()) return;
  const pages = layoutPages(state.photos, SIZE_STEPS[state.step]);
  const embeds = new Map(state.photos.map((photo) => [photo.id, state.boost ? photo.adjusted.embed : photo.embed]));
  const pdf = buildPdf(pages, embeds);
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = URL.createObjectURL(pdf);
  const link = document.createElement('a');
  link.href = downloadUrl;
  link.download = 'photogrid.pdf';
  document.body.append(link);
  link.click();
  link.remove();
  state.downloaded = true;
  render();
}

function render() {
  const hasPhotos = state.photos.length > 0;
  ui.intro.hidden = hasPhotos;
  ui.workspace.hidden = !hasPhotos;
  ui.toolbar.hidden = !hasPhotos;
  ui.clear.hidden = !hasPhotos;
  const multiplier = SIZE_STEPS[state.step];
  const placed = state.photos.filter((photo) => photo.width > 0 && photo.height > 0);
  const pages = layoutPages(placed, multiplier);
  renderPages(pages);
  renderControls(pages, multiplier);
  ui.notice.hidden = state.notices.length === 0;
  ui.noticeText.textContent = state.notices.join(' ');
}

function renderPages(pages) {
  const sheets = [...ui.pages.children];
  while (sheets.length < pages.length) {
    const sheet = createSheet();
    ui.pages.append(sheet);
    sheets.push(sheet);
  }
  while (sheets.length > pages.length) sheets.pop().remove();
  const shown = new Set();
  pages.forEach((placements, index) => {
    const sheet = sheets[index];
    const paper = sheet.querySelector('.paper');
    const label = sheet.querySelector('.page-number');
    label.hidden = pages.length < 2;
    label.textContent = `Page ${index + 1} of ${pages.length}`;
    for (const placement of placements) {
      const photo = state.photos.find((candidate) => candidate.id === placement.id);
      const figure = figureFor(photo);
      shown.add(photo.id);
      position(figure, placement);
      if (figure.parentElement !== paper) paper.append(figure);
      if (photo.thumbnail && !figure.querySelector('canvas')) {
        const canvas = document.createElement('canvas');
        canvas.width = photo.thumbnail.width;
        canvas.height = photo.thumbnail.height;
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', photo.name);
        figure.prepend(canvas);
        paintPhoto(photo);
      }
      figure.classList.toggle('is-loading', !photo.thumbnail);
    }
  });
  for (const [id, figure] of figures) {
    if (!shown.has(id)) figure.remove();
  }
}

function renderControls(pages, multiplier) {
  const total = state.photos.length;
  const ready = state.photos.filter((photo) => photo.status === 'ready').length;
  const adjusted = state.boost ? state.photos.filter((photo) => photo.adjusted).length : total;
  ui.percent.textContent = `${Math.round(multiplier * 100)}%`;
  ui.dimensions.textContent = `${Math.round(BASE_SHORT * multiplier)} × ${Math.round(BASE_LONG * multiplier)} mm`;
  ui.smaller.disabled = state.step === 0;
  ui.larger.disabled = state.step === SIZE_STEPS.length - 1;
  const boostText = state.boost ? String(state.boost) : 'Off';
  ui.boostValue.textContent = boostText;
  ui.boost.setAttribute('aria-valuetext', boostText);
  ui.boost.style.setProperty('--ratio', String(state.boost / 100));
  ui.download.disabled = !canDownload();
  if (ready < total) ui.summary.textContent = `Preparing photos: ${ready} of ${total} ready`;
  else if (adjusted < total) ui.summary.textContent = `Adjusting colors: ${adjusted} of ${total}`;
  else if (state.downloaded) ui.summary.textContent = 'PDF created. Print it at 100% scale to keep these sizes.';
  else ui.summary.textContent = `${count(total, 'photo')} on ${count(pages.length, 'page')}`;
}

function schedulePaint() {
  if (!paintFrame) paintFrame = requestAnimationFrame(paint);
}

function paint() {
  paintFrame = 0;
  const deadline = performance.now() + PAINT_BUDGET_MS;
  for (const photo of state.photos) {
    if (!photo.thumbnail || photo.shownBoost === state.boost) continue;
    paintPhoto(photo);
    if (performance.now() > deadline) {
      schedulePaint();
      return;
    }
  }
}

function paintPhoto(photo) {
  const canvas = figures.get(photo.id)?.querySelector('canvas');
  if (!canvas || !photo.thumbnail) return;
  const { thumbnail } = photo;
  const apply = adjustmentFor(state.boost);
  let pixels = thumbnail;
  if (apply) {
    pixels = scratchFor(thumbnail.width, thumbnail.height);
    apply(thumbnail.data, pixels.data);
  }
  canvas.getContext('2d').putImageData(pixels, 0, 0);
  photo.shownBoost = state.boost;
}

function adjustmentFor(boost) {
  if (adjustment.boost !== boost) adjustment = { boost, apply: createAdjustment(boost / 100) };
  return adjustment.apply;
}

function scratchFor(width, height) {
  const key = `${width}x${height}`;
  let pixels = scratch.get(key);
  if (!pixels) {
    pixels = new ImageData(width, height);
    scratch.set(key, pixels);
  }
  return pixels;
}

function createSheet() {
  const sheet = document.createElement('section');
  sheet.className = 'sheet';
  const paper = document.createElement('div');
  paper.className = 'paper';
  const label = document.createElement('p');
  label.className = 'page-number';
  sheet.append(paper, label);
  return sheet;
}

function figureFor(photo) {
  let figure = figures.get(photo.id);
  if (!figure) {
    figure = document.createElement('figure');
    figure.className = 'photo';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove';
    remove.dataset.remove = String(photo.id);
    remove.setAttribute('aria-label', `Remove ${photo.name}`);
    remove.textContent = '×';
    figure.append(remove);
    figures.set(photo.id, figure);
  }
  return figure;
}

function drawBlankSheet() {
  const slots = layoutPages(Array.from({ length: 9 }, (_, id) => ({ id, width: 3, height: 4 })), 1)[0];
  for (const slot of slots) {
    const element = document.createElement('span');
    element.className = 'slot';
    position(element, slot);
    ui.blank.append(element);
  }
}

function position(element, { x, y, width, height }) {
  element.style.left = `${(x / PAGE.width) * 100}%`;
  element.style.top = `${(y / PAGE.height) * 100}%`;
  element.style.width = `${(width / PAGE.width) * 100}%`;
  element.style.height = `${(height / PAGE.height) * 100}%`;
}

function count(value, noun) {
  return `${value} ${noun}${value === 1 ? '' : 's'}`;
}

function listNames(names) {
  if (names.length === 1) return names[0];
  if (names.length <= 3) return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
}

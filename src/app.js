import { BASE_LONG, BASE_SHORT, DEFAULT_STEP, PAGE, SIZE_STEPS, layoutPages } from './layout.js';
import { buildPdf } from './pdf.js';
import { isImageFile, preparePhoto, probePhoto } from './photos.js';

const $ = (selector) => document.querySelector(selector);

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
  smaller: $('#smaller'),
  larger: $('#larger'),
  percent: $('#size-percent'),
  dimensions: $('#size-dimensions'),
  add: $('#add'),
  download: $('#download'),
  clear: $('#clear'),
  picker: $('#picker'),
};

const state = { photos: [], step: DEFAULT_STEP, notices: [], downloaded: false };
const figures = new Map();
let nextId = 1;
let queue = Promise.resolve();
let downloadUrl = null;
let dragDepth = 0;

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
  const photos = images.map((file) => ({ id: nextId++, file, name: file.name, status: 'probing', width: 0, height: 0, embed: null, thumbnail: null }));
  state.photos.push(...photos);
  state.downloaded = false;
  render();
  if (photos.length) queue = queue.then(() => processPhotos(photos));
}

async function processPhotos(photos) {
  for (const photo of photos) {
    if (photo.removed) continue;
    Object.assign(photo, await probePhoto(photo.file).catch(() => ({})));
    photo.status = 'pending';
    render();
  }
  const failed = [];
  const reduced = [];
  for (const photo of photos) {
    if (photo.removed) continue;
    try {
      const prepared = await preparePhoto(photo.file, photo.embed);
      if (photo.removed) {
        URL.revokeObjectURL(prepared.thumbnail);
        continue;
      }
      Object.assign(photo, prepared, { status: 'ready' });
      if (prepared.reduced) reduced.push(photo.name);
    } catch {
      failed.push(photo.name);
      dropPhoto(photo);
    }
    render();
  }
  if (failed.length) state.notices.push(`Couldn't open ${listNames(failed)}. PhotoGrid reads JPEG, PNG, HEIC and WebP photos.`);
  if (reduced.length) {
    const one = reduced.length === 1;
    state.notices.push(`${listNames(reduced)} ${one ? 'was' : 'were'} too large for this browser, so ${one ? 'it was' : 'they were'} scaled down to fit.`);
  }
  render();
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
  state.photos = state.photos.filter((candidate) => candidate !== photo);
  if (photo.thumbnail) URL.revokeObjectURL(photo.thumbnail);
  figures.get(photo.id)?.remove();
  figures.delete(photo.id);
}

function clearAll() {
  [...state.photos].forEach(dropPhoto);
  state.notices = [];
  state.downloaded = false;
  ui.pages.replaceChildren();
  render();
  ui.choose.focus();
}

function resize(delta) {
  state.step = Math.min(SIZE_STEPS.length - 1, Math.max(0, state.step + delta));
  state.downloaded = false;
  render();
}

function download() {
  const ready = state.photos.filter((photo) => photo.status === 'ready');
  if (ready.length === 0 || ready.length !== state.photos.length) return;
  const pages = layoutPages(ready, SIZE_STEPS[state.step]);
  const pdf = buildPdf(pages, new Map(ready.map((photo) => [photo.id, photo.embed])));
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
      if (photo.thumbnail && !figure.querySelector('img')) {
        const image = document.createElement('img');
        image.alt = photo.name;
        image.src = photo.thumbnail;
        figure.prepend(image);
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
  ui.percent.textContent = `${Math.round(multiplier * 100)}%`;
  ui.dimensions.textContent = `${Math.round(BASE_SHORT * multiplier)} × ${Math.round(BASE_LONG * multiplier)} mm`;
  ui.smaller.disabled = state.step === 0;
  ui.larger.disabled = state.step === SIZE_STEPS.length - 1;
  ui.download.disabled = total === 0 || ready < total;
  if (ready < total) ui.summary.textContent = `Preparing photos: ${ready} of ${total} ready`;
  else if (state.downloaded) ui.summary.textContent = 'PDF created. Print it at 100% scale to keep these sizes.';
  else ui.summary.textContent = `${count(total, 'photo')} on ${count(pages.length, 'page')}`;
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

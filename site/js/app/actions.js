// Everything that leaves the page: downloads, clipboard, share, print, batch and the settings
// link. Each works from the last rendered code.

import { encode } from '../qr/encode.js';
import { toText } from '../render/text.js';
import { makeZip } from '../io/zip.js';
import { download, slug } from '../io/download.js';
import { serialize, defaultState, coerce, STYLE, MAX_TEXT, MAX_FRAGMENT } from './state.js';
import { inspectUrl } from '../payload/inspect.js';
import { current, render, sync, saveStyle } from './ui.js';
import { encodeOptions, widthMm } from './model.js';
import { pngBlob, svgText, filename } from './export.js';
import { bumpCount, resetCount } from './counter.js';
import { $, clear } from './dom.js';

const MAX_BATCH = 200;
const COPY_PIXELS = 1024;
const BATCH_PIXELS = 512;

function status(id, text) {
  $(id).textContent = text;
  if (text)
    setTimeout(() => {
      if ($(id).textContent === text)
        $(id).textContent = '';
    }, 4000);
}

function nothingYet() {
  status('take-status', 'Nothing to save yet. Type something in 01.');
}

// `pixels` is remembered as the size Ctrl+S and the phone bar reuse.
async function savePng(state, pixels = state.style.size, button = null) {
  const { code } = current();
  if (!code) {
    nothingYet();
    return;
  }
  const total = code.size + 2 * state.style.quiet;
  if (pixels < total) {
    status('take-status', `This code is ${total} squares across, so the PNG needs at least ${total} px.`);
    return;
  }
  state.style.size = pixels;
  saveStyle(state);
  if (button && !button.dataset.busy) {
    button.dataset.busy = button.textContent;
    button.setAttribute('aria-disabled', 'true');
    button.textContent = 'Rendering…';
  }
  await new Promise(resolve => requestAnimationFrame(resolve));
  try {
    const name = filename(state, 'png');
    const { blob, drawn } = await pngBlob(state, code, pixels);
    download(blob, name);
    bumpCount();
    status('take-status', `Saved ${name} (${drawn} px).`);
    $('announce').textContent = `Saved ${name}.`;
  } catch (err) {
    $('error').textContent = err.message;
  } finally {
    if (button && button.dataset.busy) {
      button.textContent = button.dataset.busy;
      delete button.dataset.busy;
      button.removeAttribute('aria-disabled');
    }
  }
}

function saveSvg(state) {
  const { code } = current();
  if (!code)
    return;
  const name = filename(state, 'svg');
  download(new Blob([svgText(state, code)], { type: 'image/svg+xml' }), name);
  bumpCount();
  status('take-status', `Saved ${name}.`);
}

async function copyImage(state) {
  const { code } = current();
  if (!code) {
    nothingYet();
    return;
  }
  if (!('ClipboardItem' in window)) {
    // Older browsers take text only; the SVG source is the next best thing.
    try {
      await navigator.clipboard.writeText(svgText(state, code));
      bumpCount();
      status('take-status', 'This browser cannot copy images, so the SVG text was copied instead.');
    } catch {
      status('take-status', 'Copying is blocked here. Download instead.');
    }
    return;
  }
  try {
    // Safari only allows the write inside the click, so the blob goes in as a promise.
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob(state, code, COPY_PIXELS).then(r => r.blob) })]);
    bumpCount();
    status('take-status', 'Image copied.');
  } catch {
    status('take-status', 'Copying is blocked here. Download instead.');
  }
}

async function copyText(state) {
  const { code } = current();
  if (!code)
    return;
  try {
    await navigator.clipboard.writeText(toText(code, state.style.quiet));
    bumpCount();
    status('link-status', 'Copied as text blocks. Paste into a terminal or chat with a monospace font.');
  } catch {
    status('link-status', 'Copying is blocked here.');
  }
}

async function share(state) {
  const { code } = current();
  if (!code || !navigator.share)
    return;
  const { blob } = await pngBlob(state, code, COPY_PIXELS);
  const file = new File([blob], filename(state, 'png'), { type: 'image/png' });
  const data = { files: [file], title: state.style.caption || 'QR code' };
  try {
    if (navigator.canShare && !navigator.canShare(data))
      throw new Error('cannot share files');
    await navigator.share(data);
    bumpCount();
  } catch (err) {
    if (err.name !== 'AbortError')
      status('take-status', 'Sharing files is not available here. Download instead.');
  }
}

// The print sheet holds an inline SVG at the chosen physical size, the caption, and for Wi-Fi
// the network details in large type for the guest whose camera will not cooperate.
function print(state) {
  const { code, type } = current();
  if (!code) {
    nothingYet();
    return;
  }
  const area = $('print-area');
  clear(area);
  // The same SVG the download makes, parsed as a document; it holds only numbers, checked
  // colours, an escaped title and the page's own data URL.
  const parsed = new DOMParser().parseFromString(svgText(state, code), 'image/svg+xml');
  if (parsed.querySelector('parsererror')) {
    $('error').textContent = 'The print sheet could not be built. Try a plainer caption.';
    return;
  }
  const svg = document.importNode(parsed.documentElement, true);
  const size = `${widthMm(state)}mm`;
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  area.append(svg);
  if (state.style.caption) {
    const caption = document.createElement('p');
    caption.className = 'caption';
    caption.textContent = state.style.caption;
    area.append(caption);
  }
  if (type === 'wifi') {
    const card = document.createElement('dl');
    card.className = 'card';
    const f = state.fields.wifi;
    const rows = [['Network', f.ssid]];
    if (f.security !== 'nopass')
      rows.push(['Password', f.password]);
    for (const [term, value] of rows) {
      const dt = document.createElement('dt');
      dt.textContent = term;
      const dd = document.createElement('dd');
      dd.textContent = value;
      card.append(dt, dd);
    }
    area.append(card);
  }
  if (widthMm(state) > 186)
    status('take-status', 'Wider than an A4 or Letter page: the browser may shrink or clip it.');
  window.print();
  bumpCount();
}

async function batch(state, format) {
  const lines = $('batch-text').value.split(/\r?\n/)
    .map((text, index) => ({ text: text.trim(), line: index + 1 }))
    .filter(entry => entry.text !== '');
  if (lines.length === 0) {
    status('batch-status', 'Nothing to make: the box is empty.');
    return;
  }
  if (lines.length > MAX_BATCH) {
    status('batch-status', `Up to ${MAX_BATCH} lines at a time; this has ${lines.length}.`);
    return;
  }
  const files = [];
  const skipped = [];
  const buttons = [$('batch-png'), $('batch-svg')];
  for (const button of buttons)
    button.disabled = true;
  try {
    await makeBatch(state, format, lines, files, skipped);
  } finally {
    for (const button of buttons)
      button.disabled = false;
  }
  if (files.length > 0) {
    download(makeZip(files), 'qr-codes.zip');
    bumpCount(files.length);
  }
  const made = `${files.length} ${files.length === 1 ? 'code' : 'codes'}`;
  status('batch-status', skipped.length ? `Done: ${made}. Lines ${skipped.join(', ')} were too long or were script links, and were skipped.` : `Done: ${made}.`);
}

async function makeBatch(state, format, lines, files, skipped) {
  const used = new Set();
  for (let i = 0; i < lines.length; i++) {
    const { text, line } = lines[i];
    $('batch-status').textContent = `Making ${i + 1} of ${lines.length}…`;
    // A short yield every few codes keeps the progress text painting.
    if (i % 8 === 0)
      await new Promise(resolve => setTimeout(resolve, 0));
    let code;
    try {
      if (text.length > MAX_TEXT || inspectUrl(text).some(f => f.level === 'block'))
        throw new RangeError('refused');
      code = encode(text, encodeOptions(state));
    } catch {
      skipped.push(line);
      continue;
    }
    let name = `${String(line).padStart(3, '0')}-${slug(text)}`;
    while (used.has(name))
      name += '-';
    used.add(name);
    if (format === 'svg') {
      files.push({ name: `${name}.svg`, data: new TextEncoder().encode(svgText(state, code)) });
    } else {
      const { blob } = await pngBlob(state, code, BATCH_PIXELS);
      files.push({ name: `${name}.png`, data: new Uint8Array(await blob.arrayBuffer()) });
    }
  }
}

async function copyLink(state) {
  const content = $('link-content').checked;
  const fragment = serialize(state, { content });
  if (fragment.length > MAX_FRAGMENT) {
    status('link-status', 'The content is too long to fit in a link. Share the image instead.');
    return;
  }
  const link = `${location.origin}${location.pathname}#${fragment}`;
  try {
    await navigator.clipboard.writeText(link);
    status('link-status', content
      ? 'Link copied. It holds the content and the caption as well as colours, border and print size, so share it with care. A logo does not travel in links.'
      : 'Link copied. It holds colours, border and print size; the content and caption stay here. A logo does not travel in links.');
  } catch {
    status('link-status', 'Copying is blocked here.');
  }
}

function forget(state) {
  try {
    localStorage.removeItem('qr-settings');
  } catch {
    // nothing stored
  }
  state.style = defaultState().style;
  resetCount();
  history.replaceState(null, '', location.pathname);
  sync(state);
  render(state);
  status('forget-status', 'Settings and the count forgotten.');
}

// On a phone the bar's last button jumps to whichever of the code and the form is off screen.
function bindPhoneBar(state) {
  const figure = $('preview').parentElement;
  let codeVisible = false;
  new IntersectionObserver(entries => {
    codeVisible = entries[0].isIntersecting;
    $('bar-top').textContent = codeVisible ? 'Edit' : 'See code';
  }, { threshold: 0.6, rootMargin: '0px 0px -80px 0px' }).observe(figure);
  $('bar-top').addEventListener('click', () => {
    const target = codeVisible ? $('types') : figure;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('bar-save').addEventListener('click', () => savePng(state, state.style.size, $('bar-save')));
}

export function bindActions(state) {
  for (const button of document.querySelectorAll('[data-png-size]'))
    button.addEventListener('click', () => savePng(state, Number(button.dataset.pngSize), button));
  $('download-custom').addEventListener('click', () => {
    const pixels = coerce(STYLE.size, $('custom-size').value);
    if (pixels === undefined) {
      status('take-status', 'Custom size: a whole number from 64 to 4096.');
      return;
    }
    $('custom-size').value = pixels;
    savePng(state, pixels, $('download-custom'));
  });
  $('download-svg').addEventListener('click', () => saveSvg(state));
  $('copy-image').addEventListener('click', () => copyImage(state));
  $('copy-text').addEventListener('click', () => copyText(state));
  $('print').addEventListener('click', () => print(state));
  window.addEventListener('afterprint', () => clear($('print-area')));
  $('batch-png').addEventListener('click', () => batch(state, 'png'));
  $('batch-svg').addEventListener('click', () => batch(state, 'svg'));
  $('copy-link').addEventListener('click', () => copyLink(state));
  $('forget').addEventListener('click', () => forget(state));
  $('about-open').addEventListener('click', () => {
    const about = $('about');
    about.open = true;
    about.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  bindPhoneBar(state);
  if (navigator.share) {
    for (const id of ['share', 'bar-share']) {
      $(id).hidden = false;
      $(id).addEventListener('click', () => share(state));
    }
  }
  document.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey))
      return;
    const key = e.key.toLowerCase();
    if (key === 's') {
      e.preventDefault();
      savePng(state);
    } else if (key === 'p') {
      e.preventDefault();
      print(state);
    } else if (key === 'c' && e.shiftKey) {
      e.preventDefault();
      copyImage(state);
    }
  });
}

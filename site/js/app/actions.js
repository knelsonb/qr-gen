// Everything that leaves the page: downloads, clipboard, share, print, batch and the settings
// link. Each works from the last rendered code.

import { encode } from '../qr/encode.js';
import { drawCode, toPngBlob } from '../render/canvas.js';
import { toSvg, modulePath, checkColour } from '../render/svg.js';
import { toText } from '../render/text.js';
import { withDpi } from '../io/png.js';
import { makeZip } from '../io/zip.js';
import { download, slug } from '../io/download.js';
import { serialize, defaultState } from './state.js';
import { current, describe, render, sync, effectiveLevel } from './ui.js';

const $ = id => document.getElementById(id);
const MAX_BATCH = 200;

function status(id, text) {
  $(id).textContent = text;
  if (text)
    setTimeout(() => {
      if ($(id).textContent === text)
        $(id).textContent = '';
    }, 4000);
}

function filename(state, extension) {
  return `${slug(state.style.caption || describe(state))}.${extension}`;
}

function styleOptions(state) {
  return {
    quiet: state.style.quiet,
    dark: state.style.dark,
    light: state.style.light,
    rounded: state.style.rounded,
  };
}

function widthMm(state) {
  if (state.style.unit === 'mm') return state.style.physical;
  if (state.style.unit === 'in') return state.style.physical * 25.4;
  return null;
}

// A PNG of the code at a whole number of pixels per module, no larger than `pixels` across.
async function pngBlob(state, code, pixels) {
  const canvas = document.createElement('canvas');
  const total = code.size + 2 * state.style.quiet;
  const drawn = drawCode(canvas, code, {
    ...styleOptions(state),
    pixelsPerModule: Math.max(1, Math.floor(pixels / total)),
    logo: state.logo ? { image: state.logo.image, fraction: state.style.logoFraction } : null,
  });
  const blob = await toPngBlob(canvas);
  const mm = widthMm(state);
  if (mm === null)
    return blob;
  const dpi = drawn / (mm / 25.4);
  return new Blob([withDpi(await blob.arrayBuffer(), dpi)], { type: 'image/png' });
}

function svgText(state, code) {
  return toSvg(code, {
    ...styleOptions(state),
    title: state.style.caption || `QR code: ${describe(state)}`,
    widthMm: widthMm(state),
    pixelsPerModule: 10,
    logo: state.logo ? { dataUrl: state.logo.dataUrl, fraction: state.style.logoFraction } : null,
  });
}

async function savePng(state) {
  const { code } = current();
  if (!code)
    return;
  const button = $('download-png');
  button.disabled = true;
  button.textContent = 'Rendering…';
  await new Promise(resolve => requestAnimationFrame(resolve));
  try {
    download(await pngBlob(state, code, state.style.size), filename(state, 'png'));
  } catch (err) {
    $('error').textContent = err.message;
  } finally {
    button.disabled = false;
    button.textContent = 'Download PNG';
  }
}

function saveSvg(state) {
  const { code } = current();
  if (code)
    download(new Blob([svgText(state, code)], { type: 'image/svg+xml' }), filename(state, 'svg'));
}

async function copyImage(state) {
  const { code } = current();
  if (!code)
    return;
  try {
    if (!('ClipboardItem' in window))
      throw new Error('no ClipboardItem');
    const blob = await pngBlob(state, code, 1024);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    status('link-status', 'Image copied.');
  } catch {
    try {
      await navigator.clipboard.writeText(svgText(state, code));
      status('link-status', 'This browser cannot copy images, so the SVG text was copied instead.');
    } catch {
      status('link-status', 'Copying is blocked here. Download instead.');
    }
  }
}

async function copyText() {
  const { code } = current();
  if (!code)
    return;
  try {
    await navigator.clipboard.writeText(toText(code));
    status('link-status', 'Copied as text blocks. Paste into a terminal or chat with a monospace font.');
  } catch {
    status('link-status', 'Copying is blocked here.');
  }
}

async function share(state) {
  const { code } = current();
  if (!code || !navigator.share)
    return;
  const file = new File([await pngBlob(state, code, 1024)], filename(state, 'png'), { type: 'image/png' });
  const data = { files: [file], title: state.style.caption || 'QR code' };
  try {
    if (navigator.canShare && !navigator.canShare(data))
      throw new Error('cannot share files');
    await navigator.share(data);
  } catch (err) {
    if (err.name !== 'AbortError')
      status('link-status', 'Sharing files is not available here. Download instead.');
  }
}

// The print sheet holds an inline SVG at the chosen physical size, the caption, and for Wi-Fi
// the network details in large type for the guest whose camera will not cooperate.
function print(state) {
  const { code, type } = current();
  if (!code)
    return;
  const area = $('print-area');
  while (area.firstChild)
    area.removeChild(area.firstChild);
  const total = code.size + 2 * state.style.quiet;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${total} ${total}`);
  const size = `${widthMm(state) ?? 50}mm`;
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('shape-rendering', 'crispEdges');
  const background = document.createElementNS(ns, 'rect');
  background.setAttribute('width', total);
  background.setAttribute('height', total);
  background.setAttribute('fill', checkColour(state.style.light));
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', modulePath(code, state.style.quiet, state.style.rounded));
  path.setAttribute('fill', checkColour(state.style.dark));
  svg.append(background, path);
  if (state.logo) {
    const side = code.size * state.style.logoFraction;
    const at = (total - side) / 2;
    const pad = document.createElementNS(ns, 'rect');
    for (const [k, v] of [['x', at], ['y', at], ['width', side], ['height', side], ['fill', checkColour(state.style.light)]])
      pad.setAttribute(k, v);
    const image = document.createElementNS(ns, 'image');
    for (const [k, v] of [['href', state.logo.dataUrl], ['x', at], ['y', at], ['width', side], ['height', side], ['preserveAspectRatio', 'xMidYMid meet']])
      image.setAttribute(k, v);
    svg.append(pad, image);
  }
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
  window.print();
}

async function batch(state, format) {
  const lines = $('batch-text').value.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
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
  const used = new Set();
  for (let i = 0; i < lines.length; i++) {
    $('batch-status').textContent = `Making ${i + 1} of ${lines.length}…`;
    if (i % 8 === 0)
      await new Promise(resolve => setTimeout(resolve, 0));
    let code;
    try {
      code = encode(lines[i], { ecLevel: effectiveLevel(state), boostEc: state.style.boost, eci: state.style.eci });
    } catch {
      skipped.push(i + 1);
      continue;
    }
    let name = `${String(i + 1).padStart(3, '0')}-${slug(lines[i])}`;
    while (used.has(name))
      name += '-';
    used.add(name);
    if (format === 'svg') {
      files.push({ name: `${name}.svg`, data: new TextEncoder().encode(toSvg(code, { ...styleOptions(state), pixelsPerModule: 10, widthMm: widthMm(state) })) });
    } else {
      const blob = await pngBlob(state, code, 512);
      files.push({ name: `${name}.png`, data: new Uint8Array(await blob.arrayBuffer()) });
    }
  }
  download(makeZip(files), 'qr-codes.zip');
  status('batch-status', skipped.length ? `Done. Lines ${skipped.join(', ')} were too long and were skipped.` : `Done: ${files.length} codes.`);
}

async function copyLink(state) {
  const content = $('link-content').checked;
  const link = `${location.origin}${location.pathname}#${serialize(state, { content })}`;
  try {
    await navigator.clipboard.writeText(link);
    status('link-status', content ? 'Link copied. It carries the content, so share it with care.' : 'Link copied. It carries the style only.');
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
  sync(state);
  render(state);
  status('link-status', 'Settings forgotten.');
}

export function bindActions(state) {
  $('download-png').addEventListener('click', () => savePng(state));
  $('bar-save').addEventListener('click', () => savePng(state));
  $('download-svg').addEventListener('click', () => saveSvg(state));
  $('copy-image').addEventListener('click', () => copyImage(state));
  $('copy-text').addEventListener('click', copyText);
  $('print').addEventListener('click', () => print(state));
  $('batch-png').addEventListener('click', () => batch(state, 'png'));
  $('batch-svg').addEventListener('click', () => batch(state, 'svg'));
  $('copy-link').addEventListener('click', () => copyLink(state));
  $('forget').addEventListener('click', () => forget(state));
  $('bar-top').addEventListener('click', () => {
    const first = document.querySelector(`fieldset[data-type="${state.type}"] input, fieldset[data-type="${state.type}"] textarea`);
    (first ?? $('types')).scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (first)
      first.focus({ preventScroll: true });
  });
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

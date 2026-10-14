// Logos for the middle of a code: a file the visitor chose, a built-in icon, or a few letters,
// each as a small canvas plus a data URL for the SVG export. Files are typed by content, capped
// before decoding, and redrawn so their metadata never reaches an export.

import { ICONS } from './icons.js';

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_SIDE = 4096;
const LOGO_PIXELS = 512;
const MAX_LOGO_LETTERS = 12;

function readDimensions(bytes) {
  if (bytes.length < 32)
    return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (from, to) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && ascii(12, 16) === 'IHDR')
    return { type: 'png', width: view.getUint32(16), height: view.getUint32(20) };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = bytes[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
        return { type: 'jpeg', width: view.getUint16(i + 7), height: view.getUint16(i + 5) };
      i += 2 + view.getUint16(i + 2);
    }
    return null;
  }
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') {
    const chunk = ascii(12, 16);
    if (chunk === 'VP8 ')
      return { type: 'webp', width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    if (chunk === 'VP8L') {
      const b = bytes.subarray(21, 25);
      return { type: 'webp', width: 1 + (((b[1] & 0x3f) << 8) | b[0]), height: 1 + (((b[3] & 0x0f) << 10) | (b[2] << 2) | ((b[1] & 0xc0) >> 6)) };
    }
    if (chunk === 'VP8X')
      return { type: 'webp', width: 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)), height: 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) };
  }
  return null;
}

function looksLikeSvg(bytes) {
  const head = new TextDecoder().decode(bytes.subarray(0, 2048)).replace(/^\ufeff/, '').trimStart();
  return head.startsWith('<') && /<svg[\s>]/i.test(head);
}

function blankCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = LOGO_PIXELS;
  canvas.height = LOGO_PIXELS;
  return canvas;
}

function finish(kind, value, canvas, colour = null) {
  return { kind, value, image: canvas, dataUrl: canvas.toDataURL('image/png'), colour };
}

function drawFitted(source, width, height) {
  const canvas = blankCanvas();
  const fit = Math.min(1, LOGO_PIXELS / Math.max(width, height));
  canvas.width = Math.max(1, Math.round(width * fit));
  canvas.height = Math.max(1, Math.round(height * fit));
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// An SVG is rasterised through an <img>, where scripts never run and nothing external loads.
function rasteriseSvg(bytes) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const width = image.naturalWidth || LOGO_PIXELS;
      const height = image.naturalHeight || LOGO_PIXELS;
      if (width > MAX_SIDE || height > MAX_SIDE) {
        reject(new Error(`The image is ${width}×${height}. Up to ${MAX_SIDE} pixels a side, please.`));
        return;
      }
      try {
        resolve(drawFitted(image, width, height));
      } catch {
        reject(new Error('That SVG could not be drawn. Try exporting it as PNG.'));
      }
    };
    image.onerror = () => reject(new Error('That SVG could not be drawn. Try exporting it as PNG.'));
    let binary = '';
    for (const byte of bytes)
      binary += String.fromCharCode(byte);
    image.src = `data:image/svg+xml;base64,${btoa(binary)}`;
  });
}

export async function logoFromFile(file) {
  if (file.size > MAX_BYTES)
    throw new Error('The image is over 2 MB. A logo this small does not need that much.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (looksLikeSvg(bytes)) {
    // Entity declarations are how an SVG is made expensive to parse; logos never need them.
    if (/<!(ENTITY|DOCTYPE)/i.test(new TextDecoder().decode(bytes)))
      throw new Error('That SVG has a DOCTYPE or entity block. Export it as a plain SVG or a PNG.');
    return finish('file', file.name, await rasteriseSvg(bytes));
  }
  const info = readDimensions(bytes);
  if (info === null)
    throw new Error('Only PNG, JPEG, WebP and SVG images are accepted.');
  if (info.width > MAX_SIDE || info.height > MAX_SIDE)
    throw new Error(`The image is ${info.width}×${info.height}. Up to ${MAX_SIDE} pixels a side, please.`);
  const bitmap = await createImageBitmap(file);
  const canvas = drawFitted(bitmap, bitmap.width, bitmap.height);
  bitmap.close();
  return finish('file', file.name, canvas);
}

export function logoFromIcon(name, colour) {
  const icon = ICONS[name];
  if (!icon)
    throw new RangeError(`No icon named ${name}`);
  const canvas = blankCanvas();
  const ctx = canvas.getContext('2d');
  // The 24-unit path fills the canvas with a small margin.
  const scale = LOGO_PIXELS / 26;
  ctx.setTransform(scale, 0, 0, scale, scale, scale);
  ctx.fillStyle = colour;
  ctx.fill(new Path2D(icon.path));
  return finish('icon', name, canvas, colour);
}

const FONT = "'Brewster Technical', system-ui, sans-serif";

export async function logoFromText(text, colour) {
  const letters = Array.from(text.trim()).slice(0, MAX_LOGO_LETTERS).join('');
  if (letters === '')
    throw new Error('Type a few letters first.');
  try {
    await document.fonts.load(`200px ${FONT}`);
  } catch {
    // The fallback font will do.
  }
  return finish('text', letters, textCanvas(letters, colour), colour);
}

function textCanvas(letters, colour) {
  const canvas = blankCanvas();
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = colour;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = 320;
  ctx.font = `${size}px ${FONT}`;
  const width = ctx.measureText(letters).width;
  if (width > LOGO_PIXELS * 0.9) {
    size = Math.floor(size * LOGO_PIXELS * 0.9 / width);
    ctx.font = `${size}px ${FONT}`;
  }
  ctx.fillText(letters, LOGO_PIXELS / 2, LOGO_PIXELS / 2 + size * 0.04);
  return canvas;
}

// Icons and text take the module colour, so they are redrawn when it changes.
export function recolourLogo(logo, colour) {
  if (!logo || logo.kind === 'file' || logo.colour === colour)
    return logo;
  if (logo.kind === 'icon')
    return logoFromIcon(logo.value, colour);
  return finish('text', logo.value, textCanvas(logo.value, colour), colour);
}

export function describeLogo(logo) {
  if (!logo)
    return '';
  if (logo.kind === 'icon')
    return `Logo: ${ICONS[logo.value].label} icon.`;
  if (logo.kind === 'text')
    return `Logo: the letters ${logo.value}.`;
  return 'Logo: your image.';
}

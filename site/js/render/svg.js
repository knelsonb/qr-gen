// A code as an SVG document: one path for every dark module, so the file stays one node even
// at version 40. User text never enters the markup; only numbers and checked colours do.

import { logoBox, padPath, imageRect, isSquareModule } from './logo.js';

export function checkColour(colour) {
  if (!/^#[0-9a-f]{6}$/i.test(colour))
    throw new RangeError(`Not a colour: ${colour}`);
  return colour.toLowerCase();
}

export function escapeXml(text) {
  return String(text)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '')
    .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '\ufffd')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Dark modules as horizontal runs; rounded data modules as circles.
export function modulePath(code, quiet, rounded) {
  const parts = [];
  for (let y = 0; y < code.size; y++) {
    for (let x = 0; x < code.size; x++) {
      if (!code.get(x, y))
        continue;
      if (rounded && !isSquareModule(code, x, y)) {
        const cx = x + quiet + 0.5;
        const cy = y + quiet + 0.5;
        parts.push(`M${cx - 0.5} ${cy}a.5 .5 0 1 0 1 0a.5 .5 0 1 0-1 0z`);
        continue;
      }
      let run = 1;
      while (x + run < code.size && code.get(x + run, y) && !(rounded && !isSquareModule(code, x + run, y)))
        run++;
      parts.push(`M${x + quiet} ${y + quiet}h${run}v1h-${run}z`);
      x += run - 1;
    }
  }
  return parts.join('');
}

// `logo` is optional: { dataUrl, fraction, shape }, the data URL already produced by the page's
// own canvas.
export function toSvg(code, options = {}) {
  const quiet = options.quiet ?? 4;
  const dark = checkColour(options.dark ?? '#000000');
  const light = checkColour(options.light ?? '#ffffff');
  const total = code.size + 2 * quiet;
  const dimension = options.widthMm ? `${options.widthMm}mm` : `${total * (options.pixelsPerModule ?? 10)}`;
  const title = options.title ? `<title>${escapeXml(options.title)}</title>` : '';
  let logo = '';
  if (options.logo) {
    const box = logoBox(code, quiet, options.logo.fraction);
    const pad = padPath(box, options.logo.shape ?? 'square');
    const rect = imageRect(box);
    const round3 = v => Math.round(v * 1000) / 1000;
    logo = (pad ? `<path d="${pad}" fill="${light}"/>` : '')
      + `<image href="${options.logo.dataUrl}" x="${round3(rect.x)}" y="${round3(rect.y)}" width="${round3(rect.size)}" height="${round3(rect.size)}" preserveAspectRatio="xMidYMid meet"/>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${dimension}" height="${dimension}" shape-rendering="crispEdges">`
    + title
    + `<rect width="${total}" height="${total}" fill="${light}"/>`
    + `<path d="${modulePath(code, quiet, options.rounded === true)}" fill="${dark}"/>`
    + logo
    + `</svg>\n`;
}

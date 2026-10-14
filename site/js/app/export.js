// The code as a file: PNG with its print size, SVG, and the name the file gets.

import { drawCode, toPngBlob } from '../render/canvas.js';
import { toSvg } from '../render/svg.js';
import { withDpi } from '../io/png.js';
import { slug } from '../io/download.js';
import { MM_PER_INCH, widthMm, logoOptions, styleOptions, describe } from './model.js';

export function filename(state, extension) {
  return `${slug(state.style.caption || describe(state))}.${extension}`;
}

// A PNG at a whole number of pixels per module, no larger than `pixels` across. Returns the
// blob and the size actually drawn.
export async function pngBlob(state, code, pixels) {
  const canvas = document.createElement('canvas');
  const total = code.size + 2 * state.style.quiet;
  const drawn = drawCode(canvas, code, {
    ...styleOptions(state),
    pixelsPerModule: Math.max(1, Math.floor(pixels / total)),
    logo: logoOptions(state),
  });
  const blob = await toPngBlob(canvas);
  // Releasing the backing store matters on iOS, which caps canvas memory per page.
  canvas.width = 0;
  canvas.height = 0;
  const dpi = drawn / (widthMm(state) / MM_PER_INCH);
  return { blob: new Blob([withDpi(await blob.arrayBuffer(), dpi)], { type: 'image/png' }), drawn };
}

export function svgText(state, code) {
  return toSvg(code, {
    ...styleOptions(state),
    title: state.style.caption || `QR code: ${describe(state)}`,
    widthMm: widthMm(state),
    logo: logoOptions(state, true),
  });
}

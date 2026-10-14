// A code drawn onto a canvas at a whole number of pixels per module, so edges stay crisp.

import { ROLE } from '../qr/encode.js';
import { checkColour } from './svg.js';
import { logoBox, drawPad, drawImageInBox } from './logo.js';

function isSquare(code, x, y) {
  const role = code.roles[y * code.size + x];
  return role === ROLE.finder || role === ROLE.alignment;
}

// Returns the pixel size drawn. `logo` is { image, fraction, shape }; the image is anything
// drawImage accepts.
export function drawCode(canvas, code, options = {}) {
  const quiet = options.quiet ?? 4;
  const scale = Math.max(1, Math.floor(options.pixelsPerModule ?? 8));
  const total = (code.size + 2 * quiet) * scale;
  canvas.width = total;
  canvas.height = total;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = checkColour(options.light ?? '#ffffff');
  ctx.fillRect(0, 0, total, total);
  ctx.fillStyle = checkColour(options.dark ?? '#000000');
  const rounded = options.rounded === true && scale >= 3;
  for (let y = 0; y < code.size; y++) {
    for (let x = 0; x < code.size; x++) {
      if (!code.get(x, y))
        continue;
      const px = (x + quiet) * scale;
      const py = (y + quiet) * scale;
      if (rounded && !isSquare(code, x, y)) {
        ctx.beginPath();
        ctx.arc(px + scale / 2, py + scale / 2, scale / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(px, py, scale, scale);
      }
    }
  }
  if (options.logo) {
    const box = logoBox(code, quiet, options.logo.fraction);
    drawPad(ctx, box, options.logo.shape ?? 'square', scale, checkColour(options.light ?? '#ffffff'));
    drawImageInBox(ctx, options.logo.image, box, scale);
  }
  return total;
}

export function toPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('The browser could not make a PNG this large'))), 'image/png');
  });
}

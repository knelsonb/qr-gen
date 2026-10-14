// Where a logo sits on a code and what backs it, shared by the canvas and SVG renderers so both
// draw the same thing.

import { ROLE } from '../qr/encode.js';

export const SHAPES = ['square', 'rounded', 'circle', 'none'];

// Finder and alignment patterns stay square under rounded styling so readers still find them.
export function isSquareModule(code, x, y) {
  const role = code.roles[y * code.size + x];
  return role === ROLE.finder || role === ROLE.alignment;
}

// Inset of the image inside its box, as a share of the box side.
const INSET = 0.12;

// The box in module units, measured from the code's top-left corner (the quiet zone included
// by the caller through `quiet`).
export function logoBox(code, quiet, fraction) {
  let side = Math.round(code.size * fraction);
  if ((code.size - side) % 2 !== 0)
    side += 1;
  side = Math.max(3, Math.min(code.size - 16, side));
  const at = quiet + (code.size - side) / 2;
  return { x: at, y: at, side };
}

export function imageRect(box) {
  const inset = box.side * INSET;
  return { x: box.x + inset, y: box.y + inset, size: box.side - 2 * inset };
}

// The backing shape as an SVG path in module units, or '' for none.
export function padPath(box, shape) {
  const { x, y, side } = box;
  const r = side / 2;
  switch (shape) {
    case 'none':
      return '';
    case 'circle':
      return `M${x} ${y + r}a${r} ${r} 0 1 0 ${side} 0a${r} ${r} 0 1 0-${side} 0z`;
    case 'rounded': {
      const c = side * 0.2;
      return `M${x + c} ${y}h${side - 2 * c}a${c} ${c} 0 0 1 ${c} ${c}v${side - 2 * c}a${c} ${c} 0 0 1-${c} ${c}h-${side - 2 * c}a${c} ${c} 0 0 1-${c}-${c}v-${side - 2 * c}a${c} ${c} 0 0 1 ${c}-${c}z`;
    }
    default:
      return `M${x} ${y}h${side}v${side}h-${side}z`;
  }
}

// Draws the pad on a canvas whose pixels are `scale` per module.
export function drawPad(ctx, box, shape, scale, colour) {
  if (shape === 'none')
    return;
  ctx.fillStyle = colour;
  ctx.beginPath();
  const x = box.x * scale;
  const y = box.y * scale;
  const side = box.side * scale;
  if (shape === 'circle')
    ctx.arc(x + side / 2, y + side / 2, side / 2, 0, Math.PI * 2);
  else if (shape === 'rounded' && typeof ctx.roundRect === 'function')
    ctx.roundRect(x, y, side, side, side * 0.2);
  else if (shape === 'rounded')
    roundedRect(ctx, x, y, side, side * 0.2);
  else
    ctx.rect(x, y, side, side);
  ctx.fill();
}

// For browsers from before roundRect existed.
function roundedRect(ctx, x, y, side, r) {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + side, y, x + side, y + side, r);
  ctx.arcTo(x + side, y + side, x, y + side, r);
  ctx.arcTo(x, y + side, x, y, r);
  ctx.arcTo(x, y, x + side, y, r);
  ctx.closePath();
}

// Fits an image inside the box, centred.
export function drawImageInBox(ctx, image, box, scale) {
  const rect = imageRect(box);
  const fit = Math.min(rect.size * scale / image.width, rect.size * scale / image.height);
  const w = image.width * fit;
  const h = image.height * fit;
  const x = rect.x * scale + (rect.size * scale - w) / 2;
  const y = rect.y * scale + (rect.size * scale - h) / 2;
  ctx.drawImage(image, x, y, w, h);
}

// Adds a pHYs chunk to a PNG so print software knows its physical size. Browsers write PNGs
// without one.

import { crc32 } from './crc32.js';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++)
    out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

export function withDpi(pngBytes, dpi) {
  const bytes = new Uint8Array(pngBytes);
  for (let i = 0; i < 8; i++)
    if (bytes[i] !== PNG_SIGNATURE[i])
      throw new Error('Not a PNG');
  const ihdrEnd = 8 + 12 + 13;
  const phys = new Uint8Array(9);
  const view = new DataView(phys.buffer);
  const perMetre = Math.round(dpi / 0.0254);
  view.setUint32(0, perMetre);
  view.setUint32(4, perMetre);
  phys[8] = 1;
  const physChunk = chunk('pHYs', phys);
  const out = new Uint8Array(bytes.length + physChunk.length);
  out.set(bytes.subarray(0, ihdrEnd));
  out.set(physChunk, ihdrEnd);
  out.set(bytes.subarray(ihdrEnd), ihdrEnd + physChunk.length);
  return out;
}

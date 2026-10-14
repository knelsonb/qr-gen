// Writes the PNG app icons from the same shapes as favicon.svg, with nothing but node:zlib.
// Run: node tools/make-icons.js

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { crc32 } from '../site/js/io/crc32.js';

// 16x16 cells, 1 = dark. Same drawing as favicon.svg.
const CELLS = [
  '0000000000000000',
  '0111111101111110',
  '0100000101000010',
  '0101110101011010',
  '0101110101011010',
  '0101110101011010',
  '0100000101000010',
  '0111111101111110',
  '0000000000000000',
  '0111111101100110',
  '0100000100000000',
  '0101110100011000',
  '0101110100011000',
  '0101110101100110',
  '0100000100000000',
  '0111111100000000',
];

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function png(size, padCells) {
  const cell = size / (16 + 2 * padCells);
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const cx = Math.floor(x / cell) - padCells;
      const cy = Math.floor(y / cell) - padCells;
      const dark = cx >= 0 && cy >= 0 && cx < 16 && cy < 16 && CELLS[cy][cx] === '1';
      const value = dark ? 0x1a : 0xff;
      const at = y * (size * 3 + 1) + 1 + x * 3;
      raw[at] = raw[at + 1] = raw[at + 2] = value;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

writeFileSync(new URL('../site/icon-192.png', import.meta.url), png(192, 0));
// The maskable icon keeps the drawing inside the safe zone.
writeFileSync(new URL('../site/icon-512.png', import.meta.url), png(512, 4));
console.log('wrote icon-192.png and icon-512.png');

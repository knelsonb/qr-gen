// The module grid: function patterns drawn first, codewords zigzagged into what is left.

import { sizeOf, alignmentPositions, EC_FORMAT_BITS } from './tables.js';

// What each module is for. Renderers use this to keep the finders square and the logo off the
// format bits.
export const ROLE = {
  data: 0,
  finder: 1,
  separator: 2,
  timing: 3,
  alignment: 4,
  format: 5,
  version: 6,
};

// The 15-bit format information: level and mask, BCH-protected and XORed with a fixed pattern
// so that no level and mask combination gives all zeros.
export function formatBits(level, mask) {
  const data = (EC_FORMAT_BITS[level] << 3) | mask;
  let remainder = data;
  for (let i = 0; i < 10; i++)
    remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  return ((data << 10) | remainder) ^ 0x5412;
}

// The 18-bit version information, BCH-protected.
export function versionBits(version) {
  let remainder = version;
  for (let i = 0; i < 12; i++)
    remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
  return (version << 12) | remainder;
}

export class Matrix {
  constructor(version) {
    this.version = version;
    this.size = sizeOf(version);
    this.modules = new Uint8Array(this.size * this.size);
    this.roles = new Uint8Array(this.size * this.size);
  }

  get(x, y) {
    return this.modules[y * this.size + x];
  }

  set(x, y, dark, role) {
    this.modules[y * this.size + x] = dark ? 1 : 0;
    this.roles[y * this.size + x] = role;
  }

  isFunction(x, y) {
    return this.roles[y * this.size + x] !== ROLE.data;
  }

  drawFunctionPatterns() {
    const size = this.size;
    for (let i = 0; i < size; i++) {
      this.set(6, i, i % 2 === 0, ROLE.timing);
      this.set(i, 6, i % 2 === 0, ROLE.timing);
    }
    this.drawFinder(3, 3);
    this.drawFinder(size - 4, 3);
    this.drawFinder(3, size - 4);
    const positions = alignmentPositions(this.version);
    const last = positions.length - 1;
    for (let i = 0; i < positions.length; i++) {
      for (let j = 0; j < positions.length; j++) {
        const onFinder = (i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0);
        if (!onFinder)
          this.drawAlignment(positions[i], positions[j]);
      }
    }
    // Reserves the format and version areas; the real format bits come with the mask.
    this.drawFormatBits('L', 0);
    this.drawVersion();
  }

  // The 7x7 finder with its light separator ring, clipped at the edges.
  drawFinder(cx, cy) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= this.size || y >= this.size)
          continue;
        const ring = Math.max(Math.abs(dx), Math.abs(dy));
        if (ring === 4)
          this.set(x, y, false, ROLE.separator);
        else
          this.set(x, y, ring !== 2, ROLE.finder);
      }
    }
  }

  drawAlignment(cx, cy) {
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++)
        this.set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1, ROLE.alignment);
  }

  drawFormatBits(level, mask) {
    const bits = formatBits(level, mask);
    const bit = i => ((bits >>> i) & 1) === 1;
    const size = this.size;
    for (let i = 0; i <= 5; i++)
      this.set(8, i, bit(i), ROLE.format);
    this.set(8, 7, bit(6), ROLE.format);
    this.set(8, 8, bit(7), ROLE.format);
    this.set(7, 8, bit(8), ROLE.format);
    for (let i = 9; i < 15; i++)
      this.set(14 - i, 8, bit(i), ROLE.format);
    for (let i = 0; i < 8; i++)
      this.set(size - 1 - i, 8, bit(i), ROLE.format);
    for (let i = 8; i < 15; i++)
      this.set(8, size - 15 + i, bit(i), ROLE.format);
    this.set(8, size - 8, true, ROLE.format);
  }

  // Versions 7 and up carry their number in two 6x3 blocks beside the top-right and bottom-left
  // finders.
  drawVersion() {
    if (this.version < 7)
      return;
    const bits = versionBits(this.version);
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1;
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.set(a, b, dark, ROLE.version);
      this.set(b, a, dark, ROLE.version);
    }
  }

  // Codewords run in two-module-wide columns from the right edge, up then down in turn,
  // skipping the vertical timing column. Leftover modules stay light.
  drawCodewords(codewords) {
    const size = this.size;
    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6)
        right = 5;
      const upward = ((right + 1) & 2) === 0;
      for (let step = 0; step < size; step++) {
        const y = upward ? size - 1 - step : step;
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          if (this.isFunction(x, y) || i >= codewords.length * 8)
            continue;
          this.set(x, y, (codewords[i >>> 3] >>> (7 - (i & 7))) & 1, ROLE.data);
          i++;
        }
      }
    }
  }
}

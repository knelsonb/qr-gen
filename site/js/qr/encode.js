// encode(text, options) turns text into a QR module grid. This module imports nothing outside
// the qr folder and never touches the DOM.

import { EC_LEVELS, EC_CODEWORDS_PER_BLOCK, EC_BLOCKS, totalCodewords, dataCodewords } from './tables.js';
import { remainder } from './reed-solomon.js';
import { makeSegments, bitLength, toCodewords } from './segments.js';
import { Matrix, ROLE } from './matrix.js';
import { applyMask, penalty } from './mask.js';

export { ROLE, EC_LEVELS, dataCodewords };

export class CapacityError extends Error {
  constructor(neededBits, availableBits) {
    super(`Data needs ${neededBits} bits; the largest allowed code holds ${availableBits}`);
    this.name = 'CapacityError';
    this.neededBits = neededBits;
    this.availableBits = availableBits;
  }
}

const DEFAULTS = {
  ecLevel: 'M',
  minVersion: 1,
  maxVersion: 40,
  mask: -1, // -1 picks the mask with the lowest penalty
  boostEc: true, // raise the level when the chosen version has room
  mode: 'auto', // or numeric, alphanumeric, byte, kanji
  eci: false, // announce UTF-8 with an ECI header; most readers assume it anyway
};

// Blocks of data plus error correction, interleaved codeword by codeword. The first blocks are
// one codeword shorter when the total does not divide evenly, and the interleave skips the
// codeword they lack.
function interleave(data, version, level) {
  const blockCount = EC_BLOCKS[level][version];
  const ecLength = EC_CODEWORDS_PER_BLOCK[level][version];
  const total = totalCodewords(version);
  const shortBlocks = blockCount - (total % blockCount);
  const shortLength = Math.floor(total / blockCount);
  const blocks = [];
  for (let b = 0, offset = 0; b < blockCount; b++) {
    const length = shortLength - ecLength + (b < shortBlocks ? 0 : 1);
    const block = data.subarray(offset, offset + length);
    offset += length;
    blocks.push({ data: block, ec: remainder(block, ecLength) });
  }
  const result = new Uint8Array(total);
  let i = 0;
  for (let k = 0; k < shortLength - ecLength + 1; k++)
    for (const block of blocks)
      if (k < block.data.length)
        result[i++] = block.data[k];
  for (let k = 0; k < ecLength; k++)
    for (const block of blocks)
      result[i++] = block.ec[k];
  return result;
}

function chooseMask(matrix, level, forced) {
  if (forced >= 0) {
    applyMask(matrix, forced);
    matrix.drawFormatBits(level, forced);
    return { mask: forced, penalty: penalty(matrix) };
  }
  let best = { mask: 0, penalty: Infinity };
  for (let mask = 0; mask < 8; mask++) {
    applyMask(matrix, mask);
    matrix.drawFormatBits(level, mask);
    const score = penalty(matrix);
    if (score < best.penalty)
      best = { mask, penalty: score };
    applyMask(matrix, mask);
  }
  applyMask(matrix, best.mask);
  matrix.drawFormatBits(level, best.mask);
  return best;
}

const MODE_NAMES = ['auto', 'numeric', 'alphanumeric', 'byte', 'kanji'];

function checkOptions(o) {
  if (!EC_LEVELS.includes(o.ecLevel))
    throw new RangeError(`Unknown error-correction level ${o.ecLevel}`);
  const whole = [o.minVersion, o.maxVersion, o.mask].every(Number.isInteger);
  if (!whole || !(o.minVersion >= 1 && o.maxVersion <= 40 && o.minVersion <= o.maxVersion))
    throw new RangeError('Version range must be whole numbers within 1 to 40');
  if (!(o.mask >= -1 && o.mask <= 7))
    throw new RangeError('Mask must be -1 or 0 to 7');
  if (!MODE_NAMES.includes(o.mode))
    throw new RangeError(`Unknown mode ${o.mode}`);
  if (o.eci && o.mode === 'kanji')
    throw new RangeError('Kanji mode is Shift JIS and cannot sit under a UTF-8 ECI header');
}

// `text` is a string, or a Uint8Array to be carried as raw bytes.
export function encode(text, options = {}) {
  const o = { ...DEFAULTS, ...options };
  checkOptions(o);
  // Character counts take more bits from versions 10 and 27, which can change the cheapest split.
  let segments = null;
  let version = o.minVersion;
  let dataBits = Infinity;
  for (;; version++) {
    if (segments === null || version === 10 || version === 27) {
      segments = makeSegments(text, version, o.mode, o.eci);
      if (segments === null)
        throw new RangeError(`The text cannot be encoded in ${o.mode} mode`);
    }
    dataBits = bitLength(segments, version, o.eci);
    if (dataBits <= dataCodewords(version, o.ecLevel) * 8)
      break;
    if (version >= o.maxVersion) {
      // A character count can overflow its field below version 40; report the real need.
      const needed = Number.isFinite(dataBits) ? dataBits : bitLength(makeSegments(text, 40, o.mode, o.eci), 40, o.eci);
      throw new CapacityError(needed, dataCodewords(o.maxVersion, o.ecLevel) * 8);
    }
  }
  let level = o.ecLevel;
  if (o.boostEc)
    for (const candidate of EC_LEVELS)
      if (EC_LEVELS.indexOf(candidate) > EC_LEVELS.indexOf(level) && dataBits <= dataCodewords(version, candidate) * 8)
        level = candidate;
  const data = toCodewords(segments, version, dataCodewords(version, level), o.eci);
  const matrix = new Matrix(version);
  matrix.drawFunctionPatterns();
  matrix.drawCodewords(interleave(data, version, level));
  const { mask, penalty: score } = chooseMask(matrix, level, o.mask);
  return {
    size: matrix.size,
    version,
    ecLevel: level,
    mask,
    penalty: score,
    modules: matrix.modules,
    roles: matrix.roles,
    segments: segments.map(s => ({ mode: s.mode, charCount: s.charCount, bits: s.bits.length })),
    dataBits,
    capacityBits: dataCodewords(version, level) * 8,
    get(x, y) {
      return matrix.modules[y * matrix.size + x];
    },
  };
}

// Data bits the largest allowed code holds at a level, for capacity meters.
export function capacityBits(level, maxVersion = 40) {
  return dataCodewords(maxVersion, level) * 8;
}

// Data segments: text split into runs that each use the densest mode that can hold them, then
// packed into the bit stream that the error-correction stage works on.

import { kanjiValue, isKanji } from './kanji.js';

export const MODES = {
  numeric: { indicator: 1, countBits: [10, 12, 14] },
  alphanumeric: { indicator: 2, countBits: [9, 11, 13] },
  byte: { indicator: 4, countBits: [8, 16, 16] },
  kanji: { indicator: 8, countBits: [8, 10, 12] },
};

const ALPHANUMERIC = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
const ECI_INDICATOR = 7;
export const ECI_UTF8 = 26;

const encoder = new TextEncoder();

export function charCountBits(mode, version) {
  return MODES[mode].countBits[version < 10 ? 0 : version < 27 ? 1 : 2];
}

export function isNumeric(char) {
  return char >= '0' && char <= '9';
}

export function isAlphanumeric(char) {
  return ALPHANUMERIC.includes(char);
}

function appendBits(bits, value, count) {
  for (let i = count - 1; i >= 0; i--)
    bits.push((value >>> i) & 1);
}

export function numericSegment(text) {
  const bits = [];
  for (let i = 0; i < text.length; i += 3) {
    const group = text.slice(i, i + 3);
    appendBits(bits, Number(group), group.length * 3 + 1);
  }
  return { mode: 'numeric', charCount: text.length, bits };
}

export function alphanumericSegment(text) {
  const bits = [];
  for (let i = 0; i < text.length; i += 2) {
    const first = ALPHANUMERIC.indexOf(text[i]);
    if (i + 1 < text.length)
      appendBits(bits, first * 45 + ALPHANUMERIC.indexOf(text[i + 1]), 11);
    else
      appendBits(bits, first, 6);
  }
  return { mode: 'alphanumeric', charCount: text.length, bits };
}

export function byteSegment(bytes) {
  const bits = [];
  for (const byte of bytes)
    appendBits(bits, byte, 8);
  return { mode: 'byte', charCount: bytes.length, bits };
}

export function kanjiSegment(text) {
  const bits = [];
  const chars = Array.from(text);
  for (const char of chars)
    appendBits(bits, kanjiValue(char), 13);
  return { mode: 'kanji', charCount: chars.length, bits };
}

function segmentFor(mode, text) {
  switch (mode) {
    case 'numeric': return numericSegment(text);
    case 'alphanumeric': return alphanumericSegment(text);
    case 'kanji': return kanjiSegment(text);
    default: return byteSegment(encoder.encode(text));
  }
}

// Which mode each character is encoded in, chosen so the whole stream is shortest. Costs are
// counted in sixths of a bit so that the fractional per-character costs stay integers.
// Switching modes starts a new segment, which costs a mode indicator and a character count.
// Kanji mode is only used for text that is entirely Kanji: readers guess the character set of
// byte segments, and a Kanji segment beside them tips some into Latin-1. It is Shift JIS, so it
// never goes under a UTF-8 ECI header either.
function cheapestModes(chars, version, eci) {
  const modes = ['byte', 'alphanumeric', 'numeric', 'kanji'];
  const headCosts = modes.map(mode => (4 + charCountBits(mode, version)) * 6);
  const allKanji = !eci && chars.every(isKanji);
  const charCosts = [
    char => encoder.encode(char).length * 48,
    char => (isAlphanumeric(char) ? 33 : Infinity),
    char => (isNumeric(char) ? 20 : Infinity),
    char => (allKanji ? 78 : Infinity),
  ];
  let previous = headCosts.slice();
  const history = [];
  for (const char of chars) {
    const current = charCosts.map((cost, i) => previous[i] + cost(char));
    const modeOfChar = modes.map((mode, i) => (current[i] < Infinity ? mode : null));
    for (let from = 0; from < modes.length; from++) {
      if (modeOfChar[from] === null)
        continue;
      for (let to = 0; to < modes.length; to++) {
        const switched = Math.ceil(current[from] / 6) * 6 + headCosts[to];
        if (switched < current[to]) {
          current[to] = switched;
          modeOfChar[to] = modes[from];
        }
      }
    }
    history.push(modeOfChar);
    previous = current;
  }
  let mode = modes[previous.indexOf(Math.min(...previous))];
  const result = new Array(chars.length);
  for (let i = chars.length - 1; i >= 0; i--) {
    mode = history[i][modes.indexOf(mode)];
    result[i] = mode;
  }
  return result;
}

// Segments for the text, as few bits as the four modes allow at this version. A forced mode
// gives one segment, or none when the text has a character outside it.
export function makeSegments(text, version, mode = 'auto', eci = false) {
  if (text.length === 0)
    return [];
  if (text instanceof Uint8Array)
    return [byteSegment(text)];
  if (mode !== 'auto') {
    const chars = Array.from(text);
    const fits = { numeric: isNumeric, alphanumeric: isAlphanumeric, kanji: isKanji, byte: () => true }[mode];
    return chars.every(fits) ? [segmentFor(mode, text)] : null;
  }
  const chars = Array.from(text);
  const modes = cheapestModes(chars, version, eci);
  const segments = [];
  let start = 0;
  for (let i = 1; i <= chars.length; i++) {
    if (i === chars.length || modes[i] !== modes[start]) {
      segments.push(segmentFor(modes[start], chars.slice(start, i).join('')));
      start = i;
    }
  }
  return segments;
}

// Bits the segments take at this version, with mode indicators and character counts, or
// Infinity when a count does not fit its field.
export function bitLength(segments, version, eci = false) {
  let total = eci ? 4 + 8 : 0;
  for (const segment of segments) {
    const countBits = charCountBits(segment.mode, version);
    if (segment.charCount >= 1 << countBits)
      return Infinity;
    total += 4 + countBits + segment.bits.length;
  }
  return total;
}

// The data codewords: segments, terminator, padding to a byte, then the alternating pad bytes.
export function toCodewords(segments, version, codewordCount, eci = false) {
  const bits = [];
  if (eci) {
    appendBits(bits, ECI_INDICATOR, 4);
    appendBits(bits, ECI_UTF8, 8);
  }
  for (const segment of segments) {
    appendBits(bits, MODES[segment.mode].indicator, 4);
    appendBits(bits, segment.charCount, charCountBits(segment.mode, version));
    bits.push(...segment.bits);
  }
  const capacity = codewordCount * 8;
  appendBits(bits, 0, Math.min(4, capacity - bits.length));
  appendBits(bits, 0, (8 - bits.length % 8) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11)
    appendBits(bits, pad, 8);
  const bytes = new Uint8Array(codewordCount);
  for (let i = 0; i < bits.length; i++)
    bytes[i >>> 3] |= bits[i] << (7 - (i & 7));
  return bytes;
}

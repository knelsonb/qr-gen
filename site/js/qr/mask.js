// The eight mask patterns and the penalty score that picks between them (ISO/IEC 18004:2015).

import { ROLE } from './matrix.js';

export const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x, y) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

const N1 = 3;
const N2 = 3;
const N3 = 40;
const N4 = 10;

// Applying the same mask twice restores the matrix.
export function applyMask(matrix, mask) {
  const size = matrix.size;
  const pattern = MASKS[mask];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      if (matrix.roles[y * size + x] === ROLE.data && pattern(x, y))
        matrix.modules[y * size + x] ^= 1;
}

// Rule 3 looks for the finder's 1:1:3:1:1 run with four light modules on one side. The run
// lengths of the last seven runs are kept newest first; the edge of the symbol counts as light.
function finderLikePatterns(runs) {
  const n = runs[1];
  const core = n > 0 && runs[2] === n && runs[3] === 3 * n && runs[4] === n && runs[5] === n;
  return (core && runs[0] >= 4 * n && runs[6] >= n ? 1 : 0) + (core && runs[6] >= 4 * n && runs[0] >= n ? 1 : 0);
}

function pushRun(runs, length, size) {
  if (runs[0] === 0)
    length += size;
  runs.pop();
  runs.unshift(length);
}

function endLine(runs, dark, length, size) {
  if (dark) {
    pushRun(runs, length, size);
    length = 0;
  }
  pushRun(runs, length + size, size);
  return finderLikePatterns(runs);
}

// Rules 1 and 3 along one line of modules; `at(i)` reads the i-th module.
function linePenalty(at, size) {
  let penalty = 0;
  let dark = 0;
  let length = 0;
  const runs = [0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < size; i++) {
    if (at(i) === dark) {
      length++;
      if (length === 5)
        penalty += N1;
      else if (length > 5)
        penalty++;
    } else {
      pushRun(runs, length, size);
      if (!dark)
        penalty += finderLikePatterns(runs) * N3;
      dark = at(i);
      length = 1;
    }
  }
  return penalty + endLine(runs, dark, length, size) * N3;
}

export function penalty(matrix) {
  const size = matrix.size;
  const m = matrix.modules;
  let total = 0;
  for (let y = 0; y < size; y++)
    total += linePenalty(x => m[y * size + x], size);
  for (let x = 0; x < size; x++)
    total += linePenalty(y => m[y * size + x], size);
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const colour = m[y * size + x];
      if (colour === m[y * size + x + 1] && colour === m[(y + 1) * size + x] && colour === m[(y + 1) * size + x + 1])
        total += N2;
    }
  }
  let dark = 0;
  for (const module of m)
    dark += module;
  const cells = size * size;
  const deviation = Math.ceil(Math.abs(dark * 20 - cells * 10) / cells) - 1;
  return total + deviation * N4;
}

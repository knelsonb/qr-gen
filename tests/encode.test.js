import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { encode, CapacityError } from '../site/js/qr/encode.js';
import { remainder } from '../site/js/qr/reed-solomon.js';
import { numericSegment, alphanumericSegment, makeSegments, bitLength } from '../site/js/qr/segments.js';
import { formatBits, versionBits } from '../site/js/qr/matrix.js';
import { MASKS, penalty } from '../site/js/qr/mask.js';
import { dataCodewords, totalCodewords, alignmentPositions, EC_LEVELS } from '../site/js/qr/tables.js';
import { toPbm } from './pbm.js';

const bitString = bits => bits.join('');

test('numeric segment packs digits in threes (spec Annex I)', () => {
  assert.equal(bitString(numericSegment('01234567').bits), '000000110001010110011000011');
});

test('alphanumeric segment packs pairs in 11 bits', () => {
  assert.equal(bitString(alphanumericSegment('AC-42').bits), '0011100111011100111001000010');
});

test('Reed-Solomon codewords for the spec Annex I example', () => {
  const data = [0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11];
  const expected = [0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55];
  assert.deepEqual(Array.from(remainder(Uint8Array.from(data), 10)), expected);
});

test('format bits match the spec table, all 32', () => {
  const table = {
    L: ['111011111000100', '111001011110011', '111110110101010', '111100010011101', '110011000101111', '110001100011000', '110110001000001', '110100101110110'],
    M: ['101010000010010', '101000100100101', '101111001111100', '101101101001011', '100010111111001', '100000011001110', '100111110010111', '100101010100000'],
    Q: ['011010101011111', '011000001101000', '011111100110001', '011101000000110', '010010010110100', '010000110000011', '010111011011010', '010101111101101'],
    H: ['001011010001001', '001001110111110', '001110011100111', '001100111010000', '000011101100010', '000001001010101', '000110100001100', '000100000111011'],
  };
  for (const level of EC_LEVELS)
    for (let mask = 0; mask < 8; mask++)
      assert.equal(formatBits(level, mask).toString(2).padStart(15, '0'), table[level][mask], `${level} ${mask}`);
});

test('version bits match the spec table', () => {
  assert.equal(versionBits(7), 0x07c94);
  assert.equal(versionBits(21), 0x15683);
  assert.equal(versionBits(40), 0x28c69);
});

test('capacities match the spec table', () => {
  assert.equal(dataCodewords(1, 'L'), 19);
  assert.equal(dataCodewords(1, 'H'), 9);
  assert.equal(dataCodewords(5, 'Q'), 62);
  assert.equal(dataCodewords(10, 'H'), 122);
  assert.equal(dataCodewords(40, 'L'), 2956);
  assert.equal(dataCodewords(40, 'H'), 1276);
  assert.equal(totalCodewords(40), 3706);
  for (let v = 1; v <= 40; v++)
    for (const level of EC_LEVELS)
      assert.ok(dataCodewords(v, level) > 0, `version ${v}-${level}`);
});

test('alignment pattern positions', () => {
  assert.deepEqual(alignmentPositions(1), []);
  assert.deepEqual(alignmentPositions(2), [6, 18]);
  assert.deepEqual(alignmentPositions(7), [6, 22, 38]);
  assert.deepEqual(alignmentPositions(32), [6, 34, 60, 86, 112, 138]);
  assert.deepEqual(alignmentPositions(40), [6, 30, 58, 86, 114, 142, 170]);
});

test('mask patterns on a 6x6 grid', () => {
  const grid = mask => Array.from({ length: 3 }, (_, y) => Array.from({ length: 6 }, (_, x) => (MASKS[mask](x, y) ? 1 : 0)).join(''));
  assert.deepEqual(grid(0), ['101010', '010101', '101010']);
  assert.deepEqual(grid(1), ['111111', '000000', '111111']);
  assert.deepEqual(grid(2), ['100100', '100100', '100100']);
  assert.deepEqual(grid(3), ['100100', '001001', '010010']);
  assert.deepEqual(grid(4), ['111000', '111000', '000111']);
  assert.deepEqual(grid(5), ['111111', '100000', '100100']);
  assert.deepEqual(grid(6), ['111111', '111000', '110110']);
  assert.deepEqual(grid(7), ['101010', '000111', '100011']);
});

test('penalty on a blank 5x5 grid: rules 1, 2 and 4', () => {
  const blank = { size: 5, modules: new Uint8Array(25), roles: new Uint8Array(25) };
  // Ten runs of five score 3 each, sixteen 2x2 blocks score 3 each, and 0% dark is nine
  // steps of 5% from 50%.
  assert.equal(penalty(blank), 30 + 48 + 90);
});

test('mixed text splits into the cheapest segments', () => {
  const segments = makeSegments('https://example.com/?id=1234567890123456', 1);
  assert.deepEqual(segments.map(s => s.mode), ['byte', 'numeric']);
  assert.ok(bitLength(segments, 1) < bitLength(makeSegments('https://example.com/?id=1234567890123456', 1, 'byte'), 1));
});

test('spec Annex I symbol: 01234567 at 1-M', () => {
  const code = encode('01234567', { ecLevel: 'M', boostEc: false });
  assert.equal(code.version, 1);
  assert.equal(code.ecLevel, 'M');
  assert.equal(code.size, 21);
  assert.equal(code.dataBits, 4 + 10 + 27);
});

test('smallest version is chosen and the level boosted when there is room', () => {
  // 74 data bits: one over what 1-H holds, so Q is the best level with room.
  const code = encode('HELLO WORLD', { ecLevel: 'L' });
  assert.equal(code.version, 1);
  assert.equal(code.ecLevel, 'Q');
  const noBoost = encode('HELLO WORLD', { ecLevel: 'L', boostEc: false });
  assert.equal(noBoost.ecLevel, 'L');
});

test('too much data throws a CapacityError with the shortfall', () => {
  assert.throws(() => encode('x'.repeat(3000), { ecLevel: 'L' }), err => err instanceof CapacityError && err.neededBits > err.availableBits);
  assert.throws(() => encode('x'.repeat(20), { maxVersion: 1, ecLevel: 'H' }), CapacityError);
  assert.throws(() => encode('abc', { mode: 'numeric' }), /cannot be encoded/);
});

test('a forced mask is used', () => {
  for (let mask = 0; mask < 8; mask++)
    assert.equal(encode('mask test', { mask }).mask, mask);
});

const zbar = (() => {
  try {
    execFileSync('zbarimg', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const SAMPLES = [
  ['numeric', '01234567', {}],
  ['alphanumeric', 'HELLO WORLD', {}],
  ['url', 'https://qr.thetallkeith.com/?ref=flyer-2026', {}],
  ['wifi', ['WIFI:T:WPA;S:Coffee House;P:p@ss', String.fromCharCode(92), ';word;H:true;;'].join(''), { ecLevel: 'H' }],
  ['utf8', 'Grüße aus Köln ✓ – 日本語', {}],
  ['kanji', '日本語のテキスト', {}],
  ['kanji-forced', '東京', { mode: 'kanji' }],
  ['eci', 'Grüße ✓', { eci: true }],
  ['long-L', 'The quick brown fox jumps over the lazy dog. '.repeat(60), { ecLevel: 'L' }],
  ['long-H', '0123456789'.repeat(300), { ecLevel: 'H' }],
  ['v40', 'A'.repeat(4200), { ecLevel: 'L', boostEc: false }],
  ['v9-Q', 'x'.repeat(130), { ecLevel: 'Q', boostEc: false }],
  ['v26-M', 'x'.repeat(1100), { ecLevel: 'M', boostEc: false }],
];

test('round trip through zbarimg', { skip: !zbar && 'zbarimg is not installed' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'qr-'));
  for (const [name, text, options] of SAMPLES) {
    const code = encode(text, options);
    const file = join(dir, `${name}.pbm`);
    writeFileSync(file, toPbm(code, name.startsWith('v') || name.startsWith('long') ? 3 : 4));
    const decoded = execFileSync('zbarimg', ['-q', '--raw', file], { maxBuffer: 1 << 20 }).toString('utf8').replace(/\n$/, '');
    assert.equal(decoded, text, `${name}: version ${code.version}-${code.ecLevel} mask ${code.mask}`);
  }
});

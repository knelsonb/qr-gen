// Reed-Solomon error-correction codewords over GF(256) with the QR polynomial x^8+x^4+x^3+x^2+1.

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x;
  LOG[x] = i;
  x <<= 1;
  if (x & 0x100)
    x ^= 0x11d;
}
// The second half lets multiply() skip a modulo 255.
for (let i = 255; i < 512; i++)
  EXP[i] = EXP[i - 255];

export function multiply(a, b) {
  return a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]];
}

const generators = new Map();

// Coefficients of the product (x - a^0)(x - a^1)...(x - a^(degree-1)), highest power first, with
// the leading 1 left out.
export function generatorPolynomial(degree) {
  if (generators.has(degree))
    return generators.get(degree);
  const poly = new Uint8Array(degree);
  poly[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      poly[j] = multiply(poly[j], root);
      if (j + 1 < degree)
        poly[j] ^= poly[j + 1];
    }
    root = multiply(root, 2);
  }
  generators.set(degree, poly);
  return poly;
}

// The error-correction codewords for one block of data codewords.
export function remainder(data, degree) {
  const generator = generatorPolynomial(degree);
  const result = new Uint8Array(degree);
  for (const byte of data) {
    const factor = byte ^ result[0];
    result.copyWithin(0, 1);
    result[degree - 1] = 0;
    for (let i = 0; i < degree; i++)
      result[i] ^= multiply(generator[i], factor);
  }
  return result;
}

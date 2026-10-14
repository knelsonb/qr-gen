// Kanji mode packs one Shift JIS double-byte character into 13 bits. The browser's own Shift JIS
// decoder supplies the character table: every double-byte sequence in the two QR ranges is
// decoded once and the result inverted, so no table ships with the page.

let codes = null;

function buildTable() {
  codes = new Map();
  let decoder;
  try {
    decoder = new TextDecoder('shift_jis');
  } catch {
    return;
  }
  const bytes = new Uint8Array(2);
  for (const [first, last] of [[0x81, 0x9f], [0xe0, 0xeb]]) {
    for (let lead = first; lead <= last; lead++) {
      for (let trail = 0x40; trail <= 0xfc; trail++) {
        if (trail === 0x7f)
          continue;
        bytes[0] = lead;
        bytes[1] = trail;
        const text = decoder.decode(bytes);
        if (text.length !== 1 || text === '�')
          continue;
        const code = (lead << 8) | trail;
        if (code > 0xebbf)
          continue;
        codes.set(text, code);
      }
    }
  }
}

// The 13-bit Kanji mode value for one character, or -1 when it has none.
export function kanjiValue(char) {
  if (codes === null)
    buildTable();
  const code = codes.get(char);
  if (code === undefined)
    return -1;
  const shifted = code - (code < 0xa000 ? 0x8140 : 0xc140);
  return (shifted >> 8) * 0xc0 + (shifted & 0xff);
}

export function isKanji(char) {
  return kanjiValue(char) >= 0;
}

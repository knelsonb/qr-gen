// A stored (uncompressed) zip of already-compressed files. PNG and SVG gain nothing from
// deflate, and this keeps the writer to one screen.

import { crc32 } from './crc32.js';

const encoder = new TextEncoder();

function header(view, offset, fields) {
  for (const [size, value] of fields) {
    if (size === 2) view.setUint16(offset, value, true);
    else view.setUint32(offset, value, true);
    offset += size;
  }
  return offset;
}

// `files` is a list of { name, data: Uint8Array }. Names are UTF-8 (general purpose bit 11).
export function makeZip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.data);
    const local = new Uint8Array(30 + name.length);
    const view = new DataView(local.buffer);
    header(view, 0, [[4, 0x04034b50], [2, 20], [2, 0x0800], [2, 0], [2, 0], [2, 0x21], [4, crc], [4, file.data.length], [4, file.data.length], [2, name.length], [2, 0]]);
    local.set(name, 30);
    parts.push(local, file.data);
    const entry = new Uint8Array(46 + name.length);
    const entryView = new DataView(entry.buffer);
    header(entryView, 0, [[4, 0x02014b50], [2, 20], [2, 20], [2, 0x0800], [2, 0], [2, 0], [2, 0x21], [4, crc], [4, file.data.length], [4, file.data.length], [2, name.length], [2, 0], [2, 0], [2, 0], [2, 0], [4, 0], [4, offset]]);
    entry.set(name, 46);
    central.push(entry);
    offset += local.length + file.data.length;
  }
  const centralSize = central.reduce((n, e) => n + e.length, 0);
  const end = new Uint8Array(22);
  header(new DataView(end.buffer), 0, [[4, 0x06054b50], [2, 0], [2, 0], [2, files.length], [2, files.length], [4, centralSize], [4, offset], [2, 0]]);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}

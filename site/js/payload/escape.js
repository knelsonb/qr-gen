// One escaper per payload grammar. Each is the exact set of characters that grammar reserves.

export function escapeWifi(text) {
  return text.replace(/[\\:;,"]/g, c => `\\${c}`);
}

export function escapeVcard(text) {
  return text.replace(/\\/g, '\\\\').replace(/[,;]/g, c => `\\${c}`).replace(/\r?\n/g, '\\n');
}

export function escapeMecard(text) {
  return text.replace(/[\\:;,]/g, c => `\\${c}`);
}

export function escapeIcal(text) {
  return text.replace(/\\/g, '\\\\').replace(/[,;]/g, c => `\\${c}`).replace(/\r?\n/g, '\\n');
}

// iCalendar lines longer than 75 octets continue on the next line after a space.
export function foldIcal(line) {
  const encoder = new TextEncoder();
  const chunks = [];
  let current = '';
  for (const char of line) {
    if (encoder.encode(current + char).length > (chunks.length === 0 ? 75 : 74)) {
      chunks.push(current);
      current = '';
    }
    current += char;
  }
  chunks.push(current);
  return chunks.join('\r\n ');
}

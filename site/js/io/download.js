// Saving and naming files. Names come from a short whitelist of characters, never from the
// payload as typed.

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function slug(text, fallback = 'qr-code') {
  const cleaned = String(text).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return cleaned === '' || RESERVED.test(cleaned) ? fallback : cleaned;
}

export function download(blob, filename) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 10000);
}

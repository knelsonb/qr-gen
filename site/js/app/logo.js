// Loads a logo from a file the visitor chose, cautiously: type by magic bytes, size and
// dimensions capped before decoding, and the result redrawn through a canvas so the file's
// metadata never reaches an export.

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_SIDE = 4096;
const LOGO_PIXELS = 512;

function readDimensions(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return { type: 'png', width: view.getUint32(16), height: view.getUint32(20) };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = bytes[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
        return { type: 'jpeg', width: view.getUint16(i + 7), height: view.getUint16(i + 5) };
      i += 2 + view.getUint16(i + 2);
    }
    return null;
  }
  if (String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') {
    const chunk = String.fromCharCode(...bytes.subarray(12, 16));
    if (chunk === 'VP8 ')
      return { type: 'webp', width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    if (chunk === 'VP8L') {
      const b = bytes.subarray(21, 25);
      return { type: 'webp', width: 1 + (((b[1] & 0x3f) << 8) | b[0]), height: 1 + (((b[3] & 0x0f) << 10) | (b[2] << 2) | ((b[1] & 0xc0) >> 6)) };
    }
    if (chunk === 'VP8X')
      return { type: 'webp', width: 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)), height: 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) };
  }
  return null;
}

// Resolves to { image, dataUrl } or throws with a sentence for the visitor.
export async function loadLogo(file) {
  if (file.size > MAX_BYTES)
    throw new Error('The image is over 2 MB. A logo this small does not need that much.');
  const head = new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer());
  const info = readDimensions(head);
  if (info === null)
    throw new Error('Only PNG, JPEG and WebP images are accepted.');
  if (info.width > MAX_SIDE || info.height > MAX_SIDE)
    throw new Error(`The image is ${info.width}×${info.height}. Up to ${MAX_SIDE} pixels a side, please.`);
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, LOGO_PIXELS / Math.max(bitmap.width, bitmap.height));
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return { image: canvas, dataUrl: canvas.toDataURL('image/png') };
}

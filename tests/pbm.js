// A plain PBM image of a code, for round trips through an external decoder.

export function toPbm(code, scale = 4, quiet = 4) {
  const width = (code.size + 2 * quiet) * scale;
  const rows = [];
  for (let y = 0; y < width; y++) {
    const my = Math.floor(y / scale) - quiet;
    let row = '';
    for (let x = 0; x < width; x++) {
      const mx = Math.floor(x / scale) - quiet;
      const dark = mx >= 0 && my >= 0 && mx < code.size && my < code.size && code.get(mx, my);
      row += dark ? '1' : '0';
    }
    rows.push(row);
  }
  return `P1\n${width} ${width}\n${rows.join('\n')}\n`;
}

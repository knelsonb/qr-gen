// A code as text, two module rows per line of half-block characters, for terminals and chat.

export function toText(code, quiet = 2) {
  const total = code.size + 2 * quiet;
  const dark = (x, y) => {
    const mx = x - quiet;
    const my = y - quiet;
    return mx >= 0 && my >= 0 && mx < code.size && my < code.size && code.get(mx, my) === 1;
  };
  const lines = [];
  for (let y = 0; y < total; y += 2) {
    let line = '';
    for (let x = 0; x < total; x++) {
      const top = dark(x, y);
      const bottom = y + 1 < total ? dark(x, y + 1) : false;
      line += top && bottom ? '█' : top ? '▀' : bottom ? '▄' : ' ';
    }
    lines.push(line);
  }
  return lines.join('\n');
}

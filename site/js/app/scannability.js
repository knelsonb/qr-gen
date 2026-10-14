// How likely a phone is to read the code as styled. Each factor explains itself in a line;
// the overall rating is the worst factor.

function luminance(hex) {
  const channel = i => {
    const c = parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function isInverted(dark, light) {
  return luminance(dark) > luminance(light);
}

const RANK = { good: 0, risky: 1, poor: 2 };

// `code` is the encoded result, `style` the state's style, `logo` the overlaid logo's box side
// in modules (null when there is none), `moduleMm` the printed module size when known.
export function assess(code, style, { logo = null, moduleMm = null } = {}) {
  const factors = [];
  const ratio = contrastRatio(style.dark, style.light);
  if (isInverted(style.dark, style.light) && !style.invertedOk)
    factors.push({ name: 'Contrast', rating: 'poor', text: 'light code on a dark background. Many readers only look for dark on light.' });
  else if (ratio >= 4.5)
    factors.push({ name: 'Contrast', rating: 'good', text: `strong (${Math.round(ratio)} to 1).` });
  else if (ratio >= 3)
    factors.push({ name: 'Contrast', rating: 'risky', text: `low (${ratio.toFixed(1)} to 1). A darker code colour or a lighter background would help.` });
  else
    factors.push({ name: 'Contrast', rating: 'poor', text: `too low for most cameras (${ratio.toFixed(1)} to 1).` });

  if (style.quiet >= 4)
    factors.push({ name: 'Border', rating: 'good', text: `wide enough (${style.quiet} squares).` });
  else if (style.quiet >= 2)
    factors.push({ name: 'Border', rating: 'risky', text: `narrow (${style.quiet} squares). Under 4, some readers struggle when the code sits near other print.` });
  else
    factors.push({ name: 'Border', rating: 'poor', text: 'none. Readers need a blank border to find the code. Use at least 2 squares, 4 to be safe.' });

  if (moduleMm !== null) {
    if (moduleMm >= 0.5)
      factors.push({ name: 'Print size', rating: 'good', text: `each square prints ${moduleMm.toFixed(2)} mm wide.` });
    else if (moduleMm >= 0.33)
      factors.push({ name: 'Print size', rating: 'risky', text: `squares of ${moduleMm.toFixed(2)} mm need a sharp printer and a close scan. Print larger or shorten the content.` });
    else
      factors.push({ name: 'Print size', rating: 'poor', text: `squares of ${moduleMm.toFixed(2)} mm are too small to print reliably.` });
  }

  if (logo !== null) {
    // High correction repairs up to 30% of the codewords; the pad's share of the area is a
    // fair proxy, with room left for print damage.
    const covered = (logo / code.size) ** 2;
    if (style.logoShape === 'none')
      factors.push({ name: 'Logo pad', rating: 'risky', text: 'none, so the squares show through the logo and readers must tell the two apart.' });
    if (code.ecLevel !== 'H')
      factors.push({ name: 'Logo', rating: 'poor', text: 'needs High error correction to cover what it hides.' });
    else if (covered <= 0.07)
      factors.push({ name: 'Logo', rating: 'good', text: `covers ${Math.round(covered * 100)}% of the code, well inside what High correction repairs.` });
    else if (covered <= 0.12)
      factors.push({ name: 'Logo', rating: 'risky', text: `covers ${Math.round(covered * 100)}% of the code. Test with a phone before printing.` });
    else
      factors.push({ name: 'Logo', rating: 'poor', text: `covers ${Math.round(covered * 100)}% of the code, more than error correction can make up.` });
  }

  if (code.version >= 30)
    factors.push({ name: 'Density', rating: 'risky', text: `${code.size} squares across. Phones need it large, flat and well lit.` });
  else if (code.version >= 20)
    factors.push({ name: 'Density', rating: 'risky', text: 'dense. Shorter content scans faster from further away.' });

  if (style.rounded)
    factors.push({ name: 'Style', rating: 'good', text: 'rounded squares read fine; the corner markers stay square.' });

  const overall = factors.reduce((worst, f) => (RANK[f.rating] > RANK[worst] ? f.rating : worst), 'good');
  return { overall, factors };
}

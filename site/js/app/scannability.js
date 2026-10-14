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
    factors.push({ name: 'Contrast', rating: 'poor', text: 'Light modules on a dark background. Many readers only look for dark on light.' });
  else if (ratio >= 4.5)
    factors.push({ name: 'Contrast', rating: 'good', text: `Contrast ${ratio.toFixed(1)}:1.` });
  else if (ratio >= 3)
    factors.push({ name: 'Contrast', rating: 'risky', text: `Contrast ${ratio.toFixed(1)}:1 is low. Darker modules or a lighter background would help.` });
  else
    factors.push({ name: 'Contrast', rating: 'poor', text: `Contrast ${ratio.toFixed(1)}:1 is too low for most cameras.` });

  if (style.quiet >= 4)
    factors.push({ name: 'Border', rating: 'good', text: `${style.quiet} blank modules around the code.` });
  else if (style.quiet >= 2)
    factors.push({ name: 'Border', rating: 'risky', text: 'A border under 4 modules confuses some readers when the code sits near other print.' });
  else
    factors.push({ name: 'Border', rating: 'poor', text: 'Readers need a blank border to find the code. Use at least 2 modules, 4 to be safe.' });

  if (moduleMm !== null) {
    if (moduleMm >= 0.5)
      factors.push({ name: 'Print size', rating: 'good', text: `Each module prints ${moduleMm.toFixed(2)} mm wide.` });
    else if (moduleMm >= 0.33)
      factors.push({ name: 'Print size', rating: 'risky', text: `Modules of ${moduleMm.toFixed(2)} mm need a sharp printer and a close scan. Print larger or shorten the content.` });
    else
      factors.push({ name: 'Print size', rating: 'poor', text: `Modules of ${moduleMm.toFixed(2)} mm are too small to print reliably.` });
  }

  if (logo !== null) {
    const covered = (logo / code.size) ** 2;
    if (style.logoShape === 'none')
      factors.push({ name: 'Logo pad', rating: 'risky', text: 'With no pad the modules show through the logo, and readers must tell the two apart.' });
    if (code.ecLevel !== 'H')
      factors.push({ name: 'Logo', rating: 'poor', text: 'A logo needs High error correction to cover what it hides.' });
    else if (covered <= 0.05)
      factors.push({ name: 'Logo', rating: 'good', text: `The logo covers ${Math.round(covered * 100)}% of the code, well inside what High correction repairs.` });
    else if (covered <= 0.09)
      factors.push({ name: 'Logo', rating: 'risky', text: `The logo covers ${Math.round(covered * 100)}% of the code. Test with a phone before printing.` });
    else
      factors.push({ name: 'Logo', rating: 'poor', text: `The logo covers ${Math.round(covered * 100)}% of the code, more than error correction can make up.` });
  }

  if (code.version >= 30)
    factors.push({ name: 'Density', rating: 'risky', text: `Version ${code.version} is ${code.size} modules across. Phones need it large, flat and well lit.` });
  else if (code.version >= 20)
    factors.push({ name: 'Density', rating: 'risky', text: `Version ${code.version} is dense. Shorter content scans faster from further away.` });

  if (style.rounded)
    factors.push({ name: 'Style', rating: 'good', text: 'Rounded modules read fine; the corner squares stay square.' });

  const overall = factors.reduce((worst, f) => (RANK[f.rating] > RANK[worst] ? f.rating : worst), 'good');
  return { overall, factors };
}

// Facts derived from the state that both the view and the exports need. No DOM here.

import { dataCodewords } from '../qr/encode.js';
import { build } from '../payload/builders.js';

export const MM_PER_INCH = 25.4;

export function widthMm(state) {
  return state.style.unit === 'in' ? state.style.physical * MM_PER_INCH : state.style.physical;
}

// The printed width of one module.
export function moduleMm(state, code) {
  return code ? widthMm(state) / (code.size + 2 * state.style.quiet) : null;
}

// A logo hides part of the code, so it needs the strongest correction.
export function effectiveLevel(state) {
  return state.logo ? 'H' : state.style.ecLevel;
}

export function encodeOptions(state) {
  return { ecLevel: effectiveLevel(state), boostEc: state.style.boost, eci: state.style.eci };
}

export function logoOptions(state, forSvg = false) {
  if (!state.logo)
    return null;
  return {
    image: state.logo.image,
    dataUrl: forSvg ? state.logo.dataUrl : undefined,
    fraction: state.style.logoFraction,
    shape: state.style.logoShape,
  };
}

export function styleOptions(state) {
  return { quiet: state.style.quiet, dark: state.style.dark, light: state.style.light, rounded: state.style.rounded };
}

// The smallest version whose data area holds `bits` at a level, or null past version 40.
export function smallestVersion(bits, level) {
  for (let v = 1; v <= 40; v++)
    if (dataCodewords(v, level) * 8 >= bits)
      return v;
  return null;
}

// What the code holds, in a few words, for alt text, filenames and the link banner.
export function describe(state) {
  const f = state.fields[state.type];
  switch (state.type) {
    case 'url': {
      try {
        return `a link to ${new URL(build('url', f)).hostname}`;
      } catch {
        return 'a link';
      }
    }
    case 'wifi': return f.ssid ? `the Wi-Fi network ${f.ssid}` : 'a Wi-Fi network';
    case 'contact': return `the contact ${[f.firstName, f.lastName].filter(Boolean).join(' ') || f.org || 'card'}`;
    case 'email': return f.to ? `an email to ${f.to}` : 'an email';
    case 'sms': return f.number ? `a text message to ${f.number}` : 'a text message';
    case 'phone': return f.number ? `the phone number ${f.number}` : 'a phone number';
    case 'event': return f.title ? `the event ${f.title}` : 'an event';
    case 'geo': return 'a map location';
    case 'crypto': return `a ${f.coin} address`;
    default: return 'some text';
  }
}

// Wires the form to the state and renders the state into the page. The DOM is a view of the
// state and never the store. User text reaches the page only through textContent.

import { encode, CapacityError, capacityBits } from '../qr/encode.js';
import { drawCode } from '../render/canvas.js';
import { build } from '../payload/builders.js';
import { inspect, revealControls } from '../payload/inspect.js';
import { STYLE, FIELDS, TYPES, coerce, applySettings, styleToJson } from './state.js';
import { assess } from './scannability.js';

const $ = id => document.getElementById(id);

const LEVEL_NAMES = { L: 'Low', M: 'Medium', Q: 'Quartile', H: 'High' };

// What the last render produced, for the actions that export it.
let latest = { code: null, payload: '', type: 'url' };

export function current() {
  return latest;
}

function clear(element) {
  while (element.firstChild)
    element.removeChild(element.firstChild);
}

function li(parent, text, className) {
  const item = document.createElement('li');
  item.textContent = text;
  if (className)
    item.className = className;
  parent.append(item);
}

export function describe(state) {
  const f = state.fields[state.type];
  switch (state.type) {
    case 'url': {
      try {
        return `link to ${new URL(build('url', f)).hostname}`;
      } catch {
        return 'link';
      }
    }
    case 'wifi': return `Wi-Fi network ${f.ssid}`;
    case 'contact': return `contact ${[f.firstName, f.lastName].filter(Boolean).join(' ') || f.org}`;
    case 'email': return `email to ${f.to}`;
    case 'sms': return `text message to ${f.number}`;
    case 'phone': return `phone number ${f.number}`;
    case 'event': return `event ${f.title}`;
    case 'geo': return 'map location';
    case 'crypto': return `${f.coin} address`;
    default: return 'text';
  }
}

// The printed width of one module, when a physical size is set.
export function moduleMm(state, code) {
  if (!code || state.style.unit === 'px')
    return null;
  const width = state.style.unit === 'in' ? state.style.physical * 25.4 : state.style.physical;
  return width / (code.size + 2 * state.style.quiet);
}

export function effectiveLevel(state) {
  return state.logo ? 'H' : state.style.ecLevel;
}

function showPayload(state, payload) {
  const pre = $('payload');
  clear(pre);
  const shown = revealControls(payload);
  let host = null;
  if (state.type === 'url') {
    try {
      host = new URL(payload).hostname;
    } catch {
      host = null;
    }
  }
  const at = host ? shown.indexOf(host) : -1;
  if (at < 0) {
    pre.textContent = shown;
    return;
  }
  pre.append(shown.slice(0, at));
  const mark = document.createElement('span');
  mark.className = 'host';
  mark.textContent = host;
  pre.append(mark, shown.slice(at + host.length));
}

function showStats(state, code) {
  const used = Math.ceil(code.dataBits / 8);
  const room = code.capacityBits / 8;
  $('stats').textContent = `Version ${code.version} · ${code.size}×${code.size} modules · ${used} of ${room} bytes · ${LEVEL_NAMES[code.ecLevel]} correction`;
}

function capacityWarning(state, code, findings) {
  const level = effectiveLevel(state);
  const limit = capacityBits(level);
  const share = code.dataBits / limit;
  if (share > 0.8)
    findings.push({ level: 'warn', text: `${Math.ceil(code.dataBits / 8)} of the ${limit / 8} bytes a ${LEVEL_NAMES[level]} code can hold at most. Lower the error correction or shorten the content.` });
}

function tooLong(state, err) {
  const over = Math.ceil((err.neededBits - err.availableBits) / 8);
  const level = effectiveLevel(state);
  let text = `Too much for one code: about ${over} bytes over the limit at ${LEVEL_NAMES[level]} correction.`;
  if (level !== 'L' && err.neededBits <= capacityBits('L'))
    text += ' It fits at Low.';
  return text;
}

function showScannability(state, code) {
  const result = assess(code, state.style, { logo: Boolean(state.logo), moduleMm: moduleMm(state, code) });
  const overall = $('scan-overall');
  overall.textContent = { good: 'Good', risky: 'Risky', poor: 'Poor' }[result.overall];
  overall.className = `rating ${result.overall}`;
  const list = $('scan-factors');
  clear(list);
  for (const factor of result.factors)
    li(list, `${factor.name}: ${factor.text}`, factor.rating);
}

let detector = null;
async function selfCheck(payload) {
  const out = $('self-check');
  if (!('BarcodeDetector' in window)) {
    out.textContent = '';
    return;
  }
  try {
    if (detector === null) {
      const formats = await BarcodeDetector.getSupportedFormats();
      detector = formats.includes('qr_code') ? new BarcodeDetector({ formats: ['qr_code'] }) : false;
    }
    if (!detector) {
      out.textContent = '';
      return;
    }
    const found = await detector.detect($('preview'));
    const ok = found.some(b => b.rawValue === payload);
    out.textContent = ok ? 'This browser reads the preview back correctly.' : 'This browser could not read the preview back. Try a phone before printing.';
  } catch {
    out.textContent = '';
  }
}

function saveStyle(state) {
  try {
    localStorage.setItem('qr-settings', styleToJson(state));
  } catch {
    // Storage may be unavailable; the page works without it.
  }
}

export function render(state) {
  const payload = build(state.type, state.fields[state.type]);
  const findings = inspect(state.type, payload);
  const blocked = findings.some(f => f.level === 'block');
  const preview = $('preview');
  const error = $('error');
  error.textContent = '';
  let code = null;
  if (payload !== '' && !blocked) {
    try {
      code = encode(payload, { ecLevel: effectiveLevel(state), boostEc: state.style.boost, eci: state.style.eci });
    } catch (err) {
      error.textContent = err instanceof CapacityError ? tooLong(state, err) : 'This text cannot be encoded.';
    }
  }
  latest = { code, payload, type: state.type };
  preview.hidden = code === null;
  $('empty').hidden = code !== null;
  $('caption-out').textContent = code ? state.style.caption : '';
  if (code) {
    const total = code.size + 2 * state.style.quiet;
    drawCode(preview, code, {
      quiet: state.style.quiet,
      pixelsPerModule: Math.max(1, Math.floor(640 / total)),
      dark: state.style.dark,
      light: state.style.light,
      rounded: state.style.rounded,
      logo: state.logo ? { image: state.logo.image, fraction: state.style.logoFraction } : null,
    });
    preview.setAttribute('aria-label', `QR code: ${describe(state)}`);
    showStats(state, code);
    capacityWarning(state, code, findings);
    showScannability(state, code);
    selfCheck(payload);
  } else {
    $('stats').textContent = '';
    $('scan-overall').textContent = '';
    $('scan-overall').className = 'rating';
    clear($('scan-factors'));
    $('self-check').textContent = '';
  }
  const list = $('findings');
  clear(list);
  for (const finding of findings)
    li(list, finding.text, finding.level);
  showPayload(state, payload);
  for (const button of document.querySelectorAll('#download-png, #download-svg, #copy-image, #share, #print, #copy-text, #bar-save, #bar-share'))
    button.disabled = code === null;
  $('announce').textContent = code ? 'Code updated' : '';
  saveStyle(state);
}

let pending = false;
export function scheduleRender(state) {
  if (pending)
    return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    render(state);
  });
}

function showType(state) {
  for (const fieldset of document.querySelectorAll('fieldset[data-type]'))
    fieldset.hidden = fieldset.dataset.type !== state.type;
  for (const radio of document.querySelectorAll('input[name="type"]'))
    radio.checked = radio.value === state.type;
}

// Pushes the state into every control. Used at load and when link content is accepted.
export function sync(state) {
  showType(state);
  for (const input of document.querySelectorAll('[data-field]')) {
    const type = input.closest('[data-type]').dataset.type;
    const value = state.fields[type][input.dataset.field];
    if (input.type === 'checkbox')
      input.checked = value === true;
    else
      input.value = value;
  }
  for (const input of document.querySelectorAll('[data-style]')) {
    const value = state.style[input.dataset.style];
    if (input.type === 'checkbox')
      input.checked = value === true;
    else
      input.value = value;
  }
  $('quiet-out').textContent = state.style.quiet;
  $('logo-out').textContent = Math.round(state.style.logoFraction * 100);
  $('png-size').value = String(state.style.size);
  echoAddress(state);
}

function echoAddress(state) {
  const address = state.fields.crypto.address.replace(/\s+/g, '');
  $('address-echo').textContent = address === '' ? '' : address.match(/.{1,4}/g).join(' ');
}

const READY_MADE = [
  [/^WIFI:/i, 'Wi-Fi code'],
  [/^BEGIN:VCARD/i, 'contact card'],
  [/^MECARD:/i, 'contact card'],
  [/^BEGIN:VCALENDAR/i, 'calendar event'],
  [/^mailto:/i, 'email link'],
  [/^(tel|sms|smsto):/i, 'phone link'],
  [/^geo:/i, 'location'],
];

// Pasting a finished payload into the link field offers to use it as-is, under Text, where
// nothing is added to it.
function offerSwitch(state, pasted) {
  const match = READY_MADE.find(([pattern]) => pattern.test(pasted.trim()));
  const hint = $('switch-hint');
  if (!match || state.type === 'text') {
    hint.hidden = true;
    return;
  }
  const button = $('switch-type');
  button.textContent = `This looks like a ready-made ${match[1]}. Use it exactly as pasted?`;
  button.onclick = () => {
    state.type = 'text';
    state.fields.text.text = pasted.trim();
    hint.hidden = true;
    sync(state);
    render(state);
  };
  hint.hidden = false;
}

export function bind(state) {
  for (const radio of document.querySelectorAll('input[name="type"]')) {
    radio.addEventListener('change', () => {
      state.type = radio.value;
      showType(state);
      $('switch-hint').hidden = true;
      render(state);
      const first = document.querySelector(`fieldset[data-type="${state.type}"] input, fieldset[data-type="${state.type}"] textarea`);
      if (first)
        first.focus();
    });
  }
  for (const input of document.querySelectorAll('[data-field]')) {
    const type = input.closest('[data-type]').dataset.type;
    const name = input.dataset.field;
    const kind = FIELDS[type][name];
    input.addEventListener('input', () => {
      state.fields[type][name] = input.type === 'checkbox' ? input.checked : coerce(kind, input.value) ?? state.fields[type][name];
      if (type === 'crypto')
        echoAddress(state);
      scheduleRender(state);
    });
    if (type === 'url' || type === 'text')
      input.addEventListener('paste', e => offerSwitch(state, e.clipboardData.getData('text')));
  }
  for (const input of document.querySelectorAll('[data-style]')) {
    const name = input.dataset.style;
    input.addEventListener('input', () => {
      const value = input.type === 'checkbox' ? input.checked : coerce(STYLE[name], input.value);
      if (value === undefined)
        return;
      state.style[name] = value;
      if (name === 'quiet')
        $('quiet-out').textContent = value;
      if (name === 'logoFraction')
        $('logo-out').textContent = Math.round(value * 100);
      scheduleRender(state);
    });
  }
  $('png-size').addEventListener('change', () => {
    state.style.size = coerce(STYLE.size, $('png-size').value) ?? state.style.size;
    saveStyle(state);
  });
  $('show-password').addEventListener('click', () => {
    const field = $('f-password');
    const show = field.type === 'password';
    field.type = show ? 'text' : 'password';
    $('show-password').textContent = show ? 'Hide' : 'Show';
    $('show-password').setAttribute('aria-pressed', String(show));
  });
}

// A link with content in it pre-fills nothing until the visitor asks.
export function offerLinkContent(state, params) {
  const banner = $('link-banner');
  banner.hidden = false;
  $('load-link').onclick = () => {
    applySettings(state, key => params.get(key), { content: true });
    banner.hidden = true;
    sync(state);
    render(state);
  };
  $('ignore-link').onclick = () => {
    banner.hidden = true;
    history.replaceState(null, '', location.pathname);
  };
}

export { TYPES };

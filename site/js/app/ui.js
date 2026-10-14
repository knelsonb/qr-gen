// Wires the form to the state and renders the state into the page. The DOM is a view of the
// state and never the store. User text reaches the page only through textContent.

import { encode, CapacityError, capacityBits, dataCodewords, EC_LEVELS } from '../qr/encode.js';
import { drawCode } from '../render/canvas.js';
import { build } from '../payload/builders.js';
import { inspect, revealControls } from '../payload/inspect.js';
import { STYLE, FIELDS, MAX_TEXT, coerce, applySettings, styleToJson, defaultState } from './state.js';
import { assess } from './scannability.js';
import { logoBox } from '../render/logo.js';
import { logoFromFile, logoFromIcon, logoFromText, recolourLogo, describeLogo } from './logo.js';

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
export const MM_PER_INCH = 25.4;

export function widthMm(state) {
  return state.style.unit === 'in' ? state.style.physical * MM_PER_INCH : state.style.physical;
}

export function moduleMm(state, code) {
  return code ? widthMm(state) / (code.size + 2 * state.style.quiet) : null;
}

export function effectiveLevel(state) {
  return state.logo ? 'H' : state.style.ecLevel;
}

export function encodeOptions(state) {
  return { ecLevel: effectiveLevel(state), boostEc: state.style.boost, eci: state.style.eci };
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
  // The host is looked for inside the authority part only, after any user@, so a login that
  // mimics a host name cannot steal the highlight.
  let at = -1;
  if (host) {
    const start = shown.indexOf('://') + 3;
    const end = shown.slice(start).search(/[/?#]|$/) + start;
    const afterUser = shown.lastIndexOf('@', end) + 1;
    const authority = shown.slice(Math.max(start, afterUser), end);
    const match = authority.match(new RegExp(host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    if (match)
      at = Math.max(start, afterUser) + match.index;
  }
  if (at < 0) {
    pre.textContent = shown;
    return;
  }
  pre.append(shown.slice(0, at));
  const mark = document.createElement('span');
  mark.className = 'host';
  mark.textContent = shown.slice(at, at + host.length);
  pre.append(mark, shown.slice(at + host.length));
}

// The smallest version whose data area holds `bits` at a level, or null past version 40.
function smallestVersion(bits, level) {
  for (let v = 1; v <= 40; v++)
    if (dataCodewords(v, level) * 8 >= bits)
      return v;
  return null;
}

function showStats(state, code) {
  const used = Math.ceil(code.dataBits / 8);
  const room = code.capacityBits / 8;
  const kind = code.version <= 4 ? 'Small' : code.version <= 12 ? 'Medium' : 'Dense';
  $('stats').textContent = `${kind} code: ${code.size} × ${code.size} squares. Shorter content makes a smaller code that scans from further away.`;
  const forced = state.logo && state.style.ecLevel !== 'H' ? ' (High because of the logo)' : '';
  const byLevel = EC_LEVELS.map(level => {
    const v = smallestVersion(code.dataBits, level);
    return `${LEVEL_NAMES[level]} ${v === null ? 'too long' : `${v * 4 + 17} × ${v * 4 + 17}`}`;
  });
  $('size-why').textContent = `Version ${code.version}, ${used} of ${room} bytes used at ${LEVEL_NAMES[code.ecLevel]} correction${forced}. The same content at each level: ${byLevel.join(' · ')}. Longer content or more correction adds 4 squares a side.`;
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
  const logo = state.logo ? logoBox(code, 0, state.style.logoFraction).side : null;
  const result = assess(code, state.style, { logo, moduleMm: moduleMm(state, code) });
  const overall = $('scan-overall');
  overall.textContent = { good: 'Good', risky: 'Risky', poor: 'Poor' }[result.overall];
  overall.className = `rating ${result.overall}`;
  const list = $('scan-factors');
  clear(list);
  for (const factor of result.factors)
    li(list, `${factor.name}: ${factor.text}`, factor.rating);
}

let detector = null;
let checks = 0;
async function selfCheck(payload) {
  const out = $('self-check');
  const check = ++checks;
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
    if (check !== checks)
      return;
    const ok = found.some(b => b.rawValue === payload);
    out.textContent = ok ? 'This browser reads the preview back correctly.' : 'This browser could not read the preview back. Try a phone before printing.';
  } catch {
    out.textContent = '';
  }
}

// Called only from the controls, so settings that arrived in a link are not kept unless the
// visitor goes on to change something.
export function saveStyle(state) {
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
      code = encode(payload, encodeOptions(state));
    } catch (err) {
      error.textContent = err instanceof CapacityError ? tooLong(state, err) : 'This text cannot be encoded.';
    }
  }
  latest = { code, payload, type: state.type };
  preview.hidden = code === null;
  $('empty').hidden = code !== null;
  $('caption-out').textContent = code ? state.style.caption : '';
  state.logo = recolourLogo(state.logo, state.style.dark);
  if (code) {
    const total = code.size + 2 * state.style.quiet;
    drawCode(preview, code, {
      quiet: state.style.quiet,
      pixelsPerModule: Math.max(1, Math.floor(640 / total)),
      dark: state.style.dark,
      light: state.style.light,
      rounded: state.style.rounded,
      logo: state.logo ? { image: state.logo.image, fraction: state.style.logoFraction, shape: state.style.logoShape } : null,
    });
    preview.setAttribute('aria-label', `QR code: ${describe(state)}`);
    showStats(state, code);
    capacityWarning(state, code, findings);
    showScannability(state, code);
    selfCheck(payload);
  } else {
    checks++;
    $('stats').textContent = '';
    $('size-why').textContent = '';
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
  for (const button of document.querySelectorAll('[data-png-size], #download-custom, #download-svg, #copy-image, #share, #print, #copy-text, #bar-save, #bar-share'))
    if (!button.dataset.busy)
      button.disabled = code === null;
  $('take-empty').hidden = code !== null;
  $('print').textContent = `${state.type === 'wifi' ? 'Print guest card' : 'Print'} (${state.style.physical} ${state.style.unit} wide)`;
  announce(code ? $('scan-overall').textContent : '');
}

// Screen readers hear one line per pause in typing, with the rating when it changed.
let announceTimer = 0;
let lastRating = '';
function announce(rating) {
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => {
    const changed = rating !== lastRating;
    lastRating = rating;
    $('announce').textContent = rating === '' ? '' : `Code updated.${changed ? ` Will it scan: ${rating}.` : ''}`;
  }, 800);
}

// What a control changes, as the word stamped on the code pane after each update.
const CHANGE_LABELS = {
  quiet: 'border', dark: 'colours', light: 'colours', ecLevel: 'correction', boost: 'correction',
  rounded: 'module shape', logoFraction: 'logo size', logoShape: 'logo pad', caption: 'caption',
  physical: 'print size', unit: 'print size', invertedOk: 'contrast', eci: 'encoding',
};

let stampTimer = 0;
function stamp(reason) {
  const el = $('code-stamp');
  el.textContent = `02 · UPDATED: ${reason.toUpperCase()}`;
  clearTimeout(stampTimer);
  stampTimer = setTimeout(() => {
    el.textContent = '02';
  }, 1800);
}

// Keystrokes within one frame become one render; the latest reason is the one stamped.
let pending = null;
export function scheduleRender(state, reason = '') {
  const queued = pending !== null;
  pending = reason || pending || '';
  if (queued)
    return;
  requestAnimationFrame(() => {
    const why = pending;
    pending = null;
    render(state);
    if (why)
      stamp(why);
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
  $('custom-size').value = state.style.size;
  echoAddress(state);
}

function echoAddress(state) {
  const address = state.fields.crypto.address.replace(/\s+/g, '');
  $('address-echo').textContent = address === '' ? '' : address.match(/.{1,4}/g).join(' ');
}

const READY_MADE = [
  [/^BEGIN:VCARD/i, 'contact card'],
  [/^MECARD:/i, 'contact card'],
  [/^BEGIN:VCALENDAR/i, 'calendar event'],
  [/^mailto:/i, 'email link'],
  [/^(tel|sms|smsto):/i, 'phone link'],
  [/^geo:/i, 'location'],
];

// The fields of a WIFI:T:..;S:..;P:..;H:..;; string, unescaped, or null.
export function parseWifi(text) {
  if (!/^WIFI:/i.test(text.trim()))
    return null;
  const fields = {};
  const body = text.trim().slice(5);
  for (const part of body.split(/(?<!\\);/)) {
    const colon = part.indexOf(':');
    if (colon > 0)
      fields[part.slice(0, colon).toUpperCase()] = part.slice(colon + 1).replace(/\\(.)/g, '$1');
  }
  if (!fields.S)
    return null;
  const security = ['WEP', 'nopass'].includes(fields.T) ? fields.T : fields.T === undefined || fields.T === '' ? 'nopass' : 'WPA';
  return { ssid: fields.S, password: fields.P ?? '', security, hidden: fields.H === 'true' };
}

// Pasting a finished payload offers to fill the matching form, or to use the text as-is under
// Text, where nothing is added to it. Nothing changes until the offer is accepted.
function offerSwitch(state, pasted) {
  const hint = $('switch-hint');
  const button = $('switch-type');
  const wifi = parseWifi(pasted);
  if (wifi) {
    button.textContent = `This is a Wi-Fi code for the network "${wifi.ssid}". Fill in the Wi-Fi form from it?`;
    button.onclick = () => {
      state.type = 'wifi';
      Object.assign(state.fields.wifi, wifi);
      hint.hidden = true;
      sync(state);
      render(state);
    };
    hint.hidden = false;
    return;
  }
  const match = READY_MADE.find(([pattern]) => pattern.test(pasted.trim()));
  if (!match || state.type === 'text') {
    hint.hidden = true;
    return;
  }
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
      stamp('type');
    });
    // Arrow keys also fire click, with detail 0; only a pointer moves focus into the form.
    radio.addEventListener('click', e => {
      if (e.detail === 0)
        return;
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
      state.fields[type][name] = input.type === 'checkbox' ? input.checked : (coerce(kind, input.value) ?? state.fields[type][name]);
      if (kind === 'string' && input.value.length > MAX_TEXT)
        input.value = state.fields[type][name];
      if (type === 'crypto')
        echoAddress(state);
      scheduleRender(state, 'content');
    });
    if (input.type !== 'checkbox')
      input.addEventListener('paste', e => offerSwitch(state, e.clipboardData.getData('text')));
  }
  for (const input of document.querySelectorAll('[data-style]')) {
    const name = input.dataset.style;
    input.addEventListener('input', () => {
      const value = input.type === 'checkbox' ? input.checked : coerce(STYLE[name], input.value);
      if (value === undefined)
        return;
      state.style[name] = value;
      saveStyle(state);
      if (name === 'quiet')
        $('quiet-out').textContent = value;
      if (name === 'logoFraction')
        $('logo-out').textContent = Math.round(value * 100);
      scheduleRender(state, CHANGE_LABELS[name] ?? name);
    });
  }
  // Shown by default: a typo is the usual reason a guest card fails.
  $('show-password').addEventListener('click', () => {
    const field = $('f-password');
    const show = field.type === 'password';
    field.type = show ? 'text' : 'password';
    $('show-password').textContent = show ? 'Hide' : 'Show';
    $('show-password').setAttribute('aria-pressed', String(show));
  });
}

function setLogo(state, logo) {
  state.logo = logo;
  $('logo-current').textContent = describeLogo(logo);
  $('logo-clear').hidden = logo === null;
  $('logo-error').textContent = '';
  if (logo === null || logo.kind !== 'file')
    $('logo-file').value = '';
  for (const button of document.querySelectorAll('[data-icon]'))
    button.setAttribute('aria-pressed', String(logo !== null && logo.kind === 'icon' && logo.value === button.dataset.icon));
  render(state);
  stamp('logo');
}

// Only the latest request lands, so a slow file decode cannot overwrite a later icon click.
let logoRequest = 0;
async function tryLogo(state, make) {
  const request = ++logoRequest;
  try {
    const logo = await make();
    if (request === logoRequest)
      setLogo(state, logo);
  } catch (err) {
    if (request !== logoRequest)
      return;
    setLogo(state, null);
    $('logo-error').textContent = err.message;
  }
}

export function bindLogo(state) {
  $('logo-file').addEventListener('change', () => {
    const file = $('logo-file').files[0];
    if (file)
      tryLogo(state, () => logoFromFile(file));
  });
  for (const button of document.querySelectorAll('[data-icon]')) {
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => tryLogo(state, () => logoFromIcon(button.dataset.icon, state.style.dark)));
  }
  $('logo-text-use').addEventListener('click', () => tryLogo(state, () => logoFromText($('logo-text').value, state.style.dark)));
  $('logo-text').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      $('logo-text-use').click();
    }
  });
  $('logo-clear').addEventListener('click', () => setLogo(state, null));
}

// A link with content in it pre-fills nothing until the visitor asks.
export function offerLinkContent(state, params) {
  const banner = $('link-banner');
  const preview = applySettings(defaultState(), key => params.get(key), { content: true });
  $('link-banner-text').textContent = `This link wants to fill in a ${describe(preview)}. Load it?`;
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


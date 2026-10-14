// Wires the form to the state and renders the state into the page. The DOM is a view of the
// state and never the store. User text reaches the page only through textContent.

import { encode, CapacityError, capacityBits, EC_LEVELS } from '../qr/encode.js';
import { sizeOf } from '../qr/tables.js';
import { drawCode } from '../render/canvas.js';
import { build } from '../payload/builders.js';
import { inspect, revealControls } from '../payload/inspect.js';
import { parseWifi, readyMadeKind } from '../payload/detect.js';
import { STYLE, FIELDS, MAX_TEXT, coerce, applySettings, styleToJson, defaultState } from './state.js';
import { assess } from './scannability.js';
import { logoBox } from '../render/logo.js';
import { logoFromFile, logoFromIcon, logoFromText, recolourLogo, describeLogo } from './logo.js';
import { $, clear } from './dom.js';
import { MM_PER_INCH, moduleMm, effectiveLevel, encodeOptions, logoOptions, styleOptions, smallestVersion, describe } from './model.js';

const LEVEL_NAMES = { L: 'Low', M: 'Medium', Q: 'Quartile', H: 'High' };
const PREVIEW_PIXELS = 640;

// What the last render produced, for the actions that export it.
let latest = { code: null, payload: '', type: 'url' };

export function current() {
  return latest;
}

function li(parent, text, className) {
  const item = document.createElement('li');
  item.textContent = text;
  if (className)
    item.className = className;
  parent.append(item);
}

function firstField(state) {
  return document.querySelector(`fieldset[data-type="${state.type}"] input, fieldset[data-type="${state.type}"] textarea`);
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

function showStats(state, code) {
  const used = Math.ceil(code.dataBits / 8);
  const room = code.capacityBits / 8;
  const kind = code.version <= 4 ? 'Small' : code.version <= 12 ? 'Medium' : 'Dense';
  $('stats').textContent = `${kind} code: ${code.size} × ${code.size} squares. Shorter content means fewer, bigger squares at the same print width, so it scans from further away.`;
  const asked = effectiveLevel(state);
  let level = `${LEVEL_NAMES[code.ecLevel]} correction`;
  if (state.logo && state.style.ecLevel !== 'H')
    level += ' (High because of the logo)';
  else if (code.ecLevel !== asked)
    level += ` (raised from ${LEVEL_NAMES[asked]} because it cost no extra size)`;
  const byLevel = EC_LEVELS.map(l => {
    const v = smallestVersion(code.dataBits, l);
    return `${LEVEL_NAMES[l]} ${v === null ? 'too long' : `${sizeOf(v)} × ${sizeOf(v)}`}`;
  });
  $('size-why').textContent = `${used} of ${room} bytes of room used, at ${level}. Codes grow in steps of 4 squares a side; this one has room for ${room - used} more bytes before the next step. The same content at each level: ${byLevel.join(' · ')}.`;
}

function capacityWarning(state, code, findings) {
  const level = effectiveLevel(state);
  const limit = capacityBits(level);
  if (code.dataBits / limit > 0.8)
    findings.push({ level: 'warn', text: `${Math.ceil(code.dataBits / 8)} of the ${limit / 8} bytes a ${LEVEL_NAMES[level]} code can hold at most. ${state.logo ? 'Remove the logo or shorten the content.' : 'Lower the error correction or shorten the content.'}` });
}

function tooLong(state, err) {
  const level = effectiveLevel(state);
  if (!Number.isFinite(err.neededBits))
    return 'Too much for one code, even at the largest size. Shorten the content.';
  const over = Math.ceil((err.neededBits - err.availableBits) / 8);
  let text = `Too much for one code: about ${over} bytes over the limit at ${LEVEL_NAMES[level]} correction.`;
  if (state.logo)
    text += ' Remove the logo or shorten the content.';
  else if (level !== 'L' && err.neededBits <= capacityBits('L'))
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

// The browser's own reader, where it has one, checks the preview once typing pauses.
let detector = null;
let checks = 0;
let checkTimer = 0;
function selfCheck(payload) {
  const check = ++checks;
  clearTimeout(checkTimer);
  if (!('BarcodeDetector' in window))
    return;
  checkTimer = setTimeout(async () => {
    const out = $('self-check');
    try {
      if (detector === null) {
        const formats = await BarcodeDetector.getSupportedFormats();
        detector = formats.includes('qr_code') ? new BarcodeDetector({ formats: ['qr_code'] }) : false;
      }
      if (!detector)
        return;
      const found = await detector.detect($('preview'));
      if (check !== checks)
        return;
      const ok = found.some(b => b.rawValue === payload);
      out.textContent = ok ? 'This browser reads the preview back correctly.' : 'This browser could not read the preview back. Try a phone before printing.';
    } catch {
      out.textContent = '';
    }
  }, 400);
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

function printLabel(state) {
  const what = state.type === 'wifi' ? 'Print guest card' : 'Print';
  return `${what} (${state.style.physical} ${state.style.unit} wide)`;
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
  if (code) {
    const total = code.size + 2 * state.style.quiet;
    drawCode(preview, code, {
      ...styleOptions(state),
      pixelsPerModule: Math.max(1, Math.floor(PREVIEW_PIXELS / total)),
      logo: logoOptions(state),
    });
    preview.setAttribute('aria-label', `QR code: ${describe(state)}`);
    showStats(state, code);
    capacityWarning(state, code, findings);
    showScannability(state, code);
    selfCheck(payload);
  } else {
    checks++;
    $('self-check').textContent = '';
  }
  $('why-size').hidden = code === null;
  $('meter').hidden = code === null;
  const list = $('findings');
  clear(list);
  for (const finding of findings)
    li(list, finding.text, finding.level);
  showPayload(state, payload);
  $('contains').hidden = payload === '';
  for (const button of document.querySelectorAll('[data-needs-code]'))
    if (!button.dataset.busy)
      button.disabled = code === null;
  $('take-empty').hidden = code !== null;
  $('take-empty').textContent = payload === '' ? 'Type something in 01 to make a code.' : 'No code yet. See the message in 02.';
  $('print').textContent = printLabel(state);
  announce(code ? $('scan-overall').textContent : `No code. ${error.textContent || findings[0]?.text || ''}`.trim());
}

// Screen readers hear one line per pause in typing, with the rating when it changed.
let announceTimer = 0;
let lastMessage = '';
function announce(message) {
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => {
    if (message === lastMessage)
      return;
    const rating = ['Good', 'Risky', 'Poor'].includes(message);
    $('announce').textContent = rating ? `Code updated. Will it scan: ${message}.` : message;
    lastMessage = message;
  }, 800);
}

// What a control changes, as the word stamped on the code pane after each update.
const CHANGE_LABELS = {
  quiet: 'border', dark: 'colours', light: 'colours', ecLevel: 'correction', boost: 'correction',
  rounded: 'square shape', logoFraction: 'logo size', logoShape: 'logo pad', caption: 'caption',
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
  $('s-physical').step = state.style.unit === 'in' ? '0.1' : '1';
  echoAddress(state);
}

function echoAddress(state) {
  const address = state.fields.crypto.address.replace(/\s+/g, '');
  $('address-echo').textContent = address === '' ? '' : address.match(/.{1,4}/g).join(' ');
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
      state.fields.wifi = applySettings(defaultState(), key => (key === 'type' ? 'wifi' : wifi[key.slice(2)]), { content: true }).fields.wifi;
      hint.hidden = true;
      sync(state);
      render(state);
      stamp('type');
    };
    hint.hidden = false;
    return;
  }
  const kind = readyMadeKind(pasted);
  if (!kind || state.type === 'text') {
    hint.hidden = true;
    return;
  }
  button.textContent = `This looks like a ready-made ${kind}. Use it exactly as pasted?`;
  button.onclick = () => {
    state.type = 'text';
    state.fields.text.text = coerce('string', pasted.trim());
    hint.hidden = true;
    sync(state);
    render(state);
    stamp('type');
  };
  hint.hidden = false;
}

// A print width typed in one unit is converted when the unit changes, so 50 mm stays 50 mm.
function changeUnit(state, unit) {
  if (unit === state.style.unit)
    return;
  const mm = state.style.unit === 'in' ? state.style.physical * MM_PER_INCH : state.style.physical;
  state.style.unit = unit;
  state.style.physical = coerce(STYLE.physical, unit === 'in' ? (mm / MM_PER_INCH).toFixed(1) : Math.round(mm));
  $('s-physical').value = state.style.physical;
  $('s-physical').step = unit === 'in' ? '0.1' : '1';
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
      if (e.detail > 0)
        firstField(state)?.focus();
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
      if (name === 'unit')
        changeUnit(state, value);
      else
        state.style[name] = value;
      if (name === 'dark')
        state.logo = recolourLogo(state.logo, value);
      saveStyle(state);
      if (name === 'quiet')
        $('quiet-out').textContent = value;
      if (name === 'logoFraction')
        $('logo-out').textContent = Math.round(value * 100);
      scheduleRender(state, CHANGE_LABELS[name] ?? name);
    });
    // A number outside its range is clamped in the state; the field shows the clamped value.
    if (input.type === 'number')
      input.addEventListener('change', () => {
        if (String(state.style[name]) !== input.value)
          input.value = state.style[name];
      });
  }
  $('switch-dismiss').addEventListener('click', () => {
    $('switch-hint').hidden = true;
  });
  // Shown by default: a typo is the usual reason a guest card fails.
  $('show-password').addEventListener('click', () => {
    const field = $('f-password');
    const show = field.type === 'password';
    field.type = show ? 'text' : 'password';
    $('show-password').textContent = show ? 'Hide' : 'Show';
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

// A link with content in it fills nothing until the visitor asks. `undo` puts back the style
// the page had before the link, for the Ignore button.
export function offerLinkContent(state, params, undo) {
  const banner = $('link-banner');
  const preview = applySettings(defaultState(), key => params.get(key), { content: true });
  $('link-banner-text').textContent = `This link fills in the form with ${describe(preview)}. Load it?`;
  banner.hidden = false;
  $('load-link').onclick = () => {
    applySettings(state, key => params.get(key), { content: true });
    banner.hidden = true;
    sync(state);
    render(state);
    stamp('link');
  };
  $('ignore-link').onclick = () => {
    banner.hidden = true;
    undo();
    history.replaceState(null, '', location.pathname);
    sync(state);
    render(state);
  };
}

export function hideLinkBanner() {
  $('link-banner').hidden = true;
}

// The one state object, its schema, and the two places it is read from and written to: the URL
// fragment and local storage. Everything that arrives from either is checked against the
// schema; unknown keys are dropped and values clamped.

export const TYPES = ['url', 'text', 'wifi', 'contact', 'email', 'sms', 'phone', 'event', 'geo', 'crypto'];

const S = 'string';
const B = 'boolean';

export const FIELDS = {
  url: { url: S },
  text: { text: S },
  wifi: { ssid: S, password: S, security: ['WPA', 'WEP', 'nopass'], hidden: B },
  contact: {
    firstName: S, lastName: S, org: S, title: S, phone: S, mobile: S, email: S, url: S,
    street: S, city: S, region: S, postcode: S, country: S, note: S, compact: B,
  },
  email: { to: S, subject: S, body: S },
  sms: { number: S, message: S },
  phone: { number: S },
  event: { title: S, location: S, description: S, start: S, end: S, allDay: B },
  geo: { lat: S, lng: S, format: ['maps', 'geo'] },
  crypto: { coin: ['bitcoin', 'ethereum'], address: S, amount: S },
};

export const STYLE = {
  ecLevel: ['L', 'M', 'Q', 'H'],
  quiet: { int: [0, 8] },
  dark: 'colour',
  light: 'colour',
  rounded: B,
  size: { int: [64, 4096] },
  unit: ['px', 'mm', 'in'],
  physical: { number: [5, 2000] },
  caption: S,
  logoFraction: { number: [0.1, 0.3] },
  logoShape: ['square', 'rounded', 'circle', 'none'],
  invertedOk: B,
  eci: B,
  boost: B,
};

export const MAX_TEXT = 4500;
export const MAX_FRAGMENT = 8000;

export function defaultState() {
  const fields = {};
  for (const type of TYPES) {
    fields[type] = {};
    for (const [name, kind] of Object.entries(FIELDS[type]))
      fields[type][name] = kind === B ? false : Array.isArray(kind) ? kind[0] : '';
  }
  fields.wifi.security = 'WPA';
  return {
    type: 'url',
    fields,
    style: {
      ecLevel: 'M', quiet: 4, dark: '#000000', light: '#ffffff', rounded: false,
      size: 1024, unit: 'px', physical: 50, caption: '', logoFraction: 0.2, logoShape: 'square',
      invertedOk: false, eci: false, boost: true,
    },
  };
}

// One value through the schema, or undefined when it does not fit.
export function coerce(kind, raw) {
  if (raw === undefined || raw === null)
    return undefined;
  const text = String(raw);
  if (kind === S)
    return text.slice(0, MAX_TEXT);
  if (kind === B)
    return text === '1' || text === 'true';
  if (kind === 'colour')
    return /^#?[0-9a-f]{6}$/i.test(text) ? `#${text.replace('#', '').toLowerCase()}` : undefined;
  if (Array.isArray(kind))
    return kind.includes(text) ? text : undefined;
  const value = Number(text);
  if (text.trim() === '' || !Number.isFinite(value))
    return undefined;
  const [low, high] = kind.int ?? kind.number;
  const clamped = Math.min(high, Math.max(low, value));
  return kind.int ? Math.round(clamped) : clamped;
}

// Style and type from a flat key-value source; content fields too when `content` is set.
export function applySettings(state, get, { content = false } = {}) {
  for (const [name, kind] of Object.entries(STYLE)) {
    const value = coerce(kind, get(name));
    if (value !== undefined)
      state.style[name] = value;
  }
  const type = coerce(TYPES, get('type'));
  if (type !== undefined)
    state.type = type;
  if (content && type !== undefined)
    for (const [name, kind] of Object.entries(FIELDS[type])) {
      const value = coerce(kind, get(`f.${name}`));
      if (value !== undefined)
        state.fields[type][name] = value;
    }
  return state;
}

function encodeValue(kind, value) {
  if (kind === B)
    return value ? '1' : '0';
  if (kind === 'colour')
    return value.slice(1);
  return String(value);
}

export function serialize(state, { content = false } = {}) {
  const params = new URLSearchParams();
  params.set('v', '1');
  params.set('type', state.type);
  const defaults = defaultState().style;
  for (const [name, kind] of Object.entries(STYLE))
    if (state.style[name] !== defaults[name])
      params.set(name, encodeValue(kind, state.style[name]));
  if (content)
    for (const [name, kind] of Object.entries(FIELDS[state.type])) {
      const value = state.fields[state.type][name];
      if (value !== '' && value !== false)
        params.set(`f.${name}`, encodeValue(kind, value));
    }
  return params.toString();
}

export function parseFragment(hash) {
  const text = hash.replace(/^#/, '');
  if (text === '' || text.length > MAX_FRAGMENT)
    return null;
  const params = new URLSearchParams(text);
  if (params.get('v') !== '1')
    return null;
  return params;
}

export function hasContent(params) {
  for (const key of params.keys())
    if (key.startsWith('f.'))
      return true;
  return false;
}

// The caption is user text, so it is shareable in a link but never kept on the device.
export function styleToJson(state) {
  const { caption, ...kept } = state.style;
  return JSON.stringify(kept);
}

export function styleFromJson(state, json) {
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    return state;
  }
  if (typeof parsed !== 'object' || parsed === null)
    return state;
  return applySettings(state, name => parsed[name]);
}

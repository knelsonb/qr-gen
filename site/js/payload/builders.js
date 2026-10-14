// Each builder turns a form's fields into the string a reader expects. Trimmed, with empty
// fields left out.

import { escapeWifi, escapeVcard, escapeMecard, escapeIcal, foldIcal } from './escape.js';

const trim = value => String(value ?? '').trim();

// Schemes that carry no // after them, so that host:port is still read as a host.
const BARE_SCHEMES = ['mailto', 'tel', 'sms', 'smsto', 'geo', 'bitcoin', 'ethereum', 'javascript', 'data', 'vbscript', 'file', 'about', 'blob'];

export function hasScheme(text) {
  const match = text.match(/^([a-z][a-z0-9+.-]*):(\/\/)?/i);
  if (!match)
    return false;
  return match[2] !== undefined || BARE_SCHEMES.includes(match[1].toLowerCase());
}

// Tabs and line breaks vanish inside a browser's URL parser, so they go here too, and the
// inspector judges the same string a reader will see.
export function url(f) {
  const text = trim(f.url).replace(/[\t\r\n]/g, '');
  if (text === '' || hasScheme(text))
    return text;
  return `https://${text}`;
}

export function text(f) {
  return String(f.text ?? '');
}

// The de-facto format phones read: WIFI:T:<type>;S:<ssid>;P:<password>;H:true;;
// WPA, WPA2 and WPA3 all go out as WPA, which every phone accepts.
export function wifi(f) {
  const ssid = trim(f.ssid);
  if (ssid === '')
    return '';
  const security = f.security === 'nopass' || f.security === 'WEP' ? f.security : 'WPA';
  let out = `WIFI:T:${security};S:${escapeWifi(ssid)};`;
  if (security !== 'nopass')
    out += `P:${escapeWifi(String(f.password ?? ''))};`;
  if (f.hidden)
    out += 'H:true;';
  return `${out};`;
}

function contactLines(f) {
  return {
    first: trim(f.firstName),
    last: trim(f.lastName),
    org: trim(f.org),
    title: trim(f.title),
    phone: trim(f.phone),
    mobile: trim(f.mobile),
    email: trim(f.email),
    url: trim(f.url),
    street: trim(f.street),
    city: trim(f.city),
    region: trim(f.region),
    postcode: trim(f.postcode),
    country: trim(f.country),
    note: trim(f.note),
  };
}

export function vcard(f) {
  const c = contactLines(f);
  if (c.first === '' && c.last === '' && c.org === '')
    return '';
  const lines = ['BEGIN:VCARD', 'VERSION:3.0'];
  lines.push(`N:${escapeVcard(c.last)};${escapeVcard(c.first)};;;`);
  lines.push(`FN:${escapeVcard([c.first, c.last].filter(Boolean).join(' ') || c.org)}`);
  if (c.org) lines.push(`ORG:${escapeVcard(c.org)}`);
  if (c.title) lines.push(`TITLE:${escapeVcard(c.title)}`);
  if (c.phone) lines.push(`TEL;TYPE=WORK,VOICE:${escapeVcard(c.phone)}`);
  if (c.mobile) lines.push(`TEL;TYPE=CELL:${escapeVcard(c.mobile)}`);
  if (c.email) lines.push(`EMAIL:${escapeVcard(c.email)}`);
  if (c.url) lines.push(`URL:${escapeVcard(c.url)}`);
  if (c.street || c.city || c.region || c.postcode || c.country)
    lines.push(`ADR;TYPE=WORK:;;${[c.street, c.city, c.region, c.postcode, c.country].map(escapeVcard).join(';')}`);
  if (c.note) lines.push(`NOTE:${escapeVcard(c.note)}`);
  lines.push('END:VCARD');
  return `${lines.join('\r\n')}\r\n`;
}

// The compact contact format; about half the size of a vCard.
export function mecard(f) {
  const c = contactLines(f);
  if (c.first === '' && c.last === '' && c.org === '')
    return '';
  const parts = [`N:${escapeMecard(c.last)},${escapeMecard(c.first)}`];
  if (c.org) parts.push(`ORG:${escapeMecard(c.org)}`);
  if (c.phone) parts.push(`TEL:${escapeMecard(c.phone)}`);
  if (c.mobile) parts.push(`TEL:${escapeMecard(c.mobile)}`);
  if (c.email) parts.push(`EMAIL:${escapeMecard(c.email)}`);
  if (c.url) parts.push(`URL:${escapeMecard(c.url)}`);
  const address = [c.street, c.city, c.region, c.postcode, c.country].filter(Boolean).join(', ');
  if (address) parts.push(`ADR:${escapeMecard(address)}`);
  if (c.note) parts.push(`NOTE:${escapeMecard(c.note)}`);
  return `MECARD:${parts.join(';')};;`;
}

export function contact(f) {
  return f.compact ? mecard(f) : vcard(f);
}

export function email(f) {
  const to = trim(f.to);
  if (to === '')
    return '';
  const query = [];
  if (trim(f.subject)) query.push(`subject=${encodeURIComponent(trim(f.subject))}`);
  if (trim(f.body)) query.push(`body=${encodeURIComponent(String(f.body))}`);
  return `mailto:${encodeURIComponent(to).replace(/%40/g, '@')}${query.length ? `?${query.join('&')}` : ''}`;
}

export function phoneNumber(value) {
  return trim(value).replace(/[\s().-]/g, '');
}

export function phone(f) {
  const number = phoneNumber(f.number);
  return number === '' ? '' : `tel:${number}`;
}

// SMSTO is read by more phones than sms:?body=.
export function sms(f) {
  const number = phoneNumber(f.number);
  if (number === '')
    return '';
  return `SMSTO:${number}:${String(f.message ?? '')}`;
}

const DECIMAL = /^-?\d+(\.\d+)?$/;

export function geo(f) {
  const lat = Number(trim(f.lat));
  const lng = Number(trim(f.lng));
  if (!DECIMAL.test(trim(f.lat)) || !DECIMAL.test(trim(f.lng)) || Math.abs(lat) > 90 || Math.abs(lng) > 180)
    return '';
  if (f.format === 'geo')
    return `geo:${lat},${lng}`;
  return `https://www.google.com/maps/search/?api=1&query=${lat}%2C${lng}`;
}

// A date-time input's value as an iCalendar stamp, in UTC for timed events; null when it is
// not a date.
function icalStamp(local, allDay) {
  if (allDay)
    return /^\d{4}-\d{2}-\d{2}/.test(local) ? local.slice(0, 10).replace(/-/g, '') : null;
  const date = new Date(local);
  if (Number.isNaN(date.getTime()))
    return null;
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function event(f) {
  const title = trim(f.title);
  const allDay = Boolean(f.allDay);
  const start = icalStamp(trim(f.start), allDay);
  if (title === '' || start === null)
    return '';
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//qr.thetallkeith.com//EN', 'BEGIN:VEVENT'];
  lines.push(`SUMMARY:${escapeIcal(title)}`);
  lines.push(allDay ? `DTSTART;VALUE=DATE:${start}` : `DTSTART:${start}`);
  const end = icalStamp(trim(f.end), allDay);
  if (end !== null)
    lines.push(allDay ? `DTEND;VALUE=DATE:${end}` : `DTEND:${end}`);
  if (trim(f.location)) lines.push(`LOCATION:${escapeIcal(trim(f.location))}`);
  if (trim(f.description)) lines.push(`DESCRIPTION:${escapeIcal(trim(f.description))}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return `${lines.map(foldIcal).join('\r\n')}\r\n`;
}

export function crypto(f) {
  const address = trim(f.address).replace(/\s+/g, '');
  if (address === '')
    return '';
  const coin = f.coin === 'ethereum' ? 'ethereum' : 'bitcoin';
  // Wallets expect a plain decimal, so the amount goes out as typed once it is one.
  const amount = trim(f.amount);
  const query = DECIMAL.test(amount) && Number(amount) > 0 ? `?amount=${amount}` : '';
  return `${coin}:${address}${query}`;
}

export const BUILDERS = { url, text, wifi, contact, email, sms, phone, event, geo, crypto };

export function build(type, fields) {
  const builder = BUILDERS[type];
  return builder ? builder(fields ?? {}) : '';
}

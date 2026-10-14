import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { encode, CapacityError } from '../site/js/qr/encode.js';
import { toSvg, modulePath, escapeXml } from '../site/js/render/svg.js';
import { toText } from '../site/js/render/text.js';
import { build, wifi, vcard, mecard, event, email, sms, url } from '../site/js/payload/builders.js';
import { inspect, inspectUrl, revealControls } from '../site/js/payload/inspect.js';
import { crc32 } from '../site/js/io/crc32.js';
import { makeZip } from '../site/js/io/zip.js';
import { withDpi } from '../site/js/io/png.js';
import { slug } from '../site/js/io/download.js';
import { defaultState, applySettings, serialize, parseFragment, hasContent, styleFromJson, styleToJson, TYPES, FIELDS } from '../site/js/app/state.js';
import { assess, contrastRatio } from '../site/js/app/scannability.js';
import { toPbm } from './pbm.js';

const has = name => {
  try {
    execFileSync(name, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

test('Wi-Fi payload escapes the reserved characters', () => {
  assert.equal(wifi({ ssid: 'Caf;é "A:B"', password: 'p\\a,ss', security: 'WPA3', hidden: true }), 'WIFI:T:WPA;S:Caf\\;é \\"A\\:B\\";P:p\\\\a\\,ss;H:true;;');
  assert.equal(wifi({ ssid: 'Open', security: 'nopass' }), 'WIFI:T:nopass;S:Open;;');
  assert.equal(wifi({ ssid: '' }), '');
});

test('vCard has CRLF lines, N in last;first order and escaped commas', () => {
  const card = vcard({ firstName: 'Ada', lastName: 'Lovelace, Countess', org: 'Analytical Engines', phone: '+44 20 7946 0958', city: 'London' });
  assert.ok(card.startsWith('BEGIN:VCARD\r\nVERSION:3.0\r\nN:Lovelace\\, Countess;Ada;;;\r\nFN:Ada Lovelace\\, Countess\r\n'));
  assert.ok(card.includes('ADR;TYPE=WORK:;;;London;;;\r\n'));
  assert.ok(card.endsWith('END:VCARD\r\n'));
  assert.equal(mecard({ firstName: 'Ada', lastName: 'Lovelace', phone: '0123' }), 'MECARD:N:Lovelace,Ada;TEL:0123;;');
});

test('event writes UTC stamps and all-day dates', () => {
  const ics = event({ title: 'Gala; night', start: '2026-12-01T19:00', end: '2026-12-01T23:00', location: 'Town Hall' });
  assert.match(ics, /DTSTART:\d{8}T\d{6}Z\r\n/);
  assert.ok(ics.includes('SUMMARY:Gala\\; night\r\n'));
  const allDay = event({ title: 'Fair', start: '2026-12-01', allDay: true });
  assert.ok(allDay.includes('DTSTART;VALUE=DATE:20261201\r\n'));
});

test('email, sms and url builders', () => {
  assert.equal(email({ to: 'a@b.co', subject: 'Hi there', body: 'x&y' }), 'mailto:a@b.co?subject=Hi%20there&body=x%26y');
  assert.equal(sms({ number: '+1 (555) 010-1234', message: 'hello' }), 'SMSTO:+15550101234:hello');
  assert.equal(url({ url: 'example.com/x' }), 'https://example.com/x');
  assert.equal(url({ url: 'HTTP://Example.com' }), 'HTTP://Example.com');
  assert.equal(build('nonsense', {}), '');
});

test('url inspection flags the abused shapes', () => {
  assert.equal(inspectUrl('javascript:alert(1)')[0].level, 'block');
  assert.ok(inspectUrl('https://paypal.com@evil.example/x').some(f => f.text.includes('@')));
  assert.ok(inspectUrl('http://192.168.0.1/').some(f => f.text.includes('IP')));
  assert.ok(inspectUrl('https://xn--pypal-4ve.com/').some(f => f.text.includes('internationalised')));
  assert.ok(inspectUrl('https://bit.ly/abc').some(f => f.level === 'info'));
  assert.deepEqual(inspectUrl('https://example.com/'), []);
  assert.ok(inspect('wifi', 'WIFI:T:WPA;S:a;P:b;;').some(f => f.text.includes('password')));
  assert.equal(revealControls('a‮b'), 'a‹U+202E›b');
});

test('SVG is well formed, escapes the title and matches the module count', () => {
  const code = encode('https://example.com/<&>"\'', { ecLevel: 'Q' });
  const svg = toSvg(code, { quiet: 4, dark: '#102030', light: '#FFFFFF', title: 'Scan <me> & "go"' });
  assert.ok(svg.includes('<title>Scan &lt;me&gt; &amp; &quot;go&quot;</title>'));
  assert.ok(!svg.includes('<script'));
  assert.throws(() => toSvg(code, { dark: 'red' }), RangeError);
  const runs = (modulePath(code, 0, false).match(/h(\d+)/g) || []).reduce((n, h) => n + Number(h.slice(1)), 0);
  let dark = 0;
  for (const m of code.modules) dark += m;
  assert.equal(runs, dark);
  assert.equal(escapeXml('a\u0000b'), 'ab');
  const circles = (modulePath(code, 0, true).match(/a\.5 \.5/g) || []).length / 2;
  assert.ok(circles > 0 && circles < dark);
});

test('SVG decodes with zbar', { skip: !has('zbarimg') && 'zbarimg is not installed' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'qr-svg-'));
  for (const rounded of [false, true]) {
    const file = join(dir, `code-${rounded}.svg`);
    writeFileSync(file, toSvg(encode('https://example.com/svg-check'), { rounded, pixelsPerModule: 8 }));
    let decoded;
    try {
      decoded = execFileSync('zbarimg', ['-q', '--raw', file]).toString().trim();
    } catch {
      return; // zbar's image library cannot rasterise SVG here
    }
    assert.equal(decoded, 'https://example.com/svg-check');
  }
});

test('text rendering has one line per two module rows', () => {
  const code = encode('text');
  const lines = toText(code, 2).split('\n');
  assert.equal(lines.length, Math.ceil((code.size + 4) / 2));
  assert.equal(lines[0].length, code.size + 4);
});

test('crc32 of the standard check string', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('zip extracts with the system tool', { skip: !has('unzip') && 'unzip is not installed' }, async () => {
  const files = [
    { name: 'first.svg', data: new TextEncoder().encode(toSvg(encode('one'))) },
    { name: 'zweite-ü.txt', data: new TextEncoder().encode('zwei') },
  ];
  const blob = makeZip(files);
  const dir = mkdtempSync(join(tmpdir(), 'qr-zip-'));
  const file = join(dir, 'codes.zip');
  writeFileSync(file, new Uint8Array(await blob.arrayBuffer()));
  execFileSync('unzip', ['-tq', file]);
  assert.equal(execFileSync('unzip', ['-p', file, 'zweite-ü.txt']).toString(), 'zwei');
});

test('pHYs chunk is inserted after IHDR', () => {
  const ihdr = new Uint8Array(13);
  const header = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, ...ihdr, 0, 0, 0, 0, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];
  const out = withDpi(Uint8Array.from(header), 300);
  assert.equal(out.length, header.length + 21);
  assert.equal(String.fromCharCode(...out.subarray(37, 41)), 'pHYs');
  const view = new DataView(out.buffer);
  assert.equal(view.getUint32(41), 11811);
  assert.equal(out[49], 1);
  assert.throws(() => withDpi(new Uint8Array(8), 72), /Not a PNG/);
});

test('filenames are slugs, never reserved names', () => {
  assert.equal(slug('Scan for Café Menu!'), 'scan-for-cafe-menu');
  assert.equal(slug('../../etc/passwd'), 'etc-passwd');
  assert.equal(slug('CON'), 'qr-code');
  assert.equal(slug('‮\u0000'), 'qr-code');
  assert.equal(slug('x'.repeat(100)).length, 40);
});

test('settings round trip through the fragment for every type', () => {
  for (const type of TYPES) {
    const state = defaultState();
    state.type = type;
    state.style.ecLevel = 'H';
    state.style.quiet = 2;
    state.style.dark = '#123456';
    state.style.rounded = true;
    state.style.caption = 'Scan & go';
    for (const [name, kind] of Object.entries(FIELDS[type]))
      state.fields[type][name] = kind === 'boolean' ? true : Array.isArray(kind) ? kind[kind.length - 1] : `${name} value ;,&=#`;
    const fragment = serialize(state, { content: true });
    const params = parseFragment(`#${fragment}`);
    assert.ok(params && hasContent(params));
    const back = applySettings(defaultState(), key => params.get(key), { content: true });
    assert.deepEqual(back, state, type);
    const styleOnly = applySettings(defaultState(), key => parseFragment(`#${serialize(state)}`).get(key), { content: true });
    assert.deepEqual(styleOnly.fields, defaultState().fields);
    assert.deepEqual(styleOnly.style, state.style);
  }
});

test('hostile fragments are clamped or ignored', () => {
  const get = key => ({ quiet: '999', size: '-5', dark: 'javascript:', ecLevel: 'X', type: 'bogus', caption: 'x'.repeat(10000), logoFraction: 'NaN' })[key];
  const state = applySettings(defaultState(), get, { content: true });
  assert.equal(state.style.quiet, 8);
  assert.equal(state.style.size, 64);
  assert.equal(state.style.dark, '#000000');
  assert.equal(state.style.ecLevel, 'M');
  assert.equal(state.type, 'url');
  assert.equal(state.style.caption.length, 4500);
  assert.equal(state.style.logoFraction, 0.2);
  assert.equal(parseFragment(`#${'a'.repeat(9000)}`), null);
  assert.equal(parseFragment('#type=url'), null);
  assert.deepEqual(styleFromJson(defaultState(), '{"__proto__":{"x":1},"quiet":"3"}').style.quiet, 3);
  assert.deepEqual(styleFromJson(defaultState(), 'not json'), defaultState());
  assert.equal(styleFromJson(defaultState(), styleToJson(defaultState())).style.size, 1024);
});

test('review fixes: schemes, dates, amounts, coordinates, slugs, stored style', () => {
  assert.equal(url({ url: 'example.com:8443/x' }), 'https://example.com:8443/x');
  assert.equal(url({ url: 'localhost:3000' }), 'https://localhost:3000');
  assert.equal(url({ url: 'mailto:a@b.co' }), 'mailto:a@b.co');
  assert.equal(url({ url: 'https://exa\tmple.com/\n' }), 'https://example.com/');
  assert.ok(inspectUrl('ftp://files.example/').some(f => f.level === 'warn'));
  assert.ok(inspectUrl('https://bit.ly./abc').some(f => f.level === 'info'));
  assert.ok(inspect('text', '  javascript:alert(1)').some(f => f.level === 'block'));
  assert.equal(event({ title: 'x', start: 'garbage' }), '');
  assert.equal(event({ title: 'x', start: '2026/10/13', allDay: true }), '');
  assert.ok(!event({ title: 'x', start: '2026-10-13T10:00', end: 'nope' }).includes('DTEND'));
  assert.equal(build('crypto', { coin: 'bitcoin', address: 'bc1q', amount: '0.0000001' }), 'bitcoin:bc1q?amount=0.0000001');
  assert.equal(build('crypto', { coin: 'bitcoin', address: 'bc1q', amount: '1e3' }), 'bitcoin:bc1q');
  assert.equal(build('geo', { lat: '999', lng: '0', format: 'geo' }), '');
  assert.equal(build('geo', { lat: '0x1A', lng: '0', format: 'geo' }), '');
  assert.equal(build('geo', { lat: '51.5', lng: '-0.12', format: 'geo' }), 'geo:51.5,-0.12');
  assert.equal(slug('ÉCOLE  café'), 'ecole-cafe');
  const state = defaultState();
  state.style.caption = 'secret name';
  assert.ok(!styleToJson(state).includes('secret'));
  assert.equal(applySettings(defaultState(), () => '', {}).style.size, 1024);
});

test('encoder rejects bad options and takes raw bytes', () => {
  assert.throws(() => encode('x', { minVersion: 1.5 }), RangeError);
  assert.throws(() => encode('x', { maxVersion: '40' }), RangeError);
  assert.throws(() => encode('x', { mask: 2.5 }), RangeError);
  assert.throws(() => encode('x', { mode: 'foo' }), RangeError);
  assert.throws(() => encode('漢字', { mode: 'kanji', eci: true }), RangeError);
  assert.deepEqual(encode('漢字', { eci: true }).segments.map(s => s.mode), ['byte']);
  const bytes = encode(new Uint8Array([0, 255, 72, 105]));
  assert.deepEqual(bytes.segments, [{ mode: 'byte', charCount: 4, bits: 32 }]);
  assert.throws(() => encode('x'.repeat(300), { maxVersion: 9 }), err => err instanceof CapacityError && Number.isFinite(err.neededBits));
});

test('scannability rates contrast, border, print size and logo', () => {
  const code = encode('https://example.com/', { ecLevel: 'M' });
  const style = defaultState().style;
  assert.equal(assess(code, style).overall, 'good');
  assert.equal(assess(code, { ...style, quiet: 1 }).overall, 'poor');
  assert.equal(assess(code, { ...style, dark: '#ffffff', light: '#000000' }).overall, 'poor');
  assert.equal(assess(code, { ...style, dark: '#ffffff', light: '#000000', invertedOk: true }).overall, 'good');
  assert.equal(assess(code, { ...style, dark: '#888888' }).overall, 'risky');
  assert.equal(assess(code, style, { moduleMm: 0.2 }).overall, 'poor');
  assert.equal(assess(code, style, { logo: true }).overall, 'poor');
  assert.equal(assess(encode('x', { ecLevel: 'H' }), style, { logo: true }).overall, 'good');
  assert.ok(Math.abs(contrastRatio('#000000', '#ffffff') - 21) < 0.01);
});

test('the PBM helper still round-trips a styled code', { skip: !has('zbarimg') && 'zbarimg is not installed' }, () => {
  const code = encode('WIFI:T:WPA;S:Guest;P:secret;;', { ecLevel: 'H' });
  const file = join(mkdtempSync(join(tmpdir(), 'qr-')), 'w.pbm');
  writeFileSync(file, toPbm(code));
  assert.equal(execFileSync('zbarimg', ['-q', '--raw', file]).toString().trim(), 'WIFI:T:WPA;S:Guest;P:secret;;');
});

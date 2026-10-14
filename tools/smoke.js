// Drives the page in headless Chromium over the DevTools protocol: types into the form, reads
// what the page shows, downloads a PNG, an SVG and a batch zip, and decodes the PNG with zbar.
// Run with the site served at http://127.0.0.1:8765/: node tools/smoke.js

import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const PORT = 9333;
const SITE = 'http://127.0.0.1:8765/';
const downloads = mkdtempSync(join(tmpdir(), 'qr-dl-'));
const profile = mkdtempSync(join(tmpdir(), 'qr-profile-'));

const chrome = spawn('chromium', ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1300,1100', 'about:blank'], { stdio: 'ignore' });

async function debuggerUrl() {
  for (let i = 0; i < 100; i++) {
    try {
      const tabs = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = tabs.find(t => t.type === 'page');
      if (page)
        return page.webSocketDebuggerUrl;
    } catch {
      // not up yet
    }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('Chromium did not start');
}

const ws = new WebSocket(await debuggerUrl());
await new Promise(r => { ws.onopen = r; });
let nextId = 0;
const pending = new Map();
const problems = [];
const finished = [];
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id) {
    pending.get(m.id)(m);
    pending.delete(m.id);
    return;
  }
  if (m.method === 'Runtime.exceptionThrown')
    problems.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error')
    problems.push(m.params.entry.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
    problems.push(m.params.args.map(a => a.value ?? a.description).join(' '));
  if (m.method === 'Browser.downloadProgress' && m.params.state === 'completed')
    finished.push(m.params.guid);
};
const send = (method, params = {}) => new Promise(resolve => {
  const id = ++nextId;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});

async function run(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails)
    throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
  return r.result.result.value;
}

const settle = () => run('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 50))))');
const text = id => run(`document.getElementById(${JSON.stringify(id)}).textContent`);
const setInput = async (id, value) => {
  await run(`(() => { const el = document.getElementById(${JSON.stringify(id)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await settle();
};
const click = async selector => {
  await run(`document.querySelector(${JSON.stringify(selector)}).click()`);
  await settle();
};
async function screenshot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const path = join(tmpdir(), `qr-${name}.png`);
  writeFileSync(path, Buffer.from(r.result.data, 'base64'));
  console.log(`screenshot: ${path}`);
}
async function waitForDownloads(count) {
  for (let i = 0; i < 100 && finished.length < count; i++)
    await new Promise(r => setTimeout(r, 100));
  assert.equal(finished.length, count, 'downloads completed');
}

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true });
await send('Page.navigate', { url: SITE });
await new Promise(r => setTimeout(r, 800));

// A link.
await setInput('f-url', 'example.com/menu');
assert.match(await text('stats'), /^Version \d+ · \d+×\d+ modules · \d+ of \d+ bytes · \w+ correction$/);
assert.equal(await text('scan-overall'), 'Good');
assert.equal(await text('payload'), 'https://example.com/menu');
assert.equal(await run("document.getElementById('preview').hidden"), false);
assert.equal(await run("document.getElementById('preview').getAttribute('aria-label')"), 'QR code: link to example.com');
await run("document.querySelector('#more-panel').open = true");
await screenshot('desktop');
await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 900, deviceScaleFactor: 2, mobile: true });
await settle();
await screenshot('phone');
await send('Emulation.clearDeviceMetricsOverride');
await settle();

// A script link is blocked.
await setInput('f-url', 'javascript:alert(1)');
assert.match(await text('findings'), /runs code/);
assert.equal(await run("document.getElementById('preview').hidden"), true);
assert.equal(await run("document.querySelector('[data-png-size=\"1024\"]').disabled"), true);

// A look-alike host is warned about but still encoded.
await setInput('f-url', 'https://paypal.com@evil.example/');
assert.match(await text('findings'), /login before the @/);
assert.equal(await run("document.getElementById('preview').hidden"), false);

// Wi-Fi with reserved characters.
await click('input[name="type"][value="wifi"]');
await setInput('f-ssid', 'Café;Bar');
await setInput('f-password', 'p:w');
assert.equal(await text('payload'), ['WIFI:T:WPA;S:Caf', 'é\\', ';Bar;P:p\\:w;;'].join(''));
assert.match(await text('findings'), /password is in the code/);
assert.equal(await run("document.getElementById('preview').getAttribute('aria-label')"), 'QR code: Wi-Fi network Café;Bar');

// Border slider drives the rating.
await setInput('s-quiet', '1');
assert.equal(await text('scan-overall'), 'Poor');
await setInput('s-quiet', '4');
assert.equal(await text('scan-overall'), 'Good');

// Print width in mm feeds the print-size factor.
await setInput('s-unit', 'mm');
await setInput('s-physical', '10');
assert.match(await text('scan-factors'), /Print size: Modules of/);
await setInput('s-unit', 'px');

// Too much text.
await click('input[name="type"][value="text"]');
await setInput('f-text', 'x'.repeat(3200));
assert.match(await text('error'), /Too much for one code/);
await setInput('f-text', 'short');
assert.equal(await text('error'), '');

// Logos: an icon, then letters, with a circle pad; the PNG must still decode.
await run("document.querySelector('#more-panel').open = true");
await click('[data-icon="wifi"]');
assert.equal(await run("document.getElementById('logo-clear').hidden"), false);
assert.match(await text('logo-current'), /Wi-Fi icon/);
assert.match(await text('scan-factors'), /Logo:/);
assert.match(await text('stats'), /High correction/);
await setInput('logo-text', 'MENU');
await click('#logo-text-use');
await new Promise(r => setTimeout(r, 300));
assert.match(await text('logo-current'), /letters MENU/);
await setInput('s-logoShape', 'circle');
await click('input[name="type"][value="url"]');
await setInput('f-url', 'https://qr.thetallkeith.com/logo');
await click('[data-png-size="1024"]');
await waitForDownloads(1);
await new Promise(r => setTimeout(r, 300));
assert.equal(execFileSync('zbarimg', ['-q', '--raw', join(downloads, 'link-to-qr-thetallkeith-com.png')]).toString().trim(), 'https://qr.thetallkeith.com/logo');
await setInput('s-logoShape', 'none');
assert.match(await text('scan-factors'), /Logo pad/);
await click('#logo-clear');
assert.equal(await run("document.getElementById('logo-clear').hidden"), true);
await setInput('s-logoShape', 'square');
finished.length = 0;

// Downloads: PNG, SVG and a batch zip.
await click('input[name="type"][value="url"]');
await setInput('f-url', 'https://qr.thetallkeith.com/smoke');
await setInput('s-caption', 'Smoke test');
await click('[data-png-size="1024"]');
await click('#download-svg');
await setInput('batch-text', 'https://example.com/1\nhttps://example.com/2\nWIFI:T:WPA;S:a;P:b;;');
await click('#batch-svg');
await waitForDownloads(3);
await new Promise(r => setTimeout(r, 300));
const files = readdirSync(downloads).sort();
assert.deepEqual(files, ['link-to-qr-thetallkeith-com.png', 'qr-codes.zip', 'smoke-test.png', 'smoke-test.svg']);
assert.equal(execFileSync('zbarimg', ['-q', '--raw', join(downloads, 'smoke-test.png')]).toString().trim(), 'https://qr.thetallkeith.com/smoke');
assert.ok(readFileSync(join(downloads, 'smoke-test.svg'), 'utf8').includes('<title>Smoke test</title>'));
execFileSync('unzip', ['-tq', join(downloads, 'qr-codes.zip')]);
assert.equal(execFileSync('unzip', ['-Z1', join(downloads, 'qr-codes.zip')]).toString().trim().split('\n').length, 3);

// A link with content shows the banner and fills nothing until asked.
await send('Page.navigate', { url: `${SITE}#v=1&type=wifi&ecLevel=H&f.ssid=Guest&f.password=pw` });
await new Promise(r => setTimeout(r, 800));
assert.equal(await run("document.getElementById('link-banner').hidden"), false);
assert.notEqual(await run("document.getElementById('f-ssid').value"), 'Guest');
assert.equal(await run("document.getElementById('s-ecLevel').value"), 'H');
await click('#load-link');
assert.equal(await run("document.getElementById('f-ssid').value"), 'Guest');
assert.equal(await text('payload'), 'WIFI:T:WPA;S:Guest;P:pw;;');
assert.equal(await run("document.getElementById('link-banner').hidden"), true);

// Settings that arrived in a link are not kept; settings the visitor changes are, content is not.
await send('Page.navigate', { url: 'about:blank' });
await send('Page.navigate', { url: SITE });
await new Promise(r => setTimeout(r, 800));
assert.equal(await run("document.getElementById('s-ecLevel').value"), 'M');
assert.equal(await run("document.getElementById('f-ssid').value"), '');
await setInput('s-ecLevel', 'Q');
await setInput('s-caption', 'not kept');
await send('Page.navigate', { url: 'about:blank' });
await send('Page.navigate', { url: SITE });
await new Promise(r => setTimeout(r, 800));
assert.equal(await run("document.getElementById('s-ecLevel').value"), 'Q');
assert.equal(await run("document.getElementById('s-caption').value"), '');
await click('#forget');
assert.equal(await run("document.getElementById('s-ecLevel').value"), 'M');
assert.equal(await run("localStorage.getItem('qr-settings')"), null);
assert.match(await text('count-line'), /^\d+ CODES MADE HERE/);
await setInput('f-url', 'https://example.com/custom');
await setInput('custom-size', '300');
await click('#download-custom');
await waitForDownloads(4);

// A batch line with a script link is skipped, the rest are made.
await setInput('batch-text', 'javascript:alert(1)\nhttps://example.com/ok');
await click('#batch-svg');
await waitForDownloads(5);
assert.match(await text('batch-status'), /Done: 1 codes\. Lines 1/);

// No network requests after load except the page's own files.
const requests = await run("performance.getEntriesByType('resource').map(e => new URL(e.name).origin).filter(o => o !== location.origin)");
assert.deepEqual(requests, []);

ws.close();
chrome.kill();
if (problems.length) {
  console.error('Console problems:\n' + problems.join('\n'));
  process.exit(1);
}
console.log('smoke: all checks passed');

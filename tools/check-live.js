// Checks a deployed copy: the security headers, the cache rule on sw.js, and that every file
// the service worker caches is served. Run: node tools/check-live.js https://qr.thetallkeith.com

import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const base = (process.argv[2] ?? '').replace(/\/$/, '');
if (!base) {
  console.error('usage: node tools/check-live.js https://host');
  process.exit(2);
}
const expected = Object.fromEntries(
  readFileSync(new URL('../site/_headers', import.meta.url), 'utf8')
    .split('\n').slice(1).filter(l => l.startsWith('  ')).map(l => l.trim().split(/:\s(.+)/)).map(([k, v]) => [k.toLowerCase(), v]),
);
const page = await fetch(`${base}/`);
assert.equal(page.status, 200);
for (const [name, value] of Object.entries(expected))
  if (name !== 'cache-control')
    assert.equal(page.headers.get(name), value, name);
assert.match((await fetch(`${base}/sw.js`)).headers.get('cache-control') ?? '', /no-cache/);
const files = readFileSync(new URL('../site/sw.js', import.meta.url), 'utf8').match(/^\s+'([^']+)',$/gm).map(l => l.trim().slice(1, -2));
for (const file of [...files, '.well-known/security.txt', 'manifest.webmanifest']) {
  const r = await fetch(`${base}/${file === './' ? '' : file}`);
  assert.equal(r.status, 200, file);
}
console.log(`live check passed: ${files.length} files, ${Object.keys(expected).length} headers`);

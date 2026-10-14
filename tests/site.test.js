import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const site = new URL('../site/', import.meta.url).pathname;
const read = path => readFileSync(join(site, path), 'utf8');

test('service worker and app share one version', () => {
  const app = read('js/app/main.js').match(/VERSION = '([^']+)'/)[1];
  const sw = read('sw.js').match(/VERSION = '([^']+)'/)[1];
  assert.equal(sw, app);
});

test('service worker caches every file the page is made of', () => {
  const listed = new Set(read('sw.js').match(/^\s+'([^']+)',$/gm).map(line => line.trim().slice(1, -2)));
  const walk = dir => readdirSync(join(site, dir)).flatMap(name => {
    const path = dir ? `${dir}/${name}` : name;
    return statSync(join(site, path)).isDirectory() ? walk(path) : [path];
  });
  const needed = walk('').filter(p => p.endsWith('.js') && p !== 'sw.js');
  for (const file of needed)
    assert.ok(listed.has(file), `${file} is not in the service worker list`);
  for (const file of listed)
    if (file !== './')
      statSync(join(site, file));
});

test('qr modules import nothing outside their folder and never touch the DOM', () => {
  for (const name of readdirSync(join(site, 'js/qr'))) {
    const source = read(`js/qr/${name}`);
    for (const match of source.matchAll(/from '([^']+)'/g))
      assert.ok(match[1].startsWith('./'), `${name} imports ${match[1]}`);
    assert.ok(!/\b(document|window|navigator)\b/.test(source), `${name} touches the DOM`);
  }
});

test('the page has no inline script or style and the meta CSP matches _headers', () => {
  const html = read('index.html');
  assert.ok(!/<script(?![^>]*src=)/.test(html), 'inline script');
  assert.ok(!/<style/.test(html), 'inline style element');
  assert.ok(!/ style="/.test(html), 'style attribute');
  assert.ok(!/ on[a-z]+="/.test(html), 'inline handler');
  const meta = html.match(/Content-Security-Policy" content="([^"]+)"/)[1];
  const header = read('_headers').match(/Content-Security-Policy: (.+)/)[1];
  assert.equal(header.replace(/; frame-ancestors 'none'/, ''), meta);
});

test('no innerHTML or eval in the app', () => {
  const walk = dir => readdirSync(join(site, dir)).flatMap(name => {
    const path = `${dir}/${name}`;
    return statSync(join(site, path)).isDirectory() ? walk(path) : [path];
  });
  for (const file of walk('js'))
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|\beval\(|new Function/.test(read(file)), file);
});

test('the nginx config carries the same headers as _headers', () => {
  const headers = read('_headers').split('\n').slice(1).filter(l => l.startsWith('  ')).map(l => l.trim());
  const nginx = readFileSync(new URL('../deploy/nginx-qr.conf', import.meta.url), 'utf8');
  for (const line of headers) {
    const [name, value] = line.split(/:\s(.+)/);
    if (name === 'Cache-Control')
      continue;
    assert.ok(nginx.includes(`add_header ${name} "${value}" always;`), line);
  }
  assert.ok(nginx.includes('add_header Cache-Control $qr_cache_control always;'));
  assert.ok(/default\s+"no-cache"/.test(nginx), 'scripts must revalidate so a deploy never mixes versions');
  assert.ok(!/^\s*location\b[^}]*add_header/m.test(nginx), 'add_header inside a location drops the server headers');
  assert.ok(nginx.includes('location ^~ /.well-known/'), 'the dot-file regex would deny security.txt without ^~');
});

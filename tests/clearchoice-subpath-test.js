/* ClearChoice subpath offline test: the app served under /clearchoice/ with
 * the domain root returning 404 (the GitHub Pages layout). Verifies the
 * service worker installs (no failed precache of '/') and that offline
 * navigation to /clearchoice/ loads the app shell.
 *
 * Run: node clearchoice-subpath-test.js   (starts its own server on 8143)
 */
const { firefox } = require('playwright-core');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log('PASS: ' + name); }
  else { fail++; console.log('FAIL: ' + name + (extra ? ' :: ' + extra : '')); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (!url.startsWith('/clearchoice/')) { res.writeHead(404); res.end('not found'); return; }
  let rel = url.slice('/clearchoice/'.length) || 'index.html';
  if (rel.includes('..')) { res.writeHead(400); res.end(); return; }
  const file = path.join(ROOT, rel);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

(async () => {
  await new Promise(r => server.listen(8143, '127.0.0.1', r));
  const browser = await firefox.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => { errors.push(e.message); console.log('PAGEERROR: ' + e.message); });
  page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE-ERROR: ' + m.text()); });

  // domain root is a 404 here, like the GitHub Pages user site root
  const rootStatus = await new Promise(resolve => {
    http.get('http://127.0.0.1:8143/', res => resolve(res.statusCode)).on('error', () => resolve('request-failed'));
  });
  check('domain root returns 404 in this layout', rootStatus === 404, String(rootStatus));

  await page.goto('http://127.0.0.1:8143/clearchoice/');
  await page.waitForSelector('.view-head h1');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await sleep(1500);
  const swState = await page.evaluate(() => navigator.serviceWorker.getRegistration()
    .then(r => (r && r.active ? r.active.state : 'no-active-registration')));
  check('service worker installed and activated under /clearchoice/', swState === 'activated', swState);
  check('no page errors during install', errors.length === 0, errors.join(' | '));

  await ctx.setOffline(true);
  await page.goto('http://127.0.0.1:8143/clearchoice/');
  await sleep(800);
  check('offline navigation to /clearchoice/ loads the app', (await page.locator('.view-head h1').count()) > 0);
  check('offline navigation shows empty decisions state', await page.isVisible('.empty-state'));
  await ctx.setOffline(false);

  await browser.close();
  server.close();
  console.log('\nTOTAL: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR: ' + e.message); server.close(); process.exit(2); });

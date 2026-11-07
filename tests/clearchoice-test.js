/* ClearChoice verification suite (headless Firefox via Playwright).
 *
 * How to run:
 *   1. Serve this folder on port 8141:  python3 -m http.server 8141
 *   2. Install Playwright:  npm install playwright-core
 *      (and a Firefox build, e.g.  npx playwright install firefox)
 *   3. Run:  node tests/clearchoice-test.js
 *
 * The suite starts from an empty browser profile: no decisions exist yet.
 */
const { firefox } = require('playwright-core');
const fs = require('fs');

let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log('PASS: ' + name); }
  else { fail++; console.log('FAIL: ' + name + (extra ? ' :: ' + extra : '')); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await firefox.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => { errors.push(e.message); console.log('PAGEERROR: ' + e.message); });
  page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE-ERROR: ' + m.text()); });

  await page.goto('http://127.0.0.1:8141/index.html');
  await page.waitForSelector('.view-head h1');
  await sleep(300);
  check('page title', (await page.title()) === 'ClearChoice — Compare options, decide with confidence', await page.title());
  check('empty start: no decisions message', await page.isVisible('.empty-state'));
  check('guide link present', await page.isVisible('a[data-nav="guide"]'));

  // --- create decision: empty name rejected, valid name works ---
  await page.click('text=New decision');
  await page.waitForSelector('#dialog-text-input');
  await page.click('.dialog-actions .btn:last-child');
  await sleep(200);
  check('empty decision name rejected, dialog stays open', await page.isVisible('#dialog-text-input'));
  await page.fill('#dialog-text-input', 'Which laptop?');
  await page.click('.dialog-actions .btn:last-child');
  await page.waitForSelector('h1');
  await sleep(300);
  check('navigated to comparison view', (await page.textContent('h1')) === 'Which laptop?');
  check('start prompt shown (no options/criteria)', (await page.textContent('.notice')) && (await page.textContent('.notice')).includes('Start by adding'));

  // helper: add option / criterion via dialog
  async function addVia(buttonText, name) {
    await page.click('text=' + buttonText, { strict: false });
    await page.waitForSelector('#dialog-text-input');
    await page.fill('#dialog-text-input', name);
    await page.click('.dialog-actions .btn:last-child');
    await sleep(250);
  }
  async function score(row, col, value) {
    // row/col are 0-based within the comparison table body
    const input = page.locator('table.compare tbody tr').nth(row).locator('input[type="number"]').nth(col);
    await input.fill(value === null ? '' : String(value));
    await input.press('Tab');
    await sleep(300);
  }

  await addVia('Add option', 'Laptop A');
  await addVia('Add option', 'Laptop B');
  await addVia('Add criterion', 'Price');
  await addVia('Add criterion', 'Battery');
  check('2 options, 2 criteria in table', (await page.locator('table.compare tbody tr').count()) === 2 &&
    (await page.locator('table.compare thead th').count()) === 5);

  // weights: Price 5, Battery 3 (default 3; set Price to 5)
  const weightSelects = page.locator('.editor-list select');
  await weightSelects.nth(0).selectOption('5');
  await sleep(300);
  check('weight change to 5 applied', (await page.textContent('table.compare thead')).includes('Weight 5 of 5'));

  // scores: A: Price 8, Battery 6 -> 5*8+3*6 = 58/80 = 72% ; B: Price 6, Battery 9 -> 30+27 = 57/80 = 71%
  await score(0, 0, 8); await score(0, 1, 6);
  await score(1, 0, 6); await score(1, 1, 9);
  let bodyText = await page.textContent('table.compare tbody');
  check('A total 58 / 80 (73%)', bodyText.includes('58 / 80 (73%)'), bodyText);
  check('B total 57 / 80 (71%)', bodyText.includes('57 / 80 (71%)'), bodyText);
  check('A rank 1, B rank 2', bodyText.includes('Rank 1') && bodyText.includes('Rank 2'));
  let summary = await page.textContent('.results-summary');
  check('leader is Laptop A', summary.includes('Laptop A') && summary.includes('58 of 80'), summary);

  // tie: set B Battery to 10 -> 30+30=60 no; set B Price 7, Battery 8 -> 35+24=59. Make exact tie: A 58; B Price 8 Battery 6 -> 40+18=58.
  await score(1, 0, 8); await score(1, 1, 6);
  bodyText = await page.textContent('table.compare tbody');
  check('tie: both 58 / 80', (bodyText.match(/58 \/ 80 \(73%\)/g) || []).length === 2, bodyText);
  check('tie badges shown', (bodyText.match(/Rank 1 — tie/g) || []).length === 2, bodyText);
  summary = await page.textContent('.results-summary');
  check('leader summary notes tie', summary.includes('tied'), summary);

  // missing score: clear B Battery -> B partial 40/50, not ranked, 1 missing
  await score(1, 1, null);
  bodyText = await page.textContent('table.compare tbody');
  check('B partial total 40 / 50', bodyText.includes('40 / 50 (80%)'), bodyText);
  check('B not ranked with missing flag', bodyText.includes('Not ranked') && bodyText.includes('1 missing'));
  summary = await page.textContent('.results-summary');
  check('summary counts 1 ranked, 1 missing', summary.includes('1 of 2') && summary.includes('1'), summary);
  check('missing notice visible', await page.isVisible('.notice'));
  // restore B battery 6 for later steps
  await score(1, 1, 6);

  // out-of-range clamp: score 15 clamps to 10; -3 clamps to 0
  await score(0, 0, 15);
  bodyText = await page.textContent('table.compare tbody');
  check('score 15 clamped to 10 (A total 68)', bodyText.includes('68 / 80 (85%)'), bodyText);
  await score(0, 0, 8); // restore

  // note on a cell
  await page.locator('table.compare tbody tr').nth(0).locator('.score-note-btn').first().click();
  await page.waitForSelector('#note-text');
  await page.fill('#note-text', 'Cheaper than B by $200.');
  await page.click('.dialog-actions .btn:last-child');
  await sleep(300);
  check('note dot appears on scored cell', (await page.locator('.note-dot').count()) >= 1);
  check('note listed in Score notes section', (await page.textContent('.editor-section:last-child')).includes('Cheaper than B by $200.'));

  // reorder options: move Laptop B up
  const optRows = page.locator('.editor-section .editor-list li');
  await optRows.nth(1).locator('button:text("Up")').click();
  await sleep(300);
  let firstRowName = await page.locator('table.compare tbody tr').nth(0).locator('th').first().textContent();
  check('reorder options: B now first row', firstRowName === 'Laptop B', firstRowName);

  // rename option inline
  const optInputs = page.locator('.editor-section .editor-list li input[type="text"]');
  await optInputs.nth(0).fill('Laptop B Pro');
  await optInputs.nth(0).press('Enter');
  await sleep(300);
  check('option renamed inline', (await page.textContent('table.compare tbody')).includes('Laptop B Pro'));

  // delete criterion with confirm
  const critSection = page.locator('.editor-section').nth(1);
  await critSection.locator('button:text("Remove")').nth(1).click();
  await page.waitForSelector('.dialog-overlay');
  await page.click('.dialog-actions .btn-danger');
  await sleep(300);
  check('criterion removed, one column left', (await page.locator('table.compare thead th').count()) === 4);
  // re-add Battery criterion for export/import tests
  await addVia('Add criterion', 'Battery');

  // persistence across reload
  await page.reload();
  await page.waitForSelector('h1');
  await sleep(300);
  check('data persists after reload', (await page.textContent('h1')) === 'Which laptop?' &&
    (await page.textContent('table.compare tbody')).includes('Laptop B Pro'));

  // XSS: decision title with markup renders as text
  await page.goto('http://127.0.0.1:8141/index.html#/decisions');
  await sleep(300);
  await page.click('text=New decision');
  await page.waitForSelector('#dialog-text-input');
  await page.fill('#dialog-text-input', '<img src=x onerror=alert(1)> Test');
  await page.click('.dialog-actions .btn:last-child');
  await sleep(400);
  const h1Text = await page.textContent('h1');
  check('markup in title renders as text', h1Text.includes('<img src=x onerror=alert(1)> Test'), h1Text);
  check('no page errors from markup', errors.length === 0, errors.join(' | '));
  // go back to dashboard, delete the XSS test decision
  await page.goto('http://127.0.0.1:8141/index.html#/decisions');
  await sleep(300);
  const xssItem = page.locator('.decision-item', { hasText: '<img src=x' });
  await xssItem.locator('button:text("Delete")').click();
  await page.waitForSelector('.dialog-overlay');
  await page.click('.dialog-actions .btn-danger');
  await sleep(300);

  // dashboard: duplicate + rename + delete
  const countBefore = await page.locator('.decision-item').count();
  await page.locator('.decision-item').first().locator('button:text("Duplicate")').click();
  await sleep(300);
  check('duplicate adds one decision', (await page.locator('.decision-item').count()) === countBefore + 1);
  check('duplicate titled with (copy)', (await page.textContent('.decision-list')).includes('(copy)'));
  // rename the copy
  await page.locator('.decision-item').first().locator('button:text("Rename")').click();
  await page.waitForSelector('#dialog-text-input');
  await page.fill('#dialog-text-input', 'Laptop choice copy');
  await page.click('.dialog-actions .btn:last-child');
  await sleep(300);
  check('rename works on dashboard', (await page.textContent('.decision-list')).includes('Laptop choice copy'));
  // delete the copy
  await page.locator('.decision-item').first().locator('button:text("Delete")').click();
  await page.waitForSelector('.dialog-overlay');
  await page.click('.dialog-actions .btn-danger');
  await sleep(300);
  check('delete removes the decision', (await page.locator('.decision-item').count()) === countBefore);

  // export this decision: open it, export, check file content
  await page.locator('.decision-item a').first().click();
  await sleep(300);
  const downloadPromise = page.waitForEvent('download');
  await page.click('text=Export this decision');
  const download = await downloadPromise;
  const dlPath = '/tmp/clearchoice-export.json';
  await download.saveAs(dlPath);
  const exported = JSON.parse(fs.readFileSync(dlPath, 'utf8'));
  check('export JSON valid, app + version', exported.app === 'clearchoice' && exported.version === 1 && exported.decisions.length === 1, JSON.stringify(Object.keys(exported)));
  check('exported decision has options + criteria', exported.decisions[0].options.length === 2 && exported.decisions[0].criteria.length === 2);

  // import: invalid file rejected, data unchanged
  await page.goto('http://127.0.0.1:8141/index.html#/decisions');
  await sleep(300);
  const beforeImport = await page.textContent('.decision-list');
  const bad = { app: 'clearchoice', version: 1, decisions: [{ id: 'x', title: 'Bad', createdAt: 1, updatedAt: 1, options: [], criteria: [{ id: 'c', name: 'W', weight: 9 }], scores: {} }] };
  fs.writeFileSync('/tmp/clearchoice-bad.json', JSON.stringify(bad));
  await page.setInputFiles('#import-file', '/tmp/clearchoice-bad.json');
  await sleep(400);
  check('invalid import rejected, list unchanged', (await page.textContent('.decision-list')) === beforeImport);
  // valid import replaces
  const good = JSON.parse(JSON.stringify(exported));
  good.decisions[0].title = 'Imported laptop choice';
  fs.writeFileSync('/tmp/clearchoice-good.json', JSON.stringify(good));
  await page.setInputFiles('#import-file', '/tmp/clearchoice-good.json');
  await sleep(400);
  await page.waitForSelector('.dialog-overlay');
  await page.click('.dialog-actions .btn-danger'); // Replace and import
  await sleep(400);
  check('valid import replaces library', (await page.textContent('.decision-list')).includes('Imported laptop choice'));

  // --- round 3: duplicate decision IDs in import are rejected ---
  const dupFile = JSON.parse(JSON.stringify(exported));
  dupFile.decisions.push(JSON.parse(JSON.stringify(exported.decisions[0])));
  fs.writeFileSync('/tmp/clearchoice-dup.json', JSON.stringify(dupFile));
  const beforeDup = await page.textContent('.decision-list');
  await page.setInputFiles('#import-file', '/tmp/clearchoice-dup.json');
  await sleep(400);
  check('duplicate-ID import rejected, list unchanged', (await page.textContent('.decision-list')) === beforeDup);
  check('duplicate-ID import shows no confirm dialog', (await page.locator('.dialog-overlay').count()) === 0);

  // --- round 3: score entry preserves focus (in-place results update) ---
  await page.locator('.decision-item a').first().click();
  await sleep(400);
  const firstScore = page.locator('table.compare tbody tr').nth(0).locator('input[type="number"]').nth(0);
  await firstScore.click();
  await firstScore.fill('9');
  await page.keyboard.press('Tab');
  await sleep(300);
  const activeTag = await page.evaluate(() => document.activeElement && document.activeElement.className + '|' + document.activeElement.textContent);
  check('after score + Tab, focus stays in the workspace (note button, not heading)', activeTag.startsWith('icon-btn score-note-btn'), activeTag);
  bodyText = await page.textContent('table.compare tbody');
  check('in-place total updated without rebuild (B Pro now 45 / 50)', bodyText.includes('45 / 50'), bodyText);
  check('print span for the edited score reads 9 / 10', (await page.locator('.score-print').first().textContent()) === '9 / 10');
  await firstScore.fill('8');
  await firstScore.press('Tab');
  await sleep(300);

  // --- round 4: responsive score sync across breakpoints, both directions ---
  // desktop -> mobile: edit the table input, resize, the card input must match
  await firstScore.fill('7');
  await firstScore.press('Tab');
  await sleep(300);
  await page.setViewportSize({ width: 375, height: 800 });
  await sleep(300);
  const cardScore = page.locator('.option-cards .option-card').nth(0).locator('input[type="number"]').nth(0);
  check('mobile card input syncs after desktop edit', (await cardScore.inputValue()) === '7');
  // mobile -> desktop: edit the card input, resize back, the table input must match
  await cardScore.fill('9');
  await cardScore.press('Tab');
  await sleep(300);
  await page.setViewportSize({ width: 1280, height: 900 });
  await sleep(300);
  check('desktop table input syncs after mobile edit', (await firstScore.inputValue()) === '9');
  bodyText = await page.textContent('table.compare tbody');
  check('total reflects the synced score (45 / 50)', bodyText.includes('45 / 50'), bodyText);
  await firstScore.fill('8');
  await firstScore.press('Tab');
  await sleep(300);

  // --- round 3: weight change keeps focus on the select ---
  const weightSelect = page.locator('.editor-list select').first();
  await weightSelect.click();
  await weightSelect.selectOption('4');
  await sleep(300);
  const activeIsSelect = await page.evaluate(() => document.activeElement && document.activeElement.tagName === 'SELECT');
  check('after weight change, focus stays on the weight select', activeIsSelect);

  // --- round 3: confirm dialog focus trap + inert background ---
  await page.goto('http://127.0.0.1:8141/index.html#/decisions');
  await sleep(300);
  await page.locator('.decision-item').first().locator('button:text("Delete")').click();
  await page.waitForSelector('.dialog-overlay');
  const dialogFocus = await page.evaluate(() => document.activeElement && document.activeElement.textContent);
  check('confirm dialog initially focuses first action (Cancel)', dialogFocus === 'Cancel', dialogFocus);
  await page.keyboard.press('Shift+Tab');
  await sleep(200);
  const wrappedFocus = await page.evaluate(() => document.activeElement && document.activeElement.textContent);
  check('Shift+Tab from first action wraps to last action (Delete)', wrappedFocus === 'Delete', wrappedFocus);
  const inertState = await page.evaluate(() => ({ main: document.querySelector('main').inert, header: document.querySelector('.app-header').inert }));
  check('background is inert while dialog is open', inertState.main === true && inertState.header === true, JSON.stringify(inertState));
  await page.keyboard.press('Escape');
  await sleep(200);
  check('after Escape, background no longer inert', (await page.evaluate(() => document.querySelector('main').inert)) === false);

  // --- round 3: print media shows a clean report ---
  await page.locator('.decision-item a').first().click();
  await sleep(400);
  await page.emulateMedia({ media: 'print' });
  await sleep(200);
  check('print: All decisions link hidden', !(await page.locator('a.btn:text("All decisions")').isVisible()));
  check('print: note buttons hidden', (await page.locator('.score-note-btn:visible').count()) === 0);
  check('print: score inputs hidden', (await page.locator('table.compare input[type="number"]:visible').count()) === 0);
  check('print: score text visible', await page.locator('.score-print').first().isVisible());
  check('print: score text shows value', (await page.locator('.score-print').first().textContent()).includes('/ 10'));
  await page.emulateMedia({ media: 'screen' });

  // --- round 3: privacy wording ---
  await page.click('a[data-nav="guide"]');
  await sleep(300);
  check('guide privacy wording corrected', (await page.textContent('.view')).includes('requests only its own static files; decision content is never transmitted'));

  // --- round 3: offline navigation to the directory URL ---
  await page.goto('http://127.0.0.1:8141/index.html#/decisions');
  await sleep(300);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await sleep(1000);
  await ctx.setOffline(true);
  await page.goto('http://127.0.0.1:8141/');
  await sleep(800);
  check('offline directory URL loads the app', (await page.locator('.view-head h1').count()) > 0);
  await ctx.setOffline(false);

  // guide page
  await page.click('a[data-nav="guide"]');
  await sleep(300);
  check('guide page renders', (await page.textContent('h1')) === 'Guide & Privacy' &&
    (await page.textContent('.view')).includes('How scoring works'));

  // keyboard: Escape closes dialog
  await page.click('a[data-nav="decisions"]');
  await sleep(300);
  await page.click('text=New decision');
  await page.waitForSelector('#dialog-text-input');
  await page.keyboard.press('Escape');
  await sleep(200);
  check('Escape closes dialog', !(await page.locator('#dialog-text-input').count()));

  // 375px mobile: no horizontal overflow, cards visible, table hidden
  await page.setViewportSize({ width: 375, height: 800 });
  await page.locator('.decision-item a').first().click();
  await sleep(400);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check('375px no horizontal overflow', !overflow);
  check('375px option cards visible', await page.locator('.option-cards').isVisible());
  check('375px bottom nav not required; header wraps', await page.locator('.header-actions').isVisible());

  check('zero uncaught page errors overall', errors.length === 0, errors.join(' | '));

  await browser.close();
  console.log('\nTOTAL: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR: ' + e.message); process.exit(2); });

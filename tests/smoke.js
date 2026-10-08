// Smoke test for index.html. Run: NODE_PATH=$(npm root -g) node tests/smoke.js [shots-dir]
// Uses the preinstalled Playwright/Chromium. Exits 1 on any failure.
const { chromium } = require('playwright');
const path = require('path');
const URL = 'file://' + path.resolve(__dirname, '..', 'index.html');
const SHOTS = process.argv[2];
let fail = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };

(async () => {
  const b = await chromium.launch();
  const pg = await (await b.newContext({ viewport: { width: 768, height: 1024 }, hasTouch: true })).newPage(); // iPad mini 4 portrait
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto(URL);
  await pg.evaluate(() => localStorage.clear());
  await pg.reload();

  ok(await pg.locator('.row').count() === 98, 'Front page has 98 tests');
  ok(await pg.locator('.row:visible').count() === 98 - 6 - 7, 'Chapters 3.0 and 4.0 collapsed by default');
  ok(await pg.locator('#nSel').count() === 0, 'Counter card removed');
  ok(await pg.locator('.chap').count() === 5, 'Front page has 5 chapters');
  const sw = await pg.evaluate(() => document.documentElement.scrollWidth);
  ok(sw <= 768, 'No horizontal scroll at 768 (' + sw + ')');
  if (SHOTS) await pg.screenshot({ path: SHOTS + '/home.png' });

  // Tap number 1.1 -> section page
  await pg.click('#row-1\\.1 .go');
  await pg.waitForFunction(() => !document.getElementById('sec').hidden, null, { timeout: 2000 }).catch(() => {});
  ok(await pg.isVisible('#sec') && !(await pg.isVisible('#home')), '1.1 opens section page');
  ok((await pg.textContent('#doc h1')).includes('EXTERNAL EMERGENCY LIGHTS'), 'Section title shown');
  ok(await pg.isVisible('#backBtn'), 'Back button visible');
  // Back button stays visible after scrolling (sticky)
  await pg.goto(URL + '#/2.11');
  await pg.evaluate(() => window.scrollTo(0, 5000));
  const bb = await pg.locator('#backBtn').boundingBox();
  ok(bb && bb.y >= 0 && bb.y < 80, 'Back button stays at top when scrolled');
  if (SHOTS) { await pg.evaluate(() => window.scrollTo(0, 0)); await pg.screenshot({ path: SHOTS + '/sec-2.11.png' }); }
  await pg.click('#backBtn');
  await pg.waitForFunction(() => !document.getElementById('home').hidden, null, { timeout: 2000 }).catch(() => {});
  ok(await pg.isVisible('#home'), 'Back button returns to front page');

  // Collapse toggle
  await pg.click('button[data-tog="3"]');
  ok(await pg.isVisible('#row-3\\.1'), 'Tapping 3.0 header expands it');
  await pg.click('button[data-tog="3"]');
  ok(!(await pg.isVisible('#row-3\\.1')), 'Tapping again collapses it');

  // Select tests; Performed signs with one tap, row gets struck through
  await pg.click('#row-1\\.1 .chk');
  await pg.click('#row-1\\.2 .chk');
  ok((await pg.textContent('#fSel')).includes('2'), '2 tests selected');
  ok(await pg.locator('#techAdd').count() === 0, 'Technician section removed');
  ok((await pg.textContent('#row-1\\.1 .sign')) === 'Performed', 'Button is named Performed');
  await pg.click('#row-1\\.1 .sign');
  ok(!(await pg.isVisible('#signModal')) && (await pg.textContent('#row-1\\.1 .signed')).includes('Performed'), '1.1 performed with one tap');
  const deco = await pg.$eval('#row-1\\.1 .go .t', e => getComputedStyle(e).textDecorationLine);
  const op = await pg.$eval('#row-1\\.1', e => +getComputedStyle(e).opacity);
  ok(deco.includes('line-through') && op < 1, 'Performed task is struck through with reduced opacity');
  ok(!(await pg.$eval('#row-1\\.2 .go .t', e => getComputedStyle(e).textDecorationLine)).includes('line-through'), 'Not performed task is not struck through');
  if (SHOTS) await pg.screenshot({ path: SHOTS + '/home-performed.png' });
  const st = await pg.evaluate(() => JSON.parse(localStorage.getItem('fcp-v1')));
  ok(st.sel['1.1'] && st.sel['1.2'] && st.done['1.1'].at && !st.done['1.2'], 'State saved');

  // Filter Selected
  await pg.click('#fSel');
  ok(await pg.locator('.row').count() === 2, 'Selected filter shows 2 rows');
  ok(await pg.locator('#chapters .chk').count() === 0, 'No checkboxes in Selected view');
  ok(await pg.locator('#barSum').count() === 0 && !(await pg.textContent('body')).includes('Not verified'), 'Bar title/summary and disclaimer removed');
  if (SHOTS) await pg.screenshot({ path: SHOTS + '/home-selected.png' });

  // Sign from section page with one tap
  await pg.click('#row-1\\.2 .go');
  await pg.waitForSelector('#signCard .bigsign');
  await pg.click('#signCard .bigsign');
  ok((await pg.textContent('#signCard')).includes('✓ Performed'), 'Section page Performed with one tap');
  if (SHOTS) await pg.screenshot({ path: SHOTS + '/sec-1.2-signed.png' });

  // Undo sign-off
  await pg.click('#signCard button[data-sign]');
  await pg.click('#smBtns .danger');
  ok(!(await pg.evaluate(() => JSON.parse(localStorage.getItem('fcp-v1')).done['1.2'])), 'Sign-off removed');

  // New job: modal to pick tests, then only those are shown
  await pg.goto(URL + '#/');
  await pg.click('#newJobBtn');
  ok(await pg.isVisible('#jobModal'), 'New job opens task picker');
  ok((await pg.textContent('#jobInfo')).includes('clears'), 'Warns that current job is cleared');
  ok(await pg.isDisabled('#jobStart'), 'Start disabled with nothing picked');
  await pg.click('.jrow[data-jid="1.4"]'); await pg.click('.jrow[data-jid="3.2"]'); await pg.click('.jrow[data-jid="5.1"]');
  if (SHOTS) await pg.screenshot({ path: SHOTS + '/newjob.png' });
  await pg.click('#jobStart');
  ok(!(await pg.isVisible('#jobModal')), 'Start job closes modal');
  ok(await pg.locator('.row:visible').count() === 3, 'Only the 3 picked tests are shown (3.0 opened)');
  const st2 = await pg.evaluate(() => JSON.parse(localStorage.getItem('fcp-v1')));
  ok(Object.keys(st2.done).length === 0 && Object.keys(st2.sel).join() === '1.4,3.2,5.1', 'Old job cleared, new selection saved');
  if (SHOTS) await pg.screenshot({ path: SHOTS + '/newjob-home.png' });
  await pg.click('#fAll');
  ok(await pg.locator('.row:visible').count() === 98 - 7, 'All shows every test to add more (4.0 still collapsed)');
  await pg.click('#row-1\\.5 .chk');
  await pg.click('#fSel');
  ok(await pg.locator('.row:visible').count() === 4, 'Added test shows under Selected');

  // Returning from a section in a collapsed chapter opens that chapter
  await pg.goto(URL + '#/');
  await pg.click('#fAll');
  await pg.click('#row-2\\.30 .go');
  await pg.click('#nextBtn');
  await pg.waitForFunction(() => location.hash === '#/3.1');
  await pg.click('#backBtn');
  await pg.waitForFunction(() => !document.getElementById('home').hidden);
  ok(await pg.isVisible('#row-3\\.1'), 'Back from 3.1 expands 3.0');

  // Not-selected test: no Selected toggle, grey Performed asks to add to Selected
  await pg.goto(URL + '#/1.7');
  await pg.waitForSelector('#signCard .bigsign');
  ok(await pg.locator('#secSel').count() === 0, 'No "Selected for this FCP" toggle');
  ok(await pg.locator('#signCard .bigsign.off').count() === 1, 'Performed greyed out when not selected');
  await pg.click('#signCard .bigsign');
  ok(await pg.isVisible('#signModal') && (await pg.textContent('#smBody')).includes('Add it to Selected'), 'Tap asks to add to Selected');
  await pg.click('#smBtns .primary');
  ok(await pg.evaluate(() => { const o = JSON.parse(localStorage.getItem('fcp-v1')); return o.sel['1.7'] && !o.done['1.7']; }), '1.7 added to Selected, not performed yet');
  ok(await pg.locator('#signCard .bigsign.off').count() === 0, 'Performed active after adding');
  await pg.click('#signCard .bigsign');
  ok((await pg.textContent('#signCard')).includes('✓ Performed'), '1.7 performed');
  if (SHOTS) await pg.screenshot({ path: SHOTS + '/sec-1.7.png' });

  // 4.2 has record fields + figures
  await pg.goto(URL + '#/4.2');
  ok(await pg.locator('#recCard input').count() === 10, '4.2 has 10 record fields');
  ok(await pg.locator('.fig img').count() === 4, '4.2 shows 4 figures');
  await pg.fill('#recCard input >> nth=4', '15');
  if (SHOTS) await pg.screenshot({ path: SHOTS + '/sec-4.2.png' });

  // Every section renders
  const ids = await pg.evaluate(() => JSON.parse(document.getElementById('fcp-data').textContent).sections.map(s => s.id));
  let bad = [];
  for (const id of ids) {
    await pg.evaluate(i => { location.hash = '#/' + i; }, id);
    const n = await pg.locator('#doc .step, #doc .adm, #doc .para').count();
    if (n === 0) bad.push(id);
  }
  ok(bad.length === 0, 'All ' + ids.length + ' sections render content' + (bad.length ? ' (empty: ' + bad + ')' : ''));

  // Phone width: no horizontal scroll
  await pg.setViewportSize({ width: 390, height: 844 });
  await pg.goto(URL + '#/');
  const sw2 = await pg.evaluate(() => document.documentElement.scrollWidth);
  ok(sw2 <= 390, 'No horizontal scroll at 390 (' + sw2 + ')');
  if (SHOTS) await pg.screenshot({ path: SHOTS + '/home-390.png' });

  ok(errs.length === 0, 'No page errors' + (errs.length ? ': ' + errs.join('; ') : ''));
  await b.close();
  process.exit(fail ? 1 : 0);
})();

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

  ok(await pg.locator('.row').count() === 98, 'Front page lists 98 tests');
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

  // Select tests and sign off
  await pg.click('#row-1\\.1 .chk');
  await pg.click('#row-1\\.2 .chk');
  ok((await pg.textContent('#nSel')) === '2', '2 tests selected');
  await pg.click('#row-1\\.1 .sign');
  ok(await pg.isVisible('#signModal'), 'Sign modal opens');
  await pg.fill('#smWho', 'al');
  await pg.click('#smBtns .primary');
  ok((await pg.textContent('#row-1\\.1 .signed')).includes('AL'), '1.1 signed by AL');
  ok((await pg.textContent('#nDone')) === '1' && (await pg.textContent('#nLeft')) === '1', 'Counters 1 performed / 1 remaining');
  const st = await pg.evaluate(() => JSON.parse(localStorage.getItem('fcp-v1')));
  ok(st.sel['1.1'] && st.sel['1.2'] && st.done['1.1'].by === 'AL', 'State saved');

  // Filter Selected
  await pg.click('#fSel');
  ok(await pg.locator('.row').count() === 2, 'Selected filter shows 2 rows');
  if (SHOTS) await pg.screenshot({ path: SHOTS + '/home-selected.png' });

  // Sign from section page, signer remembered
  await pg.click('#row-1\\.2 .go');
  await pg.click('#signCard .bigsign');
  ok((await pg.inputValue('#smWho')) === 'AL', 'Signer remembered');
  await pg.click('#smBtns .primary');
  ok((await pg.textContent('#signCard')).includes('Performed'), 'Section page shows Performed');
  if (SHOTS) await pg.screenshot({ path: SHOTS + '/sec-1.2-signed.png' });

  // Undo sign-off
  await pg.click('#signCard button[data-sign]');
  await pg.click('#smBtns .danger');
  ok(!(await pg.evaluate(() => JSON.parse(localStorage.getItem('fcp-v1')).done['1.2'])), 'Sign-off removed');

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

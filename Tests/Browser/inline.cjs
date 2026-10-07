// Real profiles must not be disclosed through a page-controlled one-click UI.
const { webkit } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const browser = await webkit.launch({ headless: true, ...(process.env.WEBKIT_EXECUTABLE ? { executablePath: process.env.WEBKIT_EXECUTABLE } : {}) });
  try {
    const page = await browser.newPage();
    await page.setContent('<label>姓<input autocomplete="family-name"></label>');
    await page.evaluate(() => {
      window.requests = [];
      window.browser = { runtime: { id: 'test', onMessage: { addListener: fn => window.listener = fn }, sendMessage: message => requests.push(message) } };
    });
    await page.addScriptTag({ content: fs.readFileSync(`${__dirname}/../../SafariExtension/Resources/content.js`, 'utf8') });
    await page.locator('input').focus();
    assert.equal(await page.locator('button').count(), 0);
    assert.deepEqual(await page.evaluate(() => requests), []);
    assert.equal(await page.locator('input').inputValue(), '');
    assert.equal(await page.evaluate(() => listener({ type: 'extract' }, { id: 'test', tab: { id: 1 } })), undefined);
    const result = await page.evaluate(async () => {
      const extracted = await listener({ type: 'extract' }, { id: 'test' });
      return listener({ type: 'applyFill', requestID: extracted.requestID, items: [{ id: 'f0', value: '合成試験' }] }, { id: 'test' });
    });
    assert.equal(result.error, 'stale_plan', 'non-HTTPS pages cannot receive profile values');
    console.log('Page-controlled inline filling disabled; sender and HTTPS boundaries passed');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

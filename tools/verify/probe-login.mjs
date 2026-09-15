import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();

page.on('console', (m) => console.log(`[console.${m.type()}]`, m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', String(e)));
page.on('response', (r) => {
  if (r.url().includes('/api/')) console.log(`[net] ${r.status()} ${r.request().method()} ${r.url()}`);
});
page.on('requestfailed', (r) => console.log('[failed]', r.url(), r.failure()?.errorText));

await page.goto('http://localhost:4200/login', { waitUntil: 'networkidle' });
await page.fill('input[type=email]', 'ada@northwind.test');
await page.fill('input[type=password]', 'apion-dev-password');
await page.click('button[type=submit]');
await page.waitForTimeout(6000);
console.log('final url:', page.url());
console.log('body text:', (await page.textContent('body')).slice(0, 300).replace(/\s+/g, ' '));
await browser.close();

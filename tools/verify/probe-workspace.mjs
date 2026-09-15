import { chromium } from 'playwright-core';

const OUT = process.argv[2];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

page.on('console', (m) => { if (m.type() === 'error') console.log('[err]', m.text().slice(0, 300)); });
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
page.on('response', (r) => {
  if (r.url().includes('/api/') && r.status() >= 400) {
    console.log(`[net] ${r.status()} ${r.request().method()} ${r.url()}`);
  }
});

await page.goto('http://localhost:4200/login', { waitUntil: 'networkidle' });
await page.fill('input[type=email]', 'ada@northwind.test');
await page.fill('input[type=password]', 'apion-dev-password');
await page.click('button[type=submit]');
await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 15000 });
await page.getByRole('link', { name: /Orders API/ }).first().click();
await page.waitForURL(/versions/, { timeout: 15000 });
await page.waitForLoadState('networkidle');
await page.waitForTimeout(2500);

console.log('url:', page.url());
await page.screenshot({ path: `${OUT}/w1-workspace.png` });
const body = (await page.textContent('body')).replace(/\s+/g, ' ');
console.log('body:', body.slice(0, 500));
await browser.close();

import { chromium } from 'playwright-core';

const OUT = process.argv[2];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
// Force the OS preference so the dark default is what a dark-mode user sees.
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  colorScheme: 'dark',
});

await page.goto('http://localhost:4200/login', { waitUntil: 'networkidle' });
console.log('login theme:', await page.getAttribute('html', 'data-theme'));
await page.screenshot({ path: `${OUT}/d1-login-dark.png` });

await page.fill('input[type=email]', 'ada@northwind.test');
await page.fill('input[type=password]', 'apion-dev-password');
await page.click('button[type=submit]');
await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 15000 });
await page.getByRole('link', { name: /Orders API/ }).first().click();
await page.waitForURL(/versions/, { timeout: 15000 });
await page.getByText('/orders/{orderId}').first().waitFor({ timeout: 15000 });
await page.getByText('/orders/{orderId}').first().click();
await page.waitForTimeout(1200);
console.log('workspace theme:', await page.getAttribute('html', 'data-theme'));
await page.screenshot({ path: `${OUT}/d2-workspace-dark.png` });

// Read back the resolved tokens so the palette is verifiable, not just visible.
const tokens = await page.evaluate(() => {
  const s = getComputedStyle(document.documentElement);
  return ['--surface-0', '--surface-1', '--text', '--text-muted', '--accent', '--line-control']
    .map((n) => `${n}=${s.getPropertyValue(n).trim()}`)
    .join('  ');
});
console.log('dark tokens:', tokens);
await browser.close();

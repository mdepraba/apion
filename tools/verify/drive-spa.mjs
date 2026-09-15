import { chromium } from 'playwright-core';

const OUT = process.argv[2];
const errors = [];
const step = (name, ok, note = '') =>
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ' :: ' + note : ''}`);

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

try {
  await page.goto('http://localhost:4200/', { waitUntil: 'networkidle' });
  step('load / redirects to login', page.url().includes('/login'), page.url());
  await page.screenshot({ path: `${OUT}/01-login-dark.png` });

  // DESIGN.md: dark is the product default, and a first visit follows the OS.
  // This machine may prefer either, so assert a resolved theme, not a fixed one.
  const theme = await page.getAttribute('html', 'data-theme');
  step('a theme resolves before first paint',
    theme === 'dark' || theme === 'light', `data-theme=${theme}`);

  // Sign in.
  await page.fill('input[type=email]', 'ada@northwind.test');
  await page.fill('input[type=password]', 'apion-dev-password');
  await page.click('button[type=submit]');
  await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 15000 });
  step('sign in navigates away from login', true, page.url());
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${OUT}/02-projects.png` });

  const projectsVisible = await page.getByText('orders-api').first().isVisible();
  step('projects list renders seeded projects', projectsVisible);

  // Open the project: should redirect into a version workspace.
  await page.getByRole('link', { name: /Orders API/ }).first().click();
  await page.waitForURL(/versions/, { timeout: 15000 });
  await page.waitForLoadState('networkidle');
  // The tree renders after its own query settles, which networkidle can miss.
  await page.getByText('/orders/{orderId}').first().waitFor({ timeout: 15000 });
  step('project opens a version workspace', true, new URL(page.url()).pathname);
  await page.screenshot({ path: `${OUT}/03-workspace.png` });

  const treeHasEndpoint = await page.getByText('/orders/{orderId}').first().isVisible();
  step('contract tree renders endpoints', treeHasEndpoint);

  // Select an endpoint.
  await page.getByText('/orders/{orderId}').first().click();
  await page.waitForLoadState('networkidle');
  const detailVisible = await page.getByText('Status history').isVisible();
  step('selecting an endpoint opens its detail', detailVisible);
  await page.screenshot({ path: `${OUT}/04-endpoint.png` });

  // Edit and save. The summary field is the first text input in the detail form.
  const summary = page.locator('form input[type=text], form input:not([type])').first();
  await summary.fill('Fetch one order, verified live');
  await page.waitForTimeout(300);
  const saveButton = page.getByRole('button', { name: /Save changes/ });
  step('save enables once the form is dirty', await saveButton.isEnabled());
  await saveButton.click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
  step('save completes without an error banner',
    !(await page.getByRole('alert').first().isVisible().catch(() => false)));
  await page.screenshot({ path: `${OUT}/05-saved.png` });

  // Command palette via keyboard.
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(400);
  const paletteOpen = await page.getByRole('dialog').isVisible();
  step('Ctrl+K opens the command palette', paletteOpen);
  await page.keyboard.type('orders');
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/06-palette.png` });
  const hasResults = (await page.getByRole('option').count()) > 0;
  step('palette returns search results', hasResults);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  step('Escape closes the palette', !(await page.getByRole('dialog').isVisible().catch(() => false)));

  // Theme toggle, both directions (R-34).
  const toggle = page.getByRole('button', { name: /Theme:/ });
  await toggle.click();
  await page.waitForTimeout(200);
  const t2 = await page.getAttribute('html', 'data-theme');
  await toggle.click();
  await page.waitForTimeout(200);
  const t3 = await page.getAttribute('html', 'data-theme');
  step('theme toggle cycles', t2 !== t3, `${theme} -> ${t2} -> ${t3}`);

  // Light mode screenshot.
  while ((await page.getAttribute('html', 'data-theme')) !== 'light') {
    await toggle.click();
    await page.waitForTimeout(200);
  }
  await page.screenshot({ path: `${OUT}/07-workspace-light.png` });
  step('light mode renders', true);

  // Mobile viewport (R-03): no horizontal overflow.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  step('no horizontal overflow at 390px', overflow <= 0, `overflow=${overflow}px`);
  await page.screenshot({ path: `${OUT}/08-mobile.png`, fullPage: false });

  // Keyboard-only reachability (R-32).
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);
  await page.evaluate(() => document.body.focus());
  const focusables = [];
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press('Tab');
    focusables.push(await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const style = getComputedStyle(el);
      return { tag: el.tagName, outline: style.outlineWidth };
    }));
  }
  const reached = focusables.filter(Boolean);
  step('Tab reaches interactive elements', reached.length >= 5, `${reached.length} stops`);

  step('no console errors', errors.length === 0, errors.slice(0, 2).join(' | '));
} catch (error) {
  step('run completed', false, String(error).slice(0, 300));
  await page.screenshot({ path: `${OUT}/99-failure.png` }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}

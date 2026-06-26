// Headless web front-door check for a deployed Hola dashboard.
// Drives real Chromium (Playwright) against the dashboard URL — no desktop/VNC.
// Loads the login page, signs in with the admin API key, asserts the dashboard
// renders, and writes screenshots. Exits non-zero on any failure.
//
// Env:
//   HOLA_BASE_URL   e.g. https://apps.10.0.0.5.sslip.io   (required)
//   HOLA_API_KEY    admin key for the sign-in step        (optional)
//   WEB_CHECK_OUT   screenshot output dir (default ./logs/web-check)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.HOLA_BASE_URL;
const KEY = process.env.HOLA_API_KEY || '';
const OUT = process.env.WEB_CHECK_OUT || join(process.cwd(), 'logs', 'web-check');
if (!BASE) { console.error('HOLA_BASE_URL is required'); process.exit(2); }
mkdirSync(OUT, { recursive: true });

const log = (m) => console.log(`[web-check] ${m}`);
const shot = async (page, name) => { const p = join(OUT, `${name}.png`); await page.screenshot({ path: p, fullPage: true }); log(`screenshot: ${p}`); };

const browser = await chromium.launch({ headless: true });
// ignoreHTTPSErrors: the test stack serves a self-signed cert by design.
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
let ok = true;

try {
  log(`loading ${BASE}`);
  const resp = await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  log(`HTTP ${resp?.status()}  title="${await page.title()}"`);
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await shot(page, '1-landing');

  // The login screen asks for the admin API key. Sign in if we have one.
  const keyInput = page.locator('input').first();
  if (KEY && await keyInput.isVisible().catch(() => false)) {
    log('login page detected — signing in with admin key');
    await keyInput.fill(KEY);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  }

  // Assert the authenticated dashboard rendered: the "Your apps" heading plus the
  // sidebar nav items (matched by text — they're not semantic <a> links).
  const dash = page.getByText(/your apps/i).first();
  await dash.waitFor({ state: 'visible', timeout: 20000 });
  const onApps = /\/apps(\b|$)/.test(page.url());
  const nav = (await page.getByText('Catalog', { exact: true }).first().isVisible().catch(() => false))
           && (await page.getByText('Deployments', { exact: true }).first().isVisible().catch(() => false));
  await shot(page, '2-dashboard');
  log(`/apps reached: ${onApps} | "Your apps" visible: yes | sidebar nav (Catalog+Deployments): ${nav}`);
  if (!onApps || !nav) { ok = false; log('FAIL: dashboard did not fully render after sign-in'); }
  log(`final URL: ${page.url()}`);
} catch (err) {
  ok = false;
  log(`FAIL: ${err.message}`);
  await shot(page, 'error').catch(() => {});
} finally {
  await browser.close();
}

log(ok ? 'PASS — web front-door OK' : 'FAIL — see screenshots above');
process.exit(ok ? 0 : 1);

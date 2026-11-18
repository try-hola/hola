// Full headless SSO login through Authentik for one catalog app (spec 009, FR-016/017).
// Drives real Chromium (Playwright) against a TRUSTED test VM: the test CA's leaf is
// accepted via --ignore-certificate-errors-spki-list and ignoreHTTPSErrors is OFF, so
// a TLS failure anywhere in the chain is a failure here, not something to skip.
//
// Env:
//   SSO_BASE         <ip>.sslip.io base domain of the VM            (required)
//   SSO_APP          catalog app id, e.g. gitea | immich | mealie     (required)
//   SSO_PASSWORD     the Authentik akadmin password                   (required; never printed)
//   SSO_USER         default akadmin
//   WEB_CHECK_SPKI   base64 SHA-256 SPKI of the leaf (bin/vm-test-ca spki)  (required)
//   SSO_OUT          screenshot dir (default ./logs/sso-check)
//   SSO_SW_PATH      optional: after login, load this path on the app and assert that
//                    navigator.serviceWorker.ready resolves within 30 s (SC-003)
// Prints `PASS sso <app>` or `FAIL sso <app> <hop>` and exits 0/1.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.SSO_BASE;
const APP = process.env.SSO_APP;
const USER = process.env.SSO_USER || 'akadmin';
const PASSWORD = process.env.SSO_PASSWORD;
const SPKI = process.env.WEB_CHECK_SPKI;
const OUT = process.env.SSO_OUT || join(process.cwd(), 'logs', 'sso-check');
const SW_PATH = process.env.SSO_SW_PATH || '';
for (const [k, v] of Object.entries({ SSO_BASE: BASE, SSO_APP: APP, SSO_PASSWORD: PASSWORD, WEB_CHECK_SPKI: SPKI })) {
  if (!v) { console.error(`${k} is required`); process.exit(2); }
}
mkdirSync(OUT, { recursive: true });

const APP_HOST = `${APP}.${BASE}`;
const AUTH_HOST = `auth.${BASE}`;
const IDP_BUTTON = /authentik|openid|oidc|oauth|single sign|sso/i;

// Per-app recipes (research R5). `login` is the page that offers the IdP; `check` is an
// authenticated same-origin API call that must answer 200 once the session exists.
// `null` login = forward-auth: the first request to the app host is redirected to Authentik.
const RECIPES = {
  // gitea's /api/v1 does not honour a browser session cookie, so check a page that
  // only renders for a signed-in user (it redirects to /user/login otherwise).
  gitea: { login: '/user/login', check: '/user/settings', noRedirect: true },
  immich: { login: '/auth/login', check: '/api/users/me' },
  mealie: { login: '/login', check: '/api/users/self' },
};
const recipe = RECIPES[APP] || { login: '/', check: null };   // generic forward-auth (e.g. craft-apps)

// Fresh-install prerequisites. A brand-new immich has no admin yet and sends every
// visitor to /auth/register; OAuth login only works once an admin exists. Create a
// throwaway one (random password, never printed) through the app's own API.
const PREPARE = {
  immich: async (page, origin) => {
    await page.goto(`${origin}/auth/login`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    const pw = `Aa1!${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
    const r = await page.evaluate(async (password) => {
      const cfg = await (await fetch('/api/server/config')).json();
      if (cfg.isInitialized) return { skipped: true };
      const x = await fetch('/api/auth/admin-sign-up', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'sso-check-admin@hola.test', name: 'sso-check', password }) });
      return { status: x.status };
    }, pw);
    log(r.skipped ? 'immich already initialised' : `immich admin created (HTTP ${r.status})`);
  },
};

const log = (m) => console.log(`[sso-check ${APP}] ${m}`);
const where = (page) => { try { const u = new URL(page.url()); return `${u.origin}${u.pathname}`; } catch { return page.url(); } };

const browser = await chromium.launch({
  headless: true,
  args: [`--ignore-certificate-errors-spki-list=${SPKI}`],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: false, viewport: { width: 1360, height: 900 } });
const page = await ctx.newPage();
let n = 0;
const shot = async (tag) => {
  const p = join(OUT, `${APP}-${String(++n).padStart(2, '0')}-${tag}.png`);
  await page.screenshot({ path: p, fullPage: true }).catch(() => {});
  log(`${tag}: ${where(page)}  (${p})`);
};
const onAuth = () => { try { return new URL(page.url()).host === AUTH_HOST; } catch { return false; } };
const onApp = () => { try { return new URL(page.url()).host === APP_HOST; } catch { return false; } };

class Hop extends Error { constructor(hop, detail) { super(detail || hop); this.hop = hop; } }

// Walk Authentik's flow: identification -> password -> (optional) consent, tolerating an
// already-authenticated session (it then redirects straight back to the app).
async function authentikFlow() {
  const deadline = Date.now() + 90_000;
  let sawUser = false, sawPassword = false;
  while (Date.now() < deadline) {
    if (onApp()) return;
    const uid = page.locator('input[name="uidField"]');
    const pw = page.locator('input[name="password"]');
    if (await uid.isVisible().catch(() => false) && !sawUser) {
      await uid.fill(USER); await page.keyboard.press('Enter'); sawUser = true; await page.waitForTimeout(1500); continue;
    }
    if (await pw.isVisible().catch(() => false) && !sawPassword) {
      await page.waitForTimeout(1500);                       // the field re-renders once; let it settle
      await pw.fill(PASSWORD);
      if ((await pw.inputValue()) !== PASSWORD) await pw.fill(PASSWORD);
      await page.keyboard.press('Enter'); sawPassword = true; await page.waitForTimeout(2500); continue;
    }
    const cont = page.getByRole('button', { name: /^(continue|consent|authorize|allow|accept)/i }).first();
    if (onAuth() && await cont.isEnabled().catch(() => false)) { await shot('consent'); await cont.click(); await page.waitForTimeout(2500); continue; }
    await page.waitForTimeout(1000);
  }
  throw new Hop(sawPassword ? 'consent' : sawUser ? 'authentik-password' : 'authentik-user', 'did not return to the app within 90s');
}

try {
  if (PREPARE[APP]) await PREPARE[APP](page, `https://${APP_HOST}`);

  // 1. Reach the login entry (forward-auth apps bounce straight to Authentik).
  const resp = await page.goto(`https://${APP_HOST}${recipe.login}`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    .catch((e) => { throw new Hop('login-page', `TLS/navigation failure: ${String(e.message).split('\n')[0]}`); });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await shot('1-login-page');
  if (!resp) throw new Hop('login-page', 'no response');

  // 2. Native-OIDC apps: click the IdP button on the app's own login page.
  if (!onAuth()) {
    if (recipe.login === '/' && !recipe.check) {
      // forward-auth: we should have been redirected; give it a moment. A fresh browser
      // context holds no session, so an app served WITHOUT that redirect is not SSO-gated
      // (and nothing below would notice: there is no session check for this recipe).
      await page.waitForURL((u) => u.host === AUTH_HOST, { timeout: 20_000 }).catch(() => {});
      if (!onAuth()) throw new Hop('forward-auth', `the app was served without a redirect to ${AUTH_HOST} (not SSO-gated)`);
    } else {
      const btn = page.locator('a, button').filter({ hasText: IDP_BUTTON }).first();
      await btn.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => { throw new Hop('idp-button', 'no Authentik/OIDC login button on the app login page'); });
      await btn.click();
      await page.waitForURL((u) => u.host === AUTH_HOST, { timeout: 30_000 }).catch(() => { throw new Hop('idp-button', 'clicking the IdP button did not reach Authentik'); });
    }
  }
  if (onAuth()) { await shot('2-authentik'); await authentikFlow(); }
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await shot('3-after-login');
  if (!onApp()) throw new Hop('app-session', `ended on ${where(page)}, not the app`);

  // 3. The app must now hold a session: an authenticated API call answers 200.
  if (recipe.check) {
    const r = await page.evaluate(async ([p, manual]) => {
      const x = await fetch(p, { credentials: 'include', redirect: manual ? 'manual' : 'follow' });
      return { s: x.status, t: x.type };
    }, [recipe.check, !!recipe.noRedirect]);
    log(`GET ${recipe.check} -> ${r.s}${r.t === 'opaqueredirect' ? ' (redirected: not signed in)' : ''}`);
    if (r.t === 'opaqueredirect' || r.s !== 200) throw new Hop('app-session', `${recipe.check} answered ${r.s} (${r.t}), not 200`);
  }

  // 4. Optional: the service worker registers (needs a TRUSTED secure context, SC-003).
  if (SW_PATH) {
    await page.goto(`https://${APP_HOST}${SW_PATH}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    const secure = await page.evaluate(() => window.isSecureContext);
    log(`isSecureContext=${secure}`);
    if (!secure) throw new Hop('service-worker', 'page is not a secure context (TLS not trusted)');
    const sw = await page.evaluate(() => Promise.race([
      navigator.serviceWorker.ready.then((r) => ({ ok: true, scope: r.scope })),
      new Promise((res) => setTimeout(() => res({ ok: false }), 30_000)),
    ]));
    await shot('4-service-worker');
    if (!sw.ok) throw new Hop('service-worker', 'navigator.serviceWorker.ready did not resolve within 30s');
    log(`service worker ready, scope ${sw.scope}`);
  }
  console.log(`PASS sso ${APP}`);
  await browser.close();
  process.exit(0);
} catch (e) {
  await shot('error').catch(() => {});
  const hop = e instanceof Hop ? e.hop : 'unexpected';
  log(`failed at ${hop}: ${String(e.message || e).split('\n')[0]}`);
  console.log(`FAIL sso ${APP} ${hop}`);
  await browser.close().catch(() => {});
  process.exit(1);
}

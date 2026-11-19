// Headless web front-door check for a deployed Hola dashboard.
// Drives real Chromium (Playwright) against the dashboard URL — no desktop/VNC.
// Loads the login page, signs in the way the dashboard asks for, asserts the dashboard
// renders, and writes screenshots. Exits non-zero on any failure.
//
// Sign-in follows the dashboard's own login (packages/web Login.tsx / useAuth.tsx), which
// it picks from the server's real GET /api/auth/config — never stubbed here:
//   - apikey: the admin-key field -> "Sign in" (HOLA_API_KEY). Unchanged from before #575.
//   - oidc (HOLA_AUTH_MODE=authentik, once the server has provisioned its OIDC client):
//     the dashboard redirects to Authentik on its own (or offers "Sign in with SSO" after a
//     failed round-trip); the check signs in there as WEB_CHECK_SSO_USER with
//     WEB_CHECK_SSO_PASSWORD, lets the dashboard complete /auth/callback, then asks
//     GET /api/auth/me with the dashboard's own access token which role it was given.
//   - none: the dashboard loads directly.
//
// Env:
//   HOLA_BASE_URL   e.g. https://apps.10.0.0.5.sslip.io   (required)
//   HOLA_API_KEY    admin key for the apikey sign-in step  (optional)
//   WEB_CHECK_SSO_PASSWORD  Authentik password for the SSO sign-in (needed only when the
//                   dashboard sends the browser to Authentik; never printed)
//   WEB_CHECK_SSO_USER      default akadmin
//   WEB_CHECK_OUT   screenshot output dir (default ./logs/web-check)
//   WEB_CHECK_SPKI  base64 SHA-256 SPKI of the test CA's leaf (bin/vm-test-ca spki). When
//                   set (trusted-TLS mode, spec 009) Chromium accepts that key via
//                   --ignore-certificate-errors-spki-list and certificate errors are NOT
//                   ignored, so the check really verifies TLS (and the page is a secure
//                   context, so service workers register). Unset: unchanged behaviour.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { authentikFlow } from './authentik-login.mjs';

const BASE = process.env.HOLA_BASE_URL;
const KEY = process.env.HOLA_API_KEY || '';
const SSO_USER = process.env.WEB_CHECK_SSO_USER || 'akadmin';
const SSO_PASSWORD = process.env.WEB_CHECK_SSO_PASSWORD || '';
const OUT = process.env.WEB_CHECK_OUT || join(process.cwd(), 'logs', 'web-check');
if (!BASE) { console.error('HOLA_BASE_URL is required'); process.exit(2); }
mkdirSync(OUT, { recursive: true });

const log = (m) => console.log(`[web-check] ${m}`);
const shot = async (page, name) => { const p = join(OUT, `${name}.png`); await page.screenshot({ path: p, fullPage: true }); log(`screenshot: ${p}`); };

const SPKI = process.env.WEB_CHECK_SPKI || '';
const browser = SPKI
  ? await chromium.launch({ headless: true, args: [`--ignore-certificate-errors-spki-list=${SPKI}`] })
  : await chromium.launch({ headless: true });
// Untrusted mode: ignoreHTTPSErrors, the test stack serves a self-signed cert by design.
// Trusted mode (WEB_CHECK_SPKI): errors are NOT ignored; the test CA's leaf is accepted by SPKI.
const ctx = await browser.newContext({ ignoreHTTPSErrors: !SPKI, viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
let ok = true;

const DASH_HOST = new URL(BASE).host;
const host = () => { try { return new URL(page.url()).host; } catch { return ''; } };
const onDashboard = () => host() === DASH_HOST;

// The mode the server reports, read from the real endpoint through the browser's own
// network stack (same TLS as the page). Informational + used to pick the sign-in path.
async function authMode() {
  return page.evaluate(async () => {
    try { const r = await fetch('/api/auth/config', { credentials: 'include' }); return r.ok ? (await r.json()).mode : `http-${r.status}`; }
    catch (e) { return `error: ${e.message}`; }
  }).catch(() => 'unknown');
}

// SSO sign-in: the dashboard has sent us to Authentik (or offers the SSO button).
async function signInWithSso() {
  if (onDashboard()) {
    // Login.tsx auto-redirects on a fresh visit; after a failed round-trip it shows a
    // manual "Sign in with SSO" button instead. Wait for whichever happens.
    const sso = page.getByRole('button', { name: /sign in with sso/i });
    await Promise.race([
      page.waitForURL((u) => u.host !== DASH_HOST, { timeout: 30_000 }),
      sso.waitFor({ state: 'visible', timeout: 30_000 }).then(async () => { if (onDashboard()) await sso.click(); }),
    ]).catch(() => {});
    await page.waitForURL((u) => u.host !== DASH_HOST, { timeout: 30_000 })
      .catch(() => { throw new Error('the dashboard reported OIDC but did not send the browser to its identity provider'); });
  }
  const authHost = host();
  log(`dashboard sent the browser to its identity provider (${authHost}) — signing in via Authentik as ${SSO_USER}`);
  if (!SSO_PASSWORD) {
    throw new Error('the dashboard signs in through Authentik, but no WEB_CHECK_SSO_PASSWORD was given '
      + '(bin/vm-web-check reads AUTHENTIK_BOOTSTRAP_PASSWORD from the VM; pass --vmid)');
  }
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await shot(page, '1b-authentik');
  try {
    await authentikFlow(page, {
      authHost, user: SSO_USER, password: SSO_PASSWORD, isDone: onDashboard, target: 'the dashboard',
      shot: (tag) => shot(page, `1c-authentik-${tag}`),
    });
  } catch (e) {
    throw new Error(`Authentik sign-in failed at ${e.hop || 'unexpected'}: ${e.message}`);
  }
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
}

// Which principal the dashboard's OIDC session maps to (useAuth keeps the token in
// oidc-client-ts's localStorage user store and sends it as a Bearer header).
async function oidcPrincipal() {
  return page.evaluate(async () => {
    const k = Object.keys(localStorage).find((x) => x.startsWith('oidc.user:'));
    if (!k) return { error: 'no OIDC user in the dashboard session store' };
    const token = JSON.parse(localStorage.getItem(k) || '{}').access_token;
    const r = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return { error: `GET /api/auth/me answered ${r.status}` };
    const p = await r.json();
    return { name: p.name, roles: p.roles || [], capabilities: p.capabilities || [] };
  });
}

try {
  log(`loading ${BASE}`);
  const resp = await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  log(`HTTP ${resp?.status()}  title="${await page.title()}"`);
  const mode = onDashboard() ? await authMode() : 'oidc';
  log(`dashboard auth mode (GET /api/auth/config): ${mode}`);
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await shot(page, '1-landing');

  let principal = null;
  if (mode === 'oidc' || !onDashboard()) {
    await signInWithSso();
    principal = await oidcPrincipal().catch((e) => ({ error: e.message }));
  } else {
    // The login screen asks for the admin API key. Sign in if we have one.
    const keyInput = page.locator('input').first();
    if (KEY && await keyInput.isVisible().catch(() => false)) {
      log('login page detected — signing in with admin key');
      await keyInput.fill(KEY);
      await page.getByRole('button', { name: /sign in/i }).click();
      await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    }
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

  // SSO only: the render assertions above hold for a read-only user too, so say which
  // one we got. The server makes a user admin via HOLA_OIDC_ADMIN_GROUP (default
  // hola-admins), into which it seeds Authentik's superusers — akadmin among them — so
  // anything but admin here is a real regression, not a harness limitation.
  if (principal) {
    if (principal.error) { ok = false; log(`FAIL: could not resolve the signed-in principal: ${principal.error}`); }
    else {
      const admin = principal.roles.includes('admin') || principal.capabilities.includes('*');
      log(`signed in as "${principal.name}" | roles: ${principal.roles.join(',') || '-'} | dashboard admin: ${admin ? 'yes' : 'no'}`);
      if (!admin) { ok = false; log(`FAIL: ${SSO_USER} is read-only on the dashboard (not in the OIDC admin group)`); }
    }
  }
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

// Shared Authentik sign-in for the headless harness scripts (bin/lib/sso-login.mjs,
// bin/lib/web-check.mjs). TEST-HARNESS ONLY.
//
// The caller has already navigated `page` to Authentik's flow (a redirect from an app,
// or from the Hola dashboard's OIDC login). This walks identification -> password ->
// (optional) consent until `isDone()` reports the browser is back where the caller
// wanted it, tolerating an already-authenticated session (Authentik then redirects
// straight back). The password is only ever typed into the field; it is never logged.

/** Error carrying the flow step it failed at (`hop`), as sso-login reports it. */
export class AuthentikHopError extends Error {
  constructor(hop, detail) { super(detail || hop); this.hop = hop; }
}

/**
 * @param {import('playwright').Page} page
 * @param {object} o
 * @param {string}   o.authHost   host of the Authentik server, e.g. auth.10.0.0.5.sslip.io
 * @param {string}   o.user       Authentik username (akadmin on test VMs)
 * @param {string}   o.password   its password (never printed)
 * @param {() => boolean} o.isDone   true once the browser has left Authentik for the caller's target
 * @param {(tag: string) => Promise<void>} [o.shot]  screenshot hook (called before a consent click)
 * @param {number}   [o.timeoutMs=90000]
 * @param {string}   [o.target='the app']  what isDone() waits for, for the error message
 */
export async function authentikFlow(page, { authHost, user, password, isDone, shot, timeoutMs = 90_000, target = 'the app' }) {
  const onAuth = () => { try { return new URL(page.url()).host === authHost; } catch { return false; } };
  const deadline = Date.now() + timeoutMs;
  let sawUser = false, sawPassword = false;
  while (Date.now() < deadline) {
    if (isDone()) return;
    const uid = page.locator('input[name="uidField"]');
    const pw = page.locator('input[name="password"]');
    if (await uid.isVisible().catch(() => false) && !sawUser) {
      await uid.fill(user); await page.keyboard.press('Enter'); sawUser = true; await page.waitForTimeout(1500); continue;
    }
    if (await pw.isVisible().catch(() => false) && !sawPassword) {
      await page.waitForTimeout(1500);                       // the field re-renders once; let it settle
      await pw.fill(password);
      if ((await pw.inputValue()) !== password) await pw.fill(password);
      await page.keyboard.press('Enter'); sawPassword = true; await page.waitForTimeout(2500); continue;
    }
    const cont = page.getByRole('button', { name: /^(continue|consent|authorize|allow|accept)/i }).first();
    if (onAuth() && await cont.isEnabled().catch(() => false)) {
      if (shot) await shot('consent');
      await cont.click(); await page.waitForTimeout(2500); continue;
    }
    await page.waitForTimeout(1000);
  }
  throw new AuthentikHopError(sawPassword ? 'consent' : sawUser ? 'authentik-password' : 'authentik-user',
    `did not return to ${target} within ${Math.round(timeoutMs / 1000)}s`);
}

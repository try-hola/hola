import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Copy } from 'lucide-react';

import { tailscaleExposureOf } from '@hola/shared';
import type {
  GetTailscaleIngressResponse,
  SetTailscaleIngressRequest,
  TailscaleIngressExposure,
  TailscaleIngressState,
} from '@hola/shared';

import { ConfirmDialog } from './ui/ConfirmDialog';
import { useTailscaleIngressApi } from '../hooks/useTailscaleIngressApi';

const STATE_LABELS: Record<TailscaleIngressState, string> = {
  off: 'Off',
  starting: 'Starting',
  'needs-sign-in': 'Needs sign-in',
  'waiting-for-approval': 'Waiting for approval',
  connected: 'Connected',
  disconnected: 'Disconnected',
  error: 'Error',
};

const STATE_TONE: Partial<Record<TailscaleIngressState, string>> = {
  connected: 'text-success',
  error: 'text-danger',
  disconnected: 'text-danger',
};

const BTN =
  'h-[34px] px-[13px] flex items-center gap-[7px] bg-surface-2 text-text-strong border border-border rounded-lg text-[13px] font-semibold hover:border-primary transition-colors';
const INPUT =
  'w-full h-10 bg-surface-0 border border-border rounded-[9px] text-text-strong px-[13px] text-[13px] font-mono outline-none focus:border-primary';
const LABEL = 'block text-xs text-text-faint mb-1';

interface FormState {
  serviceName: string;
  tag: string;
  backendService: string;
  backendPort: string;
  mode: 'https' | 'tcp';
  listenPort: string;
  acknowledge: boolean;
  exposure: TailscaleIngressExposure;
  /** Acknowledges that Tailscale-only leaves no other way in (#596). */
  acknowledgeOnly: boolean;
  authKey: string;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'app';
}

function initialForm(data: GetTailscaleIngressResponse, app: string): FormState {
  const s = data.setting;
  const d = data.defaults;
  return {
    serviceName: s?.serviceName ?? `svc:${slug(app)}`,
    tag: s?.tag ?? d.tag,
    backendService: s?.backend.service ?? d.backend.service,
    backendPort: String(s?.backend.port ?? d.backend.port ?? ''),
    mode: s?.mode ?? d.mode,
    listenPort: String(s?.listenPort ?? d.listenPort),
    acknowledge: s?.forwardAuthAcknowledged ?? false,
    exposure: tailscaleExposureOf(s),
    acknowledgeOnly: false,
    authKey: '',
  };
}

function CopyButton({ text, label }: { text: string; label: string }) {
  return (
    <button
      type="button"
      onClick={() => void navigator.clipboard?.writeText(text)}
      aria-label={label}
      title={label}
      className="flex-none w-7 h-7 flex items-center justify-center rounded-[7px] text-text-muted hover:text-text-strong hover:bg-surface-2 transition-colors"
    >
      <Copy className="w-3.5 h-3.5" />
    </button>
  );
}

/**
 * Private Tailscale ingress (spec 010) on the deployment Overview tab: state,
 * address, what the operator must do next, and the enable / edit / disable
 * flows. The joining credential lives in this component's state only while an
 * enable dialog is open (password-type input), is sent once, and is cleared on
 * close or success. Nothing here renders a credential back.
 */
export const TailscaleIngressCard: React.FC<{ deploymentId: string; appName: string }> = ({ deploymentId, appName }) => {
  const { data, loading, error, setIngress, disableIngress, saving, disabling, resetSet } = useTailscaleIngressApi(deploymentId);

  const [dialog, setDialog] = useState<'enable' | 'login' | 'disable' | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  if (loading && !data) return null;
  if (!data) {
    return error ? (
      <div className="bg-surface-1 border border-border rounded-card p-5 text-[13px] text-text-muted">
        <div className="font-semibold text-[13.5px] text-text-strong">Private Tailscale ingress</div>
        <div className="mt-1">{`Could not load its status: ${error}`}</div>
      </div>
    ) : null;
  }

  const { setting, status, defaults, guidance } = data;
  const enabled = setting?.enabled === true;
  // Disabled on a running app, waiting for its restart job to finish removal:
  // not "off" yet, and the server refuses a new enable until it is.
  const removing = setting?.removalPending === true;
  const firstEnable = !data.credentialHeld && !setting?.enrolledAt;
  const exposure = tailscaleExposureOf(setting);
  // Why Tailscale-only cannot be chosen right now (#596). The current value stays
  // selectable so an app already there can be edited without being forced back.
  const onlyBlockedReason: string | null =
    exposure === 'tailscale-only'
      ? null
      : defaults.tailscaleOnlySupported === false
        ? defaults.tailscaleOnlyUnsupportedReason ?? 'This app signs in through its public hostname.'
        : !enabled
          ? 'Enable private ingress first (as "Public hostname and Tailscale"), wait until it is Connected, then switch.'
          : status.state !== 'connected'
            ? `The private address must be Connected before the public hostname is removed (it is ${STATE_LABELS[status.state]}).`
            : null;

  const close = () => {
    // Drop the credential from component state (and the mutation's variables).
    setForm(null);
    setFormError(null);
    setDialog(null);
    resetSet();
  };

  const open = (d: 'enable' | 'login') => {
    setForm(initialForm(data, appName));
    setFormError(null);
    setDialog(d);
  };

  const patch = (p: Partial<FormState>) => setForm((f) => (f ? { ...f, ...p } : f));

  const submit = async () => {
    if (!form) return;
    const authKey = form.authKey.trim();
    if (dialog === 'login' && !authKey) { setFormError('Enter the new credential.'); return; }
    if (dialog === 'enable' && firstEnable && !authKey) { setFormError('A Tailscale credential is required the first time.'); return; }
    if (defaults.requiresForwardAuthAcknowledgement && dialog === 'enable' && !form.acknowledge) {
      setFormError('Acknowledge that the private address bypasses forward-auth to continue.');
      return;
    }
    // A port that does not parse is an error, never "omit it and let the server
    // default": that would silently configure a port the operator did not type.
    const backendPortText = form.backendPort.trim();
    const listenPortText = form.listenPort.trim();
    const backendPort = Number(backendPortText);
    const listenPort = Number(listenPortText);
    if (backendPortText && !Number.isInteger(backendPort)) {
      setFormError('Backend port must be a whole number from 1 to 65535.');
      return;
    }
    if (listenPortText && !Number.isInteger(listenPort)) {
      setFormError('Listen port must be a whole number from 1 to 65535.');
      return;
    }
    // Login re-sends the setting as it is: PUT replaces the whole thing, so
    // dropping a tailscale-only exposure here would put the public route back.
    const exposure: TailscaleIngressExposure = dialog === 'login' ? tailscaleExposureOf(setting) : form.exposure;
    if (exposure === 'tailscale-only' && dialog === 'enable' && !form.acknowledgeOnly) {
      setFormError('Acknowledge that Tailscale-only leaves no other way in, to continue.');
      return;
    }
    const body: SetTailscaleIngressRequest = {
      serviceName: form.serviceName.trim(),
      tag: form.tag.trim(),
      backend: {
        service: form.backendService,
        ...(backendPortText ? { port: backendPort } : {}),
      },
      mode: form.mode,
      ...(listenPortText ? { listenPort } : {}),
      ...(form.acknowledge || (dialog === 'login' && setting?.forwardAuthAcknowledged) ? { acknowledgeForwardAuthBypass: true } : {}),
      ...(exposure === 'tailscale-only' ? { exposure, acknowledgeTailscaleOnly: true } : {}),
      ...(authKey ? { authKey } : {}),
    };
    setFormError(null);
    try {
      const res = await setIngress(body);
      const parts = [res.jobId ? 'Saved. The app is restarting to apply it.' : 'Saved.', ...(res.warnings ?? [])];
      setNotice(parts.join(' '));
      close();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save private ingress');
    }
  };

  const confirmDisable = async () => {
    try {
      const res = await disableIngress();
      setNotice([res.jobId ? 'Disabled. The app is restarting.' : 'Disabled.', res.removal?.message].filter(Boolean).join(' '));
      close();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to disable private ingress');
    }
  };

  const address = status.dnsName
    ? `${setting?.mode === 'tcp' ? '' : 'https://'}${status.dnsName}${status.port && !(setting?.mode !== 'tcp' && status.port === 443) ? `:${status.port}` : ''}`
    : null;

  return (
    <div className="bg-surface-1 border border-border rounded-card p-5" data-testid="tailscale-ingress-card">
      <div className="flex items-center gap-2 text-[13.5px] font-semibold">
        <span>Private Tailscale ingress</span>
        {enabled && (
          <span className={`text-xs font-semibold ${STATE_TONE[status.state] ?? 'text-text-muted'}`} data-testid="tailscale-state">
            {STATE_LABELS[status.state]}
          </span>
        )}
      </div>

      {removing ? (
        <div className="text-[13px] text-text-muted mt-1" data-testid="tailscale-removing">{status.message}</div>
      ) : !enabled ? (
        <div className="text-[13px] text-text-muted mt-1">
          Off. Reach this app privately over your tailnet, without a public address.
        </div>
      ) : (
        <>
          <div className="text-[13px] text-text-strong mt-1" data-testid="tailscale-exposure">
            {exposure === 'tailscale-only' ? 'Reachable: Tailscale only — no public hostname' : 'Reachable: public hostname and Tailscale'}
          </div>
          <div className="text-[13px] text-text-muted mt-1">{status.message}</div>
          {address && (
            <div className="text-[13px] mt-2">
              <span className="text-text-faint">Address: </span>
              <span className="font-mono">{address}</span>
              {status.addresses?.length ? <span className="text-text-faint">{` (${status.addresses.join(', ')})`}</span> : null}
            </div>
          )}
          {setting && (
            <div className="text-xs text-text-faint mt-1">
              {`${setting.serviceName} → ${setting.backend.service}:${setting.backend.port}, device ${setting.nodeName}`}
            </div>
          )}
          {status.action && (
            <div className="text-[13px] mt-2 text-text-strong">{status.action}</div>
          )}
        </>
      )}

      {notice && (
        <div className="mt-3 text-[13px] text-text-strong" role="status">
          {notice}
        </div>
      )}

      <div className="flex flex-wrap gap-2 mt-4">
        {removing ? null : !enabled ? (
          <button className={BTN} onClick={() => open('enable')}>Enable</button>
        ) : (
          <>
            <button className={BTN} onClick={() => open('enable')}>Edit</button>
            <button className={BTN} onClick={() => open('login')}>Supply new credential</button>
            <button className={BTN} onClick={() => { setFormError(null); setDialog('disable'); }}>Disable</button>
          </>
        )}
      </div>

      <div className="mt-4">
        <button
          type="button"
          onClick={() => setGuideOpen((v) => !v)}
          aria-expanded={guideOpen}
          className="flex items-center gap-1 text-[13px] font-semibold text-primary"
        >
          {guideOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          Setup guide
        </button>
        {guideOpen && (
          <div className="mt-3 space-y-3 text-[13px]">
            {guidance.prerequisites.length > 0 && (
              <div>
                <div className="font-semibold">Prerequisites</div>
                <ul className="list-disc pl-5 text-text-muted">
                  {guidance.prerequisites.map((p, i) => <li key={i}>{p}</li>)}
                </ul>
              </div>
            )}
            <ol className="list-decimal pl-5 space-y-3">
              {guidance.steps.map((s, i) => (
                <li key={i}>
                  <div className="font-semibold">{s.title}</div>
                  <div className="text-text-muted">{s.detail}</div>
                  {s.snippet && (
                    <div className="mt-1 flex items-start gap-1 bg-surface-0 border border-border rounded-[9px] p-2">
                      <pre className="flex-1 min-w-0 overflow-x-auto text-[12px] font-mono m-0">{s.snippet}</pre>
                      <CopyButton text={s.snippet} label={`Copy snippet for ${s.title}`} />
                    </div>
                  )}
                </li>
              ))}
            </ol>
            {guidance.notes.length > 0 && (
              <div>
                <div className="font-semibold">Notes</div>
                <ul className="list-disc pl-5 text-text-muted">
                  {guidance.notes.map((n, i) => <li key={i}>{n}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Enable / edit, and credential-only, dialogs. */}
      <ConfirmDialog
        open={(dialog === 'enable' || dialog === 'login') && form !== null}
        title={dialog === 'login' ? 'Supply a new credential' : enabled ? 'Edit private Tailscale ingress' : 'Enable private Tailscale ingress'}
        body={
          dialog === 'login'
            ? 'The current setting is kept; only the joining credential is replaced.'
            : 'If the app is running it restarts briefly to apply this.'
        }
        confirmLabel={saving ? 'Saving…' : dialog === 'login' ? 'Save credential' : enabled ? 'Save' : 'Enable'}
        busy={saving}
        error={formError}
        onConfirm={() => void submit()}
        onCancel={close}
      >
        {form && (
          <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); void submit(); }} autoComplete="off">
            {dialog === 'enable' && (
              <>
                <div>
                  <label className={LABEL} htmlFor="ts-service">Service name</label>
                  <input id="ts-service" className={INPUT} value={form.serviceName} onChange={(e) => patch({ serviceName: e.target.value })} placeholder="svc:myapp" />
                </div>
                <div>
                  <label className={LABEL} htmlFor="ts-tag">Tag</label>
                  <input id="ts-tag" className={INPUT} value={form.tag} onChange={(e) => patch({ tag: e.target.value })} placeholder="tag:hola-ingress" />
                </div>
                <div className="grid grid-cols-[1fr_110px] gap-3">
                  <div>
                    <label className={LABEL} htmlFor="ts-backend">Backend service</label>
                    <select id="ts-backend" className={INPUT} value={form.backendService} onChange={(e) => patch({ backendService: e.target.value })}>
                      {(defaults.services.includes(form.backendService) ? defaults.services : [form.backendService, ...defaults.services]).map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={LABEL} htmlFor="ts-backend-port">Backend port</label>
                    <input id="ts-backend-port" className={INPUT} inputMode="numeric" value={form.backendPort} onChange={(e) => patch({ backendPort: e.target.value })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={LABEL} htmlFor="ts-mode">Mode</label>
                    <select id="ts-mode" className={INPUT} value={form.mode} onChange={(e) => patch({ mode: e.target.value as 'https' | 'tcp' })}>
                      <option value="https">https</option>
                      <option value="tcp">tcp</option>
                    </select>
                  </div>
                  <div>
                    <label className={LABEL} htmlFor="ts-listen">Listen port</label>
                    <input id="ts-listen" className={INPUT} inputMode="numeric" value={form.listenPort} onChange={(e) => patch({ listenPort: e.target.value })} />
                  </div>
                </div>
              </>
            )}
            <div>
              <label className={LABEL} htmlFor="ts-authkey">
                {dialog === 'enable' && !firstEnable ? 'Tailscale credential (leave blank to keep the current one)' : 'Tailscale credential'}
              </label>
              <input
                id="ts-authkey"
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                className={INPUT}
                value={form.authKey}
                onChange={(e) => patch({ authKey: e.target.value })}
                placeholder="tskey-auth-…"
              />
              <div className="text-xs text-text-faint mt-1">Sent once and never shown again.</div>
            </div>
            {dialog === 'enable' && defaults.requiresForwardAuthAcknowledgement && (
              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-[3px] w-4 h-4 accent-primary flex-none"
                  checked={form.acknowledge}
                  onChange={(e) => patch({ acknowledge: e.target.checked })}
                />
                <span>This app is protected by forward-auth at its normal address. I understand the private address does not pass through that gate.</span>
              </label>
            )}
            {dialog === 'enable' && (
              <fieldset className="border border-border rounded-[9px] p-3">
                <legend className="px-1 text-xs text-text-faint">Reachable</legend>
                <label className="flex items-start gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="ts-exposure"
                    className="mt-[3px] accent-primary flex-none"
                    checked={form.exposure === 'both'}
                    onChange={() => patch({ exposure: 'both', acknowledgeOnly: false })}
                  />
                  <span>Public hostname and Tailscale</span>
                </label>
                <label className={`flex items-start gap-2 text-sm mt-2 ${onlyBlockedReason ? 'opacity-60' : 'cursor-pointer'}`}>
                  <input
                    type="radio"
                    name="ts-exposure"
                    className="mt-[3px] accent-primary flex-none"
                    checked={form.exposure === 'tailscale-only'}
                    disabled={onlyBlockedReason !== null}
                    onChange={() => patch({ exposure: 'tailscale-only' })}
                  />
                  <span>Tailscale only — no public hostname</span>
                </label>
                {onlyBlockedReason && (
                  <div className="text-xs text-text-faint mt-1 pl-6" data-testid="tailscale-only-blocked">{onlyBlockedReason}</div>
                )}
                {form.exposure === 'tailscale-only' && (
                  <label className="flex items-start gap-2 text-sm cursor-pointer mt-3">
                    <input
                      type="checkbox"
                      className="mt-[3px] w-4 h-4 accent-primary flex-none"
                      checked={form.acknowledgeOnly}
                      onChange={(e) => patch({ acknowledgeOnly: e.target.checked })}
                    />
                    <span>I understand this removes the normal address. If the private address stops working, this app is unreachable until I switch back.</span>
                  </label>
                )}
              </fieldset>
            )}
            {/* Enter-to-submit without a visible second button. */}
            <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
          </form>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === 'disable'}
        title="Disable private Tailscale ingress?"
        body={
          setting
            ? `The app stops being reachable over the tailnet and restarts briefly. The Tailscale device '${setting.nodeName}' may remain in your admin console; delete it there if it is not removed automatically.`
            : undefined
        }
        confirmLabel={disabling ? 'Disabling…' : 'Disable'}
        busy={disabling}
        error={formError}
        danger
        onConfirm={() => void confirmDisable()}
        onCancel={close}
      />
    </div>
  );
};

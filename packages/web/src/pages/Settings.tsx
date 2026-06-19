import React, { useState } from 'react';
import {
  Shield,
  Info,
  Plus,
  X,
  Eye,
  EyeOff,
  Save,
  Wifi,
  WifiOff,
  AlertTriangle,
  Activity
} from 'lucide-react';
import type {
  SystemEnvVar,
  GetBackupSettingsResponse
} from '@hola/shared';
import { useSettingsApi } from '../hooks/useSettingsApi';
import { useBackupSettingsApi } from '../hooks/useSettingsApi';
import { useSystemStatusApi } from '../hooks/useSettingsApi';
import { useTheme, type ThemePref } from '../hooks/useTheme';
import { useAuth } from '../hooks/useAuth';

export const Settings: React.FC = () => {
  // API hooks for data management
  const {
    data: settings,
    loading: settingsLoading,
    error: settingsError,
    updateSettings
  } = useSettingsApi();

  const {
    data: backupSettings,
    loading: backupLoading,
    error: backupError,
    updateBackupSettings
  } = useBackupSettingsApi();

  const {
    data: systemStatus,
    loading: statusLoading,
    error: statusError
  } = useSystemStatusApi();

  // Theme is owned by the shared ThemeProvider (single source of truth shared
  // with the Topbar toggle), so the selector always reflects the applied theme.
  const { theme, setTheme } = useTheme();
  const { user, mode } = useAuth();

  // Local UI state
  const [notifications, setNotifications] = useState({
    email: true,
    push: true,
    updates: true,
    backups: true,
    errors: true,
  });
  const [analytics, setAnalytics] = useState(false);
  const [showSecrets, setShowSecrets] = useState<{[key: string]: boolean}>({});
  const [saving, setSaving] = useState(false);
  const [savingBackup, setSavingBackup] = useState(false);

  // Local state for system env vars editing
  const [localSystemEnvVars, setLocalSystemEnvVars] = useState<SystemEnvVar[]>([]);

  // Local state for backup settings editing
  const [localBackupSettings, setLocalBackupSettings] = useState<GetBackupSettingsResponse | null>(null);

  // Initialize local env vars when settings load
  React.useEffect(() => {
    if (settings?.systemEnv) {
      setLocalSystemEnvVars(settings.systemEnv);
    }
  }, [settings]);

  // Initialize local backup settings when they load
  React.useEffect(() => {
    if (backupSettings) {
      setLocalBackupSettings(backupSettings);
    }
  }, [backupSettings]);

  // Loading state - any API loading
  const loading = settingsLoading || backupLoading || statusLoading;

  // Combined error state
  const error = settingsError || backupError || statusError;

  // Save settings handlers
  const handleSaveSettings = async () => {
    if (!settings || !updateSettings) return;

    try {
      setSaving(true);
      await updateSettings({
        systemEnv: localSystemEnvVars,
        // Only include changed fields in the patch
      });
    } catch (err) {
      console.error('Failed to save settings:', err);
    } finally {
      setSaving(false);
    }
  };

  // Save backup settings handler
  const handleSaveBackupSettings = async () => {
    if (!localBackupSettings || !updateBackupSettings) return;

    try {
      setSavingBackup(true);
      await updateBackupSettings({
        scheduleEnabled: localBackupSettings.scheduleEnabled,
        scheduleTime: localBackupSettings.scheduleTime,
        retentionDays: localBackupSettings.retentionDays
      });
    } catch (err) {
      console.error('Failed to save backup settings:', err);
    } finally {
      setSavingBackup(false);
    }
  };

  // Helper functions for system env vars
  const addSystemEnvVar = () => {
    setLocalSystemEnvVars([...localSystemEnvVars, { key: '', value: '', isSecret: false, description: '' }]);
  };

  const updateSystemEnvVar = (index: number, field: keyof SystemEnvVar, value: string | boolean) => {
    const updated = [...localSystemEnvVars];
    updated[index] = { ...updated[index], [field]: value };
    setLocalSystemEnvVars(updated);
  };

  const removeSystemEnvVar = (index: number) => {
    setLocalSystemEnvVars(localSystemEnvVars.filter((_, i) => i !== index));
  };

  const toggleSecretVisibility = (key: string) => {
    setShowSecrets(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Helper to update local backup settings
  const updateLocalBackupSettings = (field: keyof GetBackupSettingsResponse, value: boolean | string | number) => {
    if (!localBackupSettings) return;
    setLocalBackupSettings({ ...localBackupSettings, [field]: value });
  };

  const themeOptions: { value: ThemePref; label: string }[] = [
    { value: 'dark', label: 'Dark' },
    { value: 'light', label: 'Light' },
    { value: 'system', label: 'System' },
  ];

  const notificationToggles: { key: keyof typeof notifications; label: string; desc: string }[] = [
    { key: 'email', label: 'Email notifications', desc: 'Deliver alerts to your inbox' },
    { key: 'updates', label: 'Update notifications', desc: 'New catalog versions and platform updates' },
    { key: 'backups', label: 'Backup notifications', desc: 'Scheduled backup results' },
    { key: 'errors', label: 'Error notifications', desc: 'Deployment and runtime failures' },
  ];

  const inputClass =
    'w-full h-10 bg-surface-2 border border-border rounded-[9px] text-text-strong px-[13px] text-[13.5px] outline-none focus:border-primary';
  const labelClass = 'text-[12.5px] text-text-muted mb-1.5';

  return (
    <div className="animate-fadein max-w-[760px]">
      {/* Header */}
      <div className="mb-[22px]">
        <h1 className="m-0 text-2xl font-semibold tracking-[-0.02em]">Settings</h1>
        <p className="mt-1.5 text-text-muted text-sm">
          Platform configuration for your ¡Hola! deployment.
        </p>
      </div>

      {error && (
        <div className="bg-danger-weak border border-danger/20 text-danger rounded-card p-4 text-sm mb-4 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 flex-none" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex flex-col gap-4">
        {/* Profile — the signed-in identity, from the auth provider. */}
        <div className="bg-surface-1 border border-border rounded-card p-5">
          <div className="font-semibold text-[15px] mb-1">Profile</div>
          <p className="text-[13px] text-text-muted mb-3.5">
            {mode === 'oidc'
              ? 'Managed by your identity provider. Edit details there.'
              : 'The identity signed in to this dashboard.'}
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className={labelClass}>Name</div>
              <input value={user?.name ?? '—'} readOnly className={inputClass} />
            </div>
            <div>
              <div className={labelClass}>Email</div>
              <input value={user?.email ?? '—'} readOnly className={inputClass} />
            </div>
          </div>
        </div>

        {/* Appearance */}
        <div className="bg-surface-1 border border-border rounded-card p-5">
          <div className="font-semibold text-[15px] mb-1">Appearance</div>
          <p className="text-[13px] text-text-muted mb-3.5">Choose how ¡Hola! looks. System follows your device.</p>
          <div className="flex gap-2">
            {themeOptions.map((o) => {
              const selected = theme === o.value;
              return (
                <div
                  key={o.value}
                  onClick={() => setTheme(o.value)}
                  className={`flex-1 h-[42px] flex items-center justify-center rounded-[10px] text-[13.5px] font-semibold cursor-pointer border ${
                    selected
                      ? 'bg-primary-weak text-primary border-primary'
                      : 'bg-surface-2 text-text-muted border-border hover:text-text-strong'
                  }`}
                >
                  {o.label}
                </div>
              );
            })}
          </div>
        </div>

        {/* Notifications */}
        <div className="bg-surface-1 border border-border rounded-card p-5">
          <div className="font-semibold text-[15px] mb-4">Notifications</div>
          {notificationToggles.map((t) => {
            const on = notifications[t.key];
            return (
              <div
                key={t.key}
                className="flex items-center gap-[14px] py-[11px] border-b border-border-soft"
              >
                <div className="flex-1">
                  <div className="text-[13.5px] font-medium">{t.label}</div>
                  <div className="text-xs text-text-faint">{t.desc}</div>
                </div>
                <div
                  onClick={() => setNotifications({ ...notifications, [t.key]: !on })}
                  className={`w-[38px] h-[22px] rounded-full relative cursor-pointer transition-colors flex-none ${
                    on ? 'bg-primary' : 'bg-surface-3'
                  }`}
                >
                  <div
                    className={`absolute top-[2px] w-[18px] h-[18px] rounded-full bg-white shadow transition-[left] ${
                      on ? 'left-[18px]' : 'left-[2px]'
                    }`}
                  />
                </div>
              </div>
            );
          })}
          {/* Analytics (privacy) */}
          <div className="flex items-center gap-[14px] py-[11px] border-b border-border-soft">
            <div className="flex-1">
              <div className="text-[13.5px] font-medium">Anonymous analytics</div>
              <div className="text-xs text-text-faint">Help improve ¡Hola! by sharing anonymous usage data</div>
            </div>
            <div
              onClick={() => setAnalytics(!analytics)}
              className={`w-[38px] h-[22px] rounded-full relative cursor-pointer transition-colors flex-none ${
                analytics ? 'bg-primary' : 'bg-surface-3'
              }`}
            >
              <div
                className={`absolute top-[2px] w-[18px] h-[18px] rounded-full bg-white shadow transition-[left] ${
                  analytics ? 'left-[18px]' : 'left-[2px]'
                }`}
              />
            </div>
          </div>
        </div>

        {/* Backup */}
        <div className="bg-surface-1 border border-border rounded-card p-5">
          <div className="font-semibold text-[15px] mb-1">Backup</div>
          <p className="text-[13px] text-text-muted mb-3.5">Configure automated backup schedules and retention.</p>

          {loading ? (
            <div className="animate-pulse space-y-4">
              <div className="h-4 bg-surface-2 rounded w-1/3" />
              <div className="h-10 bg-surface-2 rounded w-full" />
              <div className="h-4 bg-surface-2 rounded w-1/4" />
              <div className="h-10 bg-surface-2 rounded w-1/2" />
            </div>
          ) : localBackupSettings ? (
            <>
              {/* Schedule Toggle */}
              <div className="flex items-center gap-[14px] py-[11px] border-b border-border-soft">
                <div className="flex-1">
                  <div className="text-[13.5px] font-medium">Automated backups</div>
                  <div className="text-xs text-text-faint">Enable scheduled automatic backups</div>
                </div>
                <div
                  onClick={() => updateLocalBackupSettings('scheduleEnabled', !localBackupSettings.scheduleEnabled)}
                  className={`w-[38px] h-[22px] rounded-full relative cursor-pointer transition-colors flex-none ${
                    localBackupSettings.scheduleEnabled ? 'bg-primary' : 'bg-surface-3'
                  }`}
                >
                  <div
                    className={`absolute top-[2px] w-[18px] h-[18px] rounded-full bg-white shadow transition-[left] ${
                      localBackupSettings.scheduleEnabled ? 'left-[18px]' : 'left-[2px]'
                    }`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 pt-4">
                <div>
                  <div className={labelClass}>Backup time (server timezone)</div>
                  <input
                    type="time"
                    value={localBackupSettings.scheduleTime}
                    onChange={(e) => updateLocalBackupSettings('scheduleTime', e.target.value)}
                    disabled={!localBackupSettings.scheduleEnabled}
                    className={`${inputClass} font-mono disabled:opacity-50 disabled:cursor-not-allowed`}
                  />
                </div>
                <div>
                  <div className={labelClass}>Retention period (1–365 days)</div>
                  <input
                    type="number"
                    min="1"
                    max="365"
                    value={localBackupSettings.retentionDays}
                    onChange={(e) => updateLocalBackupSettings('retentionDays', parseInt(e.target.value))}
                    className={`${inputClass} font-mono`}
                  />
                </div>
              </div>

              <div className="flex justify-end pt-4 mt-4 border-t border-border-soft">
                <button
                  onClick={handleSaveBackupSettings}
                  disabled={savingBackup}
                  className="h-10 px-[14px] bg-primary-weak text-primary rounded-[9px] text-[13px] font-semibold hover:bg-primary hover:text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {savingBackup ? <Activity className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  <span>{savingBackup ? 'Saving…' : 'Save backup settings'}</span>
                </button>
              </div>
            </>
          ) : null}
        </div>

        {/* System environment variables */}
        <div className="bg-surface-1 border border-border rounded-card p-5">
          <div className="flex items-start justify-between mb-1">
            <div className="font-semibold text-[15px]">System environment variables</div>
            <button
              onClick={addSystemEnvVar}
              className="h-9 px-[12px] bg-primary-weak text-primary rounded-[9px] text-[13px] font-semibold hover:bg-primary hover:text-white flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>Add variable</span>
            </button>
          </div>
          <p className="text-[13px] text-text-muted mb-3.5">Global variables available to all deployments.</p>

          <div className="flex flex-col gap-2">
            {localSystemEnvVars.map((envVar: SystemEnvVar, index: number) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="VARIABLE_NAME"
                  value={envVar.key}
                  onChange={(e) => updateSystemEnvVar(index, 'key', e.target.value)}
                  className={`${inputClass} font-mono w-[34%] flex-none`}
                />
                <div className="flex-1 relative">
                  <input
                    type={envVar.isSecret && !showSecrets[envVar.key] ? 'password' : 'text'}
                    placeholder="Value"
                    value={envVar.value}
                    onChange={(e) => updateSystemEnvVar(index, 'value', e.target.value)}
                    className={`${inputClass} font-mono pr-10`}
                  />
                  {envVar.isSecret && (
                    <button
                      type="button"
                      onClick={() => toggleSecretVisibility(envVar.key)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-text-muted hover:text-text-strong"
                    >
                      {showSecrets[envVar.key] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  )}
                </div>
                <label className="flex items-center gap-1.5 text-[12.5px] text-text-muted flex-none cursor-pointer">
                  <input
                    type="checkbox"
                    checked={envVar.isSecret}
                    onChange={(e) => updateSystemEnvVar(index, 'isSecret', e.target.checked)}
                    className="w-4 h-4 accent-primary"
                  />
                  Secret
                </label>
                <button
                  onClick={() => removeSystemEnvVar(index)}
                  className="w-10 h-10 bg-surface-2 border border-border rounded-[9px] text-text-muted hover:text-danger flex items-center justify-center flex-none"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>

          <div className="flex justify-end pt-4 mt-4 border-t border-border-soft">
            <button
              onClick={handleSaveSettings}
              disabled={saving}
              className="h-10 px-[14px] bg-primary-weak text-primary rounded-[9px] text-[13px] font-semibold hover:bg-primary hover:text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {saving ? <Activity className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              <span>{saving ? 'Saving…' : 'Save system variables'}</span>
            </button>
          </div>
        </div>

        {/* System status */}
        {loading ? (
          <div className="bg-surface-1 border border-border rounded-card p-5">
            <div className="font-semibold text-[15px] mb-4">System status</div>
            <div className="animate-pulse grid grid-cols-2 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i}>
                  <div className="h-4 bg-surface-2 rounded w-1/2 mb-2" />
                  <div className="h-6 bg-surface-2 rounded w-3/4" />
                </div>
              ))}
            </div>
          </div>
        ) : systemStatus ? (
          <div className="bg-surface-1 border border-border rounded-card p-5">
            <div className="font-semibold text-[15px] mb-4">System status</div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className={labelClass}>¡Hola! platform</div>
                <div className="font-mono text-[13px] text-text-strong">v{systemStatus.version.hola}</div>
              </div>
              <div>
                <div className={labelClass}>Docker engine</div>
                <div className="font-mono text-[13px] text-text-strong flex items-center gap-2">
                  <span>v{systemStatus.docker.version || 'unknown'}</span>
                  {systemStatus.docker.ok ? (
                    <Wifi className="w-4 h-4 text-success" />
                  ) : (
                    <WifiOff className="w-4 h-4 text-danger" />
                  )}
                </div>
              </div>
              <div>
                <div className={labelClass}>Docker Compose</div>
                <div className="font-mono text-[13px] text-text-strong">v{systemStatus.version.compose}</div>
              </div>
              <div>
                <div className={labelClass}>Disk usage</div>
                <div className="font-mono text-[13px] text-text-strong">
                  {Math.round(((systemStatus.disk.totalBytes - systemStatus.disk.freeBytes) / systemStatus.disk.totalBytes) * 100)}% used
                </div>
              </div>
            </div>

            {/* Integrations */}
            <div className="pt-4 mt-4 border-t border-border-soft">
              <div className="text-[13.5px] font-medium mb-3">Integrations</div>
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between px-[13px] h-11 bg-surface-2 border border-border rounded-[9px]">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${systemStatus.docker.ok ? 'bg-success' : 'bg-danger'}`} />
                    <div className="text-[13.5px] font-medium">Docker engine</div>
                  </div>
                  <span className={`text-[13px] ${systemStatus.docker.ok ? 'text-success' : 'text-danger'}`}>
                    {systemStatus.docker.ok ? 'Connected' : 'Disconnected'}
                  </span>
                </div>

                {systemStatus.oras && (
                  <div className="flex items-center justify-between px-[13px] h-11 bg-surface-2 border border-border rounded-[9px]">
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${systemStatus.oras.ok ? 'bg-success' : 'bg-danger'}`} />
                      <div className="text-[13.5px] font-medium">ORAS registry</div>
                    </div>
                    <span className={`text-[13px] ${systemStatus.oras.ok ? 'text-success' : 'text-danger'}`}>
                      {systemStatus.oras.ok ? 'Connected' : 'Disconnected'}
                    </span>
                  </div>
                )}

                {systemStatus.authentik && (
                  <div className="flex items-center justify-between px-[13px] h-11 bg-surface-2 border border-border rounded-[9px]">
                    <div className="flex items-center gap-3">
                      <Shield className="w-3.5 h-3.5 text-primary" />
                      <div className="text-[13.5px] font-medium">Authentik SSO</div>
                    </div>
                    <span className={`text-[13px] ${systemStatus.authentik.ok ? 'text-success' : 'text-danger'}`}>
                      {systemStatus.authentik.ok ? 'Connected' : 'Disconnected'}
                    </span>
                  </div>
                )}

                <div className="flex items-center justify-between px-[13px] h-11 bg-surface-2 border border-border rounded-[9px]">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-success" />
                    <div className="text-[13.5px] font-medium">Traefik proxy</div>
                  </div>
                  <span className="text-[13px] text-success">Connected</span>
                </div>
              </div>
            </div>

            {/* Storage */}
            <div className="pt-4 mt-4 border-t border-border-soft">
              <div className="text-[13.5px] font-medium mb-3">Storage</div>
              <div className="flex flex-col gap-2 text-[13px]">
                <div className="flex items-center justify-between">
                  <span className="text-text-muted">Total disk space</span>
                  <span className="font-mono">{(systemStatus.disk.totalBytes / (1024 ** 3)).toFixed(1)} GB</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-text-muted">Free space</span>
                  <span className="font-mono">{(systemStatus.disk.freeBytes / (1024 ** 3)).toFixed(1)} GB</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-text-muted">Used space</span>
                  <span className="font-mono">{((systemStatus.disk.totalBytes - systemStatus.disk.freeBytes) / (1024 ** 3)).toFixed(1)} GB</span>
                </div>
                <div className="mt-1">
                  <div className="w-full bg-surface-2 rounded-full h-2 overflow-hidden">
                    <div
                      className={`h-2 rounded-full transition-all duration-300 ${
                        Math.round(((systemStatus.disk.totalBytes - systemStatus.disk.freeBytes) / systemStatus.disk.totalBytes) * 100) > 80
                          ? 'bg-danger'
                          : 'bg-success'
                      }`}
                      style={{ width: `${Math.round(((systemStatus.disk.totalBytes - systemStatus.disk.freeBytes) / systemStatus.disk.totalBytes) * 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {/* Identity management notice */}
        <div className="bg-surface-1 border border-border rounded-card p-5 flex items-start gap-3">
          <Info className="w-4 h-4 text-info flex-none mt-0.5" />
          <div className="text-[13px] text-text-muted">
            <span className="font-medium text-text-strong">Identity management.</span>{' '}
            Profile information is managed through Authentik. Use the Authentik dashboard to modify your account details.
          </div>
        </div>
      </div>
    </div>
  );
};

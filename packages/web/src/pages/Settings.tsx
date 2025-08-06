import React, { useState, useEffect, useCallback } from 'react';
import { 
  User, 
  Shield, 
  Palette, 
  Bell, 
  Server, 
  Activity,
  Globe,
  Info,
  Plus,
  X,
  Eye,
  EyeOff,
  Save,
  Wifi,
  WifiOff,
  AlertTriangle
} from 'lucide-react';
import type { 
  SystemEnvVar,
  GetSettingsResponse,
  PatchSettingsRequest,
  GetBackupSettingsResponse,
  PatchBackupSettingsRequest,
  SystemStatus
} from '@hola/shared';
// import { API } from '@hola/shared'; // Used in commented API calls

export const Settings: React.FC = () => {
  const [theme, setTheme] = useState('dark');
  const [notifications, setNotifications] = useState({
    email: true,
    push: true,
    updates: true,
    backups: true,
    errors: true,
  });
  const [analytics, setAnalytics] = useState(false);
  const [systemEnvVars, setSystemEnvVars] = useState<SystemEnvVar[]>([
    { key: 'DOMAIN', value: 'localhost', isSecret: false, description: 'Base domain for all services' },
    { key: 'TIMEZONE', value: 'UTC', isSecret: false, description: 'System timezone' },
    { key: 'BACKUP_RETENTION_DAYS', value: '30', isSecret: false, description: 'Default backup retention period' },
    { key: 'SMTP_HOST', value: '', isSecret: false, description: 'SMTP server for notifications' },
    { key: 'SMTP_USER', value: '', isSecret: false, description: 'SMTP username' },
    { key: 'SMTP_PASSWORD', value: '', isSecret: true, description: 'SMTP password' },
    { key: 'SSL_EMAIL', value: '', isSecret: false, description: 'Email for SSL certificates' },
  ]);
  const [showSecrets, setShowSecrets] = useState<{[key: string]: boolean}>({});
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [settings, setSettings] = useState<GetSettingsResponse | null>(null);
  const [backupSettings, setBackupSettings] = useState<GetBackupSettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingBackup, setSavingBackup] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load settings and system status
  const loadSettings = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      // TODO: Replace with actual API calls when ready
      // const [settingsResponse, backupSettingsResponse, statusResponse] = await Promise.all([
      //   fetch(API.settings.base),
      //   fetch(API.settings.backup),
      //   fetch(API.system.status)
      // ]);
      // 
      // if (!settingsResponse.ok) throw new Error('Failed to load settings');
      // if (!backupSettingsResponse.ok) throw new Error('Failed to load backup settings');
      // if (!statusResponse.ok) throw new Error('Failed to load system status');
      // 
      // const settingsData: GetSettingsResponse = await settingsResponse.json();
      // const backupSettingsData: GetBackupSettingsResponse = await backupSettingsResponse.json();
      // const statusData: GetSystemStatusResponse = await statusResponse.json();
      
      // For now, use mock data
      const mockSettings: GetSettingsResponse = {
        systemEnv: systemEnvVars,
        docker: { host: 'unix:///var/run/docker.sock' },
        tls: { email: 'admin@localhost' },
        notifications: { 
          smtpHost: 'smtp.localhost', 
          smtpUser: 'admin@localhost',
          smtpPassword: '[REDACTED]' // Password is redacted in GET responses
        }
      };

      const mockBackupSettings: GetBackupSettingsResponse = {
        scheduleEnabled: true,
        scheduleTime: '02:00',
        retentionDays: 30
      };
      
      const mockStatus: SystemStatus = {
        docker: { ok: true, version: '24.0.7' },
        disk: { freeBytes: 50 * 1024 * 1024 * 1024, totalBytes: 100 * 1024 * 1024 * 1024 },
        version: { hola: '1.0.0', compose: '2.23.3' },
        oras: { ok: true, version: '1.1.0' },
        authentik: { ok: true },
      };
      
      setSettings(mockSettings);
      setBackupSettings(mockBackupSettings);
      setSystemStatus(mockStatus);
      setSystemEnvVars(mockSettings.systemEnv);
    } catch (err) {
      console.error('Failed to load settings:', err);
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, [systemEnvVars]);

  // Save settings
  const saveSettings = useCallback(async () => {
    if (!settings) return;
    
    try {
      setSaving(true);
      setError(null);
      
      const updateRequest: PatchSettingsRequest = {
        systemEnv: systemEnvVars,
        // Only include changed fields in the patch
      };
      
      // TODO: Replace with actual API call when ready
      // const response = await fetch(API.settings.base, {
      //   method: 'PATCH',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify(updateRequest)
      // });
      // 
      // if (!response.ok) throw new Error('Failed to save settings');
      // const updatedSettings: GetSettingsResponse = await response.json();
      
      // For now, just update local state
      console.log('Saving settings:', updateRequest);
      
      // Show success feedback
      setError(null);
    } catch (err) {
      console.error('Failed to save settings:', err);
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  }, [settings, systemEnvVars]);

  // Save backup settings
  const saveBackupSettings = useCallback(async () => {
    if (!backupSettings) return;
    
    try {
      setSavingBackup(true);
      setError(null);
      
      const updateRequest: PatchBackupSettingsRequest = {
        scheduleEnabled: backupSettings.scheduleEnabled,
        scheduleTime: backupSettings.scheduleTime,
        retentionDays: backupSettings.retentionDays
      };
      
      // TODO: Replace with actual API call when ready
      // const response = await fetch(API.settings.backup, {
      //   method: 'PATCH',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify(updateRequest)
      // });
      // 
      // if (!response.ok) throw new Error('Failed to save backup settings');
      // const updatedBackupSettings: GetBackupSettingsResponse = await response.json();
      
      // For now, just update local state
      console.log('Saving backup settings:', updateRequest);
      
      // Show success feedback
      setError(null);
    } catch (err) {
      console.error('Failed to save backup settings:', err);
      setError(err instanceof Error ? err.message : 'Failed to save backup settings');
    } finally {
      setSavingBackup(false);
    }
  }, [backupSettings]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const addSystemEnvVar = () => {
    setSystemEnvVars([...systemEnvVars, { key: '', value: '', isSecret: false, description: '' }]);
  };

  const updateSystemEnvVar = (index: number, field: keyof SystemEnvVar, value: string | boolean) => {
    const updated = [...systemEnvVars];
    updated[index] = { ...updated[index], [field]: value };
    setSystemEnvVars(updated);
  };

  const removeSystemEnvVar = (index: number) => {
    setSystemEnvVars(systemEnvVars.filter((_, i) => i !== index));
  };

  const toggleSecretVisibility = (key: string) => {
    setShowSecrets(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const updateBackupSettings = (field: keyof GetBackupSettingsResponse, value: boolean | string | number) => {
    if (!backupSettings) return;
    setBackupSettings({ ...backupSettings, [field]: value });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-text-muted mt-1">Manage your ¡Hola! platform configuration</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Profile */}
        <div className="bg-surface-1 rounded-lg border border-border p-6">
          <div className="flex items-center space-x-3 mb-4">
            <User className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-medium">Profile</h2>
          </div>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Username</label>
              <div className="px-3 py-2 bg-surface-2 border border-border rounded-lg text-sm text-text-muted">
                admin (managed by Authentik)
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-2">Email</label>
              <div className="px-3 py-2 bg-surface-2 border border-border rounded-lg text-sm text-text-muted">
                admin@localhost (managed by Authentik)
              </div>
            </div>

            <div className="bg-info/10 border border-info/20 rounded-lg p-4">
              <div className="flex items-start space-x-3">
                <Info className="w-4 h-4 text-info flex-shrink-0 mt-0.5" />
                <div className="text-sm">
                  <div className="font-medium text-info">Identity Management</div>
                  <div className="text-text-muted mt-1">
                    Profile information is managed through Authentik. Use the Authentik dashboard to modify your account details.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Theme */}
        <div className="bg-surface-1 rounded-lg border border-border p-6">
          <div className="flex items-center space-x-3 mb-4">
            <Palette className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-medium">Appearance</h2>
          </div>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Theme</label>
              <select
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
                className="w-full px-3 py-2 bg-surface-0 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="dark">Dark</option>
                <option value="light">Light</option>
                <option value="system">System</option>
              </select>
            </div>
          </div>
        </div>

        {/* Notifications */}
        <div className="bg-surface-1 rounded-lg border border-border p-6">
          <div className="flex items-center space-x-3 mb-4">
            <Bell className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-medium">Notifications</h2>
          </div>
          
          <div className="space-y-4">
            <label className="flex items-center justify-between">
              <span className="text-sm">Email notifications</span>
              <input
                type="checkbox"
                checked={notifications.email}
                onChange={(e) => setNotifications({...notifications, email: e.target.checked})}
                className="w-4 h-4 text-primary bg-surface-0 border-border rounded focus:ring-primary/50"
              />
            </label>
            
            <label className="flex items-center justify-between">
              <span className="text-sm">Update notifications</span>
              <input
                type="checkbox"
                checked={notifications.updates}
                onChange={(e) => setNotifications({...notifications, updates: e.target.checked})}
                className="w-4 h-4 text-primary bg-surface-0 border-border rounded focus:ring-primary/50"
              />
            </label>
            
            <label className="flex items-center justify-between">
              <span className="text-sm">Backup notifications</span>
              <input
                type="checkbox"
                checked={notifications.backups}
                onChange={(e) => setNotifications({...notifications, backups: e.target.checked})}
                className="w-4 h-4 text-primary bg-surface-0 border-border rounded focus:ring-primary/50"
              />
            </label>
            
            <label className="flex items-center justify-between">
              <span className="text-sm">Error notifications</span>
              <input
                type="checkbox"
                checked={notifications.errors}
                onChange={(e) => setNotifications({...notifications, errors: e.target.checked})}
                className="w-4 h-4 text-primary bg-surface-0 border-border rounded focus:ring-primary/50"
              />
            </label>
          </div>
        </div>

        {/* Privacy */}
        <div className="bg-surface-1 rounded-lg border border-border p-6">
          <div className="flex items-center space-x-3 mb-4">
            <Shield className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-medium">Privacy</h2>
          </div>
          
          <div className="space-y-4">
            <label className="flex items-center justify-between">
              <div>
                <span className="text-sm font-medium">Analytics</span>
                <p className="text-xs text-text-muted">Help improve ¡Hola! by sharing anonymous usage data</p>
              </div>
              <input
                type="checkbox"
                checked={analytics}
                onChange={(e) => setAnalytics(e.target.checked)}
                className="w-4 h-4 text-primary bg-surface-0 border-border rounded focus:ring-primary/50"
              />
            </label>
          </div>
        </div>
      </div>

      {/* Backup Settings */}
      <div className="bg-surface-1 rounded-lg border border-border p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <Server className="w-5 h-5 text-primary" />
            <div>
              <h2 className="text-lg font-medium">Backup Settings</h2>
              <p className="text-sm text-text-muted">Configure automated backup schedules and retention</p>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-surface-2 rounded w-1/3"></div>
            <div className="h-10 bg-surface-2 rounded w-full"></div>
            <div className="h-4 bg-surface-2 rounded w-1/4"></div>
            <div className="h-10 bg-surface-2 rounded w-1/2"></div>
          </div>
        ) : backupSettings ? (
          <div className="space-y-6">
            {/* Schedule Toggle */}
            <div className="flex items-center justify-between">
              <div>
                <label className="text-sm font-medium">Automated Backups</label>
                <p className="text-xs text-text-muted mt-1">Enable scheduled automatic backups</p>
              </div>
              <input
                type="checkbox"
                checked={backupSettings.scheduleEnabled}
                onChange={(e) => updateBackupSettings('scheduleEnabled', e.target.checked)}
                className="w-4 h-4 text-primary bg-surface-0 border-border rounded focus:ring-primary/50"
              />
            </div>

            {/* Schedule Time */}
            <div className="space-y-2">
              <label className="block text-sm font-medium">Backup Time</label>
              <div className="flex items-center space-x-3">
                <input
                  type="time"
                  value={backupSettings.scheduleTime}
                  onChange={(e) => updateBackupSettings('scheduleTime', e.target.value)}
                  disabled={!backupSettings.scheduleEnabled}
                  className="px-3 py-2 bg-surface-0 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <span className="text-sm text-text-muted">Daily backup time (server timezone)</span>
              </div>
            </div>

            {/* Retention Period */}
            <div className="space-y-2">
              <label className="block text-sm font-medium">Retention Period</label>
              <div className="flex items-center space-x-3">
                <input
                  type="number"
                  min="1"
                  max="365"
                  value={backupSettings.retentionDays}
                  onChange={(e) => updateBackupSettings('retentionDays', parseInt(e.target.value))}
                  className="w-24 px-3 py-2 bg-surface-0 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                <span className="text-sm text-text-muted">days (1-365)</span>
              </div>
              <p className="text-xs text-text-muted">
                Backups older than this will be automatically deleted
              </p>
            </div>

            {/* Save Button */}
            <div className="flex justify-end space-x-3 pt-4 border-t border-border">
              {error && (
                <div className="flex items-center space-x-2 text-danger text-sm">
                  <AlertTriangle className="w-4 h-4" />
                  <span>{error}</span>
                </div>
              )}
              <button 
                onClick={saveBackupSettings}
                disabled={savingBackup}
                className="bg-primary text-primary-contrast px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
              >
                {savingBackup ? (
                  <Activity className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                <span>{savingBackup ? 'Saving...' : 'Save Backup Settings'}</span>
              </button>
            </div>

            {/* Info Notice */}
            <div className="bg-info/10 border border-info/20 rounded-lg p-4">
              <div className="flex items-start space-x-3">
                <Info className="w-4 h-4 text-info flex-shrink-0 mt-0.5" />
                <div className="text-sm">
                  <div className="font-medium text-info">Backup Schedule</div>
                  <div className="text-text-muted mt-1 space-y-1">
                    <div>• Automated backups run daily at the specified time</div>
                    <div>• Manual backups can be created anytime from the Backups page</div>
                    <div>• Backups include all deployment data and configurations</div>
                    <div>• Older backups are automatically cleaned up based on retention settings</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* System Environment Variables */}
      <div className="bg-surface-1 rounded-lg border border-border p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <Globe className="w-5 h-5 text-primary" />
            <div>
              <h2 className="text-lg font-medium">System Environment Variables</h2>
              <p className="text-sm text-text-muted">Global variables available to all deployments</p>
            </div>
          </div>
          <button
            onClick={addSystemEnvVar}
            className="bg-primary text-primary-contrast px-3 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors flex items-center space-x-2"
          >
            <Plus className="w-4 h-4" />
            <span>Add Variable</span>
          </button>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-12 gap-3 text-sm font-medium text-text-muted border-b border-border pb-2">
            <div className="col-span-3">Key</div>
            <div className="col-span-4">Value</div>
            <div className="col-span-1 text-center">Secret</div>
            <div className="col-span-3">Description</div>
            <div className="col-span-1"></div>
          </div>

          {systemEnvVars.map((envVar, index) => (
            <div key={index} className="grid grid-cols-12 gap-3 items-center p-3 bg-surface-2 rounded-lg">
              <div className="col-span-3">
                <input
                  type="text"
                  placeholder="VARIABLE_NAME"
                  value={envVar.key}
                  onChange={(e) => updateSystemEnvVar(index, 'key', e.target.value)}
                  className="w-full px-3 py-2 bg-surface-0 border border-border rounded text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              <div className="col-span-4 relative">
                <input
                  type={envVar.isSecret && !showSecrets[envVar.key] ? 'password' : 'text'}
                  placeholder="Value"
                  value={envVar.value}
                  onChange={(e) => updateSystemEnvVar(index, 'value', e.target.value)}
                  className="w-full px-3 py-2 bg-surface-0 border border-border rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 pr-10"
                />
                {envVar.isSecret && (
                  <button
                    type="button"
                    onClick={() => toggleSecretVisibility(envVar.key)}
                    className="absolute right-2 top-1/2 transform -translate-y-1/2 p-1 text-text-muted hover:text-text-strong transition-colors"
                  >
                    {showSecrets[envVar.key] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                )}
              </div>
              <div className="col-span-1 flex justify-center">
                <input
                  type="checkbox"
                  checked={envVar.isSecret}
                  onChange={(e) => updateSystemEnvVar(index, 'isSecret', e.target.checked)}
                  className="w-4 h-4 text-primary bg-surface-0 border-border rounded focus:ring-primary/50"
                />
              </div>
              <div className="col-span-3">
                <input
                  type="text"
                  placeholder="Description"
                  value={envVar.description}
                  onChange={(e) => updateSystemEnvVar(index, 'description', e.target.value)}
                  className="w-full px-3 py-2 bg-surface-0 border border-border rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              <div className="col-span-1 flex justify-center">
                <button
                  onClick={() => removeSystemEnvVar(index)}
                  className="p-1 text-text-muted hover:text-danger transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex justify-end space-x-3">
          {error && (
            <div className="flex items-center space-x-2 text-danger text-sm">
              <AlertTriangle className="w-4 h-4" />
              <span>{error}</span>
            </div>
          )}
          <button 
            onClick={saveSettings}
            disabled={saving}
            className="bg-success text-primary-contrast px-4 py-2 rounded-lg text-sm font-medium hover:bg-success/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
          >
            {saving ? (
              <Activity className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            <span>{saving ? 'Saving...' : 'Save System Variables'}</span>
          </button>
        </div>

        <div className="mt-4 bg-info/10 border border-info/20 rounded-lg p-4">
          <div className="flex items-start space-x-3">
            <Info className="w-4 h-4 text-info flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <div className="font-medium text-info">System Variables</div>
              <div className="text-text-muted mt-1">
                These variables are available to all deployments by default. Individual deployments can override these values when needed.
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* System Status & Information */}
      {loading ? (
        <div className="bg-surface-1 rounded-lg border border-border p-6">
          <div className="flex items-center space-x-3 mb-4">
            <Server className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-medium">System Status</h2>
          </div>
          <div className="animate-pulse">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {[1, 2, 3, 4].map((i) => (
                <div key={i}>
                  <div className="h-4 bg-surface-2 rounded w-1/2 mb-2"></div>
                  <div className="h-6 bg-surface-2 rounded w-3/4"></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : systemStatus ? (
        <div className="bg-surface-1 rounded-lg border border-border p-6">
          <div className="flex items-center space-x-3 mb-4">
            <Server className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-medium">System Status</h2>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
            <div>
              <div className="text-sm text-text-muted mb-1">Hola Platform</div>
              <div className="font-medium">v{systemStatus.version.hola}</div>
            </div>
            
            <div>
              <div className="text-sm text-text-muted mb-1">Docker Engine</div>
              <div className="font-medium flex items-center space-x-2">
                <span>v{systemStatus.docker.version || 'Unknown'}</span>
                {systemStatus.docker.ok ? 
                  <Wifi className="w-4 h-4 text-success" /> : 
                  <WifiOff className="w-4 h-4 text-danger" />
                }
              </div>
            </div>
            
            <div>
              <div className="text-sm text-text-muted mb-1">Docker Compose</div>
              <div className="font-medium">v{systemStatus.version.compose}</div>
            </div>
            
            <div>
              <div className="text-sm text-text-muted mb-1">Disk Usage</div>
              <div className="font-medium">
                {Math.round(((systemStatus.disk.totalBytes - systemStatus.disk.freeBytes) / systemStatus.disk.totalBytes) * 100)}% used
              </div>
            </div>
          </div>

          {/* Integration Status */}
          <div className="border-t border-border pt-6">
            <h3 className="text-lg font-medium mb-4">Integration Status</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-center justify-between p-3 bg-surface-2 rounded-lg">
                <div className="flex items-center space-x-3">
                  <div className={`w-2 h-2 rounded-full ${systemStatus.docker.ok ? 'bg-success' : 'bg-danger'}`}></div>
                  <div>
                    <div className="font-medium">Docker Engine</div>
                    <div className="text-sm text-text-muted">Container runtime</div>
                  </div>
                </div>
                <span className={`text-sm ${systemStatus.docker.ok ? 'text-success' : 'text-danger'}`}>
                  {systemStatus.docker.ok ? 'Connected' : 'Disconnected'}
                </span>
              </div>

              {systemStatus.oras && (
                <div className="flex items-center justify-between p-3 bg-surface-2 rounded-lg">
                  <div className="flex items-center space-x-3">
                    <div className={`w-2 h-2 rounded-full ${systemStatus.oras.ok ? 'bg-success' : 'bg-danger'}`}></div>
                    <div>
                      <div className="font-medium">ORAS Registry</div>
                      <div className="text-sm text-text-muted">OCI artifact storage</div>
                    </div>
                  </div>
                  <span className={`text-sm ${systemStatus.oras.ok ? 'text-success' : 'text-danger'}`}>
                    {systemStatus.oras.ok ? 'Connected' : 'Disconnected'}
                  </span>
                </div>
              )}

              {systemStatus.authentik && (
                <div className="flex items-center justify-between p-3 bg-surface-2 rounded-lg">
                  <div className="flex items-center space-x-3">
                    <div className={`w-2 h-2 rounded-full ${systemStatus.authentik.ok ? 'bg-success' : 'bg-danger'}`}></div>
                    <div>
                      <div className="font-medium">Authentik</div>
                      <div className="text-sm text-text-muted">Identity and access management</div>
                    </div>
                  </div>
                  <span className={`text-sm ${systemStatus.authentik.ok ? 'text-success' : 'text-danger'}`}>
                    {systemStatus.authentik.ok ? 'Connected' : 'Disconnected'}
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between p-3 bg-surface-2 rounded-lg">
                <div className="flex items-center space-x-3">
                  <div className="w-2 h-2 rounded-full bg-success"></div>
                  <div>
                    <div className="font-medium">Traefik Proxy</div>
                    <div className="text-sm text-text-muted">Reverse proxy and SSL termination</div>
                  </div>
                </div>
                <span className="text-sm text-success">Connected</span>
              </div>
            </div>
          </div>

          {/* Disk Usage Details */}
          <div className="border-t border-border pt-6 mt-6">
            <h3 className="text-lg font-medium mb-4">Storage Information</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-text-muted">Total Disk Space:</span>
                <span className="font-medium">{(systemStatus.disk.totalBytes / (1024 ** 3)).toFixed(1)} GB</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-text-muted">Free Space:</span>
                <span className="font-medium">{(systemStatus.disk.freeBytes / (1024 ** 3)).toFixed(1)} GB</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-text-muted">Used Space:</span>
                <span className="font-medium">{((systemStatus.disk.totalBytes - systemStatus.disk.freeBytes) / (1024 ** 3)).toFixed(1)} GB</span>
              </div>
              <div className="mt-2">
                <div className="flex justify-between text-xs text-text-muted mb-1">
                  <span>Disk Usage</span>
                  <span>{Math.round(((systemStatus.disk.totalBytes - systemStatus.disk.freeBytes) / systemStatus.disk.totalBytes) * 100)}%</span>
                </div>
                <div className="w-full bg-surface-0 rounded-full h-2">
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
    </div>
  );
};
import React, { useState } from 'react';
import { 
  User, 
  Shield, 
  Palette, 
  Bell, 
  Server, 
  HardDrive,
  Activity,
  Globe,
  Info,
  Plus,
  X,
  Eye,
  EyeOff
} from 'lucide-react';

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
  const [systemEnvVars, setSystemEnvVars] = useState([
    { key: 'DOMAIN', value: 'localhost', isSecret: false, description: 'Base domain for all services' },
    { key: 'TIMEZONE', value: 'UTC', isSecret: false, description: 'System timezone' },
    { key: 'BACKUP_RETENTION_DAYS', value: '30', isSecret: false, description: 'Default backup retention period' },
    { key: 'SMTP_HOST', value: '', isSecret: false, description: 'SMTP server for notifications' },
    { key: 'SMTP_USER', value: '', isSecret: false, description: 'SMTP username' },
    { key: 'SMTP_PASSWORD', value: '', isSecret: true, description: 'SMTP password' },
    { key: 'SSL_EMAIL', value: '', isSecret: false, description: 'Email for SSL certificates' },
  ]);
  const [showSecrets, setShowSecrets] = useState<{[key: string]: boolean}>({});

  const addSystemEnvVar = () => {
    setSystemEnvVars([...systemEnvVars, { key: '', value: '', isSecret: false, description: '' }]);
  };

  const updateSystemEnvVar = (index: number, field: string, value: any) => {
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

        <div className="mt-4 flex justify-end">
          <button className="bg-success text-primary-contrast px-4 py-2 rounded-lg text-sm font-medium hover:bg-success/90 transition-colors">
            Save System Variables
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

      {/* System Information */}
      <div className="bg-surface-1 rounded-lg border border-border p-6">
        <div className="flex items-center space-x-3 mb-4">
          <Server className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-medium">System Information</h2>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div>
            <div className="text-sm text-text-muted mb-1">Hola Version</div>
            <div className="font-medium">v1.0.0</div>
          </div>
          
          <div>
            <div className="text-sm text-text-muted mb-1">Docker Engine</div>
            <div className="font-medium">v24.0.7</div>
          </div>
          
          <div>
            <div className="text-sm text-text-muted mb-1">Docker Compose</div>
            <div className="font-medium">v2.23.0</div>
          </div>
          
          <div>
            <div className="text-sm text-text-muted mb-1">Platform</div>
            <div className="font-medium">OrbStack</div>
          </div>
        </div>
      </div>

      {/* Integration Status */}
      <div className="bg-surface-1 rounded-lg border border-border p-6">
        <div className="flex items-center space-x-3 mb-4">
          <Globe className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-medium">Integration Status</h2>
        </div>
        
        <div className="space-y-4">
          <div className="flex items-center justify-between p-3 bg-surface-2 rounded-lg">
            <div className="flex items-center space-x-3">
              <div className="w-2 h-2 bg-success rounded-full"></div>
              <div>
                <div className="font-medium">Traefik Proxy</div>
                <div className="text-sm text-text-muted">Reverse proxy and SSL termination</div>
              </div>
            </div>
            <span className="text-sm text-success">Connected</span>
          </div>
          
          <div className="flex items-center justify-between p-3 bg-surface-2 rounded-lg">
            <div className="flex items-center space-x-3">
              <div className="w-2 h-2 bg-success rounded-full"></div>
              <div>
                <div className="font-medium">Authentik</div>
                <div className="text-sm text-text-muted">Identity and access management</div>
              </div>
            </div>
            <span className="text-sm text-success">Connected</span>
          </div>
          
          <div className="flex items-center justify-between p-3 bg-surface-2 rounded-lg">
            <div className="flex items-center space-x-3">
              <div className="w-2 h-2 bg-success rounded-full"></div>
              <div>
                <div className="font-medium">Docker Engine</div>
                <div className="text-sm text-text-muted">Container runtime</div>
              </div>
            </div>
            <span className="text-sm text-success">Connected</span>
          </div>
        </div>
      </div>
    </div>
  );
};
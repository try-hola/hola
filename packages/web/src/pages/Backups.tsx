import React, { useState } from 'react';
import { Shield, Clock, Download, RotateCcw, Play, Calendar } from 'lucide-react';

const backups = [
  {
    id: '1',
    app: 'Nextcloud',
    icon: '☁️',
    timestamp: '2024-01-15 14:30:00',
    size: '2.4 GB',
    status: 'completed',
    type: 'automatic',
  },
  {
    id: '2',
    app: 'Home Assistant',
    icon: '🏠',
    timestamp: '2024-01-15 02:00:00',
    size: '145 MB',
    status: 'completed',
    type: 'automatic',
  },
  {
    id: '3',
    app: 'Bitwarden',
    icon: '🔐',
    timestamp: '2024-01-14 18:45:00',
    size: '82 MB',
    status: 'completed',
    type: 'manual',
  },
  {
    id: '4',
    app: 'Plex Media Server',
    icon: '🎬',
    timestamp: '2024-01-14 03:20:00',
    size: '1.2 GB',
    status: 'failed',
    type: 'automatic',
  },
];

const getStatusColor = (status: string) => {
  switch (status) {
    case 'completed':
      return 'text-success bg-success/10 border-success/20';
    case 'failed':
      return 'text-danger bg-danger/10 border-danger/20';
    case 'running':
      return 'text-info bg-info/10 border-info/20';
    default:
      return 'text-text-muted bg-surface-2 border-border';
  }
};

export const Backups: React.FC = () => {
  const [scheduleEnabled, setScheduleEnabled] = useState(true);
  const [scheduleTime, setScheduleTime] = useState('02:00');
  const [retention, setRetention] = useState(7);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold">Backups</h1>
        <p className="text-text-muted mt-1">Manage automated backups and restore your applications</p>
      </div>

      {/* Global Schedule */}
      <div className="bg-surface-1 rounded-lg border border-border p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium">Global Backup Schedule</h2>
          <label className="flex items-center space-x-2">
            <input
              type="checkbox"
              checked={scheduleEnabled}
              onChange={(e) => setScheduleEnabled(e.target.checked)}
              className="w-4 h-4 text-primary bg-surface-0 border-border rounded focus:ring-primary/50"
            />
            <span className="text-sm">Enable automatic backups</span>
          </label>
        </div>

        {scheduleEnabled && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label className="block text-sm font-medium mb-2">Backup Time</label>
              <input
                type="time"
                value={scheduleTime}
                onChange={(e) => setScheduleTime(e.target.value)}
                className="w-full px-3 py-2 bg-surface-0 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Retention (days)</label>
              <input
                type="number"
                min="1"
                max="30"
                value={retention}
                onChange={(e) => setRetention(parseInt(e.target.value))}
                className="w-full px-3 py-2 bg-surface-0 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div className="flex items-end">
              <button className="w-full bg-primary text-primary-contrast py-2 px-4 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
                Save Schedule
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Backup History */}
      <div className="bg-surface-1 rounded-lg border border-border">
        <div className="p-6 border-b border-border">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">Backup History</h2>
            <button className="bg-primary text-primary-contrast px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors flex items-center space-x-2">
              <Play className="w-4 h-4" />
              <span>Run All Backups</span>
            </button>
          </div>
        </div>

        <div className="divide-y divide-border">
          {backups.map((backup) => (
            <div key={backup.id} className="p-6 hover:bg-surface-2/50 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  <div className="text-xl">{backup.icon}</div>
                  
                  <div>
                    <div className="flex items-center space-x-3">
                      <h3 className="font-medium">{backup.app}</h3>
                      <span className={`text-xs px-2 py-1 rounded border capitalize ${getStatusColor(backup.status)}`}>
                        {backup.status}
                      </span>
                      <span className="text-xs text-text-muted bg-surface-2 px-2 py-1 rounded">
                        {backup.type}
                      </span>
                    </div>
                    
                    <div className="flex items-center space-x-4 mt-1 text-sm text-text-muted">
                      <span className="flex items-center space-x-1">
                        <Clock className="w-3 h-3" />
                        <span>{new Date(backup.timestamp).toLocaleString()}</span>
                      </span>
                      <span>Size: {backup.size}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  {backup.status === 'completed' && (
                    <>
                      <button className="p-2 text-text-muted hover:text-info transition-colors" title="Download">
                        <Download className="w-4 h-4" />
                      </button>
                      <button className="p-2 text-text-muted hover:text-warning transition-colors" title="Restore">
                        <RotateCcw className="w-4 h-4" />
                      </button>
                    </>
                  )}
                  <button className="p-2 text-text-muted hover:text-primary transition-colors" title="Run Backup">
                    <Play className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Storage Usage */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-surface-1 rounded-lg border border-border p-6">
          <div className="flex items-center space-x-3 mb-4">
            <Shield className="w-5 h-5 text-primary" />
            <h3 className="font-medium">Total Backups</h3>
          </div>
          <div className="text-2xl font-semibold">24</div>
          <div className="text-sm text-text-muted">Across 5 apps</div>
        </div>

        <div className="bg-surface-1 rounded-lg border border-border p-6">
          <div className="flex items-center space-x-3 mb-4">
            <Calendar className="w-5 h-5 text-success" />
            <h3 className="font-medium">Storage Used</h3>
          </div>
          <div className="text-2xl font-semibold">8.2 GB</div>
          <div className="text-sm text-text-muted">12% of available space</div>
        </div>

        <div className="bg-surface-1 rounded-lg border border-border p-6">
          <div className="flex items-center space-x-3 mb-4">
            <Clock className="w-5 h-5 text-info" />
            <h3 className="font-medium">Last Backup</h3>
          </div>
          <div className="text-2xl font-semibold">2 hrs</div>
          <div className="text-sm text-text-muted">ago (Nextcloud)</div>
        </div>
      </div>
    </div>
  );
};
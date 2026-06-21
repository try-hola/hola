import React from 'react';
import { useLocation } from 'react-router-dom';
import { Search, Moon, Sun, LogOut } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme';
import { useAuth } from '../../hooks/useAuth';

/** Two-letter initials from a name/email for the avatar. */
function initials(label: string | undefined): string {
  if (!label) return 'av';
  const parts = label.split(/[\s@.]+/).filter(Boolean);
  const chars = (parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '');
  return (chars || label.slice(0, 2)).toLowerCase();
}

const TITLES: Record<string, { title: string; crumb: string }> = {
  '/apps': { title: 'Your apps', crumb: 'Installed applications' },
  '/dashboard': { title: 'Dashboard', crumb: 'Server overview' },
  '/catalog': { title: 'Catalog', crumb: 'Browse & install apps' },
  '/deployments': { title: 'Deployments', crumb: 'All deployments' },
  '/backups': { title: 'Backups', crumb: 'Snapshots & restore' },
  '/notifications': { title: 'Notifications', crumb: 'System events' },
  '/settings': { title: 'Settings', crumb: 'Platform configuration' },
};

function pageInfo(pathname: string): { title: string; crumb: string } {
  if (pathname === '/' ) return TITLES['/apps'];
  if (pathname.startsWith('/catalog/')) return { title: 'Install app', crumb: 'Catalog → Install' };
  if (pathname.startsWith('/deployments/')) return { title: 'Deployment', crumb: 'Deployments → Detail' };
  const key = Object.keys(TITLES).find((k) => pathname.startsWith(k));
  return key ? TITLES[key] : { title: 'Hola', crumb: '' };
}

export const Topbar: React.FC = () => {
  const location = useLocation();
  const { applied, toggle } = useTheme();
  const { user, mode, logout } = useAuth();
  const { title, crumb } = pageInfo(location.pathname);
  const showAccount = mode !== null && mode !== 'none';
  const label = user?.name || user?.email;

  return (
    <header className="h-[60px] flex-none flex items-center gap-4 px-[22px] border-b border-border bg-surface-0/80 backdrop-blur-md z-[5]">
      <div className="min-w-0">
        <div className="text-base font-semibold tracking-[-0.01em] leading-tight">{title}</div>
        <div className="text-xs text-text-faint leading-snug">{crumb}</div>
      </div>

      <div className="flex-1" />

      {/* Search trigger */}
      <button className="hidden sm:flex items-center gap-[9px] h-9 px-3 bg-surface-1 border border-border rounded-[9px] text-text-faint cursor-pointer min-w-[210px] hover:border-primary transition-colors">
        <Search className="w-4 h-4" />
        <span className="text-[13px] flex-1 text-left">Search apps, deployments…</span>
        <span className="font-mono text-[11px] px-[6px] py-px border border-border rounded-[5px]">⌘K</span>
      </button>

      {/* Health */}
      <div className="hidden md:flex items-center gap-[9px] h-9 px-3 bg-surface-1 border border-border rounded-[9px]">
        <span className="relative flex w-2 h-2">
          <span className="absolute inset-0 rounded-full bg-success" />
          <span className="absolute inset-0 rounded-full bg-success animate-ping-slow" />
        </span>
        <span className="text-[12.5px] text-text-muted">{window.location.hostname}</span>
      </div>

      {/* Theme toggle */}
      <button
        onClick={toggle}
        title="Toggle theme"
        className="w-9 h-9 flex-none flex items-center justify-center bg-surface-1 border border-border rounded-[9px] text-text-muted cursor-pointer hover:text-text-strong hover:border-primary transition-colors"
      >
        {applied === 'dark' ? <Sun className="w-[18px] h-[18px]" /> : <Moon className="w-[18px] h-[18px]" />}
      </button>

      {/* Avatar + sign out (only when auth is enabled) */}
      <div
        className="w-9 h-9 flex-none flex items-center justify-center bg-surface-2 border border-border rounded-[9px] text-text-strong font-semibold text-[13px]"
        title={label ?? 'Account'}
      >
        {initials(label)}
      </div>
      {showAccount && (
        <button
          onClick={() => { void logout(); }}
          title="Sign out"
          className="w-9 h-9 flex-none flex items-center justify-center bg-surface-1 border border-border rounded-[9px] text-text-muted cursor-pointer hover:text-danger hover:border-danger transition-colors"
        >
          <LogOut className="w-[18px] h-[18px]" />
        </button>
      )}
    </header>
  );
};

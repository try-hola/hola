import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  LayoutGrid,
  Package,
  Server,
  Shield,
  Bell,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { SidebarVersion } from './SidebarVersion';

const navigationItems = [
  { name: 'Apps', path: '/apps', icon: LayoutGrid },
  { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
  { name: 'Catalog', path: '/catalog', icon: Package },
  { name: 'Deployments', path: '/deployments', icon: Server },
  { name: 'Backups', path: '/backups', icon: Shield },
  { name: 'Notifications', path: '/notifications', icon: Bell },
  { name: 'Settings', path: '/settings', icon: Settings },
];

interface SidebarProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ isCollapsed, onToggleCollapse }) => {
  const location = useLocation();

  const isActive = (path: string) => {
    if (path === '/apps') {
      return location.pathname === '/' || location.pathname.startsWith('/apps');
    }
    return location.pathname.startsWith(path);
  };

  return (
    <aside
      className={`${
        isCollapsed ? 'w-[64px]' : 'w-[228px]'
      } flex-none bg-surface-1 border-r border-border flex flex-col transition-[width] duration-200 overflow-hidden`}
    >
      {/* Brand */}
      <div className="h-[60px] flex-none flex items-center gap-3 px-[18px] border-b border-border-soft">
        <div className="w-[30px] h-[30px] flex-none rounded-lg bg-gradient-to-br from-primary to-violet flex items-center justify-center text-white font-bold text-[17px] shadow-[0_2px_10px_rgba(91,140,255,0.4)]">
          h
        </div>
        {!isCollapsed && <div className="font-semibold text-[17px] tracking-[-0.01em]">Hola</div>}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-3 flex flex-col gap-[3px] overflow-y-auto">
        {navigationItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.path);
          return (
            <Link
              key={item.name}
              to={item.path}
              title={item.name}
              className={`relative flex items-center gap-3 px-[11px] py-[9px] rounded-[9px] text-[13.5px] font-medium whitespace-nowrap transition-colors ${
                active
                  ? 'bg-primary-weak text-primary'
                  : 'text-text-muted hover:bg-surface-2 hover:text-text-strong'
              }`}
            >
              <span className={`flex flex-none ${active ? 'text-primary' : ''}`}>
                <Icon className="w-[18px] h-[18px]" />
              </span>
              {!isCollapsed && <span className="flex-1">{item.name}</span>}
              {item.badge && !isCollapsed && (
                <span className="flex-none min-w-[18px] h-[18px] px-[5px] rounded-full bg-primary text-white text-[11px] font-semibold font-mono flex items-center justify-center">
                  {item.badge}
                </span>
              )}
              {item.badge && isCollapsed && (
                <span className="absolute top-0 right-0 w-2 h-2 rounded-full bg-primary" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Version + collapse */}
      <div className="flex-none p-3 border-t border-border-soft flex flex-col gap-px">
        <SidebarVersion isCollapsed={isCollapsed} />
        <button
          onClick={onToggleCollapse}
          className="w-full flex items-center gap-3 px-[11px] py-[9px] rounded-[9px] cursor-pointer text-text-muted text-[13.5px] hover:bg-surface-2 hover:text-text-strong transition-colors"
        >
          <span className="flex flex-none">
            {isCollapsed ? (
              <PanelLeftOpen className="w-[18px] h-[18px]" />
            ) : (
              <PanelLeftClose className="w-[18px] h-[18px]" />
            )}
          </span>
          {!isCollapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
};

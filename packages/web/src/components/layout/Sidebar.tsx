import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Package, 
  Server, 
  Shield, 
  Bell, 
  Settings,
  Activity,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';

const navigationItems = [
  { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
  { name: 'Catalog', path: '/catalog', icon: Package },
  { name: 'Deployments', path: '/deployments', icon: Server },
  { name: 'Backups', path: '/backups', icon: Shield },
  { name: 'Notifications', path: '/notifications', icon: Bell, badge: 3 },
  { name: 'Settings', path: '/settings', icon: Settings },
];

interface SidebarProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ isCollapsed, onToggleCollapse }) => {
  const location = useLocation();

  const isActive = (path: string) => {
    if (path === '/dashboard') {
      return location.pathname === '/' || location.pathname === '/dashboard';
    }
    return location.pathname.startsWith(path);
  };

  return (
    <div className={`${isCollapsed ? 'w-16' : 'w-56'} bg-surface-1 border-r border-border flex flex-col transition-all duration-300 relative`}>
      {/* Collapse Toggle - positioned at top right */}
      <button
        onClick={onToggleCollapse}
        className="absolute top-4 -right-3 z-10 w-6 h-6 bg-surface-1 border border-border rounded-full flex items-center justify-center text-text-muted hover:text-text-strong hover:bg-surface-2 transition-colors shadow-sm"
        title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {isCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
      </button>

      {/* Navigation */}
      <nav className="flex-1 p-4 pt-6 space-y-2">
        {navigationItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.path);
          
          return (
            <Link
              key={item.name}
              to={item.path}
              className={`flex items-center ${isCollapsed ? 'justify-center' : 'justify-between'} px-3 py-2 rounded-lg text-sm font-medium transition-colors relative ${
                active
                  ? 'bg-primary/10 text-primary border border-primary/20'
                  : 'text-text-muted hover:text-text-strong hover:bg-surface-2'
              }`}
              title={isCollapsed ? item.name : undefined}
            >
              <div className={`flex items-center ${isCollapsed ? '' : 'space-x-3'}`}>
                <Icon className="w-4 h-4" />
                {!isCollapsed && <span>{item.name}</span>}
              </div>
              {item.badge && !isCollapsed && (
                <span className="bg-danger text-white text-xs px-2 py-0.5 rounded-full min-w-[1.25rem] h-5 flex items-center justify-center">
                  {item.badge}
                </span>
              )}
              {item.badge && isCollapsed && (
                <span className="absolute -top-1 -right-1 bg-danger text-white text-xs w-5 h-5 rounded-full flex items-center justify-center">
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* System Status */}
      <div className={`p-4 border-t border-border ${isCollapsed ? 'text-center' : ''}`}>
        <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'space-x-2'} text-sm text-text-muted`}>
          <Activity className="w-4 h-4 text-success" />
          {!isCollapsed && <span>System Healthy</span>}
        </div>
        {!isCollapsed && <div className="text-xs text-text-muted mt-1">
          5 deployments running
        </div>}
      </div>
    </div>
  );
};
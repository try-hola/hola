import React, { ReactNode, useState } from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { UpdateAvailableBanner } from '../UpdateAvailableBanner';
import { useGlobalEvents } from '../../hooks/useGlobalEvents';

interface AppShellProps {
  children: ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({ children }) => {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  // One global SSE subscription for the whole authenticated app (#291) — drives
  // live list/detail updates so the views don't depend on polling.
  useGlobalEvents();

  return (
    <div className="flex h-screen w-full overflow-hidden bg-surface-0 text-text-strong font-sans">
      <Sidebar
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed((v) => !v)}
      />
      <div className="flex flex-1 flex-col min-w-0">
        <Topbar />
        <UpdateAvailableBanner />
        <main className="flex-1 overflow-y-auto relative">
          <div className="px-8 py-7 max-w-[1280px] mx-auto">{children}</div>
        </main>
      </div>
    </div>
  );
};

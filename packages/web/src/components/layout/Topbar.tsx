import React from 'react';
import { Link } from 'react-router-dom';
import { Search, User } from 'lucide-react';

export const Topbar: React.FC = () => {
  return (
    <header className="h-16 bg-surface-1 border-b border-border px-6 flex items-center justify-between">
      {/* Logo */}
      <Link to="/dashboard" className="flex items-center space-x-3 group">
        <span className="text-2xl group-hover:scale-110 transition-transform">🌮</span>
        <span className="text-xl font-semibold">¡Hola!</span>
      </Link>
      
      {/* Search and User */}
      <div className="flex items-center space-x-6">
        <div className="relative flex-1 max-w-3xl min-w-96">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            placeholder="Search apps, deployments..."
            className="w-full pl-10 pr-4 py-2.5 bg-surface-2 border border-border rounded-lg text-sm placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
          />
        </div>
        
        {/* User Profile */}
        <div className="flex items-center space-x-3">
          <div className="text-right text-sm">
            <div className="text-text-strong font-medium">Admin User</div>
            <div className="text-text-muted">admin@localhost</div>
          </div>
          <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center">
            <User className="w-4 h-4 text-primary-contrast" />
          </div>
        </div>
      </div>
    </header>
  );
};
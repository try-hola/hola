import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { Dashboard } from './pages/Dashboard';
import { VerySimpleStrictTest } from './pages/VerySimpleStrictTest';
import { LiveFeaturesDemo } from './pages/LiveFeaturesDemo';
import PerformanceOptimizationsDemo from './pages/PerformanceOptimizationsDemo';
import ErrorHandlingDemo from './pages/ErrorHandlingDemo';
import { Apps } from './pages/Apps';
import { Catalog } from './pages/Catalog';
import { Deployments } from './pages/Deployments';
import { DeploymentDetail } from './pages/DeploymentDetail';
import { InstallWizard } from './pages/InstallWizard';
import { Backups } from './pages/Backups';
import { Notifications } from './pages/Notifications';
import { Settings } from './pages/Settings';

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-surface-0 text-text-strong">
        <AppShell>
          <Routes>
            <Route path="/" element={<Navigate to="/apps" replace />} />
            <Route path="/apps" element={<Apps />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/very-simple-strict" element={<VerySimpleStrictTest />} />
            <Route path="/live-features-demo" element={<LiveFeaturesDemo />} />
            <Route path="/performance-optimizations-demo" element={<PerformanceOptimizationsDemo />} />
            <Route path="/error-handling-demo" element={<ErrorHandlingDemo />} />
            <Route path="/catalog" element={<Catalog />} />
            <Route path="/catalog/:appId/install" element={<InstallWizard />} />
            <Route path="/deployments" element={<Deployments />} />
            <Route path="/deployments/:deploymentId" element={<DeploymentDetail />} />
            <Route path="/backups" element={<Backups />} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </AppShell>
      </div>
    </Router>
  );
}

export default App;

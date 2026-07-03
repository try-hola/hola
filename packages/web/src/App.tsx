import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { RequireAuth } from './components/auth/RequireAuth';
import { ThemeProvider } from './hooks/useTheme';
import { AuthProvider } from './hooks/useAuth';
import { Dashboard } from './pages/Dashboard';
import { Apps } from './pages/Apps';
import { Catalog } from './pages/Catalog';
import { Deployments } from './pages/Deployments';
import { DeploymentDetail } from './pages/DeploymentDetail';
import { InstallWizard } from './pages/InstallWizard';
import { Backups } from './pages/Backups';
import { Notifications } from './pages/Notifications';
import { Settings } from './pages/Settings';
import { Login } from './pages/Login';
import { AuthCallback } from './pages/AuthCallback';

function App() {
  return (
    <ThemeProvider>
      <Router>
        <AuthProvider>
          <Routes>
            {/* Public auth routes (outside the guard). */}
            <Route path="/login" element={<Login />} />
            <Route path="/auth/callback" element={<AuthCallback />} />

            {/* Everything else requires authentication. */}
            <Route
              path="/*"
              element={
                <RequireAuth>
                  <div className="min-h-screen bg-surface-0 text-text-strong">
                    <AppShell>
                      <Routes>
                        <Route path="/" element={<Navigate to="/apps" replace />} />
                        <Route path="/apps" element={<Apps />} />
                        <Route path="/dashboard" element={<Dashboard />} />
                        <Route path="/catalog" element={<Catalog />} />
                        <Route path="/catalog/:appId/install" element={<InstallWizard />} />
                        {/* Install-by-ref: same wizard, draft seeded from an OCI ref (?ref=&cred=) */}
                        <Route path="/install/ref" element={<InstallWizard />} />
                        <Route path="/deployments" element={<Deployments />} />
                        <Route path="/deployments/:deploymentId" element={<DeploymentDetail />} />
                        <Route path="/backups" element={<Backups />} />
                        <Route path="/notifications" element={<Notifications />} />
                        <Route path="/settings" element={<Settings />} />
                      </Routes>
                    </AppShell>
                  </div>
                </RequireAuth>
              }
            />
          </Routes>
        </AuthProvider>
      </Router>
    </ThemeProvider>
  );
}

export default App;

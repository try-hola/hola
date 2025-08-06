import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, Upload, X, Plus, AlertTriangle, Eye, EyeOff, RotateCw, FileText, Code, Download } from 'lucide-react';

const steps = [
  { id: 'env', name: 'Environment Variables', description: 'Configure application settings' },
  { id: 'compose', name: 'Compose Override', description: 'Upload custom Docker Compose configuration' },
  { id: 'files', name: 'Additional Files', description: 'Upload configuration files and certificates' },
  { id: 'advanced', name: 'Advanced Options', description: 'Configure ports, volumes, and other settings' },
  { id: 'validate', name: 'Validate & Preflight', description: 'Check configuration and system compatibility' },
  { id: 'summary', name: 'Summary & Confirm', description: 'Review and confirm installation' },
];

export const InstallWizard: React.FC = () => {
  const { appId } = useParams();
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  
  // System-wide environment variables (would come from API/context in real app)
  const systemEnvVars = [
    { key: 'DOMAIN', value: 'localhost', isSecret: false, description: 'Base domain for all services' },
    { key: 'TIMEZONE', value: 'UTC', isSecret: false, description: 'System timezone' },
    { key: 'BACKUP_RETENTION_DAYS', value: '30', isSecret: false, description: 'Default backup retention period' },
    { key: 'SMTP_HOST', value: '', isSecret: false, description: 'SMTP server for notifications' },
    { key: 'SMTP_USER', value: '', isSecret: false, description: 'SMTP username' },
    { key: 'SMTP_PASSWORD', value: '', isSecret: true, description: 'SMTP password' },
    { key: 'SSL_EMAIL', value: '', isSecret: false, description: 'Email for SSL certificates' },
  ];
  
  // System variable overrides for this deployment
  const [systemOverrides, setSystemOverrides] = useState<{[key: string]: string}>({});
  
  // Application-specific environment variables
  const [envVars, setEnvVars] = useState([
    { key: 'POSTGRES_DB', value: 'nextcloud', isSecret: false, description: 'Database name' },
    { key: 'POSTGRES_USER', value: 'nextcloud', isSecret: false, description: 'Database user' },
    { key: 'POSTGRES_PASSWORD', value: '', isSecret: true, description: 'Database password' },
  ]);
  
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);
  const [ports, setPorts] = useState([{ host: 8080, container: 80, protocol: 'tcp' }]);
  const [volumes, setVolumes] = useState([{ hostPath: './data', containerPath: '/var/www/html', readOnly: false }]);
  const [showSecrets, setShowSecrets] = useState<{[key: string]: boolean}>({});
  const [composeOverride, setComposeOverride] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  // Mock app data
  const app = {
    id: appId,
    name: 'Nextcloud',
    icon: '☁️',
    description: 'Self-hosted productivity platform with file sync, calendar, and collaboration tools',
  };

  const canProceed = () => {
    switch (currentStep) {
      case 0: // Environment Variables
        // Allow proceeding even with empty values for demo purposes
        return true;
      case 4: // Validate & Preflight
        return true; // Always allow proceeding from validate step
      default:
        return true;
    }
  };

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleInstall = () => {
    // Mock installation process
    navigate('/deployments');
  };

  const addEnvVar = () => {
    setEnvVars([...envVars, { key: '', value: '', isSecret: false, description: '' }]);
  };

  const updateEnvVar = (index: number, field: string, value: any) => {
    const updated = [...envVars];
    updated[index] = { ...updated[index], [field]: value };
    setEnvVars(updated);
  };

  const removeEnvVar = (index: number) => {
    setEnvVars(envVars.filter((_, i) => i !== index));
  };

  const addPort = () => {
    setPorts([...ports, { host: 0, container: 0, protocol: 'tcp' }]);
  };

  const updatePort = (index: number, field: string, value: any) => {
    const updated = [...ports];
    updated[index] = { ...updated[index], [field]: value };
    setPorts(updated);
  };

  const removePort = (index: number) => {
    setPorts(ports.filter((_, i) => i !== index));
  };

  const updateSystemOverride = (key: string, value: string) => {
    const systemDefault = systemEnvVars.find(v => v.key === key)?.value || '';
    if (value === systemDefault) {
      // If value matches system default, remove override
      const newOverrides = { ...systemOverrides };
      delete newOverrides[key];
      setSystemOverrides(newOverrides);
    } else {
      // Set override
      setSystemOverrides({ ...systemOverrides, [key]: value });
    }
  };

  const resetSystemOverride = (key: string) => {
    const newOverrides = { ...systemOverrides };
    delete newOverrides[key];
    setSystemOverrides(newOverrides);
  };

  const toggleSecretVisibility = (key: string) => {
    setShowSecrets(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleFileUpload = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    
    const file = files[0];
    if (file.name.includes('docker-compose') && (file.name.endsWith('.yml') || file.name.endsWith('.yaml'))) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        setComposeOverride(content);
        setEditMode(true);
      };
      reader.readAsText(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    handleFileUpload(e.dataTransfer.files);
  };

  const downloadComposeFile = () => {
    const blob = new Blob([composeOverride], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'docker-compose.override.yml';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const getDefaultComposeOverride = () => {
    return `# Docker Compose Override for ${app.name}
# This file allows you to customize the deployment

version: '3.8'

services:
  app:
    # Add custom environment variables
    environment:
      - CUSTOM_VAR=value
    
    # Add custom volumes
    volumes:
      - ./custom-config:/app/config
    
    # Add custom labels
    labels:
      - "traefik.http.routers.${app.id}.rule=Host(\`${app.id}.example.com\`)"
    
    # Override resource limits
    deploy:
      resources:
        limits:
          memory: 512M
        reservations:
          memory: 256M`;
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 0: // Environment Variables
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-medium mb-2">Environment Variables</h3>
              <p className="text-text-muted text-sm">Configure the application environment variables.</p>
            </div>

            {/* System Environment Variables */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-medium">System Environment Variables</h4>
                <div className="text-sm text-text-muted">
                  Override system defaults only when needed
                </div>
              </div>
              
              <div className="space-y-3">
                {systemEnvVars.map((envVar) => {
                  const isOverridden = systemOverrides.hasOwnProperty(envVar.key);
                  const currentValue = isOverridden ? systemOverrides[envVar.key] : envVar.value;
                  const showValue = envVar.isSecret && !showSecrets[envVar.key];
                  
                  return (
                    <div key={envVar.key} className={`p-4 border rounded-lg ${
                      isOverridden ? 'border-warning/50 bg-warning/5' : 'border-border bg-surface-2'
                    }`}>
                      <div className="grid grid-cols-12 gap-4 items-center">
                        <div className="col-span-3">
                          <div className="flex items-center space-x-2">
                            <span className="font-mono text-sm font-medium">{envVar.key}</span>
                            {isOverridden && (
                              <span className="text-xs bg-warning text-primary-contrast px-2 py-0.5 rounded">
                                OVERRIDE
                              </span>
                            )}
                          </div>
                          {envVar.description && (
                            <div className="text-xs text-text-muted mt-1">{envVar.description}</div>
                          )}
                        </div>
                        
                        <div className="col-span-4 relative">
                          <input
                            type={showValue ? 'password' : 'text'}
                            value={currentValue}
                            onChange={(e) => updateSystemOverride(envVar.key, e.target.value)}
                            className="w-full px-3 py-2 bg-surface-0 border border-border rounded text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
                            placeholder={envVar.value || 'Enter value...'}
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
                        
                        <div className="col-span-2 text-center">
                          <span className="text-xs text-text-muted">
                            {envVar.isSecret ? 'Secret' : 'Public'}
                          </span>
                        </div>
                        
                        <div className="col-span-2 text-center">
                          <span className="text-xs text-text-muted">
                            Default: {envVar.isSecret && !showSecrets[envVar.key] ? '••••••••' : (envVar.value || '(empty)')}
                          </span>
                        </div>
                        
                        <div className="col-span-1 text-center">
                          {isOverridden && (
                            <button
                              onClick={() => resetSystemOverride(envVar.key)}
                              className="p-1 text-text-muted hover:text-warning transition-colors"
                              title="Reset to system default"
                            >
                              <RotateCw className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {Object.keys(systemOverrides).length > 0 && (
                <div className="bg-warning/10 border border-warning/20 rounded-lg p-4">
                  <div className="flex items-start space-x-3">
                    <AlertTriangle className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />
                    <div className="text-sm">
                      <div className="font-medium text-warning">System Variable Overrides</div>
                      <div className="text-text-muted mt-1">
                        You have overridden {Object.keys(systemOverrides).length} system variable(s). 
                        These will only affect this deployment.
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Application-Specific Environment Variables */}
            <div className="space-y-4">
              <h4 className="font-medium">Application-Specific Variables</h4>
              
              {envVars.map((env, index) => (
                <div key={index} className="grid grid-cols-12 gap-4 items-start p-4 bg-surface-1 rounded-lg border border-border">
                  <div className="col-span-3">
                    <input
                      type="text"
                      placeholder="Key"
                      value={env.key}
                      onChange={(e) => updateEnvVar(index, 'key', e.target.value)}
                      className="w-full px-3 py-2 bg-surface-0 border border-border rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                  </div>
                  <div className="col-span-4 relative">
                    <input
                      type={env.isSecret && !showSecrets[env.key] ? 'password' : 'text'}
                      placeholder="Value"
                      value={env.value}
                      onChange={(e) => updateEnvVar(index, 'value', e.target.value)}
                      className="w-full px-3 py-2 bg-surface-0 border border-border rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                    {env.isSecret && (
                      <button
                        type="button"
                        onClick={() => toggleSecretVisibility(env.key)}
                        className="absolute right-2 top-1/2 transform -translate-y-1/2 p-1 text-text-muted hover:text-text-strong transition-colors"
                      >
                        {showSecrets[env.key] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    )}
                  </div>
                  <div className="col-span-1 flex items-center justify-center">
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={env.isSecret}
                        onChange={(e) => updateEnvVar(index, 'isSecret', e.target.checked)}
                        className="w-4 h-4 text-primary bg-surface-0 border-border rounded focus:ring-primary/50"
                      />
                    </label>
                  </div>
                  <div className="col-span-3">
                    <input
                      type="text"
                      placeholder="Description"
                      value={env.description}
                      onChange={(e) => updateEnvVar(index, 'description', e.target.value)}
                      className="w-full px-3 py-2 bg-surface-0 border border-border rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                  </div>
                  <div className="col-span-1 flex items-center justify-center">
                    <button
                      onClick={() => removeEnvVar(index)}
                      className="p-1 text-text-muted hover:text-danger transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}

              <button
                onClick={addEnvVar}
                className="flex items-center space-x-2 px-4 py-2 bg-surface-1 border border-border rounded-lg hover:bg-surface-2 transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span>Add App Variable</span>
              </button>
            </div>
          </div>
        );

      case 1: // Compose Override
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-medium mb-2">Docker Compose Override</h3>
              <p className="text-text-muted text-sm">
                Upload a Docker Compose override file or edit one directly to customize the deployment.
              </p>
            </div>

            {!editMode ? (
              <div className="space-y-4">
                {/* Upload Area */}
                <div 
                  className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                    isDragOver 
                      ? 'border-primary bg-primary/5' 
                      : 'border-border hover:border-primary/50'
                  }`}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                >
                  <Upload className={`w-8 h-8 mx-auto mb-4 ${isDragOver ? 'text-primary' : 'text-text-muted'}`} />
                  <p className="text-text-muted mb-2">
                    Drag & drop your docker-compose.override.yml here
                  </p>
                  <div className="flex items-center justify-center space-x-3">
                    <label className="bg-primary text-primary-contrast px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors cursor-pointer">
                      Browse Files
                      <input
                        type="file"
                        accept=".yml,.yaml"
                        onChange={(e) => handleFileUpload(e.target.files)}
                        className="hidden"
                      />
                    </label>
                    <span className="text-text-muted">or</span>
                    <button
                      onClick={() => {
                        setComposeOverride(getDefaultComposeOverride());
                        setEditMode(true);
                      }}
                      className="bg-surface-2 text-text-strong px-4 py-2 rounded-lg text-sm font-medium hover:bg-surface-1 transition-colors flex items-center space-x-2"
                    >
                      <Code className="w-4 h-4" />
                      <span>Create New</span>
                    </button>
                  </div>
                </div>

                {/* Info Box */}
                <div className="bg-info/10 border border-info/20 rounded-lg p-4">
                  <div className="flex items-start space-x-3">
                    <FileText className="w-4 h-4 text-info flex-shrink-0 mt-0.5" />
                    <div className="text-sm">
                      <div className="font-medium text-info">Docker Compose Override</div>
                      <div className="text-text-muted mt-1">
                        Override files allow you to customize services, add volumes, modify environment variables, 
                        and configure networking without modifying the base compose file.
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Editor Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <FileText className="w-5 h-5 text-primary" />
                    <span className="font-medium">docker-compose.override.yml</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={downloadComposeFile}
                      className="p-2 bg-surface-2 hover:bg-surface-1 rounded-lg transition-colors"
                      title="Download file"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => {
                        setEditMode(false);
                        setComposeOverride('');
                      }}
                      className="p-2 bg-surface-2 hover:bg-surface-1 rounded-lg transition-colors"
                      title="Close editor"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Code Editor */}
                <div className="border border-border rounded-lg overflow-hidden">
                  <div className="bg-surface-2 px-4 py-2 border-b border-border">
                    <div className="flex items-center space-x-2 text-sm text-text-muted">
                      <div className="w-3 h-3 bg-danger rounded-full"></div>
                      <div className="w-3 h-3 bg-warning rounded-full"></div>
                      <div className="w-3 h-3 bg-success rounded-full"></div>
                      <span className="ml-2">docker-compose.override.yml</span>
                    </div>
                  </div>
                  <textarea
                    value={composeOverride}
                    onChange={(e) => setComposeOverride(e.target.value)}
                    className="w-full h-96 p-4 bg-surface-0 text-text-strong font-mono text-sm resize-none focus:outline-none"
                    placeholder="Enter your Docker Compose override configuration..."
                    spellCheck={false}
                  />
                </div>

                {/* Editor Footer */}
                <div className="flex items-center justify-between text-sm text-text-muted">
                  <div className="flex items-center space-x-4">
                    <span>Lines: {composeOverride.split('\n').length}</span>
                    <span>Characters: {composeOverride.length}</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span>YAML</span>
                  </div>
                </div>
              </div>
            )}

            {uploadedFiles.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-medium">Uploaded Files</h4>
                {uploadedFiles.map((file, index) => (
                  <div key={index} className="flex items-center justify-between p-3 bg-surface-1 border border-border rounded-lg">
                    <span className="text-sm">{file}</span>
                    <button
                      onClick={() => setUploadedFiles(uploadedFiles.filter((_, i) => i !== index))}
                      className="text-text-muted hover:text-danger transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );

      case 2: // Additional Files
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-medium mb-2">Additional Files</h3>
              <p className="text-text-muted text-sm">Upload configuration files, certificates, or other assets.</p>
            </div>

            <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
              <Upload className="w-8 h-8 text-text-muted mx-auto mb-4" />
              <p className="text-text-muted mb-2">Drag & drop files here or click to browse</p>
              <button className="bg-primary text-primary-contrast px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
                Browse Files
              </button>
            </div>
          </div>
        );

      case 3: // Advanced Options
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-medium mb-2">Advanced Options</h3>
              <p className="text-text-muted text-sm">Configure port mappings, volume mounts, and other advanced settings.</p>
            </div>

            {/* Ports */}
            <div>
              <h4 className="font-medium mb-3">Port Mappings</h4>
              <div className="space-y-3">
                {ports.map((port, index) => (
                  <div key={index} className="grid grid-cols-8 gap-4 items-center p-4 bg-surface-1 rounded-lg border border-border">
                    <div className="col-span-2">
                      <input
                        type="number"
                        placeholder="Host Port"
                        value={port.host || ''}
                        onChange={(e) => updatePort(index, 'host', parseInt(e.target.value))}
                        className="w-full px-3 py-2 bg-surface-0 border border-border rounded text-sm"
                      />
                    </div>
                    <div className="col-span-2">
                      <input
                        type="number"
                        placeholder="Container Port"
                        value={port.container || ''}
                        onChange={(e) => updatePort(index, 'container', parseInt(e.target.value))}
                        className="w-full px-3 py-2 bg-surface-0 border border-border rounded text-sm"
                      />
                    </div>
                    <div className="col-span-2">
                      <select
                        value={port.protocol}
                        onChange={(e) => updatePort(index, 'protocol', e.target.value)}
                        className="w-full px-3 py-2 bg-surface-0 border border-border rounded text-sm"
                      >
                        <option value="tcp">TCP</option>
                        <option value="udp">UDP</option>
                      </select>
                    </div>
                    <div className="col-span-1 text-center">
                      <span className="text-xs text-success">✓ Available</span>
                    </div>
                    <div className="col-span-1 text-center">
                      <button
                        onClick={() => removePort(index)}
                        className="p-1 text-text-muted hover:text-danger transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
                <button
                  onClick={addPort}
                  className="flex items-center space-x-2 px-4 py-2 bg-surface-1 border border-border rounded-lg hover:bg-surface-2 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add Port</span>
                </button>
              </div>
            </div>
          </div>
        );

      case 4: // Validate & Preflight
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-medium mb-2">Validation & Preflight Checks</h3>
              <p className="text-text-muted text-sm">Verify configuration and check system compatibility.</p>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-surface-1 rounded-lg border border-border">
                <div className="flex items-center space-x-3">
                  <Check className="w-5 h-5 text-success" />
                  <div>
                    <div className="font-medium">Environment Variables</div>
                    <div className="text-sm text-text-muted">All required variables configured</div>
                  </div>
                </div>
                <span className="text-success text-sm font-medium">PASS</span>
              </div>

              <div className="flex items-center justify-between p-4 bg-surface-1 rounded-lg border border-border">
                <div className="flex items-center space-x-3">
                  <Check className="w-5 h-5 text-success" />
                  <div>
                    <div className="font-medium">Port Availability</div>
                    <div className="text-sm text-text-muted">No port conflicts detected</div>
                  </div>
                </div>
                <span className="text-success text-sm font-medium">PASS</span>
              </div>

              <div className="flex items-center justify-between p-4 bg-surface-1 rounded-lg border border-border">
                <div className="flex items-center space-x-3">
                  <AlertTriangle className="w-5 h-5 text-warning" />
                  <div>
                    <div className="font-medium">Disk Space</div>
                    <div className="text-sm text-text-muted">Low disk space warning</div>
                  </div>
                </div>
                <span className="text-warning text-sm font-medium">WARN</span>
              </div>

              <div className="flex items-center justify-between p-4 bg-surface-1 rounded-lg border border-border">
                <div className="flex items-center space-x-3">
                  <Check className="w-5 h-5 text-success" />
                  <div>
                    <div className="font-medium">Docker Connectivity</div>
                    <div className="text-sm text-text-muted">Docker daemon accessible</div>
                  </div>
                </div>
                <span className="text-success text-sm font-medium">PASS</span>
              </div>
            </div>

            <div className="bg-warning/10 border border-warning/20 rounded-lg p-4">
              <div className="flex items-start space-x-3">
                <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
                <div>
                  <div className="font-medium text-warning">Low Disk Space Warning</div>
                  <div className="text-sm text-text-muted mt-1">
                    Available disk space is below 10GB. Consider freeing up space before installation.
                  </div>
                </div>
              </div>
            </div>
          </div>
        );

      case 5: // Summary & Confirm
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-medium mb-2">Installation Summary</h3>
              <p className="text-text-muted text-sm">Review your configuration before proceeding with installation.</p>
            </div>

            <div className="space-y-4">
              <div className="bg-surface-1 rounded-lg border border-border p-4">
                <h4 className="font-medium mb-3">System Variable Overrides</h4>
                {Object.keys(systemOverrides).length > 0 ? (
                  <div className="space-y-2">
                    {Object.entries(systemOverrides).map(([key, value]) => (
                      <div key={key} className="flex items-center justify-between text-sm">
                        <span className="font-mono">{key}</span>
                        <span className="text-text-muted">
                          {systemEnvVars.find(v => v.key === key)?.isSecret ? '••••••••' : value}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-text-muted">No system variables overridden</div>
                )}
              </div>

              <div className="bg-surface-1 rounded-lg border border-border p-4">
                <h4 className="font-medium mb-3">Application Variables</h4>
                <div className="space-y-2">
                  {envVars.filter(env => env.key).map((env, index) => (
                    <div key={index} className="flex items-center justify-between text-sm">
                      <span className="font-mono">{env.key}</span>
                      <span className="text-text-muted">
                        {env.isSecret ? '••••••••' : env.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-surface-1 rounded-lg border border-border p-4">
                <h4 className="font-medium mb-3">Port Mappings</h4>
                <div className="space-y-2">
                  {ports.filter(port => port.host && port.container).map((port, index) => (
                    <div key={index} className="flex items-center justify-between text-sm">
                      <span className="font-mono">{port.host}:{port.container}</span>
                      <span className="text-text-muted uppercase">{port.protocol}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="bg-info/10 border border-info/20 rounded-lg p-4">
              <div className="flex items-start space-x-3">
                <div className="w-5 h-5 bg-info rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-xs text-primary-contrast font-bold">i</span>
                </div>
                <div>
                  <div className="font-medium text-info">Ready to Install</div>
                  <div className="text-sm text-text-muted mt-1">
                    The installation will begin immediately after confirmation. You can monitor progress in the deployments section.
                  </div>
                </div>
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center space-x-4">
        <button
          onClick={() => navigate('/catalog')}
          className="p-2 hover:bg-surface-1 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        
        <div className="flex items-center space-x-3">
          <div className="text-2xl">{app.icon}</div>
          <div>
            <h1 className="text-2xl font-semibold">Install {app.name}</h1>
            <p className="text-text-muted text-sm">{app.description}</p>
          </div>
        </div>
      </div>

      {/* Progress Stepper */}
      <div className="bg-surface-1 rounded-lg border border-border p-6">
        <div className="flex items-center justify-between overflow-x-auto">
          {steps.map((step, index) => (
            <div key={step.id} className="flex items-center space-x-2 flex-shrink-0">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                index < currentStep 
                  ? 'bg-success text-primary-contrast'
                  : index === currentStep
                  ? 'bg-primary text-primary-contrast'
                  : 'bg-surface-2 text-text-muted'
              }`}>
                {index < currentStep ? <Check className="w-4 h-4" /> : index + 1}
              </div>
              <div className="hidden lg:block min-w-0">
                <div className={`text-sm font-medium ${
                  index <= currentStep ? 'text-text-strong' : 'text-text-muted'
                } truncate`}>
                  {step.name}
                </div>
                <div className="text-xs text-text-muted line-clamp-2">{step.description}</div>
              </div>
              {index < steps.length - 1 && (
                <div className={`hidden lg:block w-8 h-px mx-4 flex-shrink-0 ${
                  index < currentStep ? 'bg-success' : 'bg-border'
                }`} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Step Content */}
      <div className="bg-surface-1 rounded-lg border border-border p-6">
        {renderStepContent()}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={handleBack}
          disabled={currentStep === 0}
          className="flex items-center space-x-2 px-4 py-2 bg-surface-1 border border-border rounded-lg hover:bg-surface-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back</span>
        </button>

        {currentStep === steps.length - 1 ? (
          <button
            onClick={handleInstall}
            className="flex items-center space-x-2 px-6 py-2 bg-primary text-primary-contrast rounded-lg hover:bg-primary/90 transition-colors font-medium"
          >
            <span>Confirm & Install</span>
          </button>
        ) : (
          <button
            onClick={handleNext}
            disabled={!canProceed()}
            className="flex items-center space-x-2 px-4 py-2 bg-primary text-primary-contrast rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span>Next</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
};
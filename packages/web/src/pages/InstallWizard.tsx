import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronRight, Check, Upload, X, Plus, AlertTriangle, Eye, EyeOff, RotateCw, FileText, Code, Download } from 'lucide-react';
import { AppIcon } from '../components/ui/AppIcon';
import type {
  AppEnvVar,
  SystemEnvVar,
  DraftDefaults,
  PatchDraftRequest,
} from '@hola/shared';
import { useCreateDraft, useDraftApi } from '../hooks/useDraftApi';
import { useDraftValidation } from '../hooks/useDraftValidation';
import { useDraftUpload } from '../hooks/useDraftUpload';
import { useDraftFinalization } from '../hooks/useDraftFinalization';

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
  
  // Draft API hooks
  const createDraftHook = useCreateDraft();
  const draftApi = useDraftApi(createDraftHook.data?.draftId || null);
  const draftValidation = useDraftValidation();
  const draftUpload = useDraftUpload();
  const draftFinalization = useDraftFinalization();
  
  // Combined loading state from all API operations
  const isLoading = createDraftHook.loading || draftApi.loading || 
                   draftValidation.validation.loading || draftValidation.preflight.loading ||
                   draftUpload.loading || draftFinalization.loading;
  
  // Combined error state from all API operations
  const error = createDraftHook.error || draftApi.error || 
               draftValidation.validation.error || draftValidation.preflight.error ||
               draftUpload.error || draftFinalization.error;
  
  // Draft data from the API
  const draftId = createDraftHook.data?.draftId || null;
  const validationResult = draftValidation.validation.data;
  const preflightResult = draftValidation.preflight.data;
  
  // System-wide environment variables (loaded from draft creation)
  const [systemEnvVars, setSystemEnvVars] = useState<SystemEnvVar[]>([]);
  
  // System variable overrides for this deployment
  const [systemOverrides, setSystemOverrides] = useState<{[key: string]: string}>({});
  
  // Application-specific environment variables (loaded from draft creation)
  const [envVars, setEnvVars] = useState<AppEnvVar[]>([]);
  
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);
  const [ports, setPorts] = useState<DraftDefaults['ports']>([]);
  const [volumes, setVolumes] = useState<DraftDefaults['volumes']>([]);
  const [showSecrets, setShowSecrets] = useState<{[key: string]: boolean}>({});
  const [composeOverride, setComposeOverride] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  // Mock app data (would be loaded from catalog in real implementation)
  const app = {
    id: appId,
    name: 'Nextcloud',
    icon: '☁️',
    description: 'Self-hosted productivity platform with file sync, calendar, and collaboration tools',
  };

  // Create draft when component mounts
  useEffect(() => {
    if (!appId || createDraftHook.data) return; // Don't create if already exists
    
    const initializeDraft = async () => {
      try {
        const result = await createDraftHook.createDraft({ appId });
        
        // Update state with draft data
        setSystemEnvVars(result.systemEnv);
        setEnvVars(result.appEnv);
        setPorts(result.defaults.ports);
        setVolumes(result.defaults.volumes);
        
      } catch (err) {
        console.error('Failed to create draft:', err);
      }
    };
    
    initializeDraft();
  }, [appId, createDraftHook]); // Include the whole hook object

  // Update draft data helper function
  const updateDraftData = React.useCallback(async (updates: PatchDraftRequest) => {
    if (!draftId || !draftApi.updateDraft) return;
    
    try {
      await draftApi.updateDraft(updates);
    } catch (err) {
      console.error('Failed to update draft:', err);
    }
  }, [draftId, draftApi]); // Include the whole draftApi object

  // Validate draft configuration
  const validateDraft = async (): Promise<boolean> => {
    if (!draftId) return false;
    
    try {
      const result = await draftValidation.validateDraft(draftId);
      return result.ok;
    } catch (err) {
      console.error('Failed to validate draft:', err);
      return false;
    }
  };

  // Run preflight checks
  const runPreflight = async (): Promise<boolean> => {
    if (!draftId) return false;
    
    try {
      const result = await draftValidation.runPreflight(draftId);
      return result.ok;
    } catch (err) {
      console.error('Failed to run preflight:', err);
      return false;
    }
  };

  // Finalize draft and create deployment
  const finalizeDraft = async (): Promise<boolean> => {
    if (!draftId) return false;
    
    try {
      await draftFinalization.finalizeDraft(draftId);
      return true;
    } catch (err) {
      console.error('Failed to finalize draft:', err);
      return false;
    }
  };

  const canProceed = () => {
    switch (currentStep) {
      case 0: // Environment Variables
        return !isLoading && envVars.every(env => env.key && (env.value || !env.isSecret));
      case 4: // Validate & Preflight
        // Allow proceeding if not loading, and either checks haven't run yet OR both have passed
        return !isLoading && (!validationResult || (validationResult?.ok && preflightResult?.ok));
      default:
        return !isLoading;
    }
  };

  const handleNext = async () => {
    if (currentStep < steps.length - 1) {
      // Update draft with current state before proceeding
      if (draftId) {
        await updateDraftData({
          systemOverrides,
          appEnv: envVars,
          ports,
          composeOverride: composeOverride || undefined
        });
      }
      
      // Run validation and preflight on validate step
      if (currentStep === 4) {
        const isValid = await validateDraft();
        if (isValid) {
          await runPreflight();
        }
      }
      
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleInstall = async () => {
    const success = await finalizeDraft();
    if (success) {
      navigate('/deployments');
    }
  };

  const addEnvVar = async () => {
    const updated = [...envVars, { key: '', value: '', isSecret: false, description: '' }];
    setEnvVars(updated);
    
    // Update draft with new environment variables
    if (draftId) {
      await updateDraftData({ appEnv: updated });
    }
  };

  const updateEnvVar = async (index: number, field: keyof AppEnvVar, value: string | boolean) => {
    const updated = [...envVars];
    updated[index] = { ...updated[index], [field]: value };
    setEnvVars(updated);
    
    // Update draft with new environment variables
    if (draftId) {
      await updateDraftData({ appEnv: updated });
    }
  };

  const removeEnvVar = async (index: number) => {
    const updated = envVars.filter((_, i) => i !== index);
    setEnvVars(updated);
    
    // Update draft with new environment variables
    if (draftId) {
      await updateDraftData({ appEnv: updated });
    }
  };

  const addPort = async () => {
    const updated = [...ports, { host: 0, container: 0, protocol: 'tcp' as const }];
    setPorts(updated);
    
    // Update draft with new ports configuration
    if (draftId) {
      await updateDraftData({ ports: updated });
    }
  };

  const updatePort = async (index: number, field: keyof DraftDefaults['ports'][0], value: string | number) => {
    const updated = [...ports];
    updated[index] = { ...updated[index], [field]: value };
    setPorts(updated);
    
    // Update draft with new ports configuration
    if (draftId) {
      await updateDraftData({ ports: updated });
    }
  };

  const removePort = async (index: number) => {
    const updated = ports.filter((_, i) => i !== index);
    setPorts(updated);
    
    // Update draft with new ports configuration
    if (draftId) {
      await updateDraftData({ ports: updated });
    }
  };

  const updateSystemOverride = async (key: string, value: string) => {
    const systemDefault = systemEnvVars.find(v => v.key === key)?.value || '';
    const newOverrides = { ...systemOverrides };
    
    if (value === systemDefault) {
      // If value matches system default, remove override
      delete newOverrides[key];
    } else {
      // Set override
      newOverrides[key] = value;
    }
    
    setSystemOverrides(newOverrides);
    
    // Update draft with new system overrides
    if (draftId) {
      await updateDraftData({ systemOverrides: newOverrides });
    }
  };

  const resetSystemOverride = async (key: string) => {
    const newOverrides = { ...systemOverrides };
    delete newOverrides[key];
    setSystemOverrides(newOverrides);
    
    // Update draft with new system overrides
    if (draftId) {
      await updateDraftData({ systemOverrides: newOverrides });
    }
  };

  const addVolume = async () => {
    const updated = [...volumes, { hostPath: '', containerPath: '', readOnly: false }];
    setVolumes(updated);
    
    // Update draft with current state (volumes aren't directly supported in PatchDraftRequest yet)
    if (draftId) {
      await updateDraftData({ ports, systemOverrides, appEnv: envVars });
    }
  };

  const updateVolume = async (index: number, field: keyof DraftDefaults['volumes'][0], value: string | boolean) => {
    const updated = [...volumes];
    updated[index] = { ...updated[index], [field]: value };
    setVolumes(updated);
    
    // Update draft with current state (volumes aren't directly supported in PatchDraftRequest yet)
    if (draftId) {
      await updateDraftData({ ports, systemOverrides, appEnv: envVars });
    }
  };

  const removeVolume = async (index: number) => {
    const updated = volumes.filter((_, i) => i !== index);
    setVolumes(updated);
    
    // Update draft with current state
    if (draftId) {
      await updateDraftData({ ports, systemOverrides, appEnv: envVars });
    }
  };

  const toggleSecretVisibility = (key: string) => {
    setShowSecrets(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0 || !draftId) return;
    
    const file = files[0];
    if (file.name.includes('docker-compose') && (file.name.endsWith('.yml') || file.name.endsWith('.yaml'))) {
      try {
        // Upload compose override file to draft
        const uploadResult = await draftUpload.uploadFile(draftId, file, 'composeOverride');
        
        // Read content for local editing
        const reader = new FileReader();
        reader.onload = (e) => {
          const content = e.target?.result as string;
          setComposeOverride(content);
          setEditMode(true);
        };
        reader.readAsText(file);
        
        // Add to uploaded files list
        setUploadedFiles(prev => [...prev, uploadResult.name]);
        
      } catch (err) {
        console.error('Failed to upload compose file:', err);
      }
    } else {
      try {
        // Upload other files as additional files
        const uploadResult = await draftUpload.uploadFile(draftId, file, 'additionalFile');
        setUploadedFiles(prev => [...prev, uploadResult.name]);
      } catch (err) {
        console.error('Failed to upload file:', err);
      }
    }
  };

  const handleComposeOverrideChange = async (content: string) => {
    setComposeOverride(content);
    
    // Upload compose override content to draft
    if (draftId && content.trim()) {
      try {
        await draftUpload.uploadComposeOverride(draftId, content);
      } catch (err) {
        console.error('Failed to upload compose override:', err);
      }
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

  // Static class strings per check status (Tailwind can't generate dynamic color classes).
  type CheckStatus = 'pass' | 'warn' | 'fail';
  // One colour pairing per status, shared by the icon chip and the tag pill.
  const checkClass = (status: CheckStatus): string =>
    status === 'pass'
      ? 'bg-success-weak text-success'
      : status === 'warn'
        ? 'bg-warning-weak text-warning'
        : 'bg-danger-weak text-danger';
  const checkIcon = (status: CheckStatus) =>
    status === 'pass' ? Check : status === 'warn' ? AlertTriangle : X;

  const CheckRow: React.FC<{ status: CheckStatus; title?: string; message?: string }> = ({
    status,
    title,
    message,
  }) => {
    const Icon = checkIcon(status);
    return (
      <div className="flex items-start gap-3 px-[15px] py-[13px] bg-surface-2 border border-border-soft rounded-[10px]">
        <span className={`w-[26px] h-[26px] flex-none rounded-[7px] flex items-center justify-center ${checkClass(status)}`}>
          <Icon className="w-4 h-4" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-[13.5px] font-semibold">{title}</div>
          {message && <div className="text-[12.5px] text-text-muted mt-0.5">{message}</div>}
        </div>
        <span className={`flex-none text-[11px] font-semibold px-2 py-[3px] rounded-[6px] ${checkClass(status)}`}>
          {status.toUpperCase()}
        </span>
      </div>
    );
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 0: // Environment Variables
        return (
          <div>
            <div className="text-base font-semibold mb-1">Environment variables</div>
            <p className="text-[13.5px] text-text-muted mb-5">
              Defaults are pre-filled from the catalog. Override system defaults only when needed. Secrets are masked — reveal to check.
            </p>

            {/* System Environment Variables */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-[13.5px] font-semibold text-text-strong">System variables</h4>
                <div className="text-[12.5px] text-text-muted">Override only when needed</div>
              </div>

              <div className="space-y-3">
                {systemEnvVars.map((envVar) => {
                  const isOverridden = envVar.key in systemOverrides;
                  const currentValue = isOverridden ? systemOverrides[envVar.key] : envVar.value;
                  const showValue = envVar.isSecret && !showSecrets[envVar.key];

                  return (
                    <div
                      key={envVar.key}
                      className={`p-[14px] border rounded-[10px] ${
                        isOverridden ? 'border-warning/50 bg-warning-weak' : 'border-border-soft bg-surface-2'
                      }`}
                    >
                      <div className="grid grid-cols-12 gap-3 items-center">
                        <div className="col-span-3">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[12.5px] font-medium">{envVar.key}</span>
                            {isOverridden && (
                              <span className="text-[11px] font-semibold bg-warning-weak text-warning px-2 py-[2px] rounded-[6px]">
                                OVERRIDE
                              </span>
                            )}
                          </div>
                          {envVar.description && (
                            <div className="text-[12px] text-text-faint mt-1">{envVar.description}</div>
                          )}
                        </div>

                        <div className="col-span-4 relative flex items-center">
                          <input
                            type={showValue ? 'password' : 'text'}
                            value={currentValue}
                            onChange={(e) => updateSystemOverride(envVar.key, e.target.value)}
                            className="w-full h-10 bg-surface-0 border border-border rounded-[9px] text-text-strong px-[13px] pr-10 text-[13px] font-mono outline-none focus:border-primary"
                            placeholder={envVar.value || 'Enter value...'}
                          />
                          {envVar.isSecret && (
                            <button
                              type="button"
                              onClick={() => toggleSecretVisibility(envVar.key)}
                              className="absolute right-[11px] flex text-text-faint hover:text-text-strong transition-colors"
                            >
                              {showSecrets[envVar.key] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          )}
                        </div>

                        <div className="col-span-2 text-center">
                          <span className="text-[12px] text-text-muted">{envVar.isSecret ? 'Secret' : 'Public'}</span>
                        </div>

                        <div className="col-span-2 text-center">
                          <span className="text-[12px] text-text-faint font-mono">
                            {envVar.isSecret && !showSecrets[envVar.key] ? '••••••••' : (envVar.value || '(empty)')}
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
                <div className="bg-warning-weak border border-warning/20 rounded-[10px] p-4 mt-3">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-4 h-4 text-warning flex-none mt-0.5" />
                    <div className="text-sm">
                      <div className="font-semibold text-warning">System variable overrides</div>
                      <div className="text-text-muted mt-1 text-[12.5px]">
                        You have overridden {Object.keys(systemOverrides).length} system variable(s). These will only affect this deployment.
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Application-Specific Environment Variables */}
            <div>
              <h4 className="text-[13.5px] font-semibold text-text-strong mb-3">Application variables</h4>

              <div className="space-y-3 mb-3">
                {envVars.map((env, index) => (
                  <div key={index} className="grid grid-cols-12 gap-3 items-center p-[14px] bg-surface-2 rounded-[10px] border border-border-soft">
                    <div className="col-span-3">
                      <input
                        type="text"
                        placeholder="Key"
                        value={env.key}
                        onChange={(e) => updateEnvVar(index, 'key', e.target.value)}
                        className="w-full h-10 bg-surface-0 border border-border rounded-[9px] text-text-strong px-[13px] text-[13px] font-mono outline-none focus:border-primary"
                      />
                    </div>
                    <div className="col-span-4 relative flex items-center">
                      <input
                        type={env.isSecret && !showSecrets[env.key] ? 'password' : 'text'}
                        placeholder="Value"
                        value={env.value}
                        onChange={(e) => updateEnvVar(index, 'value', e.target.value)}
                        className="w-full h-10 bg-surface-0 border border-border rounded-[9px] text-text-strong px-[13px] pr-10 text-[13px] font-mono outline-none focus:border-primary"
                      />
                      {env.isSecret && (
                        <button
                          type="button"
                          onClick={() => toggleSecretVisibility(env.key)}
                          className="absolute right-[11px] flex text-text-faint hover:text-text-strong transition-colors"
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
                          className="w-4 h-4 accent-primary"
                        />
                      </label>
                    </div>
                    <div className="col-span-3">
                      <input
                        type="text"
                        placeholder="Description"
                        value={env.description}
                        onChange={(e) => updateEnvVar(index, 'description', e.target.value)}
                        className="w-full h-10 bg-surface-0 border border-border rounded-[9px] text-text-strong px-[13px] text-[13px] outline-none focus:border-primary"
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
              </div>

              <button
                onClick={addEnvVar}
                className="flex items-center gap-2 h-10 px-[14px] bg-surface-2 border border-border rounded-[9px] text-[13.5px] hover:border-primary transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span>Add app variable</span>
              </button>
            </div>
          </div>
        );

      case 1: // Compose Override
        return (
          <div>
            <div className="text-base font-semibold mb-1">
              Compose override <span className="text-[12px] text-text-faint font-normal">· optional</span>
            </div>
            <p className="text-[13.5px] text-text-muted mb-4">
              Upload a Docker Compose override file or edit one directly to customize the deployment. Leave blank to use the standard configuration.
            </p>

            {!editMode ? (
              <div className="space-y-4">
                {/* Upload Area */}
                <div
                  className={`border-[1.5px] border-dashed rounded-[11px] p-[30px] text-center transition-colors ${
                    isDragOver ? 'border-primary text-text-strong' : 'border-border text-text-muted hover:border-primary'
                  }`}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                >
                  <div className="flex justify-center mb-[9px]">
                    <Upload className={`w-7 h-7 ${isDragOver ? 'text-primary' : 'text-text-faint'}`} />
                  </div>
                  <p className="text-[13.5px] font-medium mb-3">Drag &amp; drop your docker-compose.override.yml here</p>
                  <div className="flex items-center justify-center gap-3">
                    <label className="bg-primary text-white px-4 py-2 rounded-[9px] text-[13.5px] font-semibold hover:brightness-110 transition cursor-pointer">
                      Browse files
                      <input
                        type="file"
                        accept=".yml,.yaml"
                        onChange={(e) => handleFileUpload(e.target.files)}
                        className="hidden"
                      />
                    </label>
                    <span className="text-text-faint text-[13px]">or</span>
                    <button
                      onClick={() => {
                        handleComposeOverrideChange(getDefaultComposeOverride());
                        setEditMode(true);
                      }}
                      className="flex items-center gap-2 h-10 px-[14px] bg-surface-2 border border-border rounded-[9px] text-[13.5px] hover:border-primary transition-colors"
                    >
                      <Code className="w-4 h-4" />
                      <span>Create new</span>
                    </button>
                  </div>
                </div>

                {/* Info Box */}
                <div className="bg-info/10 border border-info/20 rounded-[10px] p-4">
                  <div className="flex items-start gap-3">
                    <FileText className="w-4 h-4 text-info flex-none mt-0.5" />
                    <div className="text-sm">
                      <div className="font-semibold text-info">Docker Compose override</div>
                      <div className="text-text-muted mt-1 text-[12.5px]">
                        Override files allow you to customize services, add volumes, modify environment variables, and configure networking without modifying the base compose file.
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Editor Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <FileText className="w-5 h-5 text-primary" />
                    <span className="font-mono text-[13px] font-medium">docker-compose.override.yml</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={downloadComposeFile}
                      className="p-2 bg-surface-2 border border-border hover:border-primary rounded-[9px] transition-colors"
                      title="Download file"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => {
                        setEditMode(false);
                        setComposeOverride('');
                      }}
                      className="p-2 bg-surface-2 border border-border hover:border-primary rounded-[9px] transition-colors"
                      title="Close editor"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Code Editor */}
                <textarea
                  value={composeOverride}
                  onChange={(e) => handleComposeOverrideChange(e.target.value)}
                  className="w-full min-h-[320px] bg-surface-0 border border-border rounded-[10px] p-[14px] text-text-strong font-mono text-[12.5px] leading-relaxed resize-y outline-none focus:border-primary"
                  placeholder="Enter your Docker Compose override configuration..."
                  spellCheck={false}
                />

                {/* Editor Footer */}
                <div className="flex items-center justify-between text-[12px] text-text-faint">
                  <div className="flex items-center gap-4">
                    <span>Lines: {composeOverride.split('\n').length}</span>
                    <span>Characters: {composeOverride.length}</span>
                  </div>
                  <span>YAML</span>
                </div>
              </div>
            )}

            {uploadedFiles.length > 0 && (
              <div className="mt-4 space-y-2">
                <h4 className="text-[13.5px] font-semibold text-text-strong">Uploaded files</h4>
                {uploadedFiles.map((file, index) => (
                  <div key={index} className="flex items-center gap-[10px] px-[13px] py-[10px] bg-surface-2 border border-border-soft rounded-[9px]">
                    <FileText className="w-4 h-4 text-text-muted flex-none" />
                    <span className="flex-1 font-mono text-[12.5px]">{file}</span>
                    <button
                      onClick={() => setUploadedFiles(uploadedFiles.filter((_, i) => i !== index))}
                      className="flex text-text-faint hover:text-danger transition-colors"
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
          <div>
            <div className="text-base font-semibold mb-1">
              Additional files <span className="text-[12px] text-text-faint font-normal">· optional</span>
            </div>
            <p className="text-[13.5px] text-text-muted mb-4">
              Upload config files or certificates this app needs mounted at startup.
            </p>

            <label className="block border-[1.5px] border-dashed border-border rounded-[11px] p-[30px] text-center cursor-pointer text-text-muted hover:border-primary hover:text-text-strong transition-colors">
              <div className="flex justify-center mb-[9px]">
                <Upload className="w-7 h-7 text-text-faint" />
              </div>
              <div className="text-[13.5px] font-medium">Click to add a file</div>
              <div className="text-[12px] text-text-faint mt-[3px]">PEM, YAML, JSON, ENV · up to 5 MB each</div>
              <input type="file" onChange={(e) => handleFileUpload(e.target.files)} className="hidden" />
            </label>
          </div>
        );

      case 3: // Advanced Options
        return (
          <div>
            <div className="text-base font-semibold mb-1">
              Advanced options <span className="text-[12px] text-text-faint font-normal">· optional</span>
            </div>
            <p className="text-[13.5px] text-text-muted mb-5">
              Fine-tune port mappings and volume mounts. Sensible defaults are applied otherwise.
            </p>

            {/* Ports */}
            <div className="mb-6">
              <h4 className="text-[13.5px] font-semibold text-text-strong mb-3">Port mappings</h4>
              <div className="space-y-3 mb-3">
                {ports.map((port, index) => (
                  <div key={index} className="grid grid-cols-8 gap-3 items-center p-[14px] bg-surface-2 rounded-[10px] border border-border-soft">
                    <div className="col-span-2">
                      <input
                        type="number"
                        placeholder="Host port"
                        value={port.host || ''}
                        onChange={(e) => updatePort(index, 'host', parseInt(e.target.value))}
                        className="w-full h-10 bg-surface-0 border border-border rounded-[9px] text-text-strong px-[13px] text-[13px] font-mono outline-none focus:border-primary"
                      />
                    </div>
                    <div className="col-span-2">
                      <input
                        type="number"
                        placeholder="Container port"
                        value={port.container || ''}
                        onChange={(e) => updatePort(index, 'container', parseInt(e.target.value))}
                        className="w-full h-10 bg-surface-0 border border-border rounded-[9px] text-text-strong px-[13px] text-[13px] font-mono outline-none focus:border-primary"
                      />
                    </div>
                    <div className="col-span-2">
                      <select
                        value={port.protocol}
                        onChange={(e) => updatePort(index, 'protocol', e.target.value)}
                        className="w-full h-10 bg-surface-0 border border-border rounded-[9px] text-text-strong px-[13px] text-[13px] font-mono outline-none focus:border-primary"
                      >
                        <option value="tcp">TCP</option>
                        <option value="udp">UDP</option>
                      </select>
                    </div>
                    <div className="col-span-1 text-center">
                      <span className="text-[12px] text-success">✓ Available</span>
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
              </div>
              <button
                onClick={addPort}
                className="flex items-center gap-2 h-10 px-[14px] bg-surface-2 border border-border rounded-[9px] text-[13.5px] hover:border-primary transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span>Add port</span>
              </button>
            </div>

            {/* Volumes */}
            <div>
              <h4 className="text-[13.5px] font-semibold text-text-strong mb-3">Volume mounts</h4>
              <div className="space-y-3 mb-3">
                {volumes.map((volume, index) => (
                  <div key={index} className="grid grid-cols-8 gap-3 items-center p-[14px] bg-surface-2 rounded-[10px] border border-border-soft">
                    <div className="col-span-3">
                      <input
                        type="text"
                        placeholder="Host path (optional)"
                        value={volume.hostPath || ''}
                        onChange={(e) => updateVolume(index, 'hostPath', e.target.value)}
                        className="w-full h-10 bg-surface-0 border border-border rounded-[9px] text-text-strong px-[13px] text-[13px] font-mono outline-none focus:border-primary"
                      />
                    </div>
                    <div className="col-span-3">
                      <input
                        type="text"
                        placeholder="Container path"
                        value={volume.containerPath}
                        onChange={(e) => updateVolume(index, 'containerPath', e.target.value)}
                        className="w-full h-10 bg-surface-0 border border-border rounded-[9px] text-text-strong px-[13px] text-[13px] font-mono outline-none focus:border-primary"
                      />
                    </div>
                    <div className="col-span-1 text-center">
                      <label className="flex items-center justify-center gap-1">
                        <input
                          type="checkbox"
                          checked={volume.readOnly || false}
                          onChange={(e) => updateVolume(index, 'readOnly', e.target.checked)}
                          className="w-4 h-4 accent-primary"
                        />
                        <span className="text-[12px]">RO</span>
                      </label>
                    </div>
                    <div className="col-span-1 text-center">
                      <button
                        onClick={() => removeVolume(index)}
                        className="p-1 text-text-muted hover:text-danger transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <button
                onClick={addVolume}
                className="flex items-center gap-2 h-10 px-[14px] bg-surface-2 border border-border rounded-[9px] text-[13.5px] hover:border-primary transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span>Add volume</span>
              </button>
            </div>
          </div>
        );

      case 4: // Validate & Preflight
        return (
          <div>
            <div className="text-base font-semibold mb-1">Validate &amp; preflight</div>
            <p className="text-[13.5px] text-text-muted mb-[18px]">
              Hola checks the configuration and your host before anything is applied. Nothing has been deployed yet.
            </p>

            {isLoading && (
              <div className="flex items-center justify-center py-8">
                <RotateCw className="w-5 h-5 animate-spin text-primary" />
                <span className="ml-2 text-sm">Running validation and preflight checks...</span>
              </div>
            )}

            {error && (
              <div className="bg-danger-weak border border-danger/20 text-danger rounded-card p-4 text-sm mb-3">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 flex-none mt-0.5" />
                  <div>
                    <div className="font-semibold">Validation error</div>
                    <div className="text-text-muted mt-1">{error}</div>
                  </div>
                </div>
              </div>
            )}

            {!isLoading && validationResult && (
              <div className="mb-4">
                <h4 className="text-[13.5px] font-semibold text-text-strong mb-2">Configuration validation</h4>
                <div className="flex flex-col gap-[10px]">
                  {validationResult.errors.map((err, index) => (
                    <CheckRow key={`e-${index}`} status="fail" title={err.field} message={err.message} />
                  ))}
                  {validationResult.warnings.map((warning, index) => (
                    <CheckRow key={`w-${index}`} status="warn" title={warning.field || 'Warning'} message={warning.message} />
                  ))}
                  {validationResult.ok && validationResult.errors.length === 0 && (
                    <CheckRow status="pass" title="Configuration valid" message="All configuration checks passed" />
                  )}
                </div>
              </div>
            )}

            {!isLoading && preflightResult && (
              <div>
                <h4 className="text-[13.5px] font-semibold text-text-strong mb-2">System preflight checks</h4>
                <div className="flex flex-col gap-[10px]">
                  {preflightResult.checks.map((check, index) => (
                    <CheckRow
                      key={index}
                      status={check.status === 'pass' ? 'pass' : check.status === 'warn' ? 'warn' : 'fail'}
                      title={check.name}
                      message={check.detail}
                    />
                  ))}
                </div>
              </div>
            )}

            {!validationResult && !preflightResult && !isLoading && !error && (
              <div className="text-center py-8">
                <div className="text-text-muted text-sm">Click "Next" to run validation and preflight checks</div>
              </div>
            )}
          </div>
        );

      case 5: // Summary & Confirm
        return (
          <div>
            <div className="text-base font-semibold mb-1">Summary &amp; confirm</div>
            <p className="text-[13.5px] text-text-muted mb-[18px]">
              Review the deployment. On confirm, Hola kicks off the install job.
            </p>

            <div className="space-y-4 mb-4">
              <div>
                <h4 className="text-[13.5px] font-semibold text-text-strong mb-2">System variable overrides</h4>
                {Object.keys(systemOverrides).length > 0 ? (
                  <div className="bg-surface-2 border border-border-soft rounded-[11px] overflow-hidden">
                    {Object.entries(systemOverrides).map(([key, value]) => (
                      <div key={key} className="flex justify-between items-center px-4 py-3 border-b border-border-soft last:border-b-0">
                        <span className="text-[13px] text-text-muted">{key}</span>
                        <span className="text-[13px] font-mono">
                          {systemEnvVars.find(v => v.key === key)?.isSecret ? '••••••••' : value}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[13px] text-text-muted">No system variables overridden</div>
                )}
              </div>

              <div>
                <h4 className="text-[13.5px] font-semibold text-text-strong mb-2">Application variables</h4>
                {envVars.filter(env => env.key).length > 0 ? (
                  <div className="bg-surface-2 border border-border-soft rounded-[11px] overflow-hidden">
                    {envVars.filter(env => env.key).map((env, index) => (
                      <div key={index} className="flex justify-between items-center px-4 py-3 border-b border-border-soft last:border-b-0">
                        <span className="text-[13px] text-text-muted">{env.key}</span>
                        <span className="text-[13px] font-mono">{env.isSecret ? '••••••••' : env.value}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[13px] text-text-muted">No application variables configured</div>
                )}
              </div>

              <div>
                <h4 className="text-[13.5px] font-semibold text-text-strong mb-2">Port mappings</h4>
                {ports.filter(port => port.host && port.container).length > 0 ? (
                  <div className="bg-surface-2 border border-border-soft rounded-[11px] overflow-hidden">
                    {ports.filter(port => port.host && port.container).map((port, index) => (
                      <div key={index} className="flex justify-between items-center px-4 py-3 border-b border-border-soft last:border-b-0">
                        <span className="text-[13px] font-mono">{port.host}:{port.container}</span>
                        <span className="text-[13px] text-text-muted uppercase">{port.protocol}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[13px] text-text-muted">No port mappings configured</div>
                )}
              </div>

              <div>
                <h4 className="text-[13.5px] font-semibold text-text-strong mb-2">Volume mounts</h4>
                {volumes.filter(volume => volume.containerPath).length > 0 ? (
                  <div className="bg-surface-2 border border-border-soft rounded-[11px] overflow-hidden">
                    {volumes.filter(volume => volume.containerPath).map((volume, index) => (
                      <div key={index} className="flex justify-between items-center px-4 py-3 border-b border-border-soft last:border-b-0">
                        <span className="text-[13px] font-mono">{volume.hostPath || '<auto>'}:{volume.containerPath}</span>
                        <span className="text-[13px] text-text-muted">{volume.readOnly ? 'READ-ONLY' : 'READ-WRITE'}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[13px] text-text-muted">No volume mounts configured</div>
                )}
              </div>
            </div>

            <div className="flex items-start gap-3 px-4 py-[14px] rounded-[11px] bg-info/10">
              <div className="w-5 h-5 bg-info rounded-full flex items-center justify-center flex-none mt-0.5">
                <span className="text-xs text-white font-bold">i</span>
              </div>
              <div>
                <div className="text-[13.5px] font-semibold text-info">Ready to install</div>
                <div className="text-[12.5px] text-text-muted mt-0.5">
                  The installation will begin immediately after confirmation. You can monitor progress in the deployments section.
                </div>
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  const isLastStep = currentStep === steps.length - 1;

  return (
    <div className="animate-fadein max-w-[860px] mx-auto">
      {/* Header */}
      <div className="flex items-center gap-[14px] mb-6">
        <AppIcon name={app.name} emoji={app.icon} size={48} />
        <div>
          <div className="text-[21px] font-semibold tracking-[-0.02em]">Install {app.name}</div>
          <div className="text-[13px] text-text-muted mt-0.5">
            Version <span className="font-mono">latest</span> · Step {currentStep + 1} — {steps[currentStep].name}
          </div>
        </div>
      </div>

      {/* Loading State */}
      {isLoading && !draftId && (
        <div className="flex items-center bg-surface-1 border border-border rounded-[14px] p-6">
          <RotateCw className="w-5 h-5 animate-spin text-primary mr-3" />
          <span className="text-sm">Creating installation draft...</span>
        </div>
      )}

      {/* Error State */}
      {error && !draftId && (
        <div className="bg-danger-weak border border-danger/20 text-danger rounded-card p-4 text-sm mt-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 flex-none mt-0.5" />
            <div>
              <div className="font-semibold">Error</div>
              <div className="text-text-muted mt-1">{error}</div>
            </div>
          </div>
        </div>
      )}

      {/* Wizard Content - only show when draft is ready */}
      {draftId && (
        <>
          {/* Progress Stepper */}
          <div className="flex items-center mb-[26px] overflow-x-auto">
            {steps.map((step, index) => {
              const done = index < currentStep;
              const active = index === currentStep;
              const clickable = done;
              const circleClass = done
                ? 'bg-success-weak text-success border-success'
                : active
                  ? 'bg-primary-weak text-primary border-primary'
                  : 'bg-surface-2 text-text-muted border-border';
              return (
                <React.Fragment key={step.id}>
                  <div
                    onClick={clickable ? () => setCurrentStep(index) : undefined}
                    className={`flex items-center gap-[9px] flex-none ${clickable ? 'cursor-pointer' : ''}`}
                  >
                    <div className={`w-7 h-7 flex-none rounded-full flex items-center justify-center text-[12.5px] font-semibold font-mono border-[1.5px] ${circleClass}`}>
                      {done ? <Check className="w-[14px] h-[14px]" /> : index + 1}
                    </div>
                    <span className={`hidden md:block text-[12.5px] font-medium whitespace-nowrap ${active || done ? 'text-text-strong' : 'text-text-faint'}`}>
                      {step.name}
                    </span>
                  </div>
                  {index < steps.length - 1 && (
                    <div className={`flex-1 h-[2px] mx-[10px] rounded min-w-[14px] ${index < currentStep ? 'bg-success' : 'bg-border'}`} />
                  )}
                </React.Fragment>
              );
            })}
          </div>

          {/* Step Content */}
          <div className="bg-surface-1 border border-border rounded-[14px] p-6">
            {renderStepContent()}

            {/* Navigation */}
            <div className="flex items-center gap-3 mt-6 pt-5 border-t border-border-soft">
              <button
                onClick={handleBack}
                disabled={currentStep === 0}
                className="h-[42px] px-[18px] bg-transparent text-text-muted border border-border rounded-[10px] text-sm font-semibold hover:text-text-strong hover:border-text-faint disabled:opacity-50 transition-colors"
              >
                Back
              </button>
              <div className="flex-1" />
              {isLastStep ? (
                <button
                  onClick={handleInstall}
                  disabled={isLoading}
                  className="h-[42px] px-[22px] flex items-center gap-2 bg-primary text-white rounded-[10px] text-sm font-semibold shadow-primary-glow hover:brightness-110 disabled:opacity-50 transition"
                >
                  {isLoading ? (
                    <>
                      <RotateCw className="w-4 h-4 animate-spin" />
                      Installing…
                    </>
                  ) : (
                    'Install'
                  )}
                </button>
              ) : (
                <button
                  onClick={handleNext}
                  disabled={!canProceed()}
                  className="h-[42px] px-[22px] flex items-center gap-2 bg-primary text-white rounded-[10px] text-sm font-semibold shadow-primary-glow hover:brightness-110 disabled:opacity-50 transition"
                >
                  Next
                  <ChevronRight className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
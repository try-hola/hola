/**
 * Dev Session Service - Phase 7
 * 
 * Manages development sessions for preview deployments, including
 * live reloading, log streaming, and development environment setup.
 */

import type { 
  CreateDevSessionRequest,
  CreateDevSessionResponse,
  DevSession,
  DevSessionListItem,
  GetDevSessionsRequest,
  GetDevSessionsResponse,
  GetDevSessionResponse,
  PatchDevSessionRequest,
  PatchDevSessionResponse,
  PostDevSessionActionRequest,
  PostDevSessionActionResponse,
  DevSessionSettings,
  LogEntry
} from '@hola/shared';

import { getLogger } from '../../lib/logger';
import type { HealthCheckable, ServiceHealth } from '../factory';
import type { StorageService } from './storage';
import type { JobService } from './jobs';
import type { DraftService } from './draft';

export interface DevSessionService extends HealthCheckable {
  // Session lifecycle
  createSession(request: CreateDevSessionRequest): Promise<CreateDevSessionResponse>;
  listSessions(request: GetDevSessionsRequest): Promise<GetDevSessionsResponse>;
  getSession(sessionId: string): Promise<GetDevSessionResponse>;
  updateSession(sessionId: string, request: PatchDevSessionRequest): Promise<PatchDevSessionResponse>;
  deleteSession(sessionId: string): Promise<void>;
  
  // Session actions
  executeAction(sessionId: string, request: PostDevSessionActionRequest): Promise<PostDevSessionActionResponse>;
  
  // Development features
  getSessionLogs(sessionId: string, options?: { since?: string; limit?: number }): Promise<LogEntry[]>;
  getSessionSettings(sessionId: string): Promise<DevSessionSettings>;
  updateSessionSettings(sessionId: string, settings: Partial<DevSessionSettings>): Promise<void>;
  
  // File watching and sync
  enableFileWatching(sessionId: string): Promise<void>;
  disableFileWatching(sessionId: string): Promise<void>;
  syncFiles(sessionId: string, files: { path: string; content: string }[]): Promise<void>;
}

export class RealDevSessionService implements DevSessionService {
  private logger = getLogger().child({ service: 'DevSessionService' });
  private sessions = new Map<string, DevSession>();
  private sessionSettings = new Map<string, DevSessionSettings>();
  private fileWatchers = new Map<string, boolean>();

  constructor(
    private storageService: StorageService,
    private jobService: JobService,
    private draftService: DraftService
  ) {}

  async healthCheck(): Promise<ServiceHealth> {
    try {
      // Check if we can access storage and create session directory
      await this.storageService.ensureDir('dev-sessions');
      
      return {
        healthy: true,
        lastCheck: new Date(),
      };
    } catch (error) {
      return {
        healthy: false,
        lastCheck: new Date(),
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async createSession(request: CreateDevSessionRequest): Promise<CreateDevSessionResponse> {
    const sessionId = crypto.randomUUID();
    
    this.logger.info('Creating dev session', { 
      sessionId, 
      draftId: request.draftId,
      appId: request.appId,
      name: request.name
    });

    try {
      // If no draftId provided, create one automatically
      let draftId = request.draftId;
      if (!draftId && request.appId) {
        // Create a new draft for this app
        const draft = await this.draftService.createDraft({
          appId: request.appId,
          version: request.version,
        });
        draftId = draft.draftId;
      }

      if (!draftId) {
        throw new Error('Either draftId or appId must be provided');
      }

      // Create session directory
      await this.storageService.ensureDir(`dev-sessions/${sessionId}`);
      await this.storageService.ensureDir(`dev-sessions/${sessionId}/logs`);
      await this.storageService.ensureDir(`dev-sessions/${sessionId}/files`);

      // Create session record
      const session: DevSession = {
        id: sessionId,
        sessionId, // Add alias
        name: request.name || `dev-session-${sessionId.slice(0, 8)}`,
        draftId,
        status: 'starting',
        previewUrl: `http://localhost:${this.generatePort()}`,
        port: this.generatePort(),
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        liveReload: request.settings?.liveReload ?? true,
        autoSync: request.settings?.autoSync ?? false,
        logs: [],
      };

      // Store session
      this.sessions.set(sessionId, session);

      // Initialize default settings
      const settings: DevSessionSettings = {
        liveReload: session.liveReload,
        autoSync: session.autoSync,
        logLevel: 'info',
        port: session.port || 3000,
        environment: {},
        volumes: [],
        syncIgnore: ['.git', 'node_modules', '.next', '.nuxt'],
      };

      this.sessionSettings.set(sessionId, settings);

      // Persist to storage
      await this.storageService.writeFile(
        `dev-sessions/${sessionId}/metadata.json`,
        JSON.stringify(session, null, 2)
      );

      await this.storageService.writeFile(
        `dev-sessions/${sessionId}/settings.json`,
        JSON.stringify(settings, null, 2)
      );

      // Start the session if requested
      if (request.autoStart !== false) {
        const job = await this.jobService.createJob({
          type: 'start',
          payload: { sessionId, action: 'start-dev' },
        });

        this.logger.info('Dev session job created', { sessionId, jobId: job.id });
        
        return {
          sessionId,
          draftId,
          jobId: job.id,
        };
      }

      return { 
        sessionId,
        draftId,
      };
    } catch (error) {
      this.logger.error('Failed to create dev session', error as Error, {
        sessionId,
        draftId: request.draftId,
      });
      throw error;
    }
  }

  async listSessions(request: GetDevSessionsRequest): Promise<GetDevSessionsResponse> {
    this.logger.info('Listing dev sessions', { request });

    const sessions = Array.from(this.sessions.values());
    
    // Apply filters
    let filtered = sessions;
    
    if (request.status && request.status !== 'all') {
      filtered = filtered.filter(s => s.status === request.status);
    }
    
    if (request.draftId) {
      filtered = filtered.filter(s => s.draftId === request.draftId);
    }

    // Apply pagination
    const page = request.page || 1;
    const limit = request.limit || 10;
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    
    const paginatedSessions = filtered.slice(startIndex, endIndex);

    // Convert to list items
    const items: DevSessionListItem[] = paginatedSessions.map(s => ({
      id: s.id,
      name: s.name,
      draftId: s.draftId,
      status: s.status,
      previewUrl: s.previewUrl,
      createdAt: s.createdAt,
      lastActivity: s.lastActivity,
      liveReload: s.liveReload,
      autoSync: s.autoSync,
    }));

    return {
      items,
      page,
      limit,
      total: filtered.length,
    };
  }

  async getSession(sessionId: string): Promise<GetDevSessionResponse> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Dev session not found: ${sessionId}`);
    }

    this.logger.info('Getting dev session', { sessionId });

    return session;
  }

  async updateSession(sessionId: string, request: PatchDevSessionRequest): Promise<PatchDevSessionResponse> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Dev session not found: ${sessionId}`);
    }

    this.logger.info('Updating dev session', { sessionId, request });

    // Update session fields
    if (request.name !== undefined) {
      session.name = request.name;
    }

    if (request.liveReload !== undefined) {
      session.liveReload = request.liveReload;
    }

    if (request.autoSync !== undefined) {
      session.autoSync = request.autoSync;
    }

    session.lastActivity = new Date().toISOString();
    this.sessions.set(sessionId, session);

    // Persist changes
    await this.storageService.writeFile(
      `dev-sessions/${sessionId}/metadata.json`,
      JSON.stringify(session, null, 2)
    );

    return { ok: true };
  }

  async deleteSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Dev session not found: ${sessionId}`);
    }

    this.logger.info('Deleting dev session', { sessionId });

    try {
      // Stop session first
      await this.executeAction(sessionId, { action: 'stop' });
    } catch (error) {
      this.logger.warn('Failed to stop dev session before deletion', { sessionId, error: error instanceof Error ? error.message : String(error) });
    }

    // Remove from memory
    this.sessions.delete(sessionId);
    this.sessionSettings.delete(sessionId);
    this.fileWatchers.delete(sessionId);

    // Remove from storage
    try {
      await this.storageService.deleteDir(`dev-sessions/${sessionId}`, true);
    } catch (error) {
      this.logger.warn('Failed to delete dev session storage', { sessionId, error: error instanceof Error ? error.message : String(error) });
    }
  }

  async executeAction(sessionId: string, request: PostDevSessionActionRequest): Promise<PostDevSessionActionResponse> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Dev session not found: ${sessionId}`);
    }

    this.logger.info('Executing dev session action', { sessionId, action: request.action });

    try {
      // Create job for the action
      const job = await this.jobService.createJob({
        type: this.mapActionToJobType(request.action),
        payload: { sessionId, action: request.action },
      });

      // Update session status based on action
      switch (request.action) {
        case 'start':
          session.status = 'starting';
          break;
        case 'stop':
          session.status = 'stopped';
          break;
        case 'restart':
          session.status = 'starting';
          break;
        case 'refresh':
          session.status = 'running';
          break;
      }

      session.lastActivity = new Date().toISOString();
      this.sessions.set(sessionId, session);

      return {
        ok: true,
        jobId: job.id,
      };
    } catch (error) {
      this.logger.error('Failed to execute dev session action', error as Error, { sessionId, action: request.action });
      throw error;
    }
  }

  async getSessionLogs(sessionId: string, options?: { since?: string; limit?: number }): Promise<LogEntry[]> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Dev session not found: ${sessionId}`);
    }

    this.logger.info('Getting dev session logs', { sessionId, options });

    // In a real implementation, this would read from log files
    let logs = session.logs || [];

    // Apply filters
    if (options?.since) {
      const sinceDate = new Date(options.since);
      logs = logs.filter(log => new Date(log.timestamp) > sinceDate);
    }

    if (options?.limit) {
      logs = logs.slice(-options.limit);
    }

    return logs;
  }

  async getSessionSettings(sessionId: string): Promise<DevSessionSettings> {
    const settings = this.sessionSettings.get(sessionId);
    if (!settings) {
      throw new Error(`Dev session settings not found: ${sessionId}`);
    }

    return settings;
  }

  async updateSessionSettings(sessionId: string, updates: Partial<DevSessionSettings>): Promise<void> {
    const settings = this.sessionSettings.get(sessionId);
    if (!settings) {
      throw new Error(`Dev session settings not found: ${sessionId}`);
    }

    this.logger.info('Updating dev session settings', { sessionId, updates });

    // Update settings
    Object.assign(settings, updates);
    this.sessionSettings.set(sessionId, settings);

    // Persist changes
    await this.storageService.writeFile(
      `dev-sessions/${sessionId}/settings.json`,
      JSON.stringify(settings, null, 2)
    );
  }

  async enableFileWatching(sessionId: string): Promise<void> {
    this.logger.info('Enabling file watching', { sessionId });
    this.fileWatchers.set(sessionId, true);
  }

  async disableFileWatching(sessionId: string): Promise<void> {
    this.logger.info('Disabling file watching', { sessionId });
    this.fileWatchers.set(sessionId, false);
  }

  async syncFiles(sessionId: string, files: { path: string; content: string }[]): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Dev session not found: ${sessionId}`);
    }

    this.logger.info('Syncing files', { sessionId, fileCount: files.length });

    // Write files to session directory
    for (const file of files) {
      await this.storageService.writeFile(
        `dev-sessions/${sessionId}/files/${file.path}`,
        file.content
      );
    }

    // Update last activity
    session.lastActivity = new Date().toISOString();
    this.sessions.set(sessionId, session);
  }

  private generatePort(): number {
    // Generate a port between 3000-9000
    return Math.floor(Math.random() * 6000) + 3000;
  }

  private mapActionToJobType(action: string): 'start' | 'stop' | 'backup' {
    switch (action) {
      case 'start':
      case 'restart':
      case 'refresh':
        return 'start';
      case 'stop':
        return 'stop';
      default:
        return 'start';
    }
  }
}

export class MockDevSessionService implements DevSessionService {
  private logger = getLogger().child({ service: 'MockDevSessionService' });

  async healthCheck(): Promise<ServiceHealth> {
    return {
      healthy: true,
      lastCheck: new Date(),
    };
  }

  async createSession(request: CreateDevSessionRequest): Promise<CreateDevSessionResponse> {
    const sessionId = crypto.randomUUID();
    
    this.logger.info('Mock: Creating dev session', { 
      sessionId, 
      draftId: request.draftId,
      appId: request.appId
    });

    return {
      sessionId,
      draftId: request.draftId || 'mock-draft-id',
      jobId: crypto.randomUUID(),
    };
  }

  async listSessions(request: GetDevSessionsRequest): Promise<GetDevSessionsResponse> {
    this.logger.info('Mock: Listing dev sessions', { request });

    const items: DevSessionListItem[] = [
      {
        id: 'session-1',
        name: 'Mock Dev Session',
        draftId: 'draft-1',
        status: 'running',
        previewUrl: 'http://localhost:3000',
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        liveReload: true,
        autoSync: false,
      },
    ];

    return {
      items,
      page: 1,
      limit: 10,
      total: items.length,
    };
  }

  async getSession(sessionId: string): Promise<GetDevSessionResponse> {
    this.logger.info('Mock: Getting dev session', { sessionId });

    return {
      id: sessionId,
      sessionId, // Add alias
      name: 'Mock Dev Session',
      draftId: 'draft-1',
      status: 'running',
      previewUrl: 'http://localhost:3000',
      port: 3000,
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      liveReload: true,
      autoSync: false,
      logs: [
        {
          timestamp: new Date().toISOString(),
          service: 'system',
          level: 'info',
          message: 'Dev session started',
        },
      ],
    };
  }

  async updateSession(sessionId: string, request: PatchDevSessionRequest): Promise<PatchDevSessionResponse> {
    this.logger.info('Mock: Updating dev session', { sessionId, request });
    return { ok: true };
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.logger.info('Mock: Deleting dev session', { sessionId });
  }

  async executeAction(sessionId: string, request: PostDevSessionActionRequest): Promise<PostDevSessionActionResponse> {
    this.logger.info('Mock: Executing dev session action', { sessionId, action: request.action });
    
    return {
      ok: true,
      jobId: crypto.randomUUID(),
    };
  }

  async getSessionLogs(sessionId: string, options?: { since?: string; limit?: number }): Promise<LogEntry[]> {
    this.logger.info('Mock: Getting dev session logs', { sessionId, options });

    return [
      {
        timestamp: new Date().toISOString(),
        service: 'app',
        level: 'info',
        message: 'Mock log entry',
      },
    ];
  }

  async getSessionSettings(sessionId: string): Promise<DevSessionSettings> {
    this.logger.info('Mock: Getting dev session settings', { sessionId });

    return {
      liveReload: true,
      autoSync: false,
      logLevel: 'info',
      port: 3000,
      environment: {},
      volumes: [],
      syncIgnore: ['.git', 'node_modules'],
    };
  }

  async updateSessionSettings(sessionId: string, updates: Partial<DevSessionSettings>): Promise<void> {
    this.logger.info('Mock: Updating dev session settings', { sessionId, updates });
  }

  async enableFileWatching(sessionId: string): Promise<void> {
    this.logger.info('Mock: Enabling file watching', { sessionId });
  }

  async disableFileWatching(sessionId: string): Promise<void> {
    this.logger.info('Mock: Disabling file watching', { sessionId });
  }

  async syncFiles(sessionId: string, files: { path: string; content: string }[]): Promise<void> {
    this.logger.info('Mock: Syncing files', { sessionId, fileCount: files.length });
  }
}

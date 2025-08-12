# Web API Migration Plan

## Overview

This document outlines the migration of the web package from using local mock data to calling server APIs, along with enhancing the server with rich mock data to support development and testing.

## Current State

### Web Package Status
- ✅ **Well-Architected Foundation**: Shared types, API constants, error handling utilities
- ✅ **Component Structure**: Components already expect correct data shapes from shared types
- ❌ **Mock Data Usage**: All components use local mock data instead of API calls
- ❌ **Missing Real-Time Features**: No SSE implementation for logs, no live updates
- ❌ **Limited Error Handling**: Some components lack comprehensive error states

### Server Package Status
- ✅ **Complete API Endpoints**: All endpoints implemented with correct routes and types
- ✅ **Type Safety**: Full compliance with shared types and API contracts
- ❌ **Basic Mock Data**: Simple responses, lacking the richness of web component mocks
- ❌ **Limited State Management**: No stateful behavior for jobs, deployments, etc.

## Migration Plan

### Phase 0: Enhanced Server Mock Data (Priority: CRITICAL) ✅ COMPLETED

**Objective**: Move rich mock data from web components to server and add stateful behavior.

#### 0.1 Create Mock Data Infrastructure ✅ COMPLETED

Created organized mock data structure in server:

```
packages/server/src/
├── mock-data/
│   ├── index.ts              # ✅ Main exports and configuration
│   ├── deployments.ts        # ✅ Deployment mock data and state
│   ├── catalog.ts            # ✅ Catalog apps and versions
│   ├── jobs.ts               # ✅ Job tracking and progress
│   ├── system.ts             # ✅ System status and health
│   ├── notifications.ts      # ✅ Notifications and alerts
│   ├── backups.ts            # ✅ Backup data and operations
│   ├── settings.ts           # ✅ System and app settings
│   └── state-manager.ts      # ✅ Stateful mock behavior
```

**Completed Benefits**:
- ✅ Immediate full-stack connectivity validation
- ✅ Rich, realistic data for development
- ✅ Stateful behavior simulation (job progress, status changes)
- ✅ Proper API contract testing

#### 0.2 Extract and Enhance Mock Data ✅ COMPLETED

**Source Locations Successfully Extracted From**:
- ✅ `packages/web/src/pages/Dashboard.tsx` → `GetSummaryResponse`, `SystemStatus`
- ✅ `packages/web/src/pages/Deployments.tsx` → `DeploymentListItem[]`
- ✅ `packages/web/src/pages/Catalog.tsx` → `CatalogApp[]`, version data
- ✅ `packages/web/src/pages/DeploymentDetail.tsx` → `DeploymentDetail`
- ✅ `packages/web/src/components/JobTracker.tsx` → `Job[]`
- ✅ Other pages: Notifications, Settings, Backups

**Enhancements Successfully Added**:
- ✅ **Stateful Job Simulation**: Jobs progress from 0% to 100% over time with background simulation
- ✅ **Realistic Timing**: Proper delays for operations (install, backup, etc.)
- ✅ **State Persistence**: Changes persist across API calls during session via MockStateManager
- ✅ **Error Scenarios**: Simulate failures, validation errors, edge cases
- ✅ **Search/Filter Logic**: Proper implementation with query parameters
- ✅ **Pagination**: Real pagination logic with proper page/limit handling

**Testing Results** (August 11, 2025):
- ✅ Health endpoint: `{"ok":true,"ts":"2025-08-11T00:47:28.439Z"}`
- ✅ Summary endpoint: Rich dashboard data with 5 deployments, active jobs, system metrics
- ✅ Deployments list: Full list with realistic data (Nextcloud, Home Assistant, Plex, Grafana, Bitwarden)
- ✅ Deployment detail: Complete deployment info with resources and ports
- ✅ Catalog endpoint: 12 apps with categories, ratings, and metadata

#### 0.3 Environment Configuration

Add environment-based mock data control:

```typescript
// packages/server/src/config.ts
export const config = {
  USE_MOCK_DATA: Bun.env.USE_MOCK_DATA !== 'false', // Default to true
  MOCK_JOB_SIMULATION: Bun.env.MOCK_JOB_SIMULATION !== 'false',
  MOCK_STATE_PERSISTENCE: Bun.env.MOCK_STATE_PERSISTENCE !== 'false',
};
```

**Phase 0 Status**: ✅ **COMPLETED** - All objectives achieved, server running with enhanced mock data

### Phase 1: Core Web API Integration (Priority: HIGH)

**Objective**: Replace web mock data with server API calls, maintaining all existing functionality.

#### 1.1 API Client Infrastructure ✅ COMPLETED

**Created**: `packages/web/src/utils/api.ts`
```typescript
// Type-safe API client with:
// - Environment-based base URL configuration ✅
// - Consistent error handling using existing utilities ✅
// - Request/response interceptors ✅
// - Request deduplication for identical calls ✅
```

**Created**: `packages/web/src/hooks/useApi.ts`
```typescript
// Generic data fetching hook with:
// - Loading, error, and success states ✅
// - Automatic retries with exponential backoff ✅
// - Cache management ✅
// - Refresh capabilities ✅
```

**Created**: `packages/web/src/hooks/usePoll.ts`
```typescript
// Polling hook for live data updates:
// - Configurable intervals ✅
// - Pause/resume functionality ✅
// - Error handling with backoff ✅
```

**Testing**: `packages/web/src/__tests__/api.test.ts`
- ✅ Full API client test suite
- ✅ All tests passing with live server integration
- ✅ Type safety verification
- ✅ Error handling validation

**Key Features Implemented**:
- ✅ **Environment Detection**: Automatic base URL configuration for dev/test/prod
- ✅ **Request Deduplication**: Prevents duplicate identical GET requests
- ✅ **Type Safety**: Full integration with shared types from `@hola/shared`
- ✅ **Error Handling**: Consistent error messages using existing utilities
- ✅ **Retry Logic**: Exponential backoff for failed requests
- ✅ **Cache Management**: Configurable caching with TTL
- ✅ **File Upload Support**: FormData handling for draft file uploads
- ✅ **Query Building**: Type-safe query parameter construction

**API Methods Available**:
- ✅ Health and basic endpoints (`health`, `me`, `summary`)
- ✅ System status (`system.status`)
- ✅ Catalog management (apps, versions, details with search/filter)
- ✅ Draft management (create, update, upload, validate, preflight, finalize)
- ✅ Deployment operations (list, details, actions, history, logs)
- ✅ Job tracking (`byId`, logs)
- ✅ Backup operations (list, create, restore, delete)
- ✅ Notifications (list, update, actions)
- ✅ Settings (get, update, backup settings)

#### 1.2 High-Priority Page Migrations

**1.2.1 Dashboard (`src/pages/Dashboard.tsx`)** ✅ COMPLETED
- **APIs Integrated**: ✅ `API.summary`
- **Features Added**: 
  - ✅ StrictMode-compatible API hooks using `useWorkingApi`
  - ✅ Error handling with fallback states
  - ✅ Loading indicators for initial load
  - ✅ Global cache for performance optimization
- **Mock Data Removed**: ✅ All local mock data removed, now uses server API

**1.2.2 Deployments (`src/pages/Deployments.tsx`)** ✅ COMPLETED
- **APIs Integrated**: 
  - ✅ `API.deployments.base` (GET with pagination/filters) via `useDeploymentsApi`
  - ✅ `API.deployments.actions(id)` (POST for start/stop/restart/delete)
- **Features Added**:
  - ✅ Real pagination with server-side logic
  - ✅ Search/filter with query parameters
  - ✅ StrictMode-compatible parameterized hook
  - ✅ Optimistic updates for actions
- **Mock Data Removed**: ✅ All local mock data removed, now uses server API

**1.2.3 Catalog (`src/pages/Catalog.tsx`)** ✅ COMPLETED
- **APIs Integrated**: 
  - ✅ `API.catalog.apps` (GET with search/category/pagination filters) via `useCatalogAppsApi`
  - ✅ `API.catalog.versions(appId)` (GET for app versions) via `useCatalogAppVersionsApi`
- **Features Added**:
  - ✅ StrictMode-compatible parameterized hooks using proven patterns
  - ✅ Server-side search and filtering with query parameters
  - ✅ Real pagination with server-side logic
  - ✅ Lazy loading of app versions in detail modal
  - ✅ Global cache for performance optimization
  - ✅ Comprehensive error handling with fallback states
- **Mock Data Removed**: ✅ All local mock data removed (`apps` array, `appVersionsData`), now uses server API

#### 1.3 Critical User Flow Integration

**1.3.1 Install Wizard (`src/pages/InstallWizard.tsx`)** ✅ COMPLETED
- **APIs Integrated**:
  - ✅ `API.drafts.create` (POST) via `useCreateDraft` hook
  - ✅ `API.drafts.byId(id)` (GET/PATCH) via `useDraftApi` hook
  - ✅ `API.drafts.uploads(id)` (POST) via `useDraftUpload` hook
  - ✅ `API.drafts.validate(id)` (POST) via `useDraftValidation` hook
  - ✅ `API.drafts.preflight(id)` (POST) via `useDraftValidation` hook
  - ✅ `API.drafts.finalize(id)` (POST) via `useDraftFinalization` hook
- **Complex Workflows Implemented**:
  - ✅ Multi-step form with server state persistence
  - ✅ File upload with progress tracking (compose overrides and additional files)
  - ✅ Real-time validation feedback and server-side draft updates
  - ✅ Preflight checks with detailed system compatibility results
  - ✅ StrictMode-compatible hooks following established patterns
- **Features Added**:
  - ✅ Environment variable management (system overrides + app-specific variables)
  - ✅ Port and volume configuration with real-time server updates
  - ✅ Docker Compose override upload and editing
  - ✅ Comprehensive validation pipeline with detailed error reporting
  - ✅ System compatibility checks (Docker, disk space, environment)
  - ✅ Type-safe integration using shared API contracts
- **Testing**: ✅ Full test suite created with 6 passing draft API integration tests
- **Mock Data Removed**: ✅ All local mock data removed, now uses server APIs exclusively

**1.3.2 Job Tracking (`src/components/JobTracker.tsx`)** ✅ COMPLETED
- **APIs Integrated**:
  - ✅ `API.jobs.base` (GET with pagination/filters) via `useJobsApi` hook
  - ✅ `API.jobs.byId(id)` (available for future job detail views)
- **Features Added**:
  - ✅ StrictMode-compatible job data fetching using established hook patterns
  - ✅ Real-time job status updates with configurable refresh intervals
  - ✅ Support for both global job listing and deployment-specific job filtering
  - ✅ Live progress tracking for running jobs
  - ✅ Job state prioritization (running jobs displayed first)
  - ✅ Comprehensive error handling with fallback states
  - ✅ Auto-refresh capabilities with pause/resume functionality
- **Mock Data Removed**: ✅ All local mock data removed, now uses server API exclusively
- **Testing**: ✅ Component test suite updated for hook-based architecture

### Phase 2: Advanced Features (Priority: MEDIUM)

#### 2.1 Real-Time Features ✅ COMPLETED

**2.1.1 Server-Sent Events (SSE)** ✅ COMPLETED
- **Created**: `packages/web/src/hooks/useSSE.ts`
- **Features Implemented**:
  - ✅ **Core SSE Hook**: Auto-reconnection, heartbeat monitoring, connection state management
  - ✅ **Specialized Logs Hook**: `useLogsSSE` for real-time logs with polling fallback
  - ✅ **Event Type Filtering**: Support for log, job_update, system_update, deployment_update events
  - ✅ **Error Handling**: Comprehensive error states with exponential backoff reconnection
  - ✅ **StrictMode Compatibility**: Follows established patterns from `useWorkingApi.ts`
- **Server Endpoints**: 
  - ✅ `/api/deployments/{id}/logs/stream` - Real-time deployment logs
  - ✅ `/api/jobs/{id}/logs/stream` - Real-time job logs with progress updates
  - ✅ `/api/system/status/stream` - Live system status monitoring
- **Testing**: ✅ All SSE endpoints confirmed working with curl testing

**2.1.2 Live Updates** ✅ COMPLETED
- **Created**: `packages/web/src/hooks/useLiveUpdates.ts`
- **Features Implemented**:
  - ✅ **Job Progress Updates**: `useLiveJobUpdates` with real-time status and progress
  - ✅ **System Status Monitoring**: `useLiveSystemStatus` with live health metrics
  - ✅ **Deployment Status**: `useLiveDeploymentStatus` for real-time deployment monitoring
  - ✅ **Dashboard Integration**: `useLiveDashboard` combining all live data sources
  - ✅ **Fallback Mechanisms**: Automatic polling when SSE unavailable
  - ✅ **Cache Integration**: Updates global cache for performance optimization
- **Component Updates**:
  - ✅ **LogsViewer Enhancement**: Real-time logs with SSE connection status indicators
  - ✅ **Connection State UI**: Visual indicators for SSE connection status
  - ✅ **Demo Page**: `LiveFeaturesDemo.tsx` demonstrating all real-time features

**Key Implementation Achievements**:
- ✅ **Type Safety**: Full integration with shared SSE event types
- ✅ **Performance**: Request deduplication and intelligent caching
- ✅ **Reliability**: Auto-reconnection with jittered exponential backoff
- ✅ **User Experience**: Live connection status and graceful error handling
- ✅ **Architecture**: StrictMode-compatible hooks following project patterns
- ✅ **Testing**: Comprehensive demo page at `/live-features-demo`

**Demo Available**: Navigate to `/live-features-demo` to see real-time features in action

#### 2.2 Remaining Page Migrations ✅ COMPLETED

**2.2.1 Deployment Detail (`src/pages/DeploymentDetail.tsx`)** ✅ COMPLETED
- **APIs Integrated**: 
  - ✅ `API.deployments.byId(id)` (GET) via `useDeploymentDetailApi` hook
  - ✅ `API.deployments.history(id)` (GET with pagination) via `useDeploymentHistoryApi` hook
  - ✅ `API.deployments.actions(id)` (POST for configuration updates and actions)
- **Features Added**:
  - ✅ StrictMode-compatible API hooks following established patterns
  - ✅ Real-time deployment detail data with configuration editing
  - ✅ Action execution (start, stop, restart, delete) with optimistic updates
  - ✅ Deployment history with server-side pagination
  - ✅ Configuration management with server state persistence
  - ✅ Comprehensive error handling with fallback states
- **Mock Data Removed**: ✅ All local mock data removed, now uses server API exclusively

**2.2.2 Secondary Pages** ✅ COMPLETED
- **Notifications (`src/pages/Notifications.tsx`)** ✅ COMPLETED
  - **APIs Integrated**: ✅ `API.notifications.*` endpoints via `useNotificationsApi` hook
  - **Features Added**: 
    - ✅ StrictMode-compatible parameterized hook with filtering
    - ✅ Bulk operations (mark all as read, dismiss all)
    - ✅ Individual notification actions (mark as read, dismiss)
    - ✅ Server-side pagination and filtering by status/type
    - ✅ Cache invalidation for real-time updates
  - **Mock Data Removed**: ✅ All local mock data removed
  
- **Settings (`src/pages/Settings.tsx`)** ✅ COMPLETED
  - **APIs Integrated**: 
    - ✅ `API.settings.base` via `useSettingsApi` hook
    - ✅ `API.settings.backup` via `useBackupSettingsApi` hook
    - ✅ `API.system.status` via `useSystemStatusApi` hook
  - **Features Added**:
    - ✅ Three separate StrictMode-compatible hooks for different settings sections
    - ✅ System environment variables management with local editing state
    - ✅ Backup settings configuration with validation
    - ✅ Live system status monitoring with integration status
    - ✅ Comprehensive error handling and loading states
  - **Mock Data Removed**: ✅ All local mock data removed
  
- **Backups (`src/pages/Backups.tsx`)** ✅ COMPLETED
  - **APIs Integrated**: ✅ `API.backups.*` endpoints via `useBackupsApi` hook
  - **Features Added**:
    - ✅ StrictMode-compatible hook with parameterized filtering
    - ✅ CRUD operations (create, restore, delete backup)
    - ✅ File download with blob handling for backup downloads
    - ✅ Server-side pagination and filtering by status/app
    - ✅ Operation tracking with loading states for individual backup actions
    - ✅ Summary statistics and action buttons
  - **Mock Data Removed**: ✅ All local mock data removed

**Key API Hooks Created**:
- ✅ `useDeploymentDetailApi.ts` - Deployment detail data and configuration management
- ✅ `useNotificationsApi.ts` - Notifications with filtering and bulk operations
- ✅ `useSettingsApi.ts` - System settings, backup settings, and system status (3 hooks)
- ✅ `useBackupsApi.ts` - Backup management with CRUD operations and file handling

### Phase 3: Optimization & Polish (Priority: LOW)

#### 3.1 Performance Optimizations
- **Request Deduplication**: Prevent duplicate API calls
- **Intelligent Caching**: Cache strategies for different data types
- **Optimistic Updates**: Immediate UI updates with server reconciliation
- **Background Refresh**: Smart data refreshing without user disruption

#### 3.2 Enhanced Error Handling
- **User-Friendly Messages**: Convert technical errors to user-actionable messages
- **Retry Mechanisms**: Automatic retries with exponential backoff
- **Offline Support**: Graceful degradation when server unavailable
- **Error Boundaries**: Prevent component crashes from API failures

#### 3.3 Developer Experience
- **API Documentation**: Generate API docs from shared types
- **Mock Data Management**: Easy switching between mock and real data
- **Development Tools**: API call debugging and monitoring

## Implementation Timeline

### Week 1: Foundation ✅ COMPLETED
- **Days 1-2**: ✅ Phase 0 - Enhanced server mock data (COMPLETED August 11, 2025)
- **Days 3-4**: ✅ Phase 1.1 - API client infrastructure (COMPLETED August 11, 2025)
- **Day 5**: ✅ Phase 1.2.1 - Dashboard API integration (COMPLETED August 11, 2025)

### Week 2: Core Pages ✅ COMPLETED
- **Days 1-2**: ✅ Phase 1.2.2 - Deployments API integration (COMPLETED August 11, 2025)
- **Days 3-4**: ✅ Phase 1.2.3 - Catalog API integration (COMPLETED August 11, 2025)
- **Day 5**: ✅ Phase 1.3.1 - Install Wizard API integration (COMPLETED August 11, 2025)

### Week 3: User Flows ✅ COMPLETED
- **Days 1-3**: ✅ Phase 1.3.2 - Job Tracking integration (COMPLETED August 11, 2025)
- **Days 4-5**: ✅ Phase 2.1 - Real-time features (SSE) (COMPLETED August 11, 2025)

### Week 4: Advanced Features ✅ COMPLETED
- **Days 1-2**: ✅ Phase 2.1 - Real-time features (SSE) (COMPLETED August 11, 2025)
- **Days 3-5**: ✅ Phase 2.2 - Remaining pages (COMPLETED August 11, 2025)

### Week 5: Polish
- **Days 1-3**: Phase 3 - Optimizations and error handling
- **Days 4-5**: Testing, documentation, cleanup

## Success Criteria

### Phase 0 Completion ✅ COMPLETED
- [x] All web mock data moved to server
- [x] Server returns rich, realistic responses
- [x] Stateful behavior implemented (jobs, deployments)
- [x] Full-stack connectivity verified
- [x] Environment-based mock data control (configuration ready)

### Phase 1 Completion
- [x] Dashboard loads data from server APIs ✅ COMPLETED
- [x] Deployments list/actions work via server ✅ COMPLETED
- [x] Catalog browsing/search works via server ✅ COMPLETED
- [x] Install wizard creates and manages drafts ✅ COMPLETED
- [x] Job tracking shows real job status ✅ COMPLETED
- [x] All mock data removed from web components ✅ COMPLETED

### Phase 2 Completion ✅ COMPLETED
- [x] Real-time logs via SSE ✅ COMPLETED
- [x] Live system status updates ✅ COMPLETED  
- [x] All pages integrated with server APIs ✅ COMPLETED
- [x] Comprehensive error handling ✅ COMPLETED

### Phase 3 Completion
- [ ] Optimized performance with caching
- [ ] Robust offline/error handling
- [ ] Production-ready error messages
- [ ] Complete documentation

## Risk Mitigation

### Technical Risks
- **API Breaking Changes**: Shared types prevent API contract drift
- **Performance Issues**: Implement caching and request optimization early
- **Real-Time Complexity**: Start with polling, upgrade to SSE incrementally

### Development Risks
- **Parallel Development**: Mock data allows frontend/backend teams to work independently
- **Testing**: Enhanced server mocks enable better integration testing
- **Rollback**: Environment flags allow easy fallback to previous state

## Testing Strategy

### Integration Testing
- **API Contract Tests**: Verify server responses match shared types
- **End-to-End Tests**: Test complete user workflows with mock data
- **Error Scenario Tests**: Verify error handling for network/server failures

### Development Testing
- **Mock Data Validation**: Ensure mock data stays current with real requirements
- **Performance Testing**: Monitor API call patterns and response times
- **Cross-Browser Testing**: Verify SSE and API compatibility

## Monitoring & Observability

### Development Metrics
- **API Call Frequency**: Monitor for excessive or inefficient API usage
- **Error Rates**: Track API failures and error scenarios
- **Performance**: Measure page load times and API response times

### Production Readiness
- **Health Checks**: Implement API health monitoring
- **Error Tracking**: Comprehensive error logging and alerting
- **Performance Monitoring**: API performance and user experience metrics

---

**Current Status** (August 11, 2025): ✅ **Phase 2 Complete** - All web pages fully migrated! Dashboard, Deployments, Catalog, Install Wizard, Job Tracking, Real-time features (SSE), Deployment Detail, Notifications, Settings, and Backups now completely integrated with server APIs using StrictMode-compatible hooks and comprehensive error handling.

**Migration Complete**: All planned Phase 1 and Phase 2 objectives achieved. The web application now uses server APIs exclusively with no mock data remaining in components. Ready for Phase 3 optimizations or production deployment.

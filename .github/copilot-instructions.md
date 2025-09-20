# GitHub Copilot Instructions

## Overview

TypeScript monorepo for application deployment platform with:
- **Bun Server** - Backend API with modern TypeScript and async patterns
- **React Web Frontend** - SPA with Tailwind CSS for responsive UI
- **Shared Types** - Centralized type definitions and API constants
- **Workspace Architecture** - Organized monorepo with clear separation of concerns

## Core Principles

- **Modern TypeScript**: Strict typing, ESNext features, workspace references
- **Code Quality**: **CRITICAL - ALL linting errors must be fixed before any work can be considered complete. Zero linting errors allowed.**
- **Testing**: Use fakes instead of mocks, organize by feature, ensure isolation  
- **Monorepo Structure**: Clean separation between web, server, and shared packages
- **Type Safety**: End-to-end type safety from API to UI
- **API-First**: REST API with consistent patterns and shared contracts
- **Container Management**: Docker integration for application deployment

## Workspace Structure

```
packages/
├── shared/           # Shared types, API constants, utilities
│   ├── src/
│   │   └── index.ts  # API routes, types, request/response models
│   └── package.json
├── server/           # Bun backend server
│   ├── src/
│   │   └── server.ts # Main server implementation
│   └── package.json
└── web/              # React frontend
    ├── src/
    │   ├── pages/    # React components for main pages
    │   └── components/ # Reusable UI components
    └── package.json
```

### Shared Package (`packages/shared/`)
- **API Constants**: Route definitions with type-safe path builders
- **TypeScript Types**: Request/response models, domain objects
- **Utilities**: Shared helper functions and constants
- **No Runtime Dependencies**: Pure types and constants only

### Server Package (`packages/server/`)
- **Bun Runtime**: Fast TypeScript execution with built-in bundling
- **API Endpoints**: REST endpoints following shared API contract
- **Business Logic**: Core application functionality
- **Docker Integration**: Container management and orchestration

### Web Package (`packages/web/`)
- **React + TypeScript**: Modern React with strict typing
- **Tailwind CSS**: Utility-first styling framework
- **React Router**: Client-side routing and navigation
- **Lucide Icons**: Consistent icon system

## API Integration Patterns

### Shared API Contract
All API routes are defined in `packages/shared/src/index.ts` as constants:

```typescript
export const API = {
  deployments: {
    base: '/api/deployments',
    byId: (deploymentId: string) => `/api/deployments/${deploymentId}`,
    actions: (deploymentId: string) => `/api/deployments/${deploymentId}/actions`,
  },
  // ... other endpoints
} as const;
```

### Type-Safe Request/Response Models
Shared types ensure consistency between frontend and backend:

```typescript
export type PostDeploymentActionRequest = { 
  action: 'start' | 'stop' | 'restart' | 'delete' 
};

export type DeploymentDetail = {
  id: string;
  name: string;
  status: DeploymentStatus;
  resources: { cpu: string; memory: string; disk?: string };
  // ... other fields
};
```

### Frontend API Integration Pattern
React components use shared API constants and types:

```typescript
import { API } from '@hola/shared';
import type { PostDeploymentActionRequest, DeploymentDetail } from '@hola/shared';

const handleAction = async (deploymentId: string, action: 'start' | 'stop' | 'restart' | 'delete') => {
  try {
    const request: PostDeploymentActionRequest = { action };
    const response = await fetch(API.deployments.actions(deploymentId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });
    
    if (!response.ok) {
      throw new Error(`Failed to ${action} deployment`);
    }
    
    // Handle success - update UI state, show notifications
  } catch (error) {
    // Handle error - show user feedback
  }
};
```

### Backend Implementation Pattern
Server endpoints implement the shared contract:

```typescript
import { API } from '@hola/shared';
import type { PostDeploymentActionRequest, DeploymentDetail } from '@hola/shared';

// Route matches the shared API constant
app.post(API.deployments.actions(':deploymentId'), async (req, res) => {
  const { deploymentId } = req.params;
  const { action }: PostDeploymentActionRequest = req.body;
  
  // Implement business logic
  await performDeploymentAction(deploymentId, action);
  
  res.json({ success: true });
});
```

## Testing Standards

**Fakes Over Mocks**: NEVER use complex mocking libraries for business dependencies
- Create fakes implementing same interface with in-memory behavior
- Store in `__tests__/fakes/` directories, name with "Fake" prefix
- Include state tracking and reset capabilities
- Only acceptable mocks: environment control, external service stubs

**Test Organization**:
```
packages/
├── shared/
│   └── __tests__/    # Type and utility tests
├── server/
│   └── __tests__/    # API endpoint tests
└── web/
    └── __tests__/    # Component and integration tests
```

**Frontend Testing**:
- Component unit tests with React Testing Library
- Integration tests for API interactions
- Mock API responses using shared types
- Test user interactions and state management

**Backend Testing**:
- Endpoint tests with request/response validation
- Business logic unit tests
- Integration tests with fake dependencies
- Test error handling and edge cases

**Running Tests**:
```bash
bun test                               # All tests
bun test packages/web                  # Frontend tests
bun test packages/server               # Backend tests
bun run --filter './packages/*' test  # All workspace tests
```

## Development Workflow

**Workspace Commands**:
```bash
bun dev                    # Start both server and web in parallel
bun dev:web               # Start only web frontend
bun dev:server            # Start only server
bun build                 # Build all packages
bun typecheck             # Type check all packages
bun lint                  # Lint all packages
```

## Code Quality Requirements

**🚨 CRITICAL: ALL LINTING ERRORS MUST BE FIXED - NO EXCEPTIONS 🚨**

**Linting is not optional - it is a strict requirement. Work is not complete until linting passes 100% clean with zero errors or warnings. This is non-negotiable.**

### Pre-Commit Checklist
```bash
# 🚨 MANDATORY - ALWAYS run these commands before committing:
bun run lint              # ⚠️  MUST pass with ZERO errors - FIX ALL LINTING ISSUES
bun run typecheck         # ⚠️  Fix all type errors  
bun run test              # ⚠️  Ensure all tests pass
bun run build             # ⚠️  Verify build succeeds
```

**If ANY of these commands fail, you MUST fix the issues before proceeding. No shortcuts, no exceptions.**

### Linting Standards
- **🚨 ABSOLUTE ZERO LINTING ERRORS ALLOWED** - ALL code must pass ESLint checks completely
- **🚨 MANDATORY TYPE SAFETY** - TypeScript strict mode with no `any` types
- **🚨 STRICT REACT HOOKS RULES** - proper dependency arrays and effect patterns are required
- **🚨 MANDATORY IMPORT/EXPORT CONSISTENCY** - organized imports, consistent export patterns
- **🚨 REQUIRED CODE STYLE UNIFORMITY** - consistent formatting and naming conventions

**⚠️ WARNING: Any linting errors will cause GitHub Actions workflows to fail. Fix ALL errors immediately.**

### Common Linting Issues to Avoid
- ❌ Using `any` type - use proper typing or `unknown` with type guards
- ❌ Missing dependencies in React hook arrays - causes infinite loops
- ❌ Unused variables or imports - clean up code before committing
- ❌ `console.log` in production code - use proper error handling or logging
- ❌ Type assertions with `as any` - use proper type guards instead
- ❌ Missing return types on functions - explicitly type function returns
- ❌ **Method name mismatches** - always verify service interface method names
- ❌ **Interface method calls** - check method signatures before calling service methods

### Type Safety & Service Interface Verification
**🚨 CRITICAL: Always verify service interfaces before implementing**

When implementing new service calls or adding Phase 7 endpoints:

1. **Check Service Interface First**:
```bash
# Always examine the service interface before calling methods
grep -n "interface.*Service" packages/server/src/services/core/*.ts
```

2. **Verify Method Names**:
```typescript
// ❌ WRONG - calling method without checking interface
const result = await draftService.preflightChecks(draftId); // Method might not exist

// ✅ CORRECT - check interface first
// Look at packages/server/src/services/core/draft.ts line 49:
// preflightCheck(draftId: string): Promise<EnhancedPreflightResponse>;
const result = await draftService.preflightCheck(draftId);
```

3. **Common Interface Verification Pattern**:
```typescript
// Before implementing any service call:
// 1. Open the service interface file
// 2. Find the exact method name and signature
// 3. Use the exact method name in your code
// 4. Match parameter types and return types

// Example for DraftService:
import type { DraftService } from './services/core/draft';
// Check interface: async preflightCheck(draftId: string): Promise<EnhancedPreflightResponse>
const result = await draftService.preflightCheck(draftId);
```

4. **Pre-Commit Interface Verification**:
```bash
# MANDATORY: Run typecheck after any service method calls
bun run typecheck
# Look for errors like: "Property 'methodName' does not exist on type 'ServiceName'"
# Fix by checking the actual interface definition
```

**Common Service Interface Patterns**:
- `DraftService`: `preflightCheck` (singular), `validateDraft`, `finalizeDraft`  
- `ValidationService`: `validateCompose`, `preflightCheck`
- `DeploymentService`: `createFromDraft`, `getDeployment`, `rollback`
- Always check `packages/server/src/services/core/` for exact method signatures

### Fixing Linting Errors
```bash
# Run linting in individual packages for focused fixes
cd packages/web && npm run lint          # Web package only
cd packages/server && bun run lint      # Server package only

# Auto-fix common issues (be careful, review changes)
cd packages/web && npx eslint . --fix   # Auto-fix web package
```

**Development Server**:
```bash
# CRITICAL: Use standardized test environment for testing and integration work
# Import from helpers/test-environment for reliable in-process testing

# For development server (NOT for testing):
cd packages/server && bun run dev    # Development server for manual testing

# NEVER use background processes for automated testing
# ALWAYS use in-process test environment from helpers/test-environment

# For API testing with feature flags (manual development only)
HOLA_USE_REAL_DOCKER=true bun run dev  # Enable specific features for development
# Always use in-process testing for automated tests
```

**Development Flow**:
1. **🚨 CODE QUALITY FIRST - NON-NEGOTIABLE**: ALWAYS run linting and type checking before committing - work is incomplete if linting fails
2. **🔍 VERIFY SERVICE INTERFACES**: Before calling any service methods, check interface definitions in `packages/server/src/services/core/`
3. Define types in `packages/shared/src/index.ts`
4. Implement API endpoints in `packages/server/`
5. **🚨 TYPECHECK AFTER SERVICE CALLS**: Run `bun run typecheck` immediately after adding any service method calls
6. Create StrictMode-compatible hooks using proven patterns from `useWorkingApi.ts` 
7. Build UI components in `packages/web/` using the API hooks
8. Test integration between frontend and backend
9. **🚨 FINAL CHECK - MANDATORY**: Ensure linting, type checking, and tests pass 100% before committing - NO EXCEPTIONS

**Testing API Integration**:
- **Use standardized test environment**: Import from `helpers/test-environment` for reliable in-process testing
- **No background processes**: Never use `bun run dev &` or `kill %1` patterns in automated tests  
- **In-process testing**: All tests run through standardized test environment for speed and reliability
- **Feature flag testing**: Set environment variables in test setup, not external processes
- **Manual testing**: Only use development server (`bun run dev`) for manual API exploration, never in automated tests

## Architecture Patterns

### StrictMode-Compatible API Hooks
React 18 StrictMode causes double-execution of effects, which breaks traditional API hooks. Use this proven pattern:

**Working Pattern for API Hooks**:
```typescript
import React from 'react';
import { api } from '../utils/api';
import { globalCache } from '../utils/cache';
import type { ApiResponseType } from '@hola/shared';

export function useStrictModeCompatibleApi() {
  const [state, setState] = React.useState<{
    data: ApiResponseType | null;
    loading: boolean;
    error: string | null;
  }>({
    data: null,
    loading: false,
    error: null,
  });

  // CRITICAL: Empty dependency array prevents infinite loops in StrictMode
  const fetchData = React.useCallback(async () => {
    const cacheKey = 'unique-cache-key';
    const cached = globalCache.get(cacheKey);
    const now = Date.now();
    
    // Check cache first
    if (cached && (now - cached.timestamp) < 30000) {
      setState({
        data: cached.data as ApiResponseType,
        loading: false,
        error: null,
      });
      return;
    }
    
    setState(prev => ({ ...prev, loading: true, error: null }));
    
    try {
      const result = await api.someEndpoint();
      globalCache.set(cacheKey, { data: result, timestamp: now });
      setState({ data: result, loading: false, error: null });
    } catch (error) {
      setState({
        data: null,
        loading: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }, []); // CRITICAL: Empty array - no function parameters in dependencies

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { ...state, refetch: fetchData };
}
```

**For Parameterized API Hooks** (search, filters, pagination):
```typescript
export function useParameterizedApi(params: RequestParams) {
  // Use useMemo for stable cache key based on params
  const cacheKey = React.useMemo(() => {
    return `api-${JSON.stringify(params)}`;
  }, [params]);

  const fetchData = React.useCallback(async () => {
    // Same pattern but include params in API call
    const result = await api.endpoint(params);
    // ... rest of implementation
  }, [cacheKey, params]); // Include params to refetch when they change
  
  // ... rest follows same pattern
}
```

**Key Rules for StrictMode Compatibility**:
- ✅ **Never** put function parameters in `useCallback` dependency arrays
- ✅ **Always** use empty `[]` dependencies for basic fetch functions  
- ✅ **Use global cache** (`globalCache`) for stability across re-renders
- ✅ **Use `useMemo`** for cache keys when parameters are involved
- ✅ **Include primitive params** in dependencies only when they should trigger refetch
- ❌ **Avoid** complex fetcher function parameters
- ❌ **Don't** put unstable references in dependency arrays

**Proven Working Examples**:
- `packages/web/src/hooks/useWorkingApi.ts` - Basic API hook
- `packages/web/src/hooks/useDeploymentsApi.ts` - Parameterized hook
- `packages/web/src/hooks/useSummaryApi.ts` - Reference implementation

### State Management
- React state for component-level data
- Shared state through React Context when needed
- API state managed through fetch with proper error handling
- No complex state management library unless absolutely necessary

### Error Handling
- Consistent error response format from API
- User-friendly error messages in UI
- Proper error boundaries in React components
- Logging for debugging and monitoring

### Component Patterns
```typescript
// Page components handle API integration
export const DeploymentDetail: React.FC = () => {
  const [deployment, setDeployment] = useState<DeploymentDetail | null>(null);
  
  const handleAction = async (action: 'start' | 'stop' | 'restart' | 'delete') => {
    // Use shared API constants and types
  };
  
  // Render with proper error states and loading indicators
};

// Reusable components focus on presentation
export const DeploymentCard: React.FC<{ deployment: DeploymentDetail }> = ({ deployment }) => {
  // Pure presentation component
};
```

## Documentation & Conventions

**Code Documentation**: TSDoc comments for public APIs, explain business logic and design decisions

**Commit Messages**: [Conventional Commits](https://www.conventionalcommits.org/) with workspace scope (`feat(web):`, `fix(server):`, `refactor(shared):`)

**Type Safety**: Always use shared types, never `any`, prefer strict TypeScript configuration

**Import Patterns**:
```typescript
// Always use workspace alias for shared package
import { API } from '@hola/shared';
import type { DeploymentDetail } from '@hola/shared';

// Separate type imports from value imports
import { someUtility } from '@hola/shared';
import type { SomeType } from '@hola/shared';
```

**File Organization**:
- Use descriptive names that match their purpose
- Group related functionality in directories
- Prefer flat structures over deep nesting
- Keep components focused and single-purpose

## Implementation Lessons & Best Practices

### API Evolution & Simplification
**Development API Deprecation** (September 2025):
- **Removed `/api/dev/*` endpoints**: Development-specific APIs (dev sessions, enhanced debugging) permanently removed to simplify codebase
- **Simplified API surface**: Reduced from ~50 to ~35 endpoints by eliminating development-specific functionality  
- **Standard workflows only**: All functionality must use production-ready patterns (Drafts, Deployments, SSE, Jobs)
- **No development middleware**: Removed API monitoring and development-specific middleware from server pipeline
- **Clean SSE events**: Removed `SSEDevSessionStatusEvent` and development-specific SSE event types

**API Cleanup Process**:
1. **Remove API endpoints** from server routing and shared constants
2. **Delete web components** that reference removed endpoints (dev dashboards, debug pages)
3. **Clean test files** - remove ALL tests for deprecated functionality, don't leave orphaned files
4. **Update SSE types** - remove event types and handlers for deprecated functionality
5. **Fix CLI commands** - update to use standard SDK methods (Draft workflow for validation)
6. **Clean CI/CD** - remove obsolete environment variables (`HOLA_ENABLE_DEV_API`) from workflows
7. **Verify health** - ensure all tests, linting, and builds pass after cleanup

**Architectural Decision Rationale**:
- Development APIs created complexity without sufficient value
- Standard Draft/Deployment workflows provide same functionality with better consistency
- Simplified API surface reduces maintenance burden and improves reliability
- Easier onboarding for new developers with fewer API patterns to learn

### Server Development & Testing
**Server Development & Testing**:
- **Standardized Test Environment**: Always use `helpers/test-environment` for server tests
- **In-Process Testing**: All tests run in-process for speed, reliability, and isolation
- **No Background Processes**: Never use `bun run dev &`, `kill %1`, or `pkill` patterns in tests
- **Feature Flag Testing**: Set environment variables in test setup, not external server processes
- **Health Verification**: In-process tests don't need health checks - they're always ready

**Feature Flag Testing**:
```bash
# ✅ Correct: Use standardized test environment  
import { setupTestEnvironment, teardownTestEnvironment } from '../helpers/test-environment';

beforeAll(async () => {
  await setupTestEnvironment({
    env: {
      HOLA_USE_REAL_DOCKER: 'true',
      HOLA_USE_REAL_DATABASE: 'true'
    }
  });
});

afterAll(async () => {
  await teardownTestEnvironment();
});

// Tests run in-process with configured environment
```

**Health Verification Pattern**:
- Always check `/healthz` endpoint before running tests
- Use `/api/system/health` to verify service factory status
- Check `/api/system/config` to confirm feature flag activation
- Verify specific service health before testing their endpoints

### Service Implementation Patterns

**Simplified Service Factory**:

- Environment-based service selection: 'test' uses all mocks, 'production' uses all real services
- No complex health monitoring, feature flags, or automatic fallback
- Simple `getServices()` and `resetServices()` API for all service access
- Services are instantiated based on environment detection (NODE_ENV, VITEST, HOLA_DISABLE_AUTOSTART)

**Service Access Pattern**:

```typescript
import { getServices } from './services/simple-factory';

// Get all services for current environment
const services = getServices();
const result = await services.storage.readFile('config.json');
```

**Minimal Feature Flags**:

- Only `useAuth` and `useObservability` flags remain
- All service selection is handled by environment detection
- No complex configuration matrix or service-specific flags

## Testing Strategies

**Simplified Testing Approach**:

- Use environment-based service selection for predictable test behavior
- Test environment automatically uses all mock services
- No need to configure complex feature flags or health monitoring
- Simple `resetServices()` call between tests ensures clean state

**Service Testing**:

- All services work predictably in their respective environments
- Mock services provide consistent behavior for reliable testing
- Real services are only used in production with no fallback complexity

**Integration Testing**:
- Start test servers with background processes
- Use realistic test data and scenarios
- Test SSE streams and real-time functionality
- Verify performance under load

### SSE (Server-Sent Events) Implementation
**Real-time Streaming Best Practices**:
- Use callback-based monitoring for real data
- Implement fallback to mock streams when real services fail
- Use standardized event format with type and data fields
- Configure appropriate update intervals (5-second default)
- Handle client disconnections gracefully

### Database & Storage Patterns
**SQLite Best Practices**:
- Use WAL mode for better concurrency
- Implement proper transaction management
- Handle migration versioning with rollback support
- Use repository pattern for data access abstraction

**File System Operations**:
- Use atomic file writes for configuration persistence
- Create directory structures idempotently
- Implement proper file locking and cleanup
- Handle permissions and disk space errors gracefully

### Monitoring & Observability
**Structured Logging**:
- Use request correlation IDs across all operations
- Log service access and environment detection
- Include relevant context in log messages
- Use appropriate log levels (debug, info, warn, error)

**Metrics Collection**:
- Track basic service access patterns
- Monitor API response times and error rates
- Measure resource usage (memory, disk, CPU)
- Simple metrics without complex health state tracking

### Progressive Deployment
**Phase-by-Phase Implementation**:
- Complete each phase fully before moving to next
- Maintain backward compatibility throughout
- Use feature flags for safe rollout
- Test integration between phases

**Rollback Strategies**:
- Always provide fallback to previous phase
- Test rollback scenarios thoroughly
- Document rollback procedures
- Monitor system health during transitions

### External Tool Integration
**Docker Integration Lessons**:
- Check Docker client and server availability separately
- Handle Docker unavailability gracefully with clear error messages
- Use proper timeouts for Docker operations
- Implement log streaming with proper cleanup

**System Resource Monitoring**:
- Use system commands (`df`, `/proc/meminfo`) for real data
- Provide meaningful fallback estimates when commands fail
- Parse command output defensively
- Cache resource data appropriately to reduce system load
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
# CRITICAL: Always start server in background for testing and integration work
cd packages/server && bun run dev &    # Start server in background with &
sleep 3                                # Wait for server to start
curl http://localhost:3001/healthz     # Test server is running
kill %1                                # Stop background server when done

# Alternative: Use pkill for cleanup
pkill -f "bun run dev"                 # Kill any remaining bun dev processes

# For API testing with feature flags
HOLA_USE_REAL_DOCKER=true bun run dev & # Enable specific features
# Always verify server health before running tests
curl http://localhost:3001/healthz || echo "Server not ready"

# NEVER run server without & when testing - it will block terminal
# ALWAYS verify server is running before running tests against it
```

**Development Flow**:
1. **🚨 CODE QUALITY FIRST - NON-NEGOTIABLE**: ALWAYS run linting and type checking before committing - work is incomplete if linting fails
2. Define types in `packages/shared/src/index.ts`
3. Implement API endpoints in `packages/server/`
4. Create StrictMode-compatible hooks using proven patterns from `useWorkingApi.ts` 
5. Build UI components in `packages/web/` using the API hooks
6. Test integration between frontend and backend
7. **🚨 FINAL CHECK - MANDATORY**: Ensure linting, type checking, and tests pass 100% before committing - NO EXCEPTIONS

**Testing API Integration**:
- Always start the server in background mode when testing API calls
- Use `cd packages/server && bun run dev &` (with ampersand) for background execution
- Wait 3-5 seconds for server startup before running tests
- Test endpoints with curl before running test suites to verify connectivity
- Use `kill %1` or `pkill -f "bun run dev"` to stop background processes when done
- Verify server health with `/healthz` endpoint before running contract tests
- For feature testing, set environment variables before starting server

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

### Server Development & Testing
**Background Process Management**:
- **ALWAYS** use `&` (ampersand) when starting servers for testing
- **NEVER** run `bun run dev` without `&` in testing scenarios - it blocks the terminal
- Wait 3-5 seconds after starting server before running tests
- Verify server health with `curl http://localhost:3001/healthz` before proceeding
- Use `kill %1` or `pkill -f "bun run dev"` for cleanup

**Feature Flag Testing**:
```bash
# Start server with specific feature flags enabled
HOLA_USE_REAL_DOCKER=true HOLA_USE_REAL_DATABASE=true bun run dev &
sleep 3
curl http://localhost:3001/api/system/health  # Verify services are healthy
bun test __tests__/phase4-contract.test.ts    # Run tests
kill %1  # Cleanup
```

**Health Verification Pattern**:
- Always check `/healthz` endpoint before running tests
- Use `/api/system/health` to verify service factory status
- Check `/api/system/config` to confirm feature flag activation
- Verify specific service health before testing their endpoints

### Service Implementation Patterns
**Service Factory Integration**:
- All real services must implement `HealthCheckable` interface
- Use health monitoring for ongoing service health tracking
- Register services with descriptive names and appropriate health check intervals
- Test both healthy and unhealthy service states

**Feature Flag Implementation - Fail-Fast Approach**:
- Default all feature flags to `false` for safety
- Use environment variables for activation (`HOLA_USE_REAL_*=true`)
- **CRITICAL**: When a `USE_REAL` flag is enabled, the service MUST be healthy or startup fails
- **NO automatic fallback** to mocks when real implementations are explicitly requested
- **Fail-fast validation**: Real services are health-checked at startup before server starts
- Provide clear error messages with remediation steps when real services fail

**Fail-Fast Error Handling**:
- When `HOLA_USE_REAL_*=true` and the service fails: **throw an error and abort startup**
- Error messages must include:
  - Which dependency failed and why
  - How to fix the real dependency (e.g., "install Docker")
  - How to disable the flag to use mocks (`export HOLA_USE_REAL_DOCKER=false`)
- **Never silently pivot** from real to mock implementations when real flag is enabled
- Use structured logging with request correlation IDs
- Implement timeout and retry logic for external commands during health checks

**Service Startup Validation**:
- Real services are validated before server startup via `validateRealServices()`
- Health checks are performed on all enabled real services
- Server startup fails immediately if any real service is unhealthy
- Clear, actionable error messages guide operators to resolution

### Testing Strategies
**Contract Testing**:
- Test both mock and real implementations against same contracts
- Verify API compatibility across all phases
- Use dedicated test servers with different feature flag configurations
- Test fail-fast scenarios where real services are unavailable

**Service Testing**:
- Test service health checks and failure scenarios
- **Test fail-fast behavior**: Verify server startup fails when real flag enabled but service unhealthy
- Test feature flag activation and deactivation
- Test error message clarity and actionability
- Mock external dependencies appropriately

**Fail-Fast Testing**:
- Verify server fails to start when `HOLA_USE_REAL_*=true` but dependency unavailable
- Test error messages include both fix and disable options
- Confirm no silent fallback from real to mock when real flag enabled
- Test startup validation catches service issues before server accepts requests

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
**Health Check Implementation**:
- Implement comprehensive health checks for all services
- Include timestamps in health status responses
- Test actual functionality, not just service availability
- Aggregate health status in service factory

**Structured Logging**:
- Use request correlation IDs across all operations
- Log service activation, fallback, and health events
- Include relevant context in log messages
- Use appropriate log levels (debug, info, warn, error)

**Metrics Collection**:
- Track service health status changes
- Monitor API response times and error rates
- Count service activations and fallbacks
- Measure resource usage (memory, disk, CPU)

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
# GitHub Copilot Instructions

## Overview

TypeScript monorepo for application deployment platform with:
- **Bun Server** - Backend API with modern TypeScript and async patterns
- **React Web Frontend** - SPA with Tailwind CSS for responsive UI
- **Shared Types** - Centralized type definitions and API constants
- **Workspace Architecture** - Organized monorepo with clear separation of concerns

## Core Principles

- **Modern TypeScript**: Strict typing, ESNext features, workspace references
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

**Development Server**:
```bash
# IMPORTANT: When testing API integration, always start server in background
cd packages/server && bun run dev &    # Start server in background with &
curl http://localhost:3001/api/health  # Test server is running
kill %1                                # Stop background server when done

# Alternative: Use the isBackground parameter in run_in_terminal tool
# run_in_terminal with isBackground: true for long-running processes
```

**Development Flow**:
1. Define types in `packages/shared/src/index.ts`
2. Implement API endpoints in `packages/server/`
3. Create StrictMode-compatible hooks using proven patterns from `useWorkingApi.ts` 
4. Build UI components in `packages/web/` using the API hooks
5. Test integration between frontend and backend
6. Ensure type safety across the entire stack

**Testing API Integration**:
- Always start the server in background mode when testing API calls
- Use `cd packages/server && bun run dev &` or `isBackground: true` in terminal tools
- Test endpoints with curl before running frontend tests
- Remember to stop background processes when done (`kill %1` or similar)

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
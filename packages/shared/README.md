# @hola/shared

TypeScript types, API route constants, and small HTML/docs generators shared across the Hola monorepo. This package is the single source of truth for the REST contract used by `@hola/server`, `@hola/web`, `@hola/cli`, and `@hola/sdk`.

## How It Fits
- Role: Define API shapes end-to-end and reduce drift between server and clients.
- Exports: `API` route map, request/response models, SSE event types, pagination helpers, and documentation utilities (OpenAPI + UI generators).
- Consumers: Frontend hooks, CLI commands, SDK methods, and server route handlers all import from here.

## Key Exports
- `API`: Path builders like `API.deployments.byId(id)` and constants like `API.health`.
- Types: `DeploymentDetail`, `GetDeploymentsResponse`, `PostDeploymentActionRequest`, `SSEEvent`, etc.
- Docs helpers: `generateOpenAPISpec()`, `generateSwaggerUI()`, `generateReDocUI()`, `generateExamplesHTML()`.

Keeping these contracts centralized ensures:
- Type-safe API calls in the web app and SDK
- Server and clients evolve together without breaking changes
- Contract tests can rely on a single set of definitions

## Usage
```ts
import { API, type GetDeploymentsResponse } from '@hola/shared';

fetch(API.deployments.base)
  .then(r => r.json() as Promise<GetDeploymentsResponse>)
  .then(({ items }) => items.forEach(d => console.log(d.name)));
```

No runtime dependencies are required; this package ships pure TypeScript types and constants.

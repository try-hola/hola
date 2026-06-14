# @hola/sdk

Lightweight TypeScript client for the Hola API with first-class type safety via `@hola/shared`. Useful for Node scripts, tooling, or backend integrations that prefer a programmatic interface over raw fetch calls.

## How It Fits
- Role: Programmatic wrapper around the Hola REST API.
- Contract-first: Re-exports request/response types from `@hola/shared` and builds URLs using `API` constants.
- Consumers: Automation scripts, tests, external tools, or the CLI when deeper composition is useful.

## Quick Start
```ts
import { HolaSdk } from '@hola/sdk';

const sdk = new HolaSdk({ baseUrl: 'http://localhost:3001', token: process.env.HOLA_TOKEN });
const deployments = await sdk.deployments.list({ page: 1, limit: 10 });
console.log(deployments.items.map(d => d.name));
```

## Configuration
- `baseUrl`: API base URL (defaults to `process.env.HOLA_API_URL` or `http://localhost:3001`).
- `token`: Optional bearer token (`process.env.HOLA_TOKEN`).
- `fetchImpl`: Custom `fetch` implementation for non-DOM runtimes.

## Capabilities
- System: health, summary, config
- Drafts: create/get/update, file uploads, validate/finalize
- Deployments: create from draft, list/get/update/delete, history, actions, rollback, logs
- Jobs: get and stream logs, list by deployment/status
- Validation: compose validation
- Bundles: import/register

All responses and inputs are fully typed using `@hola/shared` models.

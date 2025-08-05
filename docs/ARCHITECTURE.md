# Hola Architecture

Packaging and defaults
- Hola runs as a Dockerized service with a bind mount to /var/run/docker.sock.
- Frontend is a React SPA served by a minimal TypeScript backend or static file server.
- Backend and services are implemented in TypeScript (Node.js), avoiding Python to keep a single language stack.
- OCI artifacts are pulled with ORAS CLI via subprocess.
- Secrets are stored in a locally encrypted file at rest.
- Backups are tar.gz archives under ~/.hola/backups with retention of 7 per deployment.
- Ingress and authentication are provided by Traefik and Authentik, deployed alongside Hola via docker compose.

System overview
- Deployment model: A docker compose stack including Hola (Node.js API + React SPA), Traefik (reverse proxy), and Authentik (identity provider). Traefik terminates TLS and forwards to Hola; Authentik provides authentication and SSO via forward-auth or OIDC middleware.
- Core subsystems:
  - Frontend: React SPA for catalog browsing, install wizard, lifecycle, backups, notifications.
  - Backend API: TypeScript Node.js services to orchestrate catalog, OCI pulls, bundle expansion and validation, compose runtime, jobs, backups, logs/metrics, and integration with Authentik for identity.
  - Storage: ~/.hola with structured directories; sqlite for catalog index and search; encrypted secrets store; job logs; deployment state.
  - Runtime: Docker engine with docker compose v2; project names derived from deployments to avoid collisions.
  - Ingress and Auth: Traefik routes HTTPS traffic; Authentik handles authentication and provides identity to Hola.

Repository alignment
- Current Python files remain as historical reference; future implementation prefers TypeScript equivalents.
- New Node.js backend directory proposal:
  - server/
    - src/
      - api/
      - services/
      - models/
      - utils/
      - web/ (optional static serving of SPA)
    - package.json, tsconfig.json, eslint, etc.
- SPA lives in web/ with React + Vite:
  - web/
    - src/
    - dist/ (built assets served by server or static container)
- Provisioning scripts:
  - deploy/
    - docker-compose.yml (Hola + Traefik + Authentik)
    - .env.example (Traefik, Authentik, and Hola settings)
    - install.sh (idempotent setup script; generates secrets, writes .env, boots stack)

Customization services and endpoints (pre-deploy wizard)
Purpose
- Enable users to customize environment variables, compose overrides, additional files, and advanced options before finalizing deployment, with real-time validation and a resumable draft.

Key concepts
- Draft: a pre-deployment object representing a specific app/version customization in progress.
- Uploads: temporary stored files associated with a draft until finalized.
- Validation: synchronous checks (schema, YAML syntax) and asynchronous preflight (ports, docker readiness, disk space).

Data models (TypeScript)
- Draft
  - draftId: string
  - appId: string
  - version: string
  - env: Array<{ key: string; value: string; isSecret?: boolean }>
  - overrideComposeUploadId?: string
  - additionalUploadIds: string[]
  - advanced?: {
      ports?: Array<{ host: number; container: number; protocol?: string }>
      volumes?: Array<{ hostRelPath: string; containerPath: string; readOnly?: boolean }>
    }
  - createdBy: string (from Authentik identity headers)
  - createdAt: string
  - updatedAt: string
  - validation: {
      errors: Array<{ field: string; message: string }>
      warnings: Array<{ field: string; message: string }>
    }
  - status: 'editing' | 'validated' | 'submitted'
- Upload
  - uploadId: string
  - draftId: string
  - kind: 'composeOverride' | 'additionalFile'
  - filename: string
  - mime: string
  - size: number
  - path: string (temp storage)
  - createdAt: string

API surface for customization (Express/Fastify)
- Draft lifecycle
  - POST /api/drafts
    - body: { appId, version }
    - returns: { draftId, defaultEnvSchema, defaults } for UI initialization
  - GET /api/drafts/:draftId
    - returns current draft state and validation results
  - PATCH /api/drafts/:draftId
    - body: partial Draft fields (env, advanced, etc.); merges and revalidates
  - DELETE /api/drafts/:draftId
    - cleans up uploads and temporary storage
- Uploads attached to drafts
  - POST /api/drafts/:draftId/uploads?kind=composeOverride
    - multipart/form-data; returns { uploadId }
  - POST /api/drafts/:draftId/uploads?kind=additionalFile
    - returns { uploadId }
  - DELETE /api/drafts/:draftId/uploads/:uploadId
- Validation and preflight
  - POST /api/drafts/:draftId/validate
    - synchronous checks: env schema, YAML syntax, file constraints
    - returns: { ok: boolean, errors[], warnings[] }
  - POST /api/drafts/:draftId/preflight
    - runs docker-dependent checks: port collisions, compose config, image references, disk space
    - returns: { ok: boolean, checks: Array<{ name: string, status: 'ok' | 'warn' | 'fail', detail?: string }> }
- Finalize and deploy
  - POST /api/drafts/:draftId/finalize
    - persists a snapshot of the draft; returns a frozen spec to be used for install
  - POST /api/deployments
    - body: { draftId } or inline equivalent of the finalized customization
    - creates an install job and returns { jobId, deploymentId }

Post-deploy configuration changes using Drafts
Goal
- Support safe, auditable modification of a deployment’s configuration (env, overrides, files, advanced options) after initial install, with preview, validation, and zero or low downtime apply.

Concept: Change Draft
- A Change Draft is a draft bound to an existing deploymentId and a base configuration snapshot. It allows iterative editing, validation, and staged apply.
- On apply, a new generation of the deployment configuration is created, enabling rollback.

Data models (TypeScript)
- ChangeDraft extends Draft with:
  - deploymentId: string
  - baseGeneration: number  (the generation of the deployment when the draft was created)
  - targetReleaseVersion?: string  (optional upgrade path)
  - strategy: 'inplace' | 'blueGreen' (default 'inplace' for config-only; 'blueGreen' for upgrades)
  - notes?: string
  - status: 'editing' | 'validated' | 'submitted' | 'applied' | 'aborted'
- Deployment state
  - Add fields to state.json:
    - generation: number
    - history: Array<{
        generation: number
        timestamp: string
        user: string
        changesSummary: string
        draftId?: string
        jobId?: string
      }>

API surface for post-deploy changes
- Create and manage change drafts
  - POST /api/deployments/:deploymentId/drafts
    - body: { targetReleaseVersion?, strategy? }
    - returns: { draftId, baseGeneration, currentConfig, defaultEnvSchema }
  - GET /api/deployments/:deploymentId/drafts/:draftId
  - PATCH /api/deployments/:deploymentId/drafts/:draftId
    - same shape as pre-deploy PATCH; edits env, advanced, uploads
  - POST /api/deployments/:deploymentId/drafts/:draftId/validate
  - POST /api/deployments/:deploymentId/drafts/:draftId/preflight
  - POST /api/deployments/:deploymentId/drafts/:draftId/finalize
- Apply change draft
  - POST /api/deployments/:deploymentId/apply
    - body: { draftId }
    - creates a job:
      - strategy 'inplace': stop impacted services if needed, write new .env/overrides, docker compose up -d
      - strategy 'blueGreen': prepare clone with new generation name, bring up, health check, switch, then tear down old
    - returns { jobId, newGeneration }
- Rollback
  - POST /api/deployments/:deploymentId/rollback
    - body: { toGeneration }
    - re-materializes .env/overrides/files for the selected generation and restarts the stack
- Diff and preview
  - GET /api/deployments/:deploymentId/diff?draftId=...
    - returns structured diff across .env values (keys redacted), compose override changes, and file additions/removals
- Audit history
  - GET /api/deployments/:deploymentId/history
    - returns history entries with generation info and related jobs

Backend services supporting post-deploy changes
- ChangeDraftService
  - createChangeDraft(deploymentId, options)
  - load current effective config (compose merged, .env, files) as baseline
  - update and validate like DraftService
- DeploymentService (extended)
  - applyChangeDraft(deploymentId, draft, strategy) -> job
  - computeDiff(deploymentId, draft)
  - materializeGeneration(deploymentId, generationSpec)
- JobService
  - executes 'change-apply' and 'rollback' jobs with SSE updates
- Versioning and storage
  - ~/.hola/apps/<appId>/deployments/<deploymentId>/
    - generations/
      - gen-0001/
        - compose.yaml
        - overrides.yaml
        - .env
        - files/
        - manifest.json  (hashes, sizes, metadata)
      - gen-0002/ ...
    - current -> symlink or pointer file with current generation
  - On each apply, write a new generation directory with immutable contents. The runtime always uses the 'current' pointer.

Safety and validation
- Concurrency guard: only one change draft can be 'submitted' per deployment at a time.
- Base generation check: if baseGeneration != current generation, surface conflict and require rebase or recreate the draft from the latest generation.
- Secrets handling: preserve secret values not explicitly changed; redaction in diffs and logs.
- Preflight for changes mirrors initial preflight, scoped to impacted ports and resources.

UI/UX for post-deploy edits
- On a deployment detail page:
  - Button: Create change draft
  - Editor: same components as initial wizard; pre-filled from current config
  - Tabs: Validate, Preflight, Diff, Summary
  - Apply strategies:
    - In-place for minor config changes
    - Blue/Green for version upgrades or risky changes
  - History view with per-generation entries and rollback action

End-to-end flows
- Post-deploy config change
  1) Create change draft -> edit -> validate -> preflight -> finalize
  2) Apply change draft -> Job runs -> generation incremented -> history updated -> SSE signals success
- Upgrade to new release version
  1) Create change draft with targetReleaseVersion set
  2) Pull new bundle if needed, compute migration of env keys, re-apply overrides
  3) Strategy blueGreen -> cutover on healthy target
- Rollback
  1) Choose previous generation -> rollback job -> runtime switches to previous generation

Security and auth
- All draft/change operations require Authentik-authenticated identity
- Authorization model:
  - MVP: all authenticated users can manage drafts and changes
  - Future: restrict change/rollback by Authentik groups/roles
- Logging and audit trails:
  - Include user identity and draftId in all job logs and history entries

Observability
- Metrics:
  - count of active drafts and change drafts
  - validation/preflight failure rates
  - apply durations and success rate
  - rollback count
- Logs:
  - Correlate by draftId, deploymentId, jobId; secrets redacted

Existing sections unchanged (catalog, OCI, runtime, backups, installer, ingress, etc.) remain as previously defined.

Mermaid architecture
flowchart TD
  Client[React SPA] --> Traefik[Traefik reverse proxy]
  Traefik --> Authentik[Authentik identity]
  Traefik --> API[Hola API TypeScript]
  API --> Drafts[DraftService]
  API --> ChangeDrafts[ChangeDraftService]
  API --> Uploads[UploadService]
  API --> Validate[ValidationService]
  API --> Preflight[PreflightService]
  API --> Catalog[CatalogService sqlite FTS]
  API --> Jobs[JobService SSE]
  API --> Bundle[BundleService]
  Bundle --> Registry[ORAS pull OCI]
  Bundle --> FS[~/.hola storage]
  API --> Runtime[DockerComposeAdapter]
  Runtime --> Docker[docker.sock]
  API --> Backup[BackupService]
  API --> Secrets[SecretStore]
  API --> AuthZ[Headers from Authentik]
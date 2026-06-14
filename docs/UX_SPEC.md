# Hola Website UX Spec

> **Historical / aspirational.** This UX spec (including marketing-site scope and
> any phase or OrbStack references) predates the production-recovery epic and
> does not all reflect the implemented product. For the current system see
> [ARCHITECTURE.md](ARCHITECTURE.md) and [OPERATIONS.md](OPERATIONS.md).

Scope: Marketing site (M1–M6) and Product SPA (S1–S10)
Deliverables: Low-fidelity ASCII wireframes + structured descriptions and acceptance criteria
Design direction: Dark-first high-contrast theme, accessible tokens. Link out to GitHub docs for MVP.
Alignment: docs/PRD.md and ARCHITECTURE.md

Overview
- Marketing website: Home, Features, Catalog Preview, Download/Install, Community, Footer.
- SPA (behind Traefik/Auth/Authentik): Dashboard, Catalog, Install Wizard, Deployments, Backups, Notifications, Settings.

Navigation Model (Mermaid)
flowchart TD
  A[Marketing Home] --> B[Features]
  A --> C[Catalog Preview]
  A --> D[Download Install]
  A --> E[Docs Link to GitHub]
  A --> F[Community]
  D --> G[Run Hola - Local SPA]
  G --> H[Traefik/Auth redirect]
  H --> I[SPA Dashboard]
  I --> J[Catalog]
  J --> K[Install Wizard]
  I --> L[Deployments]
  L --> M[Deployment Detail]
  M --> N[Change Draft]
  M --> O[History Rollback]
  I --> P[Backups]
  I --> Q[Notifications]
  I --> R[Settings]

Design Tokens (initial proposal)
- Color (dark-first): 
  --surface-0: #0B0E14, --surface-1: #111520, --surface-2: #161B2A
  --text-strong: #E8ECF1 (AA on surface-1), --text-muted: #A8B3C2
  --primary: #5B8CFF, --primary-contrast: #0B0E14
  --success: #4CC38A, --warning: #F5A524, --danger: #E5484D, --info: #78A9FF
  --border: #24314A
- Typography:
  --font-sans: Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace
  Sizes: 12, 14, 16, 18, 20, 24, 32 (1.25 line-height body, 1.3 headings)
- Spacing: 4px base grid (4, 8, 12, 16, 24, 32, 48)
- Radius: 8px default, 12px modals
- Elevation: 0, 1 (border), 2 (shadow-sm), 4 (shadow-md)
- Focus: 2px outline #78A9FF with 2px offset, meets WCAG 2.4.7
- Motion: Respect prefers-reduced-motion; use 120–160ms ease-out base

Accessibility Standards
- All text contrast AA; critical labels AAA where feasible
- Fully navigable by keyboard with visible focus indicators
- ARIA labeling for tabs, stepper, job status live regions (aria-live=polite)
- Link purpose clear from text alone
- Secrets masked, toggle announced to screen readers

------------------------------------------------------------
MARKETING PAGES (M1–M6)
------------------------------------------------------------

M1: Home (Hero + Value + CTA)
ASCII Wireframe
+--------------------------------------------------------------------------------+
| [Logo Hola]                                             [GitHub] [Docs] [CTA]  |
|                                                                                |
|    Hola: Home Lab App Deployment Platform                                      |
|    [ Value proposition, 1–2 lines ]                                            |
|    [ Install CTA ]      [ View Catalog Preview ]                               |
|                                                                                |
|  [ Screenshot: Dashboard ]   [ Screenshot: Install Wizard ]                    |
|                                                                                |
|  [ 3 feature highlights in cards: Catalog | One-click Install | Backups ]      |
|                                                                                |
|  [ Social proof: GitHub stars | contributors ]                                 |
|                                                                                |
|  [ Footer: Docs | Community | License | Privacy ]                              |
+--------------------------------------------------------------------------------+

Structured Description
- Header: Logo, Nav (Features, Catalog Preview, Install, Docs link, GitHub), primary CTA Install
- Hero: Title + TL;DR aligned with PRD; subtitles emphasize ease for home lab users
- Screenshots: Dashboard and Install Wizard previews
- Feature cards: succinct copy, icons
- Social proof: GitHub badges
- Footer: links and basic legal

Acceptance Criteria
- Install CTA anchors to Download/Install page
- All interactive elements reachable by keyboard; focus visible
- Images have descriptive alt text
- Responsive: two-column screenshots collapse to stacked on narrow width

M2: Features
ASCII Wireframe
+--------------------------------------------------------------------------------+
| [Header]                                                                       |
|  Features                                                                      |
|  [ Grid of 6 feature tiles ]                                                   |
|   - Catalog  - Install Wizard  - Monitoring  - Backups  - Notifications  -    |
|     Security/Privacy                                                           |
|                                                                                |
|  [ Section: How it works (3 steps with icons) ]                                |
|  [ CTA: Install now ]                                                          |
|  [ Footer ]                                                                    |
+--------------------------------------------------------------------------------+

Acceptance Criteria
- Feature tiles link to anchors on page with more detail
- Copy aligns with PRD: minimal setup, monitoring, backups, notifications
- CTA leads to Install

M3: Catalog Preview
ASCII Wireframe
+--------------------------------------------------------------------------------+
| [Header]                                                                       |
|  Catalog Preview [Search_________________] [Filters v]                          |
|                                                                                |
|  [ AppCard ] [ AppCard ] [ AppCard ] [ AppCard ]                               |
|  [ AppCard ] [ AppCard ] [ AppCard ] [ AppCard ]                               |
|                                                                                |
|  [ Note: Full catalog available in app ] [ CTA: Run Hola ]                     |
|  [ Footer ]                                                                    |
+--------------------------------------------------------------------------------+

AppCard minimal:
[Icon] App Name
Short description (1 line)
[Learn more] [Install in Hola]

Acceptance Criteria
- Search is client-side filter on the preview list
- Clicking Install in Hola explains the app runs locally (no remote install)
- Clear path to run Hola

M4: Download/Install
ASCII Wireframe
+--------------------------------------------------------------------------------+
| [Header]                                                                       |
|  Install Hola                                                                  |
|  Requirements: OrbStack (Phase 1), Docker Compose v2                           |
|  Quickstart:                                                                   |
|   1. curl -fsSL https://get.hola.sh | sh                                       |
|   2. docker compose up -d                                                      |
|  [ Code block copy button ]                                                    |
|  [ Troubleshooting / FAQ link ]                                                |
|  [ Footer ]                                                                    |
+--------------------------------------------------------------------------------+

Acceptance Criteria
- Copy-to-clipboard buttons for commands
- Explicit prerequisites list
- Link to GitHub docs

M5: Community
ASCII Wireframe
+--------------------------------------------------------------------------------+
| [Header]                                                                       |
|  Community                                                                      |
|  [ GitHub stars, issues, PRs, contributors ]                                   |
|  [ Links: Discord/Forum ]                                                      |
|  [ Contributing guide link ]                                                   |
|  [ Footer ]                                                                    |
+--------------------------------------------------------------------------------+

M6: Footer (shared)
- Links: Docs (GitHub), License, Privacy, Community, GitHub
- Small print; consistent across pages

------------------------------------------------------------
SPA SCREENS (S1–S10)
------------------------------------------------------------

S1: Login Redirect Screen
ASCII Wireframe
+--------------------------------------------------------------------------------+
| [Hola Logo]                                                                     |
|  Redirecting to Auth...                                                         |
|  [ If blocked: Link to Authentik login ] [ Help ]                               |
+--------------------------------------------------------------------------------+

Acceptance Criteria
- If Auth headers not present, show link to Authentik
- Provide help link to docs

S2: Dashboard Overview
ASCII Wireframe
+--------------------------------------------------------------------------------+
| [Sidebar] Dashboard | Catalog | Deployments | Backups | Notifications | Settings|
| [Topbar] Search         [User]                                                  |
|                                                                                |
| [ KPIs: Active Deployments ] [ Jobs Running ] [ Alerts ]                       |
|                                                                                |
| [ Recent Jobs stream ] [ Notifications summary ]                               |
|                                                                                |
| [ Quick actions: Install first app | Open Catalog ]                            |
+--------------------------------------------------------------------------------+

Acceptance Criteria
- Shows recent jobs via SSE (JobService)
- Cards link to respective sections
- Empty state prompts if no deployments

S3: Catalog Grid/List + Detail
ASCII Wireframe
+--------------------------------------------------------------------------------+
| [Sidebar] [Topbar search/filter]                                                |
| Catalog [Search__________] [Filter v] [Grid/List toggle]                        |
|                                                                                |
| [ AppCard x 12 ]                                                                |
|                                                                                |
| [ Right panel: App Detail ]                                                     |
|  - Icon, Name, Short desc, Screenshots, Resources, Ports, Env schema preview    |
|  [ Install ] [ View YAML schema ]                                               |
+--------------------------------------------------------------------------------+

Acceptance Criteria
- Search debounced, list reflects sqlite-backed index via API
- App Detail opens in panel or separate route
- Install button begins S4 wizard flow creating Draft

S4: Install Wizard (6 steps)
Stepper: Env → Compose Override → Additional Files → Advanced → Validate/Preflight → Summary/Confirm

S4.1 Env Variables
ASCII Wireframe
+--------------------------------------------------------------------------------+
| Env Variables                                                                   |
| [ + Add Row ]                                                                   |
| | Key         | Value            | Secret [ ] | Description (help icon) |      |
| |-------------|------------------|------------|--------------------------|      |
| | POSTGRES_DB | mydb             | [ ]        |                          |      |
| | PASSWORD    | ********         | [x]        |                          |      |
|                                                                                |
| [ Import .env ] [ Paste block ]                                                |
| [ Next ]                                                                        |
+--------------------------------------------------------------------------------+

Acceptance Criteria
- Required fields validated; secret masking toggle
- PATCH /api/drafts/:draftId on change with optimistic UI
- Import .env parses KEY=VALUE lines

S4.2 Compose Override Upload
ASCII Wireframe
+--------------------------------------------------------------------------------+
| Compose Override                                                                |
| [ Drag & drop YAML here or Browse ]                                         |
| [ Parsed overview: services, volumes, ports ]                                   |
| [ Remove / Replace ]                                                            |
| [ Next ] [ Back ]                                                               |
+--------------------------------------------------------------------------------+

Acceptance Criteria
- POST upload with kind=composeOverride; show filename, size
- Syntax validation client-side then server validate API available in next step

S4.3 Additional Files
ASCII Wireframe
+--------------------------------------------------------------------------------+
| Additional Files                                                                |
| [ Drag & drop files ]  [ List of files with remove ]                       |
| [ Next ] [ Back ]                                                               |
+--------------------------------------------------------------------------------+

Acceptance Criteria
- Multiple uploads allowed; track uploadIds

S4.4 Advanced Options
ASCII Wireframe
+--------------------------------------------------------------------------------+
| Advanced                                                                        |
| Ports                                                                           |
| [ + Add Port ]                                                                  |
| | Host | Container | Protocol[v] | Collision hint                              |
| Volumes                                                                         |
| [ + Add Volume ]                                                                |
| | Host rel path | Container path | RO [ ] | Exists? hint                        |
| [ Next ] [ Back ]                                                               |
+--------------------------------------------------------------------------------+

Acceptance Criteria
- Form maps to Draft.advanced.ports/volumes
- Inline hints from basic local checks

S4.5 Validate & Preflight
ASCII Wireframe
+--------------------------------------------------------------------------------+
| Validate                                                                        |
| [ Run Validate ]  [ Run Preflight ]                                             |
| Results:                                                                        |
|  - Env schema: ok/fail with messages                                            |
|  - YAML syntax: ok/fail                                                         |
|  - Files constraints: ok/warn/fail                                              |
|  - Docker readiness: ok/fail                                                    |
|  - Port collisions: ok/warn/fail                                                |
|                                                                               |
| [ Next ] [ Back ]                                                               |
+--------------------------------------------------------------------------------+

Acceptance Criteria
- Calls POST /validate and POST /preflight
- Errors link back to specific fields
- Must pass ok to proceed (warnings allowed)

S4.6 Summary & Confirmation
ASCII Wireframe
+--------------------------------------------------------------------------------+
| Summary                                                                         |
| Env (secrets redacted)                                                          |
| Overrides: diff highlights                                                      |
| Files: list                                                                     |
| Ports/Volumes: table                                                            |
| [ Confirm & Install ]                                                       |
+--------------------------------------------------------------------------------+

Acceptance Criteria
- POST /finalize then POST /api/deployments to create job
- Transition to S6 or S5 based on success

S5: Deployments List
ASCII Wireframe
+--------------------------------------------------------------------------------+
| Deployments                                                                     |
| [ Search ] [ Filter status ]                                                    |
| [ DeploymentCard x N ]                                                          |
+--------------------------------------------------------------------------------+

DeploymentCard:
[Icon] Name  Status pill  Last updated
[ Start ] [ Stop ] [ Restart ] [ Update ] [ Uninstall ]
[ Open ] [ View logs ]

Acceptance Criteria
- Batch actions disabled for initial MVP
- Real-time status from Metrics/Logs where feasible

S6: Deployment Detail with Tabs
Tabs: Overview | Logs | Metrics | Backups | Configuration | History

ASCII Wireframe
+--------------------------------------------------------------------------------+
| Header: [Icon] App Name   Status pill   Actions (Start/Stop/Restart/Update)     |
| Tabs: Overview | Logs | Metrics | Backups | Configuration | History             |
|                                                                                 |
| Overview: endpoints, ports, quick stats                                         |
| Logs: stream with filters, pause, search                                        |
| Metrics: CPU, Mem, Net charts                                                   |
| Backups: schedule, run now, restore                                             |
| Configuration: current env, overrides, files; [Create change draft]             |
| History: generations table; [Rollback]                                          |
+--------------------------------------------------------------------------------+

Acceptance Criteria
- Change Draft button begins S7
- History shows generation entries and rollback action

S7: Change Draft Editor
ASCII Wireframe
+--------------------------------------------------------------------------------+
| Change Draft                                                                    |
| Stepper like S4 with pre-filled values                                          |
| Strategy: [ In-place ] [ Blue/Green ]                                           |
| [ Validate ] [ Preflight ] [ Finalize ] [ Apply ]                               |
+--------------------------------------------------------------------------------+

Acceptance Criteria
- Mirrors Draft but bound to deploymentId
- POST /apply returns jobId and newGeneration

S8: Backups
ASCII Wireframe
+--------------------------------------------------------------------------------+
| Backups                                                                         |
| Global schedule: [ cron preset ] [ retention ]                                  |
| [ Save ]                                                                         |
| Per-app: table with Run now / Restore                                           |
+--------------------------------------------------------------------------------+

Acceptance Criteria
- Global schedule stored via API; per-app actions connect to BackupService
- Restore flow shows confirmation and potential downtime note

S9: Notifications Center
ASCII Wireframe
+--------------------------------------------------------------------------------+
| Notifications                                                                   |
| [ Filter: updates | errors | backup ] [ Dismiss all ]                            |
| List: [Item] [Snooze] [Dismiss]                                                 |
+--------------------------------------------------------------------------------+

Acceptance Criteria
- Integrates in-app notifications; email later per PRD
- Snooze clears temporarily in UI state

S10: Settings
ASCII Wireframe
+--------------------------------------------------------------------------------+
| Settings                                                                        |
| System info (versions, runtime)                                                 |
| Integrations: Authentik status, Traefik status                                  |
| Analytics: [ ] Opt-in                                                           |
| Theme: [ Dark | Light ]                                                         |
| Profile: read from identity headers                                             |
+--------------------------------------------------------------------------------+

Acceptance Criteria
- Toggle theme, persisted locally
- Identity read from headers; no password management in-app

------------------------------------------------------------
Component Inventory (initial)
------------------------------------------------------------
Layout
- AppShell: Sidebar, Topbar, Content, Breadcrumb
- SidebarNav: sections + badges for alerts
- Tabs, Stepper, Breadcrumb

Catalog
- AppCard(icon, name, desc, install)
- AppDetailPane
- SearchBar, FilterDropdown

Wizard
- EnvEditor(rows: key, value, secret, help; import/paste)
- FileUpload(dropzone, list)
- PortsEditor, VolumesEditor
- YAMLViewer(readonly with lint markers)
- ValidationChecklist
- SummaryBlock (redacted secrets), DiffViewer

Deployments
- DeploymentCard, DeploymentTable
- StatusPill, ActionButtons
- LogsStream(filter, pause), MetricsCharts
- BackupScheduleForm, RestoreDialog
- ConfigViewer, ChangeDraftButton, HistoryTable, RollbackDialog

Feedback
- Toast, InlineAlert, ProgressBar
- EmptyState cards

Jobs
- JobProgress(stream via SSE), JobList

Form/UX Helpers
- Tooltip, HelpIcon, CopyButton, CodeBlock

Props and API Mapping (high level)
- EnvEditor: props { rows, onChange(row), onImport(file), onPaste(text) } -> PATCH /api/drafts/:draftId
- FileUpload: props { kind, onUpload(file) } -> POST /api/drafts/:draftId/uploads?kind=...
- ValidationChecklist: actions -> POST /api/drafts/:draftId/validate | /preflight
- SummaryBlock: GET /api/drafts/:draftId
- JobProgress: subscribes to SSE from JobService with jobId
- ChangeDraftEditor: endpoints under /api/deployments/:deploymentId/*

------------------------------------------------------------
Error, Empty, Loading States
------------------------------------------------------------
- Offline mode: Banner explaining limited actions; cached data rendering
- Low disk space: Warning in Validate/Preflight and on Dashboard alerts
- Permission issues: Clear message about docker.sock or file permissions
- Unsupported environment: OrbStack-only notice in Install and Preflight
- Loading skeletons for lists and panels
- Retry patterns for failed endpoint calls with exponential backoff

------------------------------------------------------------
User Flows (Mermaid)
------------------------------------------------------------

Install New App
flowchart TD
  A[Catalog] --> B[Install Wizard - Env]
  B --> C[Compose Override]
  C --> D[Additional Files]
  D --> E[Advanced]
  E --> F[Validate and Preflight]
  F --> G[Summary & Confirm]
  G --> H[Finalize + Create Job]
  H --> I[JobProgress SSE]
  I --> J[Deployment Detail]

Post-deploy Change Draft
flowchart TD
  A[Deployment Detail] --> B[Create Change Draft]
  B --> C[Edit Env/Files/Advanced]
  C --> D[Validate/Preflight]
  D --> E[Finalize]
  E --> F[Apply - In-place or Blue/Green]
  F --> G[New Generation + History Updated]

Backup and Restore
flowchart TD
  A[Backups] --> B[Schedule Global]
  A --> C[Per-app Run]
  C --> D[Restore Confirmation]
  D --> E[Restore Job + Status]

------------------------------------------------------------
Acceptance Criteria Summary
------------------------------------------------------------
- All screens navigable with keyboard and accessible labels
- Dark theme with AA contrast as default; toggleable light theme
- Install wizard integrates Draft/Uploads/Validate/Preflight endpoints
- Jobs show live progress with SSE; secrets redacted in UI and logs
- Deployment management supports change drafts and rollback per Architecture
- Marketing site links to GitHub Docs; Install page offers copyable commands
- Responsive layout works at 360px width and above

------------------------------------------------------------
Phased Delivery
------------------------------------------------------------
MVP
- Marketing: Home, Install, Features, Catalog Preview, Community
- SPA: Dashboard, Catalog, Install Wizard, Deployments, Notifications, Settings
- Baseline tokens and accessibility
Phase 2 (pre-launch per PRD)
- HTTPS polish, Backups UI complete, Metrics charts, Email notifications, Docs integration
- Reviews and ratings on App Detail

------------------------------------------------------------
Handoff Package
------------------------------------------------------------
- This UX spec file
- Component inventory with prop contracts mapped to API
- Token sheet as JSON/SCSS variables
- Wireframe references: M1–M6, S1–S10 ASCII layouts with notes
- Edge cases: error/empty/loading catalog

End of UX Spec
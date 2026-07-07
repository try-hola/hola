# Feature Specification: Web UI State Freshness

**Feature Branch**: `001-web-state-freshness`

**Created**: 2026-07-06

**Status**: Draft

**Input**: User description: "Hola Web State Freshness Handoff — replace the current local-state/cache-invalidation pattern with a real universal server-state layer, and wire SSE events into it so changes in one view (or emitted asynchronously by the API) reliably update all other views without a browser refresh."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Deployment status changes propagate across every view (Priority: P1)

An operator triggers or observes a deployment whose status changes (for example, an install that moves from *deploying* to *running*, or a stack that becomes *failed*). The status change is emitted by the platform. Every open view that shows that deployment — the Apps page, the Deployments list, and the Deployment detail page — reflects the new status within a couple of seconds, without the operator reloading the browser.

**Why this priority**: This is the core of the reported problem and the highest-value cross-view stale path. Operators make decisions based on deployment status; showing stale status until a manual refresh erodes trust in the dashboard and can cause duplicate or premature actions.

**Independent Test**: Open the Deployment detail page for an app, then cause a status change for that app (e.g. from another tab or by simulating the platform event). Observe the detail page, the Deployments list, and the Apps page all update to the new status without a page reload. Delivers immediate value even if job and summary propagation are not yet wired.

**Acceptance Scenarios**:

1. **Given** the Deployment detail page for app X is open showing status *deploying*, **When** the platform emits a status change to *running* for app X, **Then** the detail page shows *running* within a few seconds without a manual refresh.
2. **Given** the Deployments list and Apps page are both open, **When** app X's status changes, **Then** both views show the updated status without a manual refresh.
3. **Given** two browser tabs are open on different views, **When** a status change occurs, **Then** both tabs converge to the same, current status.

---

### User Story 2 - Deleted deployments disappear from list views immediately (Priority: P1)

An operator uninstalls/removes an app, or a removal is emitted by the platform. Every list view that showed the app (Apps page, Deployments list) removes it right away, and the dashboard summary counts adjust accordingly. An open detail page for the removed app resolves cleanly (no stale data lingering as if the app still exists).

**Why this priority**: A deleted app that keeps appearing in lists is a confusing and error-prone state — operators may attempt actions against something that no longer exists. Correct removal is as important as correct status.

**Independent Test**: With list views open, remove an app (or simulate the removal event) and confirm it disappears from all list views and that summary counts update, without a browser refresh.

**Acceptance Scenarios**:

1. **Given** the Apps page and Deployments list show app X, **When** the platform emits a deletion for app X, **Then** app X is removed from both views without a manual refresh.
2. **Given** the dashboard summary shows a count that includes app X, **When** app X is deleted, **Then** the summary count decreases to reflect its removal.
3. **Given** the detail page for app X is open, **When** app X is deleted elsewhere, **Then** the operator is redirected to the list view and shown a transient "app X was removed" notice.

---

### User Story 3 - Job activity and dashboard summary stay current (Priority: P2)

An operator watches in-progress work (installs, upgrades, rollbacks) surfaced as jobs and as summary counts on the dashboard. As jobs progress and complete, the job tracker / recent-jobs view and the dashboard summary counts update on their own, without a manual refresh.

**Why this priority**: Job and summary freshness reinforces the sense that the dashboard is "live," but it is secondary to correct deployment status and correct list membership. It builds directly on the same event-driven foundation as P1.

**Independent Test**: With the job tracker and dashboard summary visible, drive a job through its lifecycle (or simulate job events) and confirm both update without a page reload.

**Acceptance Scenarios**:

1. **Given** the job tracker is visible, **When** the platform emits a job progress or completion event, **Then** the job's state updates without a manual refresh.
2. **Given** the dashboard summary shows counts affected by job/deployment activity, **When** relevant events occur, **Then** the summary counts update without a manual refresh.

---

### User Story 4 - Live updates are the primary consistency mechanism, with polling only as fallback (Priority: P3)

The dashboard keeps views consistent primarily by reacting to platform-emitted events. Periodic re-fetching (polling) remains available as a safety net for missed events or dropped connections, but is no longer the mechanism operators depend on to see fresh data.

**Why this priority**: This reframes the system's behavior and is more of a quality/architecture guarantee than a distinct user-visible screen. It matters because it defines "done" for the freshness effort, but it delivers value only once P1–P3 are in place.

**Independent Test**: With live updates active, confirm cross-view freshness occurs promptly on events; then disable/skip the event source and confirm data still eventually reconciles via the fallback path (albeit less promptly).

**Acceptance Scenarios**:

1. **Given** the event stream is connected, **When** a change occurs, **Then** views update promptly from the event, not from a scheduled poll.
2. **Given** the event stream is temporarily unavailable, **When** a change occurs, **Then** views still reconcile to current data through the fallback path once data is next fetched.

---

### Edge Cases

- **Event arrives for a view that isn't currently open or cached**: The system should not error; the next time that view is opened it must show current data (either the event was applied to shared state, or the view fetches fresh on mount).
- **Event stream disconnects and reconnects** (network blip, laptop sleep, auth session refresh): On reconnect, views must reconcile to current data rather than remaining pinned to the last-seen snapshot.
- **Rapid burst of events for the same deployment**: The UI must converge to the latest state without flicker or getting stuck on an intermediate state; out-of-order or duplicate events must not leave a view stale.
- **Event references a deployment/job the client has never loaded**: Handled gracefully — no crash, and correct data appears when that entity is next viewed.
- **Deletion event for an entity the user is actively viewing**: The operator is redirected from the now-defunct detail page to the list view with a transient removal notice, rather than continuing to render as if the entity is live.
- **Two views bound to the same underlying data** (e.g. Deployments list and Apps page): A single change must not update one while leaving the other stale; they must draw from the same shared source of truth.
- **Stale-while-fetching**: While fresh data is being retrieved, a previously loaded view should remain usable rather than blanking out.

## Clarifications

### Session 2026-07-06

- Q: When an operator is viewing App X's detail page and a deletion event for App X arrives, what should the detail page do? → A: Auto-redirect to the list view with a transient "App X was removed" notice.
- Q: Are deployment config and history views included in this first freshness slice, or deferred? → A: Included — config and history belong to the deployments data family and are kept fresh on relevant events and mutations.
- Q: For operator-initiated actions (action/remove/promote/update), should the UI update optimistically or wait for confirmation? → A: Server-confirmed — the mutation triggers a refresh, and the resulting fetch or platform event drives the visible change; a pending/in-progress affordance is shown meanwhile.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The web dashboard MUST maintain a single shared source of truth for server-owned data (deployments, jobs, and dashboard summary in the initial slice), such that all views reading the same underlying data render the same value at any given time.
- **FR-002**: When the platform emits a deployment status change, the system MUST update all affected views (Apps page, Deployments list, and the Deployment detail page for that deployment) to reflect the new status without requiring a browser refresh.
- **FR-003**: When the platform emits a deployment deletion, the system MUST remove that deployment from all list views without requiring a browser refresh. If a detail view for the deleted deployment is currently open, the system MUST auto-redirect the operator to the list view and surface a transient notice indicating the app was removed (rather than leaving the operator on a page for a nonexistent deployment).
- **FR-004**: When the platform emits job activity, the system MUST update job-related views (job tracker / recent jobs) and any affected dashboard summary counts without requiring a browser refresh.
- **FR-005**: Dashboard summary counts MUST stay consistent with the underlying deployment and job state after any relevant event, without requiring a browser refresh.
- **FR-006**: An open detail view MUST re-render from the shared source of truth when that shared data changes, rather than from a private, independently held snapshot that can drift out of date. The deployment detail view's secondary data — its configuration and its history/timeline — MUST belong to the same shared deployments data family and MUST be refreshed on relevant events and mutations, so the detail page is not left partially fresh.
- **FR-007**: Actions initiated from the UI (such as performing a deployment action, removing, promoting, or updating a deployment) MUST cause the affected shared data — deployment detail, deployment lists, related jobs, and summary — to refresh so the initiating view and all other open views reflect the result. The visible result MUST be server-confirmed: the action triggers a refresh of the affected data, and the resulting fetch or platform event drives the change the operator sees. The UI MUST NOT optimistically present a final outcome before the platform reports it; a pending/in-progress affordance MAY be shown while the action is resolving.
- **FR-008**: Periodic re-fetching (polling) MUST be reduced to a fallback/safety-net role and MUST NOT be the primary mechanism relied upon for cross-view consistency.
- **FR-009**: The system MUST tolerate event-stream disruption: on reconnection or on the next data fetch, views MUST reconcile to current data rather than remaining fixed on a stale snapshot.
- **FR-010**: The system MUST handle events referencing entities that are not currently loaded or cached without error, and MUST present current data for those entities when they are next viewed.
- **FR-011**: The new shared-state approach MUST NOT introduce additional direct use of the existing ad-hoc client cache for server-owned API data; server-owned data MUST be governed by the new shared-state layer.
- **FR-012**: The connection to the platform's event stream MUST continue to work in both the production single-origin deployment and the local development proxy configuration (i.e. the stream endpoint must remain resolvable in both environments as it is today).
- **FR-013**: Access to the event stream and to server data MUST remain authenticated; the freshness mechanism MUST NOT weaken existing access controls.
- **FR-014**: The behavior of the freshness mechanism MUST be covered by automated tests, including: events updating/patching shared data for status changes, deletions removing entities and invalidating list views, job events updating job and summary data, an open detail view re-rendering when shared data is patched by a simulated event, and two sibling list views sharing the same invalidation.

### Key Entities *(include if feature involves data)*

- **Deployment**: A deployed app stack the operator manages. Relevant attributes for freshness include its identity, current status, uptime/last-updated indicators, and existence (present vs. removed). Appears in list views (Apps, Deployments) and in a detail view.
- **Job**: A unit of in-progress or completed platform work (install, upgrade, rollback, removal) associated with a deployment. Surfaced in a job tracker / recent-jobs view and reflected in summary counts.
- **Dashboard Summary**: Aggregate counts derived from deployments and jobs, shown on the dashboard. Must stay consistent with the underlying entities.
- **Platform Event**: An asynchronous notification emitted by the server describing a change (deployment status update, deployment deletion, job update). The trigger that keeps shared client state fresh.
- **Shared Server-State Store**: The client-side single source of truth for server-owned data — responsible for fetching, caching, invalidation, and applying event-driven updates so all subscribing views stay consistent.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After a deployment status change is emitted, all open views showing that deployment reflect the new status within 3 seconds, with zero manual browser refreshes required.
- **SC-002**: After a deployment deletion is emitted, the deployment disappears from 100% of open list views and the summary counts adjust, within 3 seconds and with zero manual refreshes.
- **SC-003**: 0 instances remain where an operator must refresh the browser to see a change that was already emitted by the platform, across the deployments/jobs/summary flows in scope.
- **SC-004**: Two or more open views bound to the same underlying data never display conflicting values for that data for longer than the propagation window (3 seconds) after a change.
- **SC-005**: With the event stream disabled, in-scope views still reconcile to current data on their next fetch (fallback path verified), demonstrating polling functions purely as a safety net.
- **SC-006**: Automated test coverage exists and passes for each freshness scenario listed in FR-014, and the full web test suite passes.
- **SC-007**: No new direct usages of the legacy ad-hoc client cache are introduced for server-owned API data in the migrated flows (measured by review/inspection of the changed code).

## Assumptions

- **Scope of the first slice**: This specification covers the deployments, jobs, and dashboard-summary flows — the highest-value stale cross-view paths. The deployments flow includes the detail page's secondary data (configuration and history/timeline) so the detail page is fully migrated rather than half-fresh. Catalog, backups, notifications, settings, and other data domains are explicitly out of scope for this slice and can adopt the same shared-state approach in later work.
- **Existing event stream is sufficient for the slice**: The platform already emits deployment status updates, deployment deletions, and job updates over a single authenticated dashboard-wide stream. This effort consumes those existing events; it does not require new server-side event types for the initial slice.
- **Separate log and system-status streams are unaffected**: Logs and system status use their own streams today and are not part of this change.
- **Freshness target**: A propagation window of ~3 seconds is treated as "immediate" from the operator's perspective; no specific sub-second real-time guarantee is required.
- **Fallback retained**: Existing periodic re-fetching is kept as a safety net rather than removed, to cover missed events and stream outages.
- **Environments**: The change must work unchanged in both production (single-origin) and local development (dev proxy); the event-stream endpoint remains referenced in an environment-agnostic way as it is today.
- **Hook naming continuity**: Existing view/hook entry points may keep their names to limit churn, with their internals re-implemented against the shared-state layer; this is an implementation detail and does not change user-facing behavior.

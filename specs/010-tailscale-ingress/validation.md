# Real-tailnet validation record (FR-039)

These checks need a live tailnet and cannot run in CI. The feature is not complete until every row has a result. See research.md for what each one decides.

| # | Check | Result | Date | Notes |
|---|---|---|---|---|
| V1 | Bare `tailscaled` resumes sign-in, serve config and advertisement after a container restart | NOT RUN | | |
| V2 | `serve --service … http://hola-ts-backend:PORT` accepted in the userspace container | NOT RUN | | |
| V3 | Behaviour when the Service is not defined | NOT RUN | | |
| V4 | `CapMap["service-host"]` shape, unapproved and approved | NOT RUN | | |
| V5 | A client granted only the Service cannot reach the companion device's own address | NOT RUN | | |
| V6 | Service certificate issues; when | NOT RUN | | |
| V7 | WebSocket, SSE and a 10-minute request survive | NOT RUN | | |
| V8 | `cap_drop: ALL`, read-only root, tmpfs `/tmp` work with a signed-in device | NOT RUN | | Unauthenticated half observed in the T019 integration test (starts and stays up, no restarts, `NeedsLogin` readable); the signed-in half is NOT RUN. |
| V9 | `logout` leaves an expired, named device record | NOT RUN | | |
| V10 | Host-header and address substitution land on the backend only (Story 2, SC-002) | NOT RUN | | |
| SC-001 | Off to connected in under 10 minutes using Hola's guidance only | NOT RUN | | |
| SC-009 | Omnigraph: an identity limited to the Service calls `/mcp`; cannot reach a second app | NOT RUN | | |

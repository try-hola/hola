---
applyTo: "/packages/cli/src/**"
---

# CLI Package Instructions

## Purpose
Node/TS CLI orchestrating server APIs and streaming real-time feedback.

## Core Rules
- Build requests with `@hola/shared` constants/types.
- Commands under `src/commands/*`; top-level `src/index.tsx` dispatches.
- SSE: reuse `src/lib/sse.ts`; handle reconnects, SIGINT cleanup, and graceful termination messages.
- Output: human-friendly by default; `--json` for machine output.
- **Use Draft workflow for validation**: Validate compose files by creating drafts, uploading files, and using SDK validation methods.
- **NO DEV SDK methods**: Don't reference `sdk.dev` or development-specific API methods - these are removed.

## Do
- Validate args and print helpful usage on errors.
- Exit codes: non-zero on failure, zero on success.
- Stream logs with timestamps and levels; quiet/verbose flags supported.

## Don't
- Hardcode server URLs; accept env/flags and default smartly.
- Duplicate route strings.
- Block the event loop.
- **Use removed SDK methods**: `sdk.validation.compose()` and `sdk.dev.*` methods don't exist.
- **Implement dev-specific commands**: Use standard Draft/Deployment workflows for all functionality.
- **Reference development APIs**: All CLI commands must work through production-ready API endpoints.

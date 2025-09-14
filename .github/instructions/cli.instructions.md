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

## Do
- Validate args and print helpful usage on errors.
- Exit codes: non-zero on failure, zero on success.
- Stream logs with timestamps and levels; quiet/verbose flags supported.

## Don't
- Hardcode server URLs; accept env/flags and default smartly.
- Duplicate route strings.
- Block the event loop.

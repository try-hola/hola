---
applyTo: "/packages/**/__tests__/**"
---

# Tests Instructions

## Purpose
Reliable, isolated tests with fakes-first strategy and consistent structure.

## Core Rules
- Fakes over mocks: simple in-memory fakes implementing same interface in `__tests__/fakes/`.
- Organize by feature; only import `@hola/shared` across packages.
- For server integration, start dev server with `&`, wait for `/healthz`, and cleanup.
- No external network calls.

## Do
- Test error handling and edge cases.
- Use realistic sample data aligned with `@hola/shared` types.
- Keep tests deterministic; avoid arbitrary sleeps.

## Don't
- Mock deep internals; test public APIs.
- Introduce flaky timers; poll for readiness.

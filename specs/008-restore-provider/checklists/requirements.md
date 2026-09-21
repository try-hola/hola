# Specification Quality Checklist: restore@1 — the provider half

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-21
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- **66 functional requirements, 14 success criteria, 5 user stories (3×P1, 2×P2), 10 edge cases.**
- **Zero `[NEEDS CLARIFICATION]` markers.** Every open question the prompt of record left was settled as a
  documented default in `## Assumptions` rather than deferred, because this run is unattended. The two most
  consequential are recorded there explicitly: that `restore@1` is *promoted* rather than a sibling reference
  being minted, and that the provider role is filled by an app while the platform's own live-deployment restore
  remains provider-free.
- **Named symbols appear only where the requirement is *about* the symbol.** `restore@1` is the contract
  reference an app literally writes in its manifest, so requirements naming it are naming operator-facing
  vocabulary, not implementation. No file paths, function names, line numbers, endpoint paths, field names or
  type names appear anywhere in the requirements — those belong to `plan.md` and the design artifacts.
- **Six corrections to the prompt of record are load-bearing** and were verified against `main@03290b8` before
  any requirement was written (`anchors-008.md`, `catalog-findings-008.md`). They are not scope creep:
  1. The marker carve-out swallows the reference *before* the registry is consulted, so adding a registry entry
     without deleting the carve-out is a no-op — FR-003 exists to make that failure loud.
  2. The candidates surface has no origin concept at all today; this is a new concept, not a new enum value (FR-043).
  3. The path-to-slug helper the prompt cites does the *opposite* of what the prompt claims — it discards slugs to
     bound metric cardinality. Inference is new logic, and what it recovers is an *installation* name rather than
     an app identity (FR-049, FR-050).
  4. Capability enforcement is deny-by-default per route, so the cost is per endpoint, not one line (FR-032).
  5. No writable mount primitive exists; this is a new privileged cross-app capability, which the constitution
     requires be introduced by ADR (FR-018).
  6. "Restore staging" already names a different, server-local, never-mounted directory (FR-019).
- **Two issues are closed by this spec**, both deliberately deferred to it: #486 (the absolute-path subtree trap —
  FR-041) and #484 (the fabricated restore endpoint — FR-056).
- **FR-004 records a deliberate supersession of spec 007's FR-047.** This is the one place the spec reverses a
  shipped decision, and the justification is that spec 007 named the precondition for its own reversal.
- **Clarify session 2026-09-21 added 10 requirements and 3 success criteria** (66→76 FRs, 14→17 SCs) and
  changed no checkbox state — all 16 were already passing and all 16 still pass. The session's most consequential
  finding was not an answer but a consequence: identifying a candidate by its local deployment cannot express a
  provider-held capture, so the identifier and the default selection both have to become origin-independent
  (FR-043a). That is a change to a shipped type, and it would have surfaced during implementation instead.
- Items marked incomplete require spec updates before `/speckit-clarify` or `/speckit-plan`.

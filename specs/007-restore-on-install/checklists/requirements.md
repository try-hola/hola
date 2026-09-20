# Specification Quality Checklist: Restore-on-Install from a Live Deployment

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-20
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

**Deliberate deviation from "no implementation details", recorded rather than
silently taken** (matching the precedent set by specs 003–006 in this repo):

- The **Assumptions** section names the *shape* of the environment record's
  location (`<apps root>/<reserved>/<deployment id>/`) without naming the literal
  directory. This is load-bearing: the prompt of record assumed the record lives
  *inside* the app data root, and spec 006 shipped it *outside*. A reader who does
  not know that will design a restore that reads configuration out of the captured
  tree and find nothing there. Stating the shape is what prevents that; stating the
  literal path would be detail the plan owns.
- The **Dependencies** section notes that the existing upgrade-path rules pass
  through on a downgrade. This is not an implementation detail of *this* feature —
  it is a correction to the prompt, which delegated "refuse a newer candidate" to a
  check that does not produce it. FR-029 therefore states the rule independently.

**Requirement coverage sanity check** (informal; `/speckit-analyze` is the formal gate):

| Group | FRs | Stories |
|---|---|---|
| Candidate discovery | FR-001..006 (+ FR-004a) | US1, US5 |
| Entering the restore choice | FR-007..012 | US1, US2 |
| Executing the restore | FR-013..023 (+ FR-013a, FR-016a, FR-022a) | US1, US3, US4 |
| App restore declaration | FR-024..028 | US4 |
| Refusals and warnings | FR-029..037 (+ FR-037a) | US2, US3 |
| Install wizard | FR-038..042 | US1, US2 |
| Command line | FR-043..046 | US5 |
| Scope boundaries | FR-047..048 | (all) |

53 functional requirements, 13 success criteria. All 16 items passed on the first
validation iteration and still pass after clarification (no state changes).

**Post-clarification note.** The `a`-suffixed requirements were added by
`/speckit-clarify` and `/speckit-analyze` rather than renumbering, so every FR number cited elsewhere in
this spec's artifacts stays stable. FR-016 additionally carries an inline
correction to the prompt of record: the prompt's "locate the subtree" trap
describes a provider archive tool's absolute-path layout and does not apply to the
platform's own capture helper, which is root-relative. That trap belongs to
Sequence 6 and is recorded there rather than coded against here.

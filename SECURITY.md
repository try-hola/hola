# Security Policy

## Supported versions

Hola is under active development and does not yet maintain long-term support
branches. Security fixes are applied to the latest release and to `main`. Please
run a recent release before reporting an issue.

## Dependency advisories

Advisories against Hola's own dependency tree do not need a private report — they
are already public. `bun audit` must report **zero** on `main`, enforced by
[`.github/workflows/audit.yml`](.github/workflows/audit.yml). The policy, how a
finding is fixed, and the procedure for the rare advisory that cannot be fixed
are in [`docs/DEPENDENCY_AUDIT.md`](docs/DEPENDENCY_AUDIT.md).

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Report privately through GitHub's
[private vulnerability reporting](https://github.com/try-hola/hola/security/advisories/new)
(Security → Advisories → *Report a vulnerability*). This opens a confidential
advisory visible only to the maintainers.

Please include:

- a description of the vulnerability and its impact,
- the affected component (`server`, `web`, `cli`, `compose`, or another package),
- reproduction steps or a proof of concept,
- any known mitigations.

## What to expect

- We aim to acknowledge a report within **5 business days**.
- We will keep you informed as we investigate and work on a fix.
- Once a fix is released, we are happy to credit you in the advisory unless you
  prefer to remain anonymous.

Thank you for helping keep Hola and its users safe.

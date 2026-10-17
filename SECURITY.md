# Security policy

## Reporting a vulnerability

Please report security problems privately, not in public issues, pull requests or discussions.

- Email **security@nagma.app**, or
- use GitHub's private vulnerability reporting: the repository's **Security** tab › **Report a vulnerability**.

Include what you found, the version or commit, how to reproduce it, and what an attacker could do with it. If you have a fix, describe it in the report rather than opening a public pull request.

What happens next:

- We acknowledge the report within 3 working days.
- We confirm the problem, decide how severe it is, and tell you the plan, usually within 10 working days.
- We fix it in a release and publish a GitHub security advisory, crediting you unless you'd rather not be named. Please give us 90 days, or until the fix is released if that is sooner, before disclosing it yourself.

## Supported versions

Nagma is young: fixes land on the newest release only.

| Version | Supported |
|---|---|
| Latest release (desktop apps, Docker image built from its tag) | Yes |
| `main` | Yes (fixes land here first) |
| Older releases | No: update to the latest |

Self-hosted servers should follow the latest release; the update steps are in [docs/self-hosting.md](docs/self-hosting.md).

## Scope

In scope: the editor (`apps/web`), the sync server (`apps/server`), the desktop app (`apps/desktop`, including its updater), the MCP server, the VS Code extension, the Docker image and compose stack, and the install and backup scripts.

Out of scope: problems that need a compromised device or an admin account on the server, denial of service by sheer traffic volume, missing hardening headers without a demonstrated impact, and reports from automated scanners without a working proof of concept. Third-party dependencies are in scope when Nagma's use of them makes the problem exploitable; otherwise report them upstream.

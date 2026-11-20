# ADR 0003: Sandbox image, credentials, permissions and budget decided by S1

**Status:** Accepted, 2026-11-20

## Context

Spike S1 (`docs/spikes/s1-sandcastle.md`) ran Sandcastle 0.14.0 against coach-stack's `factory-pilot` with
Claude Code 2.1.311. Four questions from the plan needed an answer, and three design points were open:

- The image runs Node 20, but the npm install of Claude Code declares `engines.node >=22`.
- Permissions were planned to depend on workspace trust, which Sandcastle's container does not grant.
- A sandbox holding the real model credential is exposed to `docker inspect`, and a 15-minute helper token
  would have to reach the sandbox at run start.

The user has decided the open points. This ADR records them. ADR 0001's locked decisions are unchanged.

## Decision

1. **Claude Code is installed with the native installer, not npm.** The image pins the version (2.1.311)
   and the sha256 of the binary for each architecture. The Dockerfile checks the binary against the pinned
   checksum at build time, and auto-update is off. The image keeps Node 20 (coach-stack's current runtime).
   Moving to Node 22 or later is a separate coach-stack ticket for the Node 20 end-of-life upgrade.
2. **Permissions come only from the adapter's generated settings and `--allowedTools` /
   `--disallowedTools`.** Slice 1 verifies that they apply without workspace trust. The factory does not
   rely on `hasTrustDialogAccepted`. The adapter also replaces Sandcastle's default
   `--dangerously-skip-permissions` with an explicit `--permission-mode`.
3. **The sandbox never holds the real model credential.** The credential is an API key or gateway token,
   never a subscription sign-in. In slice 1b, a forward proxy holds the key, and `ANTHROPIC_BASE_URL` points
   the sandbox at the proxy. The sandbox holds a dummy value. The proxy adds the real credential and the
   gateway's headers and forwards upstream. The proxy is the only route out. The S1 proxy test confirmed
   this path for a trivial run (`docs/spikes/s1-sandcastle.md`, follow-up F4).
4. **Per-step budget.** Each agent step gets `--max-budget-usd` set to the ticket run's remaining budget minus
   about one call, with `--max-turns` kept as the backstop. The budget check runs after each API call, so a
   step can exceed it by one call. The flags are passed through a `ClaudeCodeAdapter` wrapper, because
   Sandcastle's `claudeCode()` cannot pass them.
5. **Egress and mounts, as S1 found them.** Sandcastle lets us choose the container's network
   (`docker({ network })`), so the sandbox attaches to an `--internal` network directly. Sandcastle supports
   read-only mounts (`docker({ mounts: [{ readonly: true }] })`), so ticket and spec files go outside the
   worktree, and the `.factory/` fallback and its check are not needed.
6. **Harness flags live behind the seams.** The flag wrapper (print-mode `--max-turns`, `--max-budget-usd`,
   `--permission-mode`, `--setting-sources`) is part of `ClaudeCodeAdapter`, reached through
   `ExecutionRunner`. The engine, schema and UI do not import Sandcastle or Claude Code flags.

## Consequences

- The image no longer depends on Claude Code's npm engines requirement. Each Claude Code bump is a change
  to two checksums and the version in the Dockerfile, with a rebuild.
- The sandbox does not hold the credential, so `docker inspect` on a sandbox shows only the dummy value.
  The credential now sits in the proxy. The worker must keep the proxy's token current. Refresh is
  host-side and is not yet tested beyond the 15-minute helper TTL. This is a known gap for slice 1b.
- Factory permissions must be checked in slice 1 with a test that runs without workspace trust. Any rule
  that only holds under trust fails the check.
- Claude Code's `--setting-sources local` drops project hooks, project skills and project permissions. The
  factory profile must use `project` or the default when it needs `CLAUDE.md` or `.claude/skills`.
- The budget is a one-call overshoot limit, not a hard cap. Plan and tests treat it as such.

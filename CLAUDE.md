# Software Factory

An AI software factory: it turns a GitHub issue into a reviewed, merged pull request through a defined
lifecycle. Humans shape, spec and accept; sandboxed agents build, check and review.

**Status:** Phase 1 (sandboxed build loop). Nothing is implemented yet.

## Read first

1. `docs/design/factory-design.md` — the full design and architecture (source of truth)
2. `CONTEXT.md` — domain glossary; use these terms exactly in code, docs and tickets
3. `docs/adr/` — decisions already made; do not reopen them without a new ADR
4. `docs/plan/phase-1.md` — current phase: spikes, slices and the phase gate

If guidance conflicts: ADRs win, then the design doc, then existing code.

## Locked decisions (details in `docs/adr/0001-baseline-architecture.md`)

- Local-first: Docker Desktop + Sandcastle, always behind the `ExecutionRunner` interface
- Tracker: GitHub Issues (spec = parent issue, tickets = sub-issues, blocking links = ticket graph)
- Engine: Temporal, TypeScript SDK, local dev server (`temporal server start-dev`)
- Workflows: JSON definitions run by one generic interpreter workflow (`FactoryWorkflow`)
- Agents: capability profiles, not persona agents
- Models: Claude Code only in v1, but every profile and step carries a `{harness, model, effort}` binding
- Memory: sandboxes read project knowledge, never write it; the Learn stage proposes changes via PR

## Architecture rules

- **Portable seams.** `ExecutionRunner`, `HarnessAdapter` and the tracker each sit behind an interface.
  Engine, schema and UI code never import Sandcastle, Claude Code or GitHub directly.
- **Claude-specific code stays in `ClaudeCodeAdapter`.** Hooks, `settings.json`, subagent files and
  output formats never leak outside it.
- **Temporal determinism.** Workflow code (`packages/engine`) does no I/O, no `Date.now()`, no random.
  All I/O lives in activities (`packages/worker`). Change workflow code with patching.
- **Idempotent activities.** Every activity takes a run key (`workflowId + stepId + attempt`).
- **Bounded loops.** Every retry or back-edge has a limit, then escalates to a human.
- **No secrets in sandboxes.** Agents never hold GitHub, AWS or Auth0 credentials. The worker does all
  GitHub writes.

## Repo layout (planned)

TypeScript monorepo, npm workspaces:

| Package | Holds |
| --- | --- |
| `packages/schema` | JSON Schemas for workflows and profiles, generated TS types |
| `packages/engine` | `FactoryWorkflow`, `TicketWorkflow` (deterministic only) |
| `packages/worker` | Activities, worker bootstrap |
| `packages/runner` | `ExecutionRunner` + `LocalDockerRunner` |
| `packages/adapters` | `HarnessAdapter` + `ClaudeCodeAdapter` |
| `packages/tracker` | GitHub Issues sync |
| `packages/cli` | Trigger runs (Phase 1) |
| `apps/ui` | Factory UI (Phase 2) |

## How we work

- Plan with Matt Pocock's skills: `grill-with-docs` → `to-spec` → `to-tickets`. Tickets are vertical
  slices that end in something runnable, never a horizontal layer.
- Build with `tdd`: a failing test first, then the code.
- One ticket per branch; conventional commits (`feat(runner): ...`).
- New decisions get an ADR in `docs/adr/` (next number, short, with context and consequences).
- Prefer small, working increments over broad scaffolding.

## Related repos

- **coach-stack** (`../coach-stack`) — the pilot target repo. Factory work there happens only on the
  `factory-pilot` branch; the factory's base branch for coach-stack is `factory-pilot`, never `main`.

# ADR 0001: Baseline architecture

**Status:** Accepted, 2026-11-10

## Context

The factory design was worked out in a design session and captured in `docs/design/factory-design.md`.
These decisions are the baseline; later ADRs may supersede individual items.

## Decisions

1. **Local-first execution.** v1 runs on one laptop with Docker Desktop. Sandcastle provides sandboxes.
   All execution goes through the `ExecutionRunner` interface so a remote or cloud runner can replace
   `LocalDockerRunner` without changes elsewhere.
2. **GitHub Issues is the tracker.** Specs are parent issues, tickets are sub-issues, blocking links form
   the ticket graph. Labels mirror run state (`factory:*`). Only the worker writes to GitHub.
3. **Temporal is the engine.** TypeScript SDK, local dev server in v1, Origami's Temporal in a dedicated
   namespace later. Temporal was chosen over agent-specific orchestrators because Origami already runs it
   and it provides durable gates, retries and history.
4. **JSON workflow definitions, one interpreter.** A single `FactoryWorkflow` interprets any versioned JSON
   definition. Each ticket runs as a child `TicketWorkflow`. Gates are signals. Runs pin their definition
   version.
5. **Capability profiles, not persona agents.** One generalist harness per step, specialized by profile
   (skills, image, tools, network, checks, review rubrics). Reviewers run in a fresh session.
6. **Model-agnostic seams, Claude first.** Profiles and steps carry `{harness, model, effort}`. Only
   `ClaudeCodeAdapter` is built in v1; a second-provider reviewer is planned for phase 2.
7. **Memory write path.** Sandboxes read project knowledge (OKF format in target repos) but never write it.
   The Learn stage proposes knowledge and skill changes in one reviewed PR.
8. **Pilot target.** coach-stack, on a long-lived `factory-pilot` branch. `main` is untouched until the
   approach is proven.

## Consequences

- We build our own UI and workflow editor; Temporal's UI is for debugging only.
- Every new harness, runner or tracker is an adapter behind an existing interface, not a refactor.
- Sandcastle's host-local design means a worker must own a repo clone; cloud execution needs worker hosts.

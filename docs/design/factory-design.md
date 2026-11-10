# AI Software Factory — Design & Architecture

Nov 10, 2026 · @Steven Clark

## Summary

The factory turns a GitHub issue into a merged, reviewed pull request through a defined lifecycle. Humans own shaping, specs and acceptance; sandboxed agents own building, checking and reviewing. v1 runs entirely on a developer laptop against one pilot repo, coach-stack, and is built so that execution, models and hosting can change later without a rewrite.

**Decisions locked**

| Area | Decision | Why |
| --- | --- | --- |
| Execution | Local first: Docker Desktop + Sandcastle behind an `ExecutionRunner` interface | Learn the fundamentals cheaply; swap the runner for AWS workers later |
| Tracker | GitHub Issues | Native fit for Pocock's skills; blocking links form the ticket graph |
| Engine | Temporal (TypeScript SDK), local dev server | Durable gates and retries; already in use at Origami |
| Workflows | JSON definitions run by one interpreter workflow, edited in a WYSIWYG canvas | Lifecycles change without code changes |
| Agents | Capability profiles, not persona agents | Specialization through skills, checks and permissions |
| Models | Claude Code first; harness and model bindings in the schema from day one | Model-agnostic without building unused adapters |
| Memory | Keep OKF format; sandboxes read only, the Learn stage writes via PR | Removes concurrent, unreviewed writes |
| Pilot | coach-stack (React, Hono, DynamoDB, AWS CDK) | Stack mirrors Origami greenfield work |

**Out of scope for v1:** cloud execution, providers other than Claude, Origami repos, production deploys by agents.

## Principles

1. **Artifacts are the handoff.** Agents never pass work to each other directly. They read and write specs, tickets, ADRs and PRs, and a fresh agent picks up from the artifact.
2. **Humans shape, agents build.** Every stage is marked human-in-the-loop (HITL) or away-from-keyboard (AFK). Human attention goes to shaping, gates and acceptance, not supervision.
3. **Planning shares a context window; building never does.** Grilling, spec and slicing run in one session. Each ticket's build starts fresh from the ticket alone.
4. **Every agent runs in a sandbox.** No agent executes on the host. One container and one branch per ticket.
5. **Checks decide, not the agent.** A ticket is done when deterministic checks pass and an independent reviewer approves, never on the implementer's say-so.
6. **Bounded loops, then escalate.** Rework has a retry limit. When it's exhausted, the ticket goes to a human with the failure attached.
7. **Profiles, not personas.** One generalist harness, specialized per ticket by skills, image, tools, checks and review rules.
8. **Portable seams.** Execution, harness, model and tracker each sit behind an interface. v1 implements one of each.
9. **Governed by default.** Every run is attributable, logged and replayable. Secrets never live in sandboxes.

## Delivery lifecycle

The default lifecycle has eight stages and three human gates. Stages 1 to 3 are human-led planning in one shared session; stages 4 to 5 run AFK in sandboxes; acceptance and release return to humans.

&#91;embedded content: delivery lifecycle · 8 stages, 3 rework loops\]

Dashed lines are bounded rework loops; nothing loops without a retry limit or a human decision.

| # | Stage | Mode | Skills | Output | Exit |
| --- | --- | --- | --- | --- | --- |
| 1 | Intake and triage | HITL | `triage` | Agent-ready brief on the issue | Labeled `needs-shaping` or `ready-for-spec` |
| 2 | Shape | HITL | `grill-with-docs`, `wayfinder` for multi-session work, `prototype`, `research` | Decisions, ADRs in `docs/architecture/adrs/`, glossary updates | Open questions closed |
| 3 | Spec and slice | HITL | `to-spec`, `to-tickets` | Spec issue + tracer-bullet tickets with blocking links | **Gate: spec and breakdown approved** |
| 4 | Build | AFK | `implement`, `tdd`, profile skills, `code-review` | One branch per ticket, checks green, review approved | Merged to the integration branch, or escalated |
| 5 | Integrate | AFK | `resolving-merge-conflicts` | Integration branch with full CI, DynamoDB integration tests, security scans | Green or routed back |
| 6 | Accept | HITL | docs generation | PR to `main`, local preview, generated docs and release notes | **Gate: human approves the PR** |
| 7 | Release | HITL in v1 | none | Merge to `main`; existing deploy scripts run by a human | **Gate: deploy is human-run in v1** |
| 8 | Learn | AFK, reviewed | `retro`, `improve-codebase-architecture` | One PR of knowledge and skill updates | Human merges or discards |

**Rework loops**

- **Inside build:** a failed check or a rejected review sends the ticket back to the implementer in the same sandbox, up to 3 attempts. Then it escalates to a human with logs and diff attached.
- **Spec gaps:** an implementer or reviewer that finds the ticket ambiguous stops and flags `needs-human`. The ticket returns to stage 3, not to the build loop.
- **Integration failures:** the failing ticket reopens; its dependents wait.
- **Learnings:** stage 8 feeds skills, `docs/knowledge/` and workflow definitions, all through reviewed PRs.

## Architecture

The factory is four planes. The control plane decides what happens; the execution plane does it in sandboxes; the knowledge plane holds what agents read; the governance plane wraps all three.

&#91;embedded content: architecture · 4 planes, local topology\]

Only the worker talks to GitHub and to the runner; sandboxes read knowledge but never write it.

| Plane | Components | v1 implementation |
| --- | --- | --- |
| Control | Factory UI and API, workflow interpreter, ticket scheduler, gate service, GitHub sync | Next.js app on localhost; Temporal dev server; one factory worker process (Node/TS) |
| Execution | `ExecutionRunner`, harness adapters, Sandcastle, sandbox images | `LocalDockerRunner` on Docker Desktop; Claude Code adapter; one Node 20 image |
| Knowledge | Canonical skills source, repo docs (AGENTS.md, ADRs, `docs/knowledge/`), GitHub Issues, run artifacts | Skills repo pinned by version; OKF bundle injected read-only; transcripts stored per run |
| Governance | Sandbox policy, secrets broker, model allowlist, telemetry, audit | Policy file per profile; env injection at run start; JSONL event log, exportable to the Databricks pipeline |

**Local topology.** Four processes on one laptop: the Next.js app, `temporal server start-dev`, the factory worker, and Docker Desktop. The factory owns a clone of each managed repo under `~/factory/repos/<repo>`; Sandcastle creates a worktree and container per ticket from that clone.

**Path to cloud.** The same worker code starts on AWS hosts listening on the `sandbox-runners` task queue, and the engine points at Origami's Temporal in a dedicated namespace. Workflow definitions, the UI and profiles do not change.

## Temporal mapping

One generic `FactoryWorkflow` interprets any JSON definition, so new lifecycles never need new Temporal code. Each run is pinned to the definition version it started with.

| Factory concept | Temporal construct | Notes |
| --- | --- | --- |
| Lifecycle run (one feature) | Workflow `FactoryWorkflow(definition, issueRef)` | Definition passed as input and stored in history; edits never affect in-flight runs |
| Ticket build loop | Child workflow `TicketWorkflow` per ticket | Owns implement, check, review and retry; parent waits on all children |
| Fan-out over the ticket graph | Parent starts children whose blockers are closed; re-evaluates on each child completion | `maxParallel` caps concurrency (2 to 3 locally) |
| Agent step | Activity `runAgentStep` on task queue `sandbox-runners` | Heartbeats while the agent works; start-to-close timeout per profile |
| Check step | Activity `runChecks`, same sandbox | Returns structured pass/fail per command |
| Human gate | Workflow waits on signal `gateDecision` (approve, reject, comment) | Durable wait of days at no cost; optional timer for reminders |
| Escalation | Workflow sets ticket state `needs-human`, waits on signal `resume` | Human edits the ticket or fixes the branch, then resumes |
| GitHub sync | Activities `syncIssues`, `openPr`, `setLabels` on queue `control` | Polling in v1; no public webhook needed |
| Kanban and run feed | Queries + search attributes `Repo`, `IssueNumber`, `Stage`, `Profile` | UI reads Temporal; no separate run-state database |

**Determinism rules.** The interpreter does no I/O; all I/O happens in activities. Definition changes take effect only for new runs. Interpreter code changes use Temporal patching.

**Idempotency.** Every activity takes a run key (`workflowId + stepId + attempt`), so a retried `openPr` or `setLabels` never duplicates work.

## Workflow definitions and editor

A workflow is a versioned JSON graph of typed nodes and edges, validated by a JSON Schema and stored in git. The canvas editor and the JSON are two views of the same document.

**Node types**

| Type | Purpose | Key fields |
| --- | --- | --- |
| `agentStep` | Run an agent with skills | `mode` (hitl, afk), `skills[]`, `profile`, `agent` binding override, `session` (shared or fresh), `maxIterations`, `outputSchema` |
| `check` | Run deterministic commands in the sandbox | `commands[]`, `env`, `onFail` (retry count, then escalate or route) |
| `humanGate` | Block until a person decides | `approvers` (role or user), `artifact`, `reminderAfter` |
| `fanOut` | Run a sub-graph per ticket in the graph | `over: ticketDag`, `respectBlockingEdges`, `maxParallel`, `body[]` |
| `merge` | Integrate ticket branches | `strategy`, `skills[]`, `postChecks[]` |
| `route` | Branch on a prior step's structured output | `when[]` conditions, `default` |

Edges carry an optional `condition` and, for back-edges, a required `maxTraversals` so no loop is unbounded.

**Example (abridged)**

```json
{
  "id": "feature-delivery",
  "version": "1.0.0",
  "defaults": { "agent": { "harness": "claude-code", "model": "claude-opus-5-5" } },
  "nodes": [
    { "id": "shape", "type": "agentStep", "mode": "hitl", "skills": ["grill-with-docs"], "session": "planning" },
    { "id": "spec", "type": "agentStep", "mode": "hitl", "skills": ["to-spec", "to-tickets"], "session": "planning", "outputSchema": "ticketDag" },
    { "id": "specGate", "type": "humanGate", "approvers": ["role:tech-lead"], "artifact": "spec" },
    { "id": "build", "type": "fanOut", "over": "ticketDag", "respectBlockingEdges": true, "maxParallel": 3,
      "body": [
        { "id": "impl", "type": "agentStep", "mode": "afk", "skills": ["implement", "tdd"], "profile": "$ticket.profile" },
        { "id": "verify", "type": "check", "commands": "$profile.checks", "onFail": { "retry": 3, "then": "escalate" } },
        { "id": "review", "type": "agentStep", "mode": "afk", "skills": ["code-review"], "session": "fresh" }
      ] },
    { "id": "integrate", "type": "merge", "skills": ["resolving-merge-conflicts"], "postChecks": ["npm run test:integration"] },
    { "id": "accept", "type": "humanGate", "approvers": ["role:tech-lead"], "artifact": "pr" }
  ]
}
```

**Editor**

- Canvas built on React Flow (xyflow); a side panel edits the selected node's fields from the schema.
- Two-way sync: canvas edits write JSON, JSON edits redraw the canvas.
- Validation on every change: schema errors, unknown skills or profiles, unbounded loops, gates with no approver.
- Publish creates a new semantic version committed to the definitions repo; drafts never run.
- Dry run: simulate a definition against a sample ticket graph without starting sandboxes.

## Agent model

There are no standing specialist agents. Every step runs one generalist harness, specialized at dispatch by a capability profile and bound to a harness and model.

**Capability profile.** One file per profile, versioned with the factory config:

```json
{
  "id": "fullstack",
  "selectWhen": { "paths": ["apps/web/**", "apps/api/**"], "labels": ["profile:fullstack"] },
  "agent": { "harness": "claude-code", "model": "claude-opus-5-5", "effort": "high" },
  "skills": ["react", "add-screen", "frontend-design", "hono", "dynamodb", "zod", "vitest"],
  "image": "factory/coach-stack-node20:1",
  "tools": { "allow": ["Read", "Edit", "Write", "Bash(npm *)", "Bash(npx *)"], "deny": ["Bash(curl *)", "Read(**/.env)"] },
  "network": { "egress": ["registry.npmjs.org"] },
  "checks": ["TZ=America/New_York npm run -w apps/web test", "npm run -w apps/api test", "npm run -w apps/web build", "bash scripts/ci/quality-ratchet.sh"],
  "review": { "rubrics": ["standards", "spec", "tenant-isolation"] }
}
```

**Profile selection.** An explicit `profile:*` label wins. Otherwise the scheduler matches the paths a ticket names against `selectWhen.paths`; a ticket that spans several profiles gets the union profile (`fullstack`). Unknown paths fall back to the default profile and are flagged for review.

**Agent binding.** `{harness, model, effort}` resolves in order: workflow step, then profile, then workflow defaults. Every run records the resolved binding.

**Harness adapters.** Each harness is behind one interface:

```ts
interface HarnessAdapter {
  prepare(sandbox: Sandbox, profile: Profile): Promise<void>; // skills, instructions, permissions, memory snapshot
  run(sandbox: Sandbox, step: AgentStep): Promise<RawResult>;
  parseEvents(raw: RawResult): FactoryEvent[];               // normalized telemetry
  extractOutput(raw: RawResult, schema: JsonSchema): unknown; // schema-validated result
}
```

v1 ships `ClaudeCodeAdapter` only. Claude-specific features (hooks, `settings.json`, subagent files) stay inside it; nothing in the engine, schema or UI depends on them.

**Reviewers.** Review runs in a fresh session with read-only tools. Rubrics compose: `standards` and `spec` (Pocock's two axes) always run; `tenant-isolation`, `iam-least-privilege` and `docs-impact` are added by profile or by touched paths. Phase 2 moves the reviewer to a second provider to remove self-grading.

**Subagents.** Allowed inside a step for parallel read-only work (exploration, multi-rubric review). Never for parallel writes to the same branch.

## Sandboxing

Every AFK step runs in a Sandcastle container on its own branch, reached only through the `ExecutionRunner` interface.

```ts
interface ExecutionRunner {
  openSandbox(job: TicketJob): Promise<SandboxHandle>;   // worktree + branch + container
  exec(h: SandboxHandle, cmd: string): Promise<ExecResult>;
  runAgent(h: SandboxHandle, step: AgentStep, adapter: HarnessAdapter): Promise<RawResult>;
  closeSandbox(h: SandboxHandle, keep: 'branch' | 'none'): Promise<BranchRef | null>;
}
```

The build loop opens one sandbox per ticket and keeps it warm across implement, check, review and retries, so state and installed dependencies carry over. `LocalDockerRunner` implements it in v1; a remote runner or microVM provider implements it later.

**Sandbox policy**

| Control | v1 rule |
| --- | --- |
| Filesystem | Only the ticket's worktree is mounted; no host home directory, SSH keys or cloud config |
| Branch | One branch per ticket (`factory/<issue>-<slug>`); never pushes to `main` |
| Network | Egress allowlist per profile (package registry, model API); everything else blocked |
| Secrets | Model API key injected at run start through env, scoped to the run; no AWS, Auth0 or GitHub credentials inside |
| GitHub | The factory worker opens PRs and sets labels; agents never hold a GitHub token |
| Permissions | Factory-generated harness settings: edits allowed in the worktree, `.env` reads and `curl` denied, no bypass mode |
| Resources | CPU and memory caps per container; wall-clock timeout per step |
| Cleanup | Container destroyed after each ticket; branch kept for the PR |

**Services.** Tests that need DynamoDB Local run at Integrate, with DynamoDB Local as a sidecar container on the sandbox's private network, not Docker-in-Docker.

## Memory and knowledge

Keep the OKF format; change the write path. Sandboxes read project knowledge but never write it, and the Learn stage proposes all changes as one reviewed PR.

| Kind | Examples | Lives in | Written by | Read by |
| --- | --- | --- | --- | --- |
| Project knowledge | ADRs, PROJECT\_CONTEXT, design system, `docs/knowledge/` | Repo, versioned | Humans; Learn-stage PRs; ADRs from shaping | Every agent, read-only |
| Run memory | Transcript, working notes, check output, review findings | Temporal history + run artifact store | The run itself | Retries in the same ticket; Learn stage; UI |
| Factory learnings | Repeated failure patterns, skill gaps, profile tuning | Learn-stage PR to the repo or skills source | Learn stage | Humans approve; then agents via project knowledge |

**In a sandbox.** The harness adapter injects the capped OKF snapshot at start for every harness, replacing the Claude-only session-start hook. `recall.mjs` remains callable as a plain command. Memory capture hooks are disabled in AFK runs.

**Learn stage.** After a feature closes, an agent reads that feature's run memory and proposes knowledge entries, skill edits and profile changes in one PR, each item linked to the runs that justify it.

## GitHub Issues integration

GitHub is the system of record for work; Temporal is the system of record for execution. Labels mirror run state so the board is readable without the factory UI.

**Structure.** A spec is a parent issue; its tickets are sub-issues; blocking links between tickets form the graph the scheduler reads. Only sub-issues of an approved spec are dispatchable, which keeps a spec issue from being built as a ticket.

| Label | Meaning | Set by |
| --- | --- | --- |
| `factory:triage` | New, not yet shaped | Human or intake |
| `factory:shaping` | In grilling or wayfinding | Shape stage |
| `factory:spec-review` | Spec and tickets awaiting the gate | Spec stage |
| `factory:ready` | Approved, waiting on blockers or capacity | Gate approval |
| `factory:building` | Sandbox running | Scheduler |
| `factory:needs-human` | Escalated, ambiguous or over retry limit | Build loop |
| `factory:in-review` | Ticket branch merged to integration; feature PR open | Integrate |
| `factory:done` | Merged to `main` | Accept |
| `profile:<name>` | Forces a capability profile | Human or `to-tickets` |

**Branches and PRs.** Each ticket branch merges into a feature integration branch (`factory/feature-<spec>`). The human gate reviews one PR from that branch to `main`, with every ticket's checks and review findings linked.

**Sync.** The factory worker polls in v1 and writes labels, comments and PRs with a fine-grained token scoped to the pilot repo. Agents never call GitHub directly.

## Factory UI

Five views cover v1. Temporal's own web UI stays available for engineers debugging a run.

| View | What it shows | Actions |
| --- | --- | --- |
| Board | Every ticket as a card in columns by stage, with profile, binding, attempt count and blockers | Open a run; force a profile; pause or cancel |
| Run | One ticket's timeline: each step, its live agent stream, check results, review findings, diff | Retry a step; escalate; open the branch |
| Gate inbox | Specs, breakdowns and PRs waiting on a person, oldest first | Approve, reject, comment (sent as Temporal signals) |
| Workflow editor | Canvas and JSON side by side, validation panel, version history | Edit, validate, dry run, publish a version |
| Profiles and skills | Profiles with their skills, checks and bindings; pass rate, retries and cost per profile and binding | Edit profiles; pin skill versions |

**Stack.** Next.js and React with React Flow for the editor. The API reads Temporal through queries and search attributes and writes only through signals and new workflow starts. Live agent streams come from the worker over server-sent events.

## Governance and observability

Every agent action is attributable to a run, a ticket and a person who approved the work, and every run can be replayed from its history.

**Event model.** Adapters normalize harness output into one event schema: `run.started`, `agent.message`, `tool.call`, `tool.result`, `check.result`, `review.finding`, `gate.decision`, `run.completed`. Each carries run id, ticket, profile, resolved binding, tokens and cost. v1 writes JSONL per run; the format is shaped to load into the existing Databricks telemetry pipeline when the factory moves to Origami.

**Controls**

- **Model allowlist** per profile; an unlisted binding fails validation at publish time.
- **Skill pinning** by version or hash, so a skill change is a reviewed change.
- **Approvals recorded** in Temporal history with who, when and what artifact version.
- **MCP access** off in v1 sandboxes. When needed, it routes through the existing MCP gateway rather than direct connections.
- **Cost guardrails:** a token budget per step and per feature; exceeding it escalates instead of continuing.

**Metrics to track from day one:** first-pass check rate, review rejection rate, retries per ticket, escalation rate, human time at gates, tokens and cost per merged ticket, and time from spec approval to merge.

## Pilot: coach-stack

coach-stack is an npm-workspaces monorepo (`apps/web` React 18 + Vite, `apps/api` Hono on Lambda, `packages/shared`, `infra` AWS CDK) with strong existing agent context, CI checks and a quality ratchet. Its 10 Claude and 8 Codex persona agents convert directly into the profiles below.

**Profiles**

| Profile | Selected when a ticket touches | Skills | Checks | Extra review rubric |
| --- | --- | --- | --- | --- |
| fullstack (default) | `apps/web` and `apps/api` | react, add-screen, frontend-design, hono, dynamodb, zod, vitest | web tests in `America/New_York`, api tests, web build, ratchet | tenant-isolation |
| web | `apps/web` only | react, add-screen, frontend-design, vitest | web tests in `America/New_York`, web build, ratchet | design-system |
| api | `apps/api`, `packages/shared` | hono, dynamodb, auth0, zod, vitest | api tests, ratchet | tenant-isolation |
| infra | `infra/` | aws-cdk, docker | infra build, `cdk synth` prod and dev with no credentials | iam-least-privilege, no always-on resources |
| ai-feature | `services/ai-*`, `config/ai-assist.ts` | aws-bedrock, zod, vitest | api tests including AI assist tests | prompt and fallback behavior |

All five share one image: Node 20, git, AWS CDK CLI pinned to 2.1111.0, dependencies pre-installed from `package-lock.json`.

**Pre-flight fixes before the first run**

- [ ] Disable the memory capture hooks (`SessionStart`, `Stop`, `PreCompact`, `SessionEnd`) in factory runs; the adapter injects the snapshot instead
- [ ] Rewrite `.claude/agents/devops-engineer.md`: its body is a stray summary and it loads only `docker`, not `aws-cdk`
- [ ] Add CDK assertion tests or cdk-nag to `infra` (its test script is currently a placeholder)
- [ ] Allow quality-ratchet baseline changes only at Integrate, to avoid conflicts between parallel tickets
- [ ] Generate factory sandbox settings separate from the interactive `.claude/settings.json`
- [ ] Add `npm run test:integration` that starts DynamoDB Local as a sidecar and runs `RUN_DYNAMO_TESTS=true`
- [ ] Consolidate skills from `.claude/skills`, `.codex/skills` and `.agents/skills` into the canonical source
- [ ] Update AGENTS.md: one agent per vertical-slice ticket, replacing the separate backend and frontend lanes
- [ ] Install Pocock's lifecycle skills and point ADR output at `docs/architecture/adrs/`

**First pilot feature.** A small vertical slice touching web and api, with no infra or auth changes, chosen from the coach-stack backlog.

## Phased build plan

Build the riskiest part first: the sandboxed build loop, driven from a CLI, before any UI. Each phase ends at a gate the pilot must pass before the next starts.

&#91;embedded content: build plan · 4 phases, 4 gates\]

Phases 1 to 3 run on a laptop against coach-stack. Phase 4 is the only one that touches Origami infrastructure.

## Open questions and risks

**Open questions**

- [ ] Does Pocock's `to-tickets` write GitHub sub-issues and native blocking links, or text references the factory must parse?
- [ ] Which coach-stack feature is the first pilot slice?
- [ ] Is a fullstack ticket that touches both apps the default, or should `to-tickets` be told to split web and api where it can?
- [ ] Who approves gates in the pilot: you alone, or a second reviewer to test the gate inbox?
- [ ] Which Temporal server version and SDK does Origami run, so v1 pins compatible versions?
- [ ] Where do run artifacts live locally: Temporal history only, or a local object store for large transcripts and diffs?

**Risks**

| Risk | Effect | Mitigation |
| --- | --- | --- |
| Tickets not truly independent | Merge conflicts at Integrate; wasted runs | `maxParallel` of 2 at first; Integrate reopens the conflicting ticket |
| Self-grading review | Defects pass review | Fresh-session reviewer with rubrics now; second-provider reviewer in phase 2 |
| Laptop resource limits | Slow or failed sandboxes | Cap parallelism; resource limits per container; pre-built image |
| Skill drift | Quality changes silently | Pin skills by version; changes through Learn-stage PRs |
| Cost overrun from retry loops | Token spend grows unnoticed | Per-step and per-feature budgets that escalate |
| Sandcastle API changes | Runner breaks on upgrade | Pin the version; all calls behind `ExecutionRunner` |

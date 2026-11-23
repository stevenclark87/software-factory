# Phase 1: Sandboxed build loop

**Gate:** all tickets of one spec (the spec made from coach-stack's #193) are merged into
`factory/feature-<spec>` on coach-stack's `factory-pilot`, with per-ticket checks green and review
approved, and Integrate's full CI and DynamoDB integration tests green on that branch. The acceptance PR
is opened but not merged. Escalations don't fail the gate if a human resumes them; record the
first-pass rate, with no threshold. No UI in this phase; runs are triggered from the CLI.

Convert each item below into a GitHub issue with `to-tickets` (or by hand). Spikes are time-boxed and
end in a short written finding, committed to `docs/spikes/`.

## Spikes (run in parallel, first)

- **S1. Sandcastle smoke test.** Finding: `docs/spikes/s1-sandcastle.md`. Run Claude Code in a Sandcastle
  container against coach-stack's `factory-pilot` branch by hand. Produce the first Dockerfile for the
  sandbox image (Node 20, git, CDK CLI 2.1111.0, a pinned Claude Code version, an npm cache baked from
  `package-lock.json`). Record: how model auth reaches the container, how `exec` behaves, how commits and
  branches come back, the pinned Sandcastle version, how baked-in dependencies reach the mounted worktree
  (e.g. `npm ci --offline` on sandbox open), and whether `COACH_STACK_MEMORY_RUN=1` stops coach-stack's
  memory hooks. Test `--setting-sources` and record whether it drops `CLAUDE.md` or `.claude/skills`.
  Four results are required:
  - **Egress case.** Whether Sandcastle lets us choose the container's network. If it does, slice 1b uses
    the internal network directly. If it does not, slice 1b moves the container after it starts and before
    the agent runs (`docker network disconnect bridge`, then connect to the internal network).
  - **Read-only mount.** Whether Sandcastle supports an extra read-only mount. This decides where slice 1
    puts the ticket and spec files.
  - **`--max-budget-usd`.** Whether the pinned Claude Code supports it in print mode. This decides the
    per-step limit in slice 1b.
  - **Baseline run numbers.** Tokens, cost and duration of the S1 run. The tracer bullet's run is the
    other baseline for slice 1b's defaults.
- **S2. `to-tickets` output.** Finding: `docs/spikes/s2-to-tickets.md`. Fixtures: `docs/spikes/s2-fixtures/`.
  In a separate Claude Code session on coach-stack's `factory-pilot` branch, after slice 7a has landed,
  treat #193 as an intake issue: run `grill-with-docs` (resolving #193's open questions), `to-spec` and
  `to-tickets`. `to-spec` creates a new spec issue in the standard format; the tickets are its
  sub-issues; close #193 with a "superseded by" link. Feature-doc automation is out of scope. Save the raw
  `gh issue view <n> --json` output for the spec and for each ticket into `docs/spikes/s2-fixtures/`, as
  fixtures for slice 4. The finding records:
  - the spec issue and ticket issue numbers;
  - how the dependencies landed: sub-issues, native blocking links, or text references to parse;
  - which labels each ticket got, including whether `profile:*` and `size:*` are applied;
  - the tickets with no `size:*` label, which run as `unsized`;
  - the human time spent in the session;
  - a closing decision line on ADR 0001 item 2. If only text references landed, that line says a new ADR
    superseding ADR 0001 item 2 is needed.

  The spec and tickets are the input for the Phase 1 gate.
- **S3. Temporal hello world.** Finding: `docs/spikes/s3-temporal.md`. TypeScript workflow with one activity
  and one signal on the local dev server. Pin the current stable TypeScript SDK and Temporal CLI dev server,
  and record both versions and the determinism tooling. Compatibility with Origami's Temporal is a Phase 4
  question and does not block this spike.

## Slices (in dependency order)

Dependencies:

- S1, S3 and 7a block slice 1. 7a blocks slice 1 explicitly: the profile loads skills from the committed
  worktree, so the skills commit must exist first.
- 7a blocks S2.
- 1 → 1b → 2 → 3.
- 1 and S2 → 4.
- 1b and 3 → 5a.
- Milestone M1 needs S2, 1b, 2, 3, 4 and 5a. M1 → 5b.
- 5b and 7b → 6.
- 7b runs in parallel from day one; it blocks slice 6 only.

Slice 1 runs only a hand-written ticket. Slice 1b must land before the factory runs any ticket that S2
generated. Milestone M1 is the first run of an S2-generated ticket, and it happens before parallel
fan-out.

1. **Tracer bullet.** CLI takes one hand-written ticket → starts a Temporal workflow → opens one sandbox
   → runs Claude Code → runs one check → leaves a branch. Defines the first versions of
   `ExecutionRunner`, `HarnessAdapter` and `TicketJob`, plus the schema types this path uses: `Profile`
   (including `env`, agent binding and the `limits` block), `TicketJob`
   (including `services`: image, port, health check; slice 6 implements it) and the typed config object the
   hard-coded workflow takes. The workflow-definition JSON Schema waits for Phase 2. `FactoryEvent` and the
   resume payload arrive with slices 1b and 2.
   - `ClaudeCodeAdapter.prepare` generates the factory sandbox settings (edits in the worktree, `.env`
     reads and `curl` denied, no bypass mode), separate from coach-stack's interactive
     `.claude/settings.json`. Permissions come only from these settings and `--allowedTools` /
     `--disallowedTools`; slice 1 verifies they apply without workspace trust (S1 showed they do). Settings generation stays in slice 1 because the path cannot run Claude
     Code without permissions.
   - Memory capture hooks are suppressed by the profile's `env` (`COACH_STACK_MEMORY_RUN=1`); the adapter
     runs `scripts/memory/session-start.mjs` at sandbox open, without the variable, and passes the output
     with `--append-system-prompt`.
   - `prepare` writes the ticket and its parent spec into the sandbox as read-only files and points the
     implementer at them. S1 confirmed Sandcastle supports read-only mounts, so they are mounted outside the
     worktree (no `.factory/` fallback). Here the source is the hand-written ticket; slice 4 replaces
     it with a GitHub fetch.
   - Owns the sandbox image from S1's Dockerfile (tag includes a hash of the lockfile; Claude Code via the
     native installer, pinned by version and sha256). Egress enforcement is slice 1b.
   - Each Temporal activity gets a start-to-close timeout, because Temporal requires one.
   - Limits. The tracer profile sets small real values for one hand-written ticket: `stepTimeoutMinutes` 10,
     `maxTurnsPerStep` 30, `ticketRunMaxTokens` 500000 and `ticketRunMaxCostUsd` 2. These are not baselines.
     Slice 1 refuses to run if any limit is `null`. Slice 1b adds the breakers that use these limits.

   *Blocked by S1, S3 and 7a.*
1b. **Hardening.** Makes slice 1 safe to run unattended. Must land before any S2-generated ticket runs.
   - **Egress proxy (required).** An allowlisting forward proxy (`HTTPS_PROXY`; allowlist = model API
     only) with `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`. The sandbox attaches only to an `--internal`
     Docker network (S1: Sandcastle can choose the network), and the proxy, dual-homed, is its only way out.
     The proxy also holds the subscription credential (a 0600 host file, outside the repo and the image) and adds
     it upstream as `Bearer`; the sandbox holds a dummy `CLAUDE_CODE_OAUTH_TOKEN` (ADR 0004). The sandbox-to-proxy
     hop is plain HTTP on the internal network; the proxy opens TLS upstream. No S2-generated ticket runs without the proxy.
   - The event log: a JSONL writer and the first events (`run.started`, `check.result`, `run.completed`).
     `run.completed` carries tokens, `costUsdApiEquivalent` and the ticket's `size:*` label, or `unsized` when there is none.
   - Ticket-run transcripts are kept as run memory.
   - Per-attempt checkpoint: the worker commits the ticket branch at the end of every attempt in the
     factory's local clone, so a sandbox is disposable. After a worker restart the ticket workflow reopens
     one from the branch.
   - Agent activities heartbeat.
   - Circuit breakers, as the profile's `limits` block: `stepTimeoutMinutes`, `maxTurnsPerStep`,
     `ticketRunMaxTokens` and `ticketRunMaxCostUsd`. Unset limits are `null`, and a run refuses to start with
     any `null` limit. Real defaults replace the tracer profile's small values once baselines exist. Defaults
     come from the largest of several baseline runs (tracer bullet plus S1), not from one run. The ticket-run
     cap is about 5× that largest run. The ticket-run cap is only checked between steps, so the per-step
     limit matters:
     - S1 confirmed `--max-budget-usd` works in print mode, so each agent step gets `--max-budget-usd` set
       to the ticket run's remaining budget minus about one call, and `--max-turns` stays on as a backstop;
     - if it does not work, `--max-turns` is the only limit inside a step. The plan records this as a
       known limit.

   *Blocked by 1 and S1's egress and budget findings.*
2. **Profile checks and retry loop.** The `fullstack` and `web` profiles only. Profile-driven check
   commands, structured results, retry up to the limit (3 attempts), then `factory:needs-human`. Includes
   a check that fails any ticket whose diff touches the baseline block in `quality-ratchet.sh`; baselines
   change only at Integrate. If S1 found no read-only mount, the check also fails any diff touching
   `.factory/`. Adds the CLI `factory resume` command: it sends the `resume` signal with an `action` and an
   optional note passed to the next attempt, and the retry counter resets. `retry` reruns in the same warm
   sandbox; `restart` opens a fresh sandbox from the current integration branch head, fetches the ticket
   and spec again, and discards the ticket branch; `abandon` closes the ticket as not done. A subscription usage limit pauses the ticket and resumes it later; it is not an attempt and does not escalate (ADR 0004). Detection is defined here, not in S1. *Blocked by 1b.*
3. **Reviewer step.** Fresh-session `code-review` with `standards` and `spec` rubrics; rejection feeds the
   retry loop. The reviewer gets the same ticket and spec files as the implementer. The `standards` rubric
   reads coach-stack's own AGENTS.md and docs from the worktree. The review diff base is the merge-base
   with the integration branch (`git merge-base HEAD factory/feature-<spec>`), so the diff stays correct
   after a conflict rebase. *Blocked by 2.*
4. **GitHub sync.** Read tickets from issues, including their `profile:*` and `size:*` labels; write
   labels and comments. A ticket's profile comes only from its `profile:<name>` label; a ticket with none
   escalates to `needs-human` (fail closed). A missing `size:*` label does not block: the run proceeds and
   the size is recorded as `unsized`. At sandbox open the worker fetches the ticket and its parent spec
   from GitHub and writes them into the sandbox read-only, replacing slice 1's hand-written source. The
   polling loop also reads `/factory resume` comments from allowlisted users, processes each comment once
   (deduplicated by comment id), and sends the same signal as the CLI. The worker opens the acceptance PR
   (integration branch → base branch). *Blocked by 1 and S2.*
5a. **Single-ticket merge** (ADR 0002). The parent merges one ticket into `factory/feature-<spec>`. It
   pushes the ticket branch (every attempt, for audit) and squash-merges it, one commit per ticket, with a
   `Factory-Ticket-Run: <ticket-run workflow ID>` trailer. Before merging, the merge activity checks the
   integration branch log for that trailer; if it is there, the merge is a no-op. No fan-out, no conflict
   handling yet. *Blocked by 1b and 3.*

   **Milestone M1: one S2-generated ticket, end to end.** The CLI runs exactly one ticket from S2's spec
   through slices 1b to 5a: sandbox, Claude Code, checks, review, and a squash merge into
   `factory/feature-<spec>`. Pick the smallest ticket with no blockers. Gate M1 passes before any parallel
   fan-out. *Blocked by S2, 1b, 2, 3, 4 and 5a.*
5b. **Fan-out and conflict handling** (ADR 0002). `factory run <spec-issue>` starts a run, and refuses unless
   the spec issue has the `factory:spec-approved` label (set by hand in Phase 1); the worker then marks
   its tickets `factory:ready`. The parent workflow reads the ticket graph, creates
   `factory/feature-<spec>`, and runs unblocked tickets in parallel with `maxParallel`. A child ticket
   workflow returns ready-to-merge; the parent merges one ticket at a time with slice 5a's merge. Dependents
   branch from the integration branch head. On a merge conflict the ticket is rebased in its warm sandbox,
   checks re-run, and the rebase counts as an attempt. An abandoned ticket marks its dependents
   `needs-human`. No PR per ticket. *Blocked by M1.*
6. **Integrate.** Run full CI plus DynamoDB integration tests on `factory/feature-<spec>`. This slice also
   implements the spec-level commands below, processed once each and deduplicated by comment id. A failure
   escalates the whole spec to `factory:needs-human`, with the failing output attached and the ticket
   commits on the integration branch listed so a human can bisect. Phase 1 does not attribute the failure
   to a ticket. A human clears the escalation with a comment on the spec issue from an allowlisted user;
   the parent workflow receives it as a signal:
   - `/factory resume integrate` re-runs Integrate on the current integration head, after a human pushes
     a fix;
   - `/factory resume abandon` abandons the spec;
   - `/factory reopen #N` reopens ticket N. It is accepted only when N is a ticket under this spec that has
     merged or been abandoned. It refuses any other N, and refuses every reopen once the spec's acceptance PR
     has merged. A refusal posts a reply comment and changes nothing. An accepted reopen starts a new ticket
     run that fixes forward: it builds on the current integration head and adds a second squash commit with
     its own `Factory-Ticket-Run` trailer. Nothing is reverted. Integrate re-runs automatically after the
     reopened ticket merges.

   A human fix pushed straight to the integration branch bypasses per-ticket review; the acceptance PR gate
   covers it. Running full CI after each serialized merge is a future option (ADR 0002). `LocalDockerRunner`
   implements `TicketJob.services`: it starts services on a per-sandbox Docker network and tears them down
   with the sandbox. *Blocked by 5b and 7b.*
7a. **coach-stack pre-flight, blocks S2 and slice 1** (in the coach-stack repo, on `factory-pilot`). One
   commit contains every AGENTS.md edit and the skills commit:
   - create `profile:fullstack`, `profile:web` and `size:s|m|l` labels (keeping the existing labels);
   - add the AGENTS.md instruction for `to-tickets` to apply those labels;
   - update AGENTS.md for vertical-slice tickets, replacing the separate backend and frontend lanes;
   - confirm Pocock's skills (installed with `setup-matt-pocock-skills`) point ADRs at
     `docs/architecture/adrs/`;
   - commit the skills as they are, for pinning: `.agents/skills/`, the relative symlinks in
     `.claude/skills/`, and `skills-lock.json`. Committing only the symlinks leaves them broken. This commit
     is the skill pin, and slice 1 loads skills from it. A separate canonical skills repo is deferred.
7b. **coach-stack pre-flight, parallel** (same repo and branch). Everything else in the pre-flight list:
   fix `devops-engineer.md`; add infra tests or cdk-nag; add `test:integration`; and consolidate skills.
   Consolidation covers `.claude/skills`, `.agents/skills` and `.codex/skills`. `.codex/skills` is ignored by
   Claude Code and holds six older, shorter versions of `.claude/skills` content. Consolidation lands as later
   reviewed commits that re-pin `skills-lock.json`; it does not rewrite the 7a pin. Nothing here blocks
   slices 1 to 5; `test:integration` blocks slice 6.

## Out of scope for Phase 1

UI, JSON interpreter for arbitrary definitions (a hard-coded build lifecycle is fine), workflow editor,
Learn stage, second harness, feature-doc automation, gate nodes and the `gateDecision` signal, path-based
profile selection, the `api`, `infra` and `ai-feature` profiles, per-size token caps and a per-feature
budget, automatic attribution of Integrate failures to a ticket, and the Phase 4 Commercial Terms credential (an API key, Bedrock or Vertex; ADR 0004).

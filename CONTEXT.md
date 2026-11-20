# Context: Software Factory glossary

Use these terms exactly. If a term is missing or ambiguous, add it here in the same change.

| Term | Meaning |
| --- | --- |
| **Factory** | This system: control plane, execution plane, knowledge plane and governance plane together. |
| **Target repo** | A repo the factory manages (pilot: coach-stack). The factory's own code is not a target in v1. |
| **Base branch** | The branch of a target repo that factory work starts from and merges back to (`factory-pilot` for coach-stack). |
| **Lifecycle** | The ordered stages a feature moves through: Intake, Shape, Spec and slice, Build, Integrate, Accept, Release, Learn. |
| **Stage** | One step of the lifecycle. Each is either HITL or AFK. |
| **HITL** | Human in the loop: a person drives or approves the stage. |
| **AFK** | Away from keyboard: agents run unattended in sandboxes. |
| **Workflow definition** | A versioned JSON graph of nodes and edges describing a lifecycle. Validated by JSON Schema. |
| **Node** | One element of a workflow definition: `agentStep`, `check`, `humanGate`, `fanOut`, `merge` or `route`. |
| **Run** | One execution of a workflow definition for one feature, pinned to the definition version it started with. Not a ticket's build: see Ticket run. |
| **Ticket run** | One execution of a ticket's build loop (a child of a Run): implement, check, review, retry, then ready to merge or escalated. |
| **Attempt** | One pass through implement, check and review inside a Ticket run. A merge-conflict rebase also counts as one. The retry limit counts Attempts. |
| **Intake issue** | A GitHub issue stating a need, before shaping. Once shaped it is superseded by a Spec and closed with a link to it. |
| **Size** | A ticket's `size:s`, `size:m` or `size:l` estimate, set by `to-tickets`. Compared with actual tokens and cost to calibrate budgets. |
| **Unsized** | A ticket with no `size:*` label. It still runs; the event log records its size as `unsized`. |
| **Resume** | A human's decision on an escalated Ticket run: `retry`, `restart` or `abandon`, with an optional note passed to the next Attempt. On a spec escalated by an Integrate failure, `/factory resume integrate` or `/factory resume abandon` instead, as a comment on the spec issue. |
| **Reopen** | A human's `/factory reopen #N` comment on a spec issue. It is accepted only when N is a ticket under this spec that has merged or been abandoned; any other N is refused, and every reopen is refused once the spec's acceptance PR has merged. A refusal posts a reply comment and changes nothing. An accepted reopen starts a new Ticket run for ticket N that fixes forward on the current integration head, adding a second squash commit. Nothing is reverted. |
| **Spec** | A GitHub parent issue describing a feature, produced by `to-spec`. |
| **Ticket** | A GitHub sub-issue of a spec: one tracer-bullet vertical slice, buildable on its own once its blockers close. |
| **Ticket graph** | The tickets of a spec plus their blocking links. The scheduler dispatches tickets whose blockers are closed. |
| **Gate** | A `humanGate` node: the run waits until a person approves or rejects an artifact. |
| **Escalation** | A ticket handed to a human (`factory:needs-human`) after its retry limit or when it is ambiguous. An Integrate failure escalates the whole spec, not one ticket. |
| **Capability profile** | Config that specializes the generalist agent for a ticket: skills, image, tools, network, checks, review rubrics, agent binding. |
| **Agent binding** | `{harness, model, effort}` for a step. Resolves step → profile → workflow defaults. |
| **Harness** | The agent program that runs in a sandbox (v1: Claude Code). |
| **Harness adapter** | Translates factory concepts (skills, permissions, outputs, events) to one harness. v1: `ClaudeCodeAdapter`. |
| **Runner** | Implementation of `ExecutionRunner` that opens sandboxes and runs commands and agents in them. v1: `LocalDockerRunner`. |
| **Sandbox** | One container + git worktree + branch for one ticket, kept warm across implement, check, review and retries. |
| **Check** | A deterministic command (tests, build, synth, ratchet) whose exit code decides pass or fail. |
| **Review** | A fresh-session agent step that judges a ticket's diff against rubrics (`standards`, `spec`, plus profile rubrics). |
| **Integration branch** | `factory/feature-<spec>`: where a spec's ticket branches merge before the acceptance PR. |
| **Merge trailer** | A git trailer, `Factory-Ticket-Run: <ticket-run workflow ID>`, on each squash commit to the integration branch. The merge activity checks for it, so a repeated merge is a no-op. |
| **Project knowledge** | Durable, reviewed repo docs agents read: AGENTS.md, ADRs, `docs/knowledge/`. Read-only inside sandboxes. |
| **Run memory** | A run's transcripts, check output and findings. Lives with the run, never committed directly. |
| **Factory learnings** | Patterns found across runs, proposed by the Learn stage as one reviewed PR. |
| **Spike** | A time-boxed investigation that ends in a short written finding under `docs/spikes/`, not in shipped code. |
| **Tracer bullet** | A thin vertical slice that runs end to end through every layer, however crudely, so the design is tested early. Tickets are tracer bullets. |
| **Pre-flight** | A change to a target repo that must land before factory runs on it (e.g. disabling memory hooks, adding `test:integration`). |
| **Slice** | A numbered build unit in `docs/plan/phase-1.md`. Suffixes split a slice: `1b` hardens slice 1 and must land before any S2-generated ticket runs; `5a` is the single-ticket merge and `5b` is fan-out and conflict handling; `7a` blocks S2 and slice 1; `7b` runs in parallel and blocks slice 6. |
| **Milestone M1** | The first run of one S2-generated ticket through the CLI, after slices 1b to 5a and before fan-out (5b). |
| **Skill** | A SKILL.md folder of instructions. Lifecycle skills come from Matt Pocock's repo; tech skills come from the target repo. In Phase 1, sandboxes load skills only from the committed target-repo worktree (`.agents/skills/`, symlinked from `.claude/skills/`, pinned by `skills-lock.json`). |

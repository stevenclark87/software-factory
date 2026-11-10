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
| **Run** | One execution of a workflow definition for one feature, pinned to the definition version it started with. |
| **Spec** | A GitHub parent issue describing a feature, produced by `to-spec`. |
| **Ticket** | A GitHub sub-issue of a spec: one tracer-bullet vertical slice, buildable on its own once its blockers close. |
| **Ticket graph** | The tickets of a spec plus their blocking links. The scheduler dispatches tickets whose blockers are closed. |
| **Gate** | A `humanGate` node: the run waits until a person approves or rejects an artifact. |
| **Escalation** | A ticket handed to a human (`factory:needs-human`) after its retry limit or when it is ambiguous. |
| **Capability profile** | Config that specializes the generalist agent for a ticket: skills, image, tools, network, checks, review rubrics, agent binding. |
| **Agent binding** | `{harness, model, effort}` for a step. Resolves step → profile → workflow defaults. |
| **Harness** | The agent program that runs in a sandbox (v1: Claude Code). |
| **Harness adapter** | Translates factory concepts (skills, permissions, outputs, events) to one harness. v1: `ClaudeCodeAdapter`. |
| **Runner** | Implementation of `ExecutionRunner` that opens sandboxes and runs commands and agents in them. v1: `LocalDockerRunner`. |
| **Sandbox** | One container + git worktree + branch for one ticket, kept warm across implement, check, review and retries. |
| **Check** | A deterministic command (tests, build, synth, ratchet) whose exit code decides pass or fail. |
| **Review** | A fresh-session agent step that judges a ticket's diff against rubrics (`standards`, `spec`, plus profile rubrics). |
| **Integration branch** | `factory/feature-<spec>`: where a spec's ticket branches merge before the acceptance PR. |
| **Project knowledge** | Durable, reviewed repo docs agents read: AGENTS.md, ADRs, `docs/knowledge/`. Read-only inside sandboxes. |
| **Run memory** | A run's transcripts, check output and findings. Lives with the run, never committed directly. |
| **Factory learnings** | Patterns found across runs, proposed by the Learn stage as one reviewed PR. |
| **Skill** | A SKILL.md folder of instructions. Lifecycle skills come from Matt Pocock's repo; tech skills come from the target repo. |

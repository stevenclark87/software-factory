# Phase 1: Sandboxed build loop

**Gate:** tickets from one spec merge to an integration branch on coach-stack's `factory-pilot`, all
checks green. No UI in this phase; runs are triggered from the CLI.

Convert each item below into a GitHub issue with `to-tickets` (or by hand). Spikes are time-boxed and
end in a short written finding, committed to `docs/spikes/`.

## Spikes (run in parallel, first)

- **S1. Sandcastle smoke test.** Run Claude Code in a Sandcastle container against coach-stack's
  `factory-pilot` branch by hand. Record: how model auth reaches the container, how `exec` behaves, how
  commits and branches come back, what the pinned Sandcastle version is.
- **S2. `to-tickets` output.** Run `to-spec` and `to-tickets` on a sample coach-stack feature. Record
  exactly what lands in GitHub: sub-issues, native blocking links, or text references to parse.
- **S3. Temporal hello world.** TypeScript workflow with one activity and one signal on the local dev
  server; confirm SDK version and determinism tooling.

## Slices (in dependency order)

1. **Tracer bullet.** CLI takes one hand-written ticket → starts a Temporal workflow → opens one sandbox
   → runs Claude Code → runs one check → leaves a branch. Defines the first versions of
   `ExecutionRunner`, `HarnessAdapter` and the schema package. *Blocked by S1, S3.*
2. **Profile checks and retry loop.** Profile-driven check commands, structured results, retry up to the
   limit, then `factory:needs-human`. *Blocked by 1.*
3. **Reviewer step.** Fresh-session `code-review` with `standards` and `spec` rubrics; rejection feeds the
   retry loop. *Blocked by 2.*
4. **GitHub sync.** Read tickets from issues; write labels and comments; the worker opens PRs.
   *Blocked by 1, S2.*
5. **Fan-out.** Parent workflow reads the ticket graph and runs unblocked tickets in parallel with
   `maxParallel`. *Blocked by 4.*
6. **Integrate.** Merge ticket branches into `factory/feature-<spec>` and run full CI plus DynamoDB
   integration tests. *Blocked by 5.*
7. **coach-stack pre-flight** (in the coach-stack repo, on `factory-pilot`, parallel from day one):
   disable memory capture hooks for factory runs; fix `devops-engineer.md`; add infra tests or cdk-nag;
   add `test:integration`; consolidate skills; install Pocock's skills; update AGENTS.md for
   vertical-slice tickets.

## Out of scope for Phase 1

UI, JSON interpreter for arbitrary definitions (a hard-coded build lifecycle is fine), workflow editor,
Learn stage, second harness.

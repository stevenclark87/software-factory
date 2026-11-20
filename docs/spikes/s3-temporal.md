# S3: Temporal hello world

Status: done (local dev server). Code: `docs/spikes/s3-temporal/`. Phase plan: `docs/plan/phase-1.md` (S3).

## Pinned versions

| Component | Version | Source |
| --- | --- | --- |
| `@temporalio/{client,worker,workflow,activity,common}` | 1.26.0 | npm `latest` dist-tag; GitHub release `v1.26.0` (not a prerelease, published 2026-11-17) |
| `@temporalio/testing` | 1.26.0 | same |
| Temporal CLI (dev server) | 1.10.1 (Server 1.32.2, UI 2.56.4) | GitHub `temporalio/cli` latest non-prerelease `v1.10.1` (2026-11-13); Homebrew stable 1.10.1 |
| TypeScript | 5.9.3 | latest 5.x. 7.0.2 exists but was not used |
| vitest | 4.1.12 | latest line whose engines include Node 20. vitest 5 requires Node 22+ |
| `@types/node` | 20.19.43 | matches Node 20 target |
| Node | 20.20.0 (target). Ran on 20.20.0 via nvm | SDK engines: `>= 20.3.0` |

The CLI release list has prereleases (e.g. `v1.9.4-time-skipping`). They were skipped.

## Setup

```sh
brew install temporal                       # CLI 1.10.1, installed via Homebrew
temporal server start-dev --headless --port 7233 --ui-port 8233
cd docs/spikes/s3-temporal
export PATH=~/.nvm/versions/node/v20.20.0/bin:$PATH   # Node 20
npm install                                  # exact pins, lockfile committed
npm run build
node dist/worker.js                          # worker on task queue hello-s3
node dist/client.js                          # start, query, signal, result
temporal workflow show -w <workflowId> -o json > evidence/history-<workflowId>.json
node dist/replay.js                          # replay evidence/*.json
npm test                                     # vitest: TestWorkflowEnvironment, replay, sandbox
```

Network use was limited to the Homebrew CLI install and npm package install. No other network step was needed.

## What ran

Client output (`evidence/` holds the matching history):

```
[client] started workflowId=hello-s3-1795201126268 runId=01a1fa53-4f81-769b-b1fb-455f8ae23c8c
[client] query status (before signal): waiting-for-approval
[client] sent signal approve(sclark)
[client] result: Hello, Origami! Approved by sclark.
[client] query status (after): done
```

Worker log: `[greet] runKey=hello-s3-1795201126268/greet/1 activityAttempt=1 activityType=greet`

CLI history: 17 events (`WorkflowExecutionStarted`, `TimerStarted`, `WorkflowExecutionSignaled`, `TimerCanceled`, `ActivityTaskScheduled/Started/Completed`, `WorkflowExecutionCompleted`). Status `COMPLETED`.

The workflow: `helloWorkflow` waits on `condition()` for signal `approve` with a timeout, serves query `status`, then calls one activity `greet` (`startToCloseTimeout: '30 seconds'`, `maximumAttempts: 3`). The activity takes `runKey = {workflowId, stepId, attempt}`.

## Determinism tooling (evidence)

Run with `npm test`, Node 20.20.0: 7 of 7 pass.

| Tool | What was proven |
| --- | --- |
| Replay (`Worker.runReplayHistory`) | The real CLI-exported history replays cleanly against current code (`src/replay.ts`, `test/replay.test.ts`). |
| `patched()` | A v2 fixture adds `patched('log-before-greet')` with no command change. The v1 history still replays. |
| Nondeterminism detection | A v2 fixture adds an unpatched `sleep('1 second')` before greet. Replay of the v1 history rejects with a determinism error (asserted by regex; error text not captured). |
| `TestWorkflowEnvironment` (time skipping) | Signal path completes and query returns `waiting-for-approval`, then `done`. Timeout path: a 24h approval timer fails the workflow with `ApprovalTimeout`, with real time under 60s. |
| Sandbox: `Date.now()` | Inside a workflow, `Date.now()` returns workflow (virtual) time. A 1h `sleep` advanced it by 3600032 ms. |
| Sandbox: `node:fs` | Rejected at bundle time. Webpack fails with `UnhandledSchemeError: Reading from "node:fs" is not handled by plugins`, so `Worker.create` throws. The workflow never runs. |
| `deprecatePatch` | Exported from `@temporalio/workflow`. Not exercised. |
| Bundler | Every worker start bundles `workflowsPath` with webpack (~1.7 MB bundle). |

Not tested: `Math.random` behaviour, the bare `fs` import (without `node:`), heartbeat and cancellation behaviour, and any Temporal-side failure of an activity beyond the happy path.

## Gotchas

1. **Importing a worker module from the client starts a worker.** `worker.ts` runs `main()` on import. The first client imported `TASK_QUEUE` from it. Fixed by moving the constant to `src/constants.ts`.
2. **The client process did not exit after `connection.close()`** on Node 20 with SDK 1.26.0, so the first run hung. Worked around with an explicit `process.exit(0)`. Root cause not investigated.
3. **`handle.fetchHistory()` output does not replay.** Its timestamps are protobuf objects, and `Worker.runReplayHistory` fails with `expected timestamp string`. Use `temporal workflow show -o json`, which emits canonical proto JSON.
4. **`condition()` rejected the string `'10 minutes'`** under strict TypeScript. Used a millisecond number. Did not check which duration types accept strings.
5. **Activity retry attempt is only visible inside the activity.** `Context.current().info.attempt` is available there, not in the workflow. Using it in the run key would change the key on every retry and defeat deduplication.
6. **Time-skipping is not exact.** The timer fired 32 ms late in virtual time. Tests should assert a tolerance.
7. **Dev server persistence is in-memory by default.** Histories are lost on restart. Use `--db-filename` if replay across restarts is needed.
8. **vitest 5 needs Node 22+.** Pinned vitest 4.1.12 for the Node 20 target.
9. **The SDK is three days old at pin time** (1.26.0, 2026-11-17). Expect frequent minor releases and pin deliberately.
10. **Commit attribution.** The task asked for `Claude Opus 5.5`. The harness reminder says `Claude Haiku 5.5`, which is the model running this spike. The commits use the harness value.

## Implications for slice 1

- **Split packages with no side-effect imports.** `packages/engine` must not import anything that starts a worker. Put task queue name, signal and query definitions, and workflow input/output types in a contract module the CLI can import. The worker bootstrap in `packages/worker` points `workflowsPath` at the engine's compiled workflow file via `require.resolve`. That works across npm workspaces.
- **Every `proxyActivities` call sets `startToCloseTimeout`.** The SDK requires it, and the test server enforces it.
- **Run key.** Build `{workflowId, stepId}` in the workflow, where both are deterministic. Keep a workflow-owned logical `attempt` counter for loops and back-edges, which bounds them as CLAUDE.md requires. Do not use the activity's retry attempt in the key. Read it only for logging. This needs a plan note, because CLAUDE.md's `attempt` could be read either way.
- **Replay regression suite from slice 1.** Commit a recorded history from every workflow shape that ships, and replay it in CI before any workflow change. Use CLI-exported JSON.
- **Patching is the change path.** Use `patched()` for new behaviour and `deprecatePatch()` to retire it, then replay the old histories to confirm.

## Plan-changing items

- The run-key definition of `attempt` should be fixed in CLAUDE.md or the design doc. The workflow-owned attempt is the reading this spike recommends.
- Vitest 5 does not run on the Node 20 target. Either pin vitest 4 or move the target to Node 22.
- Replay evidence must be CLI-exported. An SDK-side `fetchHistory()` path is not a valid replay fixture.

## Unresolved

- Heartbeat and cancellation behaviour (needed for slice 1b) was not tested.
- The `Math.random` and bare `fs` sandbox behaviour was not tested.
- Compatibility with Origami's Temporal is a Phase 4 question and was not checked.

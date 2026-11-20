# S1: Sandcastle smoke test

- Date: 2026-11-20. Spike owner: S1 agent. Plan: `docs/plan/phase-1.md` (Spikes, S1). Design: `docs/design/factory-design.md`.
- Worktree and branch: `software-factory-s1` on `spike/s1-sandcastle` (not pushed).
- Artifacts: `docs/spikes/s1-sandcastle/` (Dockerfile, `build-image.sh`, spike harness scripts, pinned `package.json` and lockfile).
- Target: a scratch clone of coach-stack at `~/factory/repos/coach-stack` (branch `factory-pilot`, HEAD `116af4f`). coach-stack's working tree was not touched.
- Pre-flight skills commit: not on factory-pilot when this ran (HEAD `116af4f`; no commit adds `.agents/skills/`, `.claude/skills/` symlinks or `skills-lock.json` changes). The scratch clone therefore uses the skills already tracked at HEAD (`.claude/skills/*` regular files, plus two symlinks `knock-cli` and `notification-best-practices`). Re-run the `--setting-sources` probe after the pre-flight commit lands.

## Decisions at a glance

| Required result | Decision | Slice consequence |
| --- | --- | --- |
| Egress case | **Sandcastle can choose the container network.** `docker({ network })` attaches the container only to the named network. Verified: `docker inspect` lists only the internal network, and an external fetch fails with `EAI_AGAIN`. | Slice 1b attaches the sandbox to the internal network directly. The move-and-disconnect fallback is not needed. The proxy must still be the only route out, which means it is dual-homed (internal network plus a route to the model gateway). That is untested. |
| Read-only mount | **Supported.** `docker({ mounts: [{ hostPath, sandboxPath, readonly: true }] })`. Reads work; writes fail with `Read-only file system`. | Slice 1 puts the ticket and spec files outside the worktree. The `.factory/` fallback and its diff check are not needed. |
| `--max-budget-usd` in print mode | **Works in Claude Code 2.1.311** (`error_max_budget_usd`, exit 1). **Sandcastle's `claudeCode()` cannot pass it**, nor `--max-turns` or `--setting-sources`. Passing them needs a custom `AgentProvider` that wraps `claudeCode()` and appends flags (verified in `capped-run-probe.mjs`). The check runs after each API call, so one call can overshoot the budget. | Slice 1b sets `--max-budget-usd` per step, with `--max-turns` as a backstop, through the wrapper. Each step's budget must cover the worst-case first call (see Budget section). |
| Baseline run numbers | One real `run()` on a scratch branch (Opus 5.5, trivial task): **$0.1801**, **3 API calls**, **14.0 s agent time**, **43.8 s wall including 21.6 s sandbox setup**. Tokens are in the table below. | Baseline for slice 1b defaults. It is a trivial task, so it is a floor, not a ticket-run estimate. Take the tracer-bullet run as the second baseline. |

Other decisions, with the plan consequence:

- **Model auth reaches the container through env at run start**, not through files or the host home. The host's Claude Code uses a managed `apiKeyHelper` that mints a gateway token. The container gets a token passed through `docker({ env })`. Consequence: slice 1 keeps the design's "API key injected at run start, scoped to the run" rule. Token lifetime for long runs is unresolved (see Unresolved).
- **`COACH_STACK_MEMORY_RUN=1` stops the memory hooks** that matter (SessionStart snapshot and the capture hooks). It does not stop the `UserPromptSubmit` skill-instructions hook. Consequence: keep the env in the profile, as the design already does.
- **`--setting-sources local` drops `CLAUDE.md` and project skills.** `--setting-sources project` keeps both. Consequence: a profile that needs `CLAUDE.md` or `.claude/skills` must not use a local-only source list. Because Sandcastle does not expose this flag, it goes through the same wrapper.
- **`exec` runs `sh -c` in the container**, not on the host. Commits made inside the sandbox land on the host clone's branch. Consequence: `ExecutionRunner` can rely on `exec` for checks and on `result.commits` for commit collection.

## Pinned versions

| Component | Pin | Evidence |
| --- | --- | --- |
| Sandcastle | `@ai-hero/sandcastle@0.14.0` (npm `latest`; GitHub tag `v0.14.0`, published 2026-11-02) | `npm view @ai-hero/sandcastle dist-tags` returns `latest: 0.14.0`. Repo `github.com/mattpocock/sandcastle` (MIT). The npm `v1-next` prerelease line is not used. |
| Claude Code (image and host) | `@anthropic-ai/claude-code@2.1.311` (npm `stable` tag; published 2026-10-26) | `npm view @anthropic-ai/claude-code dist-tags` returns `stable: 2.1.311`. `latest` is 2.1.329, published 2026-11-19, which is under two weeks old, so it was not chosen. |
| AWS CDK CLI | `aws-cdk@2.1111.0` | Matches `infra/package.json` in coach-stack. |
| Base image | `node:20-bookworm-slim` (Node 20.20.2, npm 10.8.2, git 2.39.5) | `docker run` output in the image. |
| Sandcastle source checked | `dist/` of 0.14.0 and `docs/guide/*.md` at tag `v0.14.0` | Read via `npm pack` and `gh api`. |

Sandcastle is a TypeScript library. It does not ship a Docker image. Its `docker()` provider runs a user-built image. The provider checks for the image and its UID (`checkImageUid`). It does not build the image unless asked (`sandcastle docker build-image`).

## Method

- Docker Desktop was not running at start. It was started with `open -a Docker` and was up within 10 s. No permissions or settings were changed.
- Sandcastle source and docs: `npm pack @ai-hero/sandcastle@0.14.0` (unpacked into a scratch dir, not executed by hand), and `gh api repos/mattpocock/sandcastle/contents/docs/guide/*.md` (read-only). Relevant files: `dist/sandboxes/docker.d.ts`, `chunk-GCLEXPXG.js` (docker lifecycle), `chunk-H2PEFS4W.js` (`claudeCode()` print command), `chunk-7N7AMUYA.js` (exec). Guide pages: `sandbox-providers.md`, `branch-strategies.md`, `agent-providers.md`, `hooks.md`, `run.md`.
- Harness: `docs/spikes/s1-sandcastle/` with `@ai-hero/sandcastle` pinned to 0.14.0. Every probe is a script in that folder. Each one was run against the scratch clone, and the commands and results are quoted below.

## Results

### 1. Model auth: how it reaches the container

Host mechanism (names only, no values):

- Managed settings at `/Library/Application Support/ClaudeCode/managed-settings.json` set `apiKeyHelper` to `ug auth-token --host <workspace> --profile <profile>`. The Unity Gateway CLI mints the token. Managed `env` sets `CLAUDE_CODE_USE_GATEWAY=1`, `ANTHROPIC_BASE_URL` (a Databricks workspace gateway), `ANTHROPIC_CUSTOM_HEADERS`, `CLAUDE_CODE_API_KEY_HELPER_TTL_MS=900000`, and the model names.
- The host shell has no `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`. The helper is the source of the token. A macOS keychain item for Claude Code also exists, but it was not used.
- Sandcastle's `docker()` forwards only the env it is given. It does not forward `process.env` (checked in the source; the probe printed no `ANTHROPIC_*` variables inside the container).

What the probes do: the host's helper output is read at run start and passed as `ANTHROPIC_AUTH_TOKEN`, with `CLAUDE_CODE_USE_GATEWAY`, `ANTHROPIC_BASE_URL` and `ANTHROPIC_CUSTOM_HEADERS`, through `docker({ env })`. Inside the container, `claude -p` authenticated and returned `OK` (`model-probe.mjs`, case 1). No token value was written to any file, log or transcript. A scan of the spike folder, the scratch clone's `.sandcastle` logs and the captured transcripts found no match.

Consequences: the helper cache TTL is 15 minutes. Whether the gateway token expires on that schedule was not tested. Runs longer than that need a refresh path (see Unresolved). `docker run -e` puts the token in the docker CLI's argument list for the duration of the call, and it is visible to anyone with `docker inspect` while the container exists. Both are acceptable for a laptop spike, not for slice 1 as written.

### 2. `exec`

Verified in `probe.mjs` and `model-probe.mjs`:

- Runs `docker exec <container> sh -c "<command>"`. The default cwd is the worktree, mounted at `/home/agent/workspace` in the container.
- Returns `{ stdout, stderr, exitCode }`. A non-zero exit is returned, not thrown.
- `sudo: true` runs as `0:0`. Not exercised, because the image has no sudo binary.
- `exec` only sees the container's env: `S1_PROBE` (passed via `docker({ env })`) appeared, and nothing else did.

### 3. Commits and branches come back to the host clone

- `branchStrategy: { type: "branch", branch }` creates a git worktree at `<clone>/.sandcastle/worktrees/<slug>` on the named branch. The repo's `.git` is mounted into the container. The files that control git behaviour are mounted read-only (`.git/config`, `.git/hooks`, `.git/info`, the worktree's `.git` file).
- The agent committed inside the container (`git add` and `git commit` in `/home/agent/workspace`). The commit appears on the host branch `spike/s1-smoke` as `a782d00`, and `RunResult.commits` lists it. The commit author came from `GIT_AUTHOR_*` and `GIT_COMMITTER_*` env vars on the agent. The container has no global git identity. Sandcastle does not copy one in for `docker()`.
- After a clean run the worktree directory is removed and the branch is kept (`worktree list` after the probe showed only the main worktree; `git branch --list spike/*` kept `spike/s1-probe`).
- Sandcastle's `result.stdout` is the agent's summarized text, not the raw stream. The raw stream-json events are in the log only on error paths.

### 4. First Dockerfile and build

File: `docs/spikes/s1-sandcastle/Dockerfile`. Script: `docs/spikes/s1-sandcastle/build-image.sh <clone>`. The script builds from a temp context containing only the committed `package.json`, `package-lock.json` and workspace manifests (`apps/*`, `infra`, `packages/*`), and tags `factory/coach-stack-node20:<rev>-<sha256(lockfile)[0:12]>`.

Contents: `node:20-bookworm-slim`, git, `@anthropic-ai/claude-code@2.1.311` and `aws-cdk@2.1111.0` installed globally, and an npm cache baked with `npm ci --ignore-scripts` (`npm_config_cache=/opt/npm-cache`, then `node_modules` removed). `USER 1000:1000`, `CMD sleep infinity`.

Two revisions:

- **Rev 1** (`factory/coach-stack-node20:1-2a0ca7eeaa5e`): cold build **28 s**. Size **1,279,694,100 bytes (1.28 GB)**. Missing `/home/agent` for uid 1000, so Claude Code could not write `~/.claude.json` (see Other findings).
- **Rev 2** (`factory/coach-stack-node20:2-2a0ca7eeaa5e`, the tag used for all later probes): adds `RUN mkdir -p /home/agent && chown 1000:1000 /home/agent`. Size **1,279,707,007 bytes**. Rebuild with cache: **1 s**.

Cache size inside the image: `/opt/npm-cache` is **154 MB**. Most of the rest is the Node base image and the global CDK and Claude Code installs.

Image checks (`docker run --rm <tag> ...`): `node v20.20.2`, `npm 10.8.2`, `git 2.39.5`, `claude 2.1.311 (Claude Code)`, `cdk 2.1111.0`, `uid=1000(node)`.

Claude Code 2.1.311 declares `engines.node >=22.0.0`. npm printed `EBADENGINE` during the image build. It ran on Node 20.20.2 anyway (`claude -p` completed in the baseline). Risk: a later Claude Code release may refuse Node 20. See Other findings.

### 5. How baked dependencies reach the mounted worktree

- Within a sandbox, `npm ci --offline --no-audit --no-fund` runs in the worktree as an `onSandboxReady` hook. The probe ran it with the container on `--network none` (checked manually with `docker run --network none`): `added 717 packages in 20s`, exit 0, 437 entries in `node_modules`, `tsc` loads.
- Within the spike's `run()` and probes, the same hook took **21.6 s** of setup time. The trust hook is a second hook in the same list.
- `node_modules` lands in the bind-mounted worktree on the host. It is gitignored in coach-stack. Nothing extra is needed to share it.
- Scripts ran (default `npm ci` includes install scripts, and `esbuild` and `tsc` worked). Only the image build used `--ignore-scripts`.

Result: `npm ci --offline` works on sandbox open. The lockfile hash in the tag changes when the lockfile changes, as the design requires.

### 6. `COACH_STACK_MEMORY_RUN=1`

Verified in the container with the scratch clone's scripts (`model-probe.mjs` cases 6a to 6c, and `hook-probe.mjs`):

- `scripts/memory/session-start.mjs` without the env: **3,499 bytes** of hook output (the OKF snapshot). With `COACH_STACK_MEMORY_RUN=1`: **0 bytes**.
- `scripts/memory/capture.mjs stop` with the env: exits 0 at once. In the baseline transcript the Stop hook summary shows `capture.mjs stop` ran for 43 ms.
- Model self-report, `model-probe.mjs` case 5 with the env, asked whether the "Project knowledge (OKF bundle" heading is in context: answered `no`. Case 3 without the env answered `no` as well, so this check is inconclusive. The hook output size is the stronger evidence.
- The hook scripts import `js-yaml`, which is a root dev dependency. Without `npm ci` they fail with `ERR_MODULE_NOT_FOUND`. Claude Code keeps going, but the memory is not written. The `onSandboxReady` install order matters.
- Not stopped by the env: the `UserPromptSubmit` skill-instructions hook (`.claude/hooks/skill-instructions-hook.sh`). It prints "Proceeding without skills" in print mode.

Result: the env stops the memory snapshot and the capture hooks. Keep it in the profile.

### 7. `--setting-sources`

`model-probe.mjs` case 3 and 4, `hook-probe.mjs` C and D. Each question was answered by Haiku 5.5 with yes or no. Haiku's self-report is the only evidence here, so the results are indicative:

| Source list | CLAUDE.md (coach-stack) | Project skill (`react`) | Memory heading |
| --- | --- | --- | --- |
| default (`user,project,local`) | yes | yes | no (case 3; see section 6) |
| `--setting-sources local` | **no** | **no** | no |
| `--setting-sources project` | yes | yes | no |

Result: `local` drops `CLAUDE.md` and `.claude/skills`. `project` keeps both. Sandcastle does not expose this flag, so the wrapper is needed. Not tested: whether `local` also drops the project's hooks and permissions. The memory hooks live in `.claude/settings.json`, so they would also be dropped. That is an inference, not a measurement.

### 8. Egress case

`egress-probe.mjs`, with `docker network create --internal s1-egress-test`:

- `container networks: s1-egress-test`. Only the named network was attached.
- External fetch: `blocked EAI_AGAIN`, exit 0.
- In the default bridge network the same fetch to the npm registry returned 200 (`probe.mjs`), so the difference is the network choice.

Result: Sandcastle lets us choose the container's network. Slice 1b does not need the move-and-reconnect fallback. Gap: the model gateway is only reachable through the proxy, and the proxy has not been built. Testing a dual-homed proxy is the next step (see Unresolved).

### 9. Read-only mount

`probe.mjs`, with `mounts: [{ hostPath, sandboxPath: "/mnt/ticket", readonly: true }]`:

- `cat /mnt/ticket/ticket.md` returned the fixture.
- `touch /mnt/ticket/x` returned `Read-only file system`.

Result: supported. The fixture is a harmless file under `~/factory/spike-s1/ro-fixture/`, not in any repo.

### 10. `--max-budget-usd` in print mode

Claude Code 2.1.311 `--help`: "Maximum dollar amount to spend on API calls (only works with --print)".

- `model-probe.mjs` case 2, `--max-budget-usd 0.0001` with Haiku: `"subtype":"error_max_budget_usd","is_error":true`, exit 1. Cost reported `$0.00032`.
- `capped-run-probe.mjs`, the same flag passed through `run()` by a custom `AgentProvider` (`buildPrintCommand` appends `--max-turns 1 --max-budget-usd 0.0001`): the log shows `error_max_budget_usd` with `Reached maximum budget ($0.0001)`, and Sandcastle rejects with `claude-code-capped exited with code 1`. The flags reached the CLI.
- `--max-turns` is accepted in print mode (all probes used it).

Budget behaviour: the check runs after each API call. The first call of a fresh session writes about 17k to 31k cache-creation tokens, so the budget is exceeded by at most one call's cost. Haiku first call: $0.0023 measured. Opus first call: not measured; the baseline total ($0.18 over 3 calls) suggests a few cents per first call, but this is an estimate.

### 11. Baseline run (`baseline-run.mjs`)

One real `run()` on branch `spike/s1-smoke`, model `system.ai.claude-opus-5-5`, one iteration, a trivial task (read the read-only fixture, write one line to `s1-smoke/notes.txt`, commit it). The agent made two Bash tool calls and committed `a782d00`.

| Metric | Value | Source |
| --- | --- | --- |
| Total cost | **$0.1801** | `cost-state.totalCostUSD` in the captured session transcript |
| API calls | 3 | session transcript |
| Input / output tokens | 6 / 686 (+52 thinking) | `cost-state.modelUsage` |
| Cache creation / read tokens | 30,856 / 60,378 | assistant `usage` sums |
| Agent time | 14.0 s total (13.0 s in API) | `cost-state` `totalDuration`, `totalAPIDuration` |
| Run wall time | 43.8 s, of which 21.6 s sandbox setup (install and trust hooks) | `run()` timing and log |

Where the numbers come from: `RunResult` does not carry cost. The cost and token numbers are read from the captured session transcript under `~/.claude/projects/...` (Sandcastle's default `captureSessions`). The factory's cost accounting should read that file (or the stream-json log on error paths) rather than `RunResult`.

## Other findings

1. **Sandcastle's `claudeCode()` is missing the flags the design needs.** It passes `--dangerously-skip-permissions` by default, or `--permission-mode` if `permissionMode` is set. It has no `--max-turns`, `--max-budget-usd`, `--setting-sources`, `--allowedTools` or `--disallowedTools`. The design's `tools.allow`/`deny` cannot be enforced through `run()` options alone. The wrapper in `capped-run-probe.mjs` is the working pattern. It should live behind `ExecutionRunner` and be pinned with the Sandcastle version.
2. **Workspace trust gates project settings.** Without trust, Claude Code logs `Ignoring 7 permissions.allow entries from .claude/settings.json: this workspace has not been trusted`. The message points at `projects["/home/agent/workspace"].hasTrustDialogAccepted` in `~/.claude.json`. Sandcastle creates `/home/agent` as root, so the write fails until the image pre-creates the directory for uid 1000 (rev 2). The trust hook in the probes writes that flag at sandbox open. The warning no longer appeared in the rev 2 runs. Consequence: slice 1 must decide how trust is set (this is a sandbox-local config write, not a host change). The alternative is to put the allow list on the command line.
3. **Node 20 vs Claude Code's engines field.** Claude Code 2.1.311 declares `node >=22.0.0`. It ran on Node 20.20.2 here. The design pins Node 20. If a later Claude Code pin needs Node 22, the image changes with it.
4. **Git identity is absent in the container** (`git config --global user.name` is empty). Commits need `GIT_AUTHOR_*` and `GIT_COMMITTER_*` on the agent, or an explicit identity in the factory's commit step.
5. **Only explicit env reaches the container.** This is good for secret hygiene. It also means every needed variable (gateway URL, headers, token, `COACH_STACK_MEMORY_RUN`) has to be listed in the profile or the runner.
6. **Image size is 1.28 GB.** The baked cache is 154 MB. The design does not set a size target. A slimmer base would have to be measured.
7. **Skill and memory hook lines.** The `UserPromptSubmit` skill hook prints "Proceeding without skills" in print mode. In the baseline the agent said it had no skills, even though the tracked `.claude/skills` were present in the clone. This shows that trust and settings sources decide what the agent sees, and the skills check (S2 and 7a) should confirm it under the final settings.

## Unresolved

- **Token lifetime for runs longer than the helper TTL (15 min).** Not tested. A ticket run's agent step can exceed that. The factory needs either a refresh hook inside the sandbox (not possible without the host helper) or a longer-lived token that the design allows. This is plan-relevant for slice 1b.
- **Dual-homed proxy.** The egress case is answered (the internal network works), but the proxy itself has not been built or tested. The model gateway is not reachable from the internal network alone.
- **`--setting-sources` against hooks and permissions.** Only the context files and skills were tested. Whether `local` also drops `.claude/settings.json` hooks and permissions is inferred, not measured.
- **Context inventory relied on Haiku's self-report.** Yes or no answers are a weak check. The memory hook output size (3,499 bytes versus 0) is the stronger evidence for section 6.
- **Budget overshoot size on Opus.** The first-call overshoot was measured on Haiku ($0.0023) and estimated for Opus. A per-step budget should be set from measured first-call costs on the profile's model.
- **Performance on macOS bind mounts.** `npm ci` on a bind-mounted worktree took 20 s; a large repo or heavier tests were not measured.
- **Pre-flight skills commit.** It was not on factory-pilot when the spike ran. The skills check should be repeated after it lands.

## Commands run (summary)

```
docker info                                                    # daemon up after `open -a Docker`
npm view @ai-hero/sandcastle dist-tags ; npm pack @ai-hero/sandcastle@0.14.0
gh api repos/mattpocock/sandcastle/contents/docs/guide/<page>.md
git -C <root>/software-factory worktree add ../software-factory-s1 -b spike/s1-sandcastle
git clone --branch factory-pilot <root>/coach-stack ~/factory/repos/coach-stack
docs/spikes/s1-sandcastle/build-image.sh ~/factory/repos/coach-stack          # rev 1, then rev 2
node probe.mjs ... ; node model-probe.mjs ... ; node hook-probe.mjs ...        # token from `ug auth-token`, set in-process only
node egress-probe.mjs ... (with docker network create --internal)
node capped-run-probe.mjs ... 0.0001 ; node baseline-run.mjs ...
```

Scratch branches created in the scratch clone (not pushed): `spike/s1-probe`, `spike/s1-model-probe`, `spike/s1-egress-test`, `spike/s1-capped`, `spike/s1-smoke`.

// S1 round 3, long-run test (>15 minutes). NOT STARTED by this change; run it only when the user has created
// a subscription token on the host (`claude setup-token`) and given its file path.
//
// The token is read from <token-file>. It is never read from the environment or from argv, never printed,
// and never written into the repo. The path is the only argument that names it. The token file must be mode
// 0600 and must not be inside the repo worktree; the script refuses otherwise.
//
// Topology: sandbox on an --internal network with a dummy CLAUDE_CODE_OAUTH_TOKEN; proxy (MODE=oauth)
// dual-homed (internal + bridge) and holding the real token in its own file, written over docker exec stdin.
// The task: one Haiku run that calls Bash `sleep 60` seventeen times (about 17 minutes of wall time),
// with Bash allowed explicitly through --allowedTools and default permission mode (no bypass).
//
// Usage: node long-run-oauth-test.mjs <clone> <image> <branch> <token-file> <outdir> [model]
//   <clone>  a coach-stack clone (e.g. ~/factory/repos/coach-stack)
//   <image>  the sandbox image tag (factory/coach-stack-node20:3-...)
//   <branch> a fresh scratch branch name in the clone
//   <token-file> host path to the 0600 file holding the subscription token
//   <outdir> host directory for the summary JSON
import { createSandbox } from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [clone, imageName, branch, tokenFile, outdir, model = "haiku"] = process.argv.slice(2);
if (!tokenFile || !outdir) throw new Error("usage: long-run-oauth-test.mjs <clone> <image> <branch> <token-file> <outdir> [model]");

// Refuse unsafe token files. Checks only the path and mode, never the contents.
const tokenPath = resolve(tokenFile);
const st = fs.statSync(tokenPath);
if ((st.mode & 0o777) !== 0o600) throw new Error(`token file mode must be 0600 (is ${(st.mode & 0o777).toString(8)})`);
if (tokenPath.startsWith(resolve(clone) + path.sep)) throw new Error("token file must not be inside the repo clone");
const token = fs.readFileSync(tokenPath, "utf8").trim();
if (!token) throw new Error("token file is empty");

const HERE = dirname(fileURLToPath(import.meta.url));
const NET = "s1-oauth-internal";
const PROXY = "s1-oauth-proxy";
const DUMMY = "dummy-s1-oauth-not-a-credential";
const sh = (args, input) => execFileSync("docker", args, { input, stdio: [input ? "pipe" : "ignore", "pipe", "pipe"] }).toString().trim();
const tryDocker = (args) => { try { return sh(args); } catch { return ""; } };

// Proxy and network: remove leftovers, then create. The proxy is dual-homed.
tryDocker(["rm", "-f", PROXY]);
tryDocker(["network", "create", "--internal", NET]);
sh(["run", "-d", "--name", PROXY, "--network", NET,
  "-v", `${resolve(HERE, "credential-proxy")}:/app:ro`,
  "-e", "MODE=oauth", "-e", "UPSTREAM_BASE_URL=https://api.anthropic.com",
  "node:20-bookworm-slim", "node", "/app/proxy.mjs"]);
sh(["network", "connect", "bridge", PROXY]);
// The real token goes in over stdin. It is not in env or argv.
sh(["exec", "-i", PROXY, "sh", "-c", "umask 077; mkdir -p /run/s1 && cat > /run/s1/token"], token);

const started = new Date();
let summary;
try {
  await using sandbox = await createSandbox({
    branch, cwd: clone,
    hooks: { sandbox: { onSandboxReady: [{ command: "npm ci --offline --no-audit --no-fund", timeoutMs: 300000 }] } },
    sandbox: docker({ imageName, containerUid: 1000, containerGid: 1000, network: NET,
      env: {
        ANTHROPIC_BASE_URL: `http://${PROXY}:8080`,
        CLAUDE_CODE_OAUTH_TOKEN: DUMMY,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      } }),
  });
  const prompt =
    "Use the Bash tool to run exactly `sleep 60`. Make 17 Bash calls in total, one per turn, waiting for each result " +
    "before the next. After the 17th result, reply with DONE and the number of calls you made.";
  const cmd =
    `COACH_STACK_MEMORY_RUN=1 timeout 2700 claude -p '${prompt}' --model ${model} ` +
    `--permission-mode default --allowedTools 'Bash(sleep 60)' --max-turns 40 --max-budget-usd 1.50 ` +
    `--output-format json > /tmp/long-run.json 2> /tmp/long-run.err; echo exit=$?; cat /tmp/long-run.json | head -c 4000`;
  const r = await sandbox.exec(cmd);
  const exitLine = r.stdout.split("\n")[0];
  let result = null;
  try { result = JSON.parse(r.stdout.split("\n").slice(1).join("\n")); } catch { /* keep null; head may be truncated */ }
  fs.mkdirSync(outdir, { recursive: true });
  execFileSync("docker", ["cp", `${sandbox.sandboxId}:/tmp/long-run.json`, `${outdir}/long-run-output.json`]);
  execFileSync("docker", ["cp", `${sandbox.sandboxId}:/tmp/long-run.err`, `${outdir}/long-run-stderr.txt`]);
  const ended = new Date();
  const mu = result?.modelUsage ? Object.keys(result.modelUsage) : [];
  summary = {
    started_at: started.toISOString(),
    ended_at: ended.toISOString(),
    wall_minutes: Number(((ended - started) / 60000).toFixed(2)),
    over_15_minutes: (ended - started) > 15 * 60000,
    exit: exitLine,
    success: !!result && result.subtype === "success" && result.is_error === false,
    subtype: result?.subtype ?? null,
    model_used: mu,
    num_turns: result?.num_turns ?? null,
    duration_ms: result?.duration_ms ?? null,
    total_cost_usd: result?.total_cost_usd ?? null,
    usage: result?.usage ? { input: result.usage.input_tokens, output: result.usage.output_tokens,
      cache_create: result.usage.cache_creation_input_tokens, cache_read: result.usage.cache_read_input_tokens } : null,
    result_head: String(result?.result ?? "").slice(0, 200),
    proxy_upstream_200s: Number(tryDocker(["logs", PROXY]).split("\n").filter((l) => /-> 200$/.test(l)).length),
    proxy_upstream_non_200: tryDocker(["logs", PROXY]).split("\n").filter((l) => /->\s(4|5)\d\d|upstream error/.test(l)).slice(0, 5).map((l) => l.replace(/\s+/g, " ").slice(0, 160)),
  };
} finally {
  tryDocker(["rm", "-f", PROXY]);
  tryDocker(["network", "rm", NET]);
}
fs.writeFileSync(`${outdir}/long-run-summary.json`, JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));

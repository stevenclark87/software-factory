// S1 round 3, part D: host-spaced long run. Does the one-year setup-token and the OAuth-mode proxy keep
// working past 15 minutes, and does a resumed session still work then? The agent never sleeps. The
// host waits between calls, and all calls run in ONE sandbox, which stays up for the whole test, so the
// session files persist for --resume.
//
// Schedule (minutes from call 1): 0 fresh, 8 fresh, 16 resume call 1's session, 20 fresh.
// The token is read from <token-file> (mode 0600, outside the repo). It is never printed or logged.
// Usage: node long-run-spaced-test.mjs <clone> <image> <branch> <token-file> <outdir> [model]
import { createSandbox } from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [clone, imageName, branch, tokenFile, outdir, model = "haiku"] = process.argv.slice(2);
if (!tokenFile || !outdir) throw new Error("usage: long-run-spaced-test.mjs <clone> <image> <branch> <token-file> <outdir> [model]");
const tokenPath = resolve(tokenFile);
const st = fs.statSync(tokenPath);
if ((st.mode & 0o777) !== 0o600) throw new Error(`token file mode must be 0600 (is ${(st.mode & 0o777).toString(8)})`);
if (tokenPath.startsWith(resolve(clone) + path.sep)) throw new Error("token file must not be inside the repo clone");
const token = fs.readFileSync(tokenPath, "utf8").trim();
if (!token) throw new Error("token file is empty");

const HERE = dirname(fileURLToPath(import.meta.url));
const NET = "s1-spaced-internal";
const PROXY = "s1-spaced-proxy";
const DUMMY = "dummy-s1-oauth-not-a-credential";
const sh = (args, input) => execFileSync("docker", args, { input, stdio: [input ? "pipe" : "ignore", "pipe", "pipe"] }).toString();
const tryDocker = (args) => { try { return sh(args); } catch { return ""; } };
const sleepUntil = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms - Date.now())));
const proxyLines = () => tryDocker(["logs", PROXY]).split("\n").filter(Boolean);

fs.mkdirSync(outdir, { recursive: true });
tryDocker(["rm", "-f", PROXY]);
tryDocker(["network", "create", "--internal", NET]);
sh(["run", "-d", "--name", PROXY, "--network", NET,
  "-v", `${resolve(HERE, "credential-proxy")}:/app:ro`,
  "-e", "MODE=oauth", "-e", "UPSTREAM_BASE_URL=https://api.anthropic.com",
  "node:20-bookworm-slim", "node", "/app/proxy.mjs"]);
sh(["network", "connect", "bridge", PROXY]);
sh(["exec", "-i", PROXY, "sh", "-c", "umask 077; mkdir -p /run/s1 && cat > /run/s1/token"], token);

const calls = [];
const ERR_RE = /ENOTFOUND|EAI_AGAIN|ECONN|getaddrinfo|fetch failed|timed out|ETIMEDOUT|\b401\b|\b403\b|unauthori[sz]ed|forbidden|error/i;
let session1 = null;
let t0 = 0;
const schedule = [
  { n: 1, at: 0, word: "ONE", resume: false },
  { n: 2, at: 8, word: "TWO", resume: false },
  { n: 3, at: 16, word: "THREE", resume: true },
  { n: 4, at: 20, word: "FOUR", resume: false },
];

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
  t0 = Date.now();
  for (const c of schedule) {
    await sleepUntil(t0 + c.at * 60000);
    const before = proxyLines().length;
    const started = new Date();
    const resumeFlag = c.resume ? `--resume ${session1}` : "";
    const cmd =
      `COACH_STACK_MEMORY_RUN=1 timeout 300 claude -p 'Reply with the single word ${c.word}.' --model ${model} ` +
      `--permission-mode default --max-turns 2 --max-budget-usd 0.25 ${resumeFlag} ` +
      `--output-format json > /tmp/call-${c.n}.json 2> /tmp/call-${c.n}.err; echo exit=$?`;
    const r = await sandbox.exec(cmd);
    const ended = new Date();
    execFileSync("docker", ["cp", `${sandbox.sandboxId}:/tmp/call-${c.n}.json`, `${outdir}/call-${c.n}-output.json`]);
    execFileSync("docker", ["cp", `${sandbox.sandboxId}:/tmp/call-${c.n}.err`, `${outdir}/call-${c.n}-stderr.txt`]);
    const errText = fs.readFileSync(`${outdir}/call-${c.n}-stderr.txt`, "utf8");
    const errLines = errText.split("\n").filter((l) => ERR_RE.test(l) && !/hasTrustDialogAccepted|Ignoring 7 permissions/.test(l));
    let j = null;
    try { j = JSON.parse(fs.readFileSync(`${outdir}/call-${c.n}-output.json`, "utf8")); } catch { /* keep null */ }
    if (c.n === 1 && j?.session_id) session1 = j.session_id;
    const newProxy = proxyLines().slice(before);
    const statuses = newProxy.map((l) => (l.match(/->\s(\d{3})/) || [])[1]).filter(Boolean);
    calls.push({
      call: c.n,
      resume: c.resume,
      scheduled_min: c.at,
      started_at: started.toISOString(),
      ended_at: ended.toISOString(),
      minutes_since_call1: Number(((started - t0) / 60000).toFixed(2)),
      exit: r.stdout.trim(),
      session_id: j?.session_id ?? null,
      subtype: j?.subtype ?? null,
      is_error: j?.is_error ?? null,
      result_has_expected_word: String(j?.result ?? "").includes(c.word),
      model_used: j?.modelUsage ? Object.keys(j.modelUsage) : [],
      usage: j?.usage ? { input: j.usage.input_tokens, output: j.usage.output_tokens,
        cache_create: j.usage.cache_creation_input_tokens, cache_read: j.usage.cache_read_input_tokens } : null,
      total_cost_usd_api_equivalent: j?.total_cost_usd ?? null,
      upstream_statuses: statuses,
      upstream_401_403: statuses.filter((s) => s === "401" || s === "403").length,
      sandbox_error_lines: errLines.length,
      sandbox_error_sample: errLines.slice(0, 3).map((l) => l.replace(/\s+/g, " ").slice(0, 160)),
    });
    console.log(JSON.stringify(calls[calls.length - 1]));
  }
} finally {
  // Save the proxy's full request log before the container is removed (no header values are logged).
  fs.writeFileSync(`${outdir}/proxy-requests.log`, proxyLines().join("\n") + "\n");
  tryDocker(["rm", "-f", PROXY]);
  tryDocker(["network", "rm", NET]);
}
fs.writeFileSync(`${outdir}/spaced-calls.json`, JSON.stringify(calls, null, 2) + "\n");
const after15 = calls.filter((c) => c.minutes_since_call1 >= 15);
console.log(JSON.stringify({
  calls: calls.length,
  all_calls_succeeded: calls.every((c) => c.subtype === "success" && c.is_error === false && c.result_has_expected_word),
  calls_after_15_min: after15.map((c) => c.call),
  calls_after_15_min_all_succeeded: after15.every((c) => c.subtype === "success" && c.is_error === false),
  upstream_401_403_total: calls.reduce((n, c) => n + c.upstream_401_403, 0),
}, null, 2));

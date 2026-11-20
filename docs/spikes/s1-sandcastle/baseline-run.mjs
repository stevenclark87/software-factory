// S1 baseline: one real Sandcastle run() of Claude Code (print mode) on a scratch branch of the
// coach-stack clone. Trivial task; reads the read-only fixture, writes one file, commits it.
// Usage: ANTHROPIC_AUTH_TOKEN=<minted at run start> node baseline-run.mjs <clone> <image> <branch> <ro-fixture-dir>
import { run, claudeCode } from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";

const [clone, imageName, branch, fixtureDir] = process.argv.slice(2);
const MODEL = "system.ai.claude-opus-5-5";
const need = (k) => { if (!process.env[k]) throw new Error(`host env ${k} is not set`); return process.env[k]; };
const gatewayEnv = {
  CLAUDE_CODE_USE_GATEWAY: "1",
  ANTHROPIC_BASE_URL: need("ANTHROPIC_BASE_URL"),
  ANTHROPIC_CUSTOM_HEADERS: need("ANTHROPIC_CUSTOM_HEADERS"),
  ANTHROPIC_AUTH_TOKEN: need("ANTHROPIC_AUTH_TOKEN"),
};
const TRUST = "cat > /tmp/trust.cjs <<'EOF'\nconst fs=require('fs');const p=process.env.HOME+'/.claude.json';\nconst j=fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):{};j.projects=j.projects||{};\nconst k=process.cwd();j.projects[k]={...(j.projects[k]||{}),hasTrustDialogAccepted:true};fs.writeFileSync(p,JSON.stringify(j));\nEOF\nnode /tmp/trust.cjs && echo trust-accepted";
const PROMPT = [
  "Read /mnt/ticket/ticket.md (read-only fixture). Create the file s1-smoke/notes.txt containing exactly one line:",
  "the first line of ticket.md. Then stage only that file and commit it with the message",
  "'chore(spike): S1 smoke run note'. Change nothing else. Do not run npm. Stop after the commit.",
].join(" ");

const t0 = Date.now();
const result = await run({
  name: "s1-baseline",
  cwd: clone,
  agent: claudeCode(MODEL, {
    env: {
      COACH_STACK_MEMORY_RUN: "1",
      GIT_AUTHOR_NAME: "s1-smoke-agent", GIT_AUTHOR_EMAIL: "s1-smoke-agent@example.invalid",
      GIT_COMMITTER_NAME: "s1-smoke-agent", GIT_COMMITTER_EMAIL: "s1-smoke-agent@example.invalid",
    },
  }),
  sandbox: docker({
    imageName, containerUid: 1000, containerGid: 1000, env: gatewayEnv,
    mounts: [{ hostPath: fixtureDir, sandboxPath: "/mnt/ticket", readonly: true }],
  }),
  branchStrategy: { type: "branch", branch },
  hooks: { sandbox: { onSandboxReady: [
    { command: "npm ci --offline --no-audit --no-fund", timeoutMs: 300000 },
    { command: TRUST },
  ] } },
  prompt: PROMPT,
  maxIterations: 1,
  idleTimeoutSeconds: 300,
});
const wall = (Date.now() - t0) / 1000;

// Pull the final stream-json "result" event for tokens, cost and duration.
const events = result.stdout.split("\n").filter((l) => l.startsWith("{")).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const fin = [...events].reverse().find((e) => e.type === "result");
console.log(JSON.stringify({
  wall_seconds: wall,
  iterations: result.iterations.length,
  commits: result.commits,
  branch: result.branch,
  log: result.logFilePath ? "written (host .sandcastle, not recorded)" : null,
  result_event: fin && {
    subtype: fin.subtype, is_error: fin.is_error, num_turns: fin.num_turns, duration_ms: fin.duration_ms,
    duration_api_ms: fin.duration_api_ms, total_cost_usd: fin.total_cost_usd,
    usage: fin.usage && { input: fin.usage.input_tokens, output: fin.usage.output_tokens,
      cache_create: fin.usage.cache_creation_input_tokens, cache_read: fin.usage.cache_read_input_tokens },
    result_head: String(fin.result ?? "").slice(0, 200),
  },
  tool_uses: events.flatMap((e) => (e.message?.content ?? []).filter((c) => c.type === "tool_use").map((c) => c.name)),
}, null, 2));

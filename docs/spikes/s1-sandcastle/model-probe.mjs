// S1 model probe: auth through the gateway, --max-budget-usd, --setting-sources,
// and COACH_STACK_MEMORY_RUN. Uses the cheapest Haiku model; no secrets are printed.
// Usage: ANTHROPIC_AUTH_TOKEN=<minted at run start> node model-probe.mjs <clone> <image> <branch>
import { createSandbox } from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";

const [clone, imageName, branch] = process.argv.slice(2);
const MODEL = "system.ai.claude-haiku-5-5";
const need = (k) => { if (!process.env[k]) throw new Error(`host env ${k} is not set`); return process.env[k]; };

const env = {
  CLAUDE_CODE_USE_GATEWAY: "1",
  ANTHROPIC_BASE_URL: need("ANTHROPIC_BASE_URL"),
  ANTHROPIC_CUSTOM_HEADERS: need("ANTHROPIC_CUSTOM_HEADERS"),
  ANTHROPIC_AUTH_TOKEN: need("ANTHROPIC_AUTH_TOKEN"),
};
const CONTEXT_PROMPT =
  "Answer each item yes or no, one per line, no other text. " +
  "a) Your context contains the heading Project knowledge (OKF bundle from a SessionStart hook. " +
  "b) Your context contains project instructions from a CLAUDE.md file for Coach Stack. " +
  "c) Your context lists a skill named tdd. " +
  "d) Your context lists a skill named react.";

const summarize = (stdout) => {
  const line = stdout.trim().split("\n").filter((l) => l.startsWith("{")).pop();
  if (!line) return stdout.trim().slice(0, 400);
  const j = JSON.parse(line);
  return JSON.stringify({
    subtype: j.subtype, is_error: j.is_error, num_turns: j.num_turns, duration_ms: j.duration_ms,
    total_cost_usd: j.total_cost_usd, usage: j.usage && { in: j.usage.input_tokens, out: j.usage.output_tokens,
      cache_create: j.usage.cache_creation_input_tokens, cache_read: j.usage.cache_read_input_tokens },
    result: String(j.result ?? "").slice(0, 200),
  });
};

// Sandbox open: install from the baked cache, then accept workspace trust in the container's own Claude config.
const TRUST = "cat > /tmp/trust.cjs <<EOF\nconst fs=require(fs);const p=process.env.HOME+/.claude.json;\nconst j=fs.existsSync(p)?JSON.parse(fs.readFileSync(p,utf8)):{};j.projects=j.projects||{};\nconst k=process.cwd();j.projects[k]={...(j.projects[k]||{}),hasTrustDialogAccepted:true};fs.writeFileSync(p,JSON.stringify(j));\nEOF\nnode /tmp/trust.cjs && echo trust-accepted";
await using sandbox = await createSandbox({ branch, cwd: clone, sandbox: docker({ imageName, containerUid: 1000, containerGid: 1000, env }),
  hooks: { sandbox: { onSandboxReady: [{ command: "npm ci --offline --no-audit --no-fund", timeoutMs: 300000 }, { command: TRUST }] } } });
const run = async (label, cmd) => {
  const r = await sandbox.exec(cmd);
  console.log(`--- ${label} exit=${r.exitCode}`);
  console.log(r.exitCode === 0 || r.stdout ? summarize(r.stdout) : (r.stderr || "").slice(0, 400));
  if (r.stderr && r.exitCode !== 0) console.log("stderr:", r.stderr.slice(0, 400));
  return r;
};
const claude = (flags, prompt) => `claude -p '${prompt}' --model ${MODEL} --dangerously-skip-permissions ${flags}`;

// 1. Auth through the gateway, with usage numbers.
await run("1 auth + usage (json)", claude("--output-format json --max-turns 1", "Reply with the single word OK."));
// 2. Budget flag in print mode: expect a budget-exceeded subtype.
await run("2 --max-budget-usd 0.0001", claude("--output-format json --max-turns 1 --max-budget-usd 0.0001", "Reply with the single word OK."));
// 3-5. Context inventory with default sources, --setting-sources local, and the memory env var.
await run("3 context default", claude("--output-format json --max-turns 1", CONTEXT_PROMPT));
await run("4 context --setting-sources local", claude("--output-format json --max-turns 1 --setting-sources local", CONTEXT_PROMPT));
await run("5 context COACH_STACK_MEMORY_RUN=1", `COACH_STACK_MEMORY_RUN=1 ${claude("--output-format json --max-turns 1", CONTEXT_PROMPT)}`);
// 6. Hook scripts run directly (no model): does the env var silence them?
await run("6a session-start hook, unset", "node --no-warnings scripts/memory/session-start.mjs < /dev/null | wc -c");
await run("6b session-start hook, env=1", "COACH_STACK_MEMORY_RUN=1 node --no-warnings scripts/memory/session-start.mjs < /dev/null | wc -c");
await run("6c capture hook stop, env=1", "COACH_STACK_MEMORY_RUN=1 node --no-warnings scripts/memory/capture.mjs stop < /dev/null; echo exit=$?");

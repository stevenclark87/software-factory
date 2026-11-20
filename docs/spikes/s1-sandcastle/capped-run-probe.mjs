// S1: can run() pass --max-turns and --max-budget-usd? claudeCode() has no such option, so this
// wraps it in a custom AgentProvider that appends the flags to the print command.
// Usage: ANTHROPIC_AUTH_TOKEN=<minted> node capped-run-probe.mjs <clone> <image> <branch> <budgetUsd>
import { run, claudeCode } from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";

const [clone, imageName, branch, budget] = process.argv.slice(2);
const need = (k) => { if (!process.env[k]) throw new Error(`host env ${k} is not set`); return process.env[k]; };
const TRUST = "cat > /tmp/trust.cjs <<'EOF'\nconst fs=require('fs');const p=process.env.HOME+'/.claude.json';\nconst j=fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):{};j.projects=j.projects||{};\nconst k=process.cwd();j.projects[k]={...(j.projects[k]||{}),hasTrustDialogAccepted:true};fs.writeFileSync(p,JSON.stringify(j));\nEOF\nnode /tmp/trust.cjs && echo trust-accepted";

function cappedClaudeCode(model, { maxTurns, maxBudgetUsd, env }) {
  const base = claudeCode(model, { env });
  return {
    ...base,
    name: "claude-code-capped",
    buildPrintCommand(options) {
      const p = base.buildPrintCommand(options);
      if (!p.command.includes(" -p -")) throw new Error("unexpected print command shape");
      return { ...p, command: p.command.replace(" -p -", ` --max-turns ${maxTurns} --max-budget-usd ${maxBudgetUsd} -p -`) };
    },
  };
}

const result = await run({
  name: "s1-capped",
  cwd: clone,
  agent: cappedClaudeCode("system.ai.claude-haiku-5-5", {
    maxTurns: 1, maxBudgetUsd: budget, env: { COACH_STACK_MEMORY_RUN: "1" },
  }),
  sandbox: docker({
    imageName, containerUid: 1000, containerGid: 1000,
    env: {
      CLAUDE_CODE_USE_GATEWAY: "1",
      ANTHROPIC_BASE_URL: need("ANTHROPIC_BASE_URL"),
      ANTHROPIC_CUSTOM_HEADERS: need("ANTHROPIC_CUSTOM_HEADERS"),
      ANTHROPIC_AUTH_TOKEN: need("ANTHROPIC_AUTH_TOKEN"),
    },
  }),
  branchStrategy: { type: "branch", branch },
  hooks: { sandbox: { onSandboxReady: [{ command: "npm ci --offline --no-audit --no-fund", timeoutMs: 300000 }, { command: TRUST }] } },
  prompt: "Reply with the single word OK.",
  maxIterations: 1,
  idleTimeoutSeconds: 120,
}).then(
  (r) => ({ outcome: "resolved", commits: r.commits.length, stdout_head: r.stdout.slice(0, 200) }),
  (e) => ({ outcome: "rejected", error: String(e?.message ?? e).slice(0, 400) }),
);
console.log(JSON.stringify(result, null, 2));

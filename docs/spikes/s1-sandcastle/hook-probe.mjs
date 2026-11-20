// S1 follow-up: is the SessionStart snapshot reaching the model in -p mode, and does workspace trust hold?
// Usage: ANTHROPIC_AUTH_TOKEN=<minted at run start> node hook-probe.mjs <clone> <image> <branch>
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
const TRUST = "cat > /tmp/trust.cjs <<'EOF'\nconst fs=require('fs');const p=process.env.HOME+'/.claude.json';\nconst j=fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):{};j.projects=j.projects||{};\nconst k=process.cwd();j.projects[k]={...(j.projects[k]||{}),hasTrustDialogAccepted:true};fs.writeFileSync(p,JSON.stringify(j));\nEOF\nnode /tmp/trust.cjs && echo trust-accepted";
await using sandbox = await createSandbox({ branch, cwd: clone, sandbox: docker({ imageName, containerUid: 1000, containerGid: 1000, env }),
  hooks: { sandbox: { onSandboxReady: [{ command: "npm ci --offline --no-audit --no-fund", timeoutMs: 300000 }, { command: TRUST }] } } });
const run = async (label, cmd) => { const r = await sandbox.exec(cmd); console.log(`--- ${label} exit=${r.exitCode}\n${(r.stdout + "\n[stderr]" + r.stderr).trim().slice(0, 1200)}`); return r; };
await run("A home + trust flag", "echo HOME=$HOME; grep -o '\"hasTrustDialogAccepted\": *[a-z]*' $HOME/.claude.json | head -3");
await run("B default, stream-json, hook events", `claude -p 'Reply with the single word OK.' --model ${MODEL} --dangerously-skip-permissions --output-format stream-json --verbose --max-turns 1 > /tmp/b.jsonl 2>/tmp/b.err; echo "lines=$(wc -l < /tmp/b.jsonl)"; grep -o '"subtype":"[a-z_]*"' /tmp/b.jsonl | sort | uniq -c; grep -o 'hook[a-z_]*' /tmp/b.jsonl | sort | uniq -c | head; grep -c 'OKF bundle' /tmp/b.jsonl; wc -c < /tmp/b.err`);
await run("C setting-sources project", `claude -p 'Answer yes or no for each, one per line, no other text. a) Your context contains project instructions from a CLAUDE.md file for Coach Stack. b) Your context lists a skill named react. c) Your context contains the heading Project knowledge (OKF bundle.' --model ${MODEL} --dangerously-skip-permissions --setting-sources project --output-format json --max-turns 1 | grep -o '"result":"[^"]*"' ; true`);
await run("D default context, same questions", `claude -p 'Answer yes or no for each, one per line, no other text. a) Your context contains project instructions from a CLAUDE.md file for Coach Stack. b) Your context lists a skill named react. c) Your context contains the heading Project knowledge (OKF bundle.' --model ${MODEL} --dangerously-skip-permissions --output-format json --max-turns 1 | grep -o '"result":"[^"]*"'; true`);

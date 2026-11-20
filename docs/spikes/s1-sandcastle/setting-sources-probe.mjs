// S1 follow-up: what does each --setting-sources value load? Evidence is the stream-json init
// event, the hook events, the session transcript's attachments and the stderr permission warning,
// not the model's own answers. Haiku, --max-turns 1.
// Usage: ANTHROPIC_AUTH_TOKEN=<minted at run start> node setting-sources-probe.mjs <clone> <image> <branch> <outdir>
import { createSandbox } from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const [clone, imageName, branch, outdir] = process.argv.slice(2);
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
  hooks: { sandbox: { onSandboxReady: [{ command: "npm ci --offline --no-audit --no-fund", timeoutMs: 300000 }] } } });
// Trust is deliberately NOT accepted for the default and project cases: it is the factory's default
// position that permissions must not depend on trust. The local case runs with the same no-trust state.
const cases = { default: "", project: "--setting-sources project", local: "--setting-sources local" };
for (const [name, flags] of Object.entries(cases)) {
  const cmd = `rm -f /tmp/${name}.jsonl /tmp/${name}.err; claude -p 'Reply with the single word OK.' --model ${MODEL} --dangerously-skip-permissions --output-format stream-json --verbose --max-turns 1 ${flags} > /tmp/${name}.jsonl 2>/tmp/${name}.err; echo exit=$?; SESS=$(ls -t $HOME/.claude/projects/*/*.jsonl | head -1); cp "$SESS" /tmp/${name}.session.jsonl`;
  const r = await sandbox.exec(cmd);
  console.log(name, r.stdout.trim(), r.stderr.trim().slice(0, 200));
  mkdirSync(`${outdir}/${name}`, { recursive: true });
  for (const f of [`${name}.jsonl`, `${name}.err`, `${name}.session.jsonl`]) {
    execFileSync("docker", ["cp", `${sandbox.sandboxId}:/tmp/${f}`, `${outdir}/${name}/${f}`]);
  }
}

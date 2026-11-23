// S1 round 3: what does Claude Code send in OAuth mode (CLAUDE_CODE_OAUTH_TOKEN) when its base URL is an
// internal recording proxy? The sandbox holds only a dummy token. No real credential is passed.
// Usage: OAUTH_OUT=<host dir> node oauth-dummy-probe.mjs <clone> <image> <branch> <network> <recorder container>
import { createSandbox } from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const [clone, imageName, branch, network, recorder] = process.argv.slice(2);
const OUT = process.env.OAUTH_OUT || "/tmp/s1-oauth";
await using sandbox = await createSandbox({
  branch, cwd: clone,
  hooks: { sandbox: { onSandboxReady: [{ command: "npm ci --offline --no-audit --no-fund", timeoutMs: 300000 }] } },
  sandbox: docker({ imageName, containerUid: 1000, containerGid: 1000, network,
    env: {
      ANTHROPIC_BASE_URL: `http://${recorder}:8080`,
      CLAUDE_CODE_OAUTH_TOKEN: "dummy-s1-oauth-not-a-credential",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    } }),
});
const r = await sandbox.exec(
  "timeout 150 claude -p 'Reply with the single word OK.' --model system.ai.claude-haiku-5-5 --dangerously-skip-permissions --max-turns 1 --output-format json --debug > /tmp/oauth-out.json 2> /tmp/oauth-err.txt; echo exit=$?; env | grep -c -E '^ANTHROPIC_(AUTH_TOKEN|API_KEY)=' || true",
);
console.log(r.stdout.trim(), r.stderr.trim());
fs.mkdirSync(OUT, { recursive: true });
for (const f of ["oauth-err.txt", "oauth-out.json"]) {
  execFileSync("docker", ["cp", `${sandbox.sandboxId}:/tmp/${f}`, `${OUT}/${f}`]);
}
console.log("debug files copied to", OUT);

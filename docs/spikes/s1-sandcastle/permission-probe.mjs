// S1 follow-up: do factory permissions apply WITHOUT workspace trust? Non-bypass permission mode,
// no trust accepted. Case A: --disallowedTools flag. Case B: --settings file with permissions.deny.
// Evidence: the tool_result of the Bash call (denied or executed) in the stream-json output.
// Usage: ANTHROPIC_AUTH_TOKEN=<minted> node permission-probe.mjs <clone> <image> <branch> <outdir>
import { createSandbox } from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const [clone, imageName, branch, outdir] = process.argv.slice(2);
const MODEL = "system.ai.claude-haiku-5-5";
const need = (k) => { if (!process.env[k]) throw new Error(`host env ${k} is not set`); return process.env[k]; };
const env = { CLAUDE_CODE_USE_GATEWAY: "1", ANTHROPIC_BASE_URL: need("ANTHROPIC_BASE_URL"),
  ANTHROPIC_CUSTOM_HEADERS: need("ANTHROPIC_CUSTOM_HEADERS"), ANTHROPIC_AUTH_TOKEN: need("ANTHROPIC_AUTH_TOKEN") };
const PROMPT = "Run the shell command: curl --version . Then reply with DONE.";
const SETTINGS = JSON.stringify({ permissions: { allow: ["Bash(ls *)"], deny: ["Bash(curl *)"] } });

await using sandbox = await createSandbox({ branch, cwd: clone, sandbox: docker({ imageName, containerUid: 1000, containerGid: 1000, env }),
  hooks: { sandbox: { onSandboxReady: [{ command: "npm ci --offline --no-audit --no-fund", timeoutMs: 300000 }] } } });
const cases = {
  A_disallowed_flag: `claude -p '${PROMPT}' --model ${MODEL} --permission-mode default --disallowedTools 'Bash(curl *)' --output-format stream-json --verbose --max-turns 3`,
  B_settings_file: `printf '%s' '${SETTINGS}' > /tmp/factory-settings.json && claude -p '${PROMPT}' --model ${MODEL} --permission-mode default --settings /tmp/factory-settings.json --output-format stream-json --verbose --max-turns 3`,
};
for (const [name, base] of Object.entries(cases)) {
  const cmd = `${base} > /tmp/${name}.jsonl 2>/tmp/${name}.err; echo exit=$?`;
  const r = await sandbox.exec(cmd);
  mkdirSync(outdir, { recursive: true });
  for (const f of [`${name}.jsonl`, `${name}.err`]) execFileSync("docker", ["cp", `${sandbox.sandboxId}:/tmp/${f}`, `${outdir}/${f}`]);
  console.log(name, r.stdout.trim(), "stderr:", r.stderr.trim().slice(0, 160));
}

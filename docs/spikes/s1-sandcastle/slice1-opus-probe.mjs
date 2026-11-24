// S1 slice 1 pre-work, probe 3 (re-run): one tiny Opus call over OAuth through the proxy.
// The first attempt in slice1-sandbox-probes.mjs used --max-budget-usd 0.10 and hit error_max_budget_usd
// on the first call (cache creation). The call itself reached the model. This re-run uses a $0.50 cap.
// Usage: node slice1-opus-probe.mjs <scratch clone> <image> <token file> <out root>
import { createSandbox } from "@ai-hero/sandcastle";
import { docker as dockerSandbox } from "@ai-hero/sandcastle/sandboxes/docker";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  NET, OPUS, INSTALL_HOOK, sandboxEnv, checkToken, startProxy, stopProxy, proxyLogText,
} from "./slice1-lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const [clone, imageName, tokenFile, outRoot] = process.argv.slice(2);
const out = path.join(outRoot, "opus-probe");
fs.mkdirSync(out, { recursive: true });
const tokenPath = checkToken(tokenFile, clone);
startProxy(tokenPath, path.join(HERE, "credential-proxy"));
let summary;
try {
  await using sb = await createSandbox({
    branch: "spike/s1-slice1-opus",
    cwd: clone,
    sandbox: dockerSandbox({ imageName, containerUid: 1000, containerGid: 1000, network: NET, env: sandboxEnv() }),
    hooks: { sandbox: { onSandboxReady: [INSTALL_HOOK] } },
  });
  const r = await sb.exec(
    `rm -f /tmp/p3b.json /tmp/p3b.err; claude -p 'Reply with the single word OK.' --model ${OPUS} --max-turns 1 --max-budget-usd 0.50 ` +
    `--output-format json > /tmp/p3b.json 2> /tmp/p3b.err; echo exit=$?`,
  );
  execFileSync("docker", ["cp", `${sb.sandboxId}:/tmp/p3b.json`, path.join(out, "p3b-opus.json")]);
  execFileSync("docker", ["cp", `${sb.sandboxId}:/tmp/p3b.err`, path.join(out, "p3b-opus.err")]);
  const j = JSON.parse(fs.readFileSync(path.join(out, "p3b-opus.json"), "utf8") || "{}");
  const mu = j.modelUsage ? Object.values(j.modelUsage)[0] : null;
  summary = {
    model_requested: OPUS,
    max_budget_usd: 0.5,
    exit: r.stdout.trim(),
    subtype: j.subtype ?? null,
    is_error: j.is_error ?? null,
    terminal_reason: j.terminal_reason ?? null,
    result: typeof j.result === "string" ? j.result.slice(0, 200) : null,
    num_turns: j.num_turns ?? null,
    total_cost_usd: j.total_cost_usd ?? null,
    model_served: j.modelUsage ? Object.keys(j.modelUsage) : null,
    input_tokens: mu?.inputTokens ?? null,
    output_tokens: mu?.outputTokens ?? null,
    cache_creation_tokens: mu?.cacheCreationInputTokens ?? null,
    cache_read_tokens: mu?.cacheReadInputTokens ?? null,
    errors: j.errors ?? null,
    stderr_head: fs.readFileSync(path.join(out, "p3b-opus.err"), "utf8").slice(0, 300),
  };
  console.log(JSON.stringify(summary, null, 2));
} finally {
  fs.writeFileSync(path.join(out, "proxy.log"), proxyLogText());
  stopProxy();
}
if (summary) fs.writeFileSync(path.join(out, "summary.json"), JSON.stringify(summary, null, 2) + "\n");

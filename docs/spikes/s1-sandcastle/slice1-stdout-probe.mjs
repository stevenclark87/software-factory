// S1 slice 1 pre-work, probe 4: is Sandcastle's result.stdout the raw stream-json, or summarized text?
// Runs through run() with an AgentProvider wrapper (the slice 1 wrapper pattern): permission mode
// default (not the Sandcastle bypass flag), project setting sources, the factory settings file, and
// --max-turns / --max-budget-usd. The raw stream is tee'd to a host-mounted file so it can be compared
// with result.stdout. captureSessions is off, so nothing is written to the host's ~/.claude.
// Usage: node slice1-stdout-probe.mjs <scratch clone> <image> <token file> <out root>
import { run, claudeCode } from "@ai-hero/sandcastle";
import { docker as dockerSandbox } from "@ai-hero/sandcastle/sandboxes/docker";
import fs from "node:fs";
import path from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  NET, HAIKU, INSTALL_HOOK, sandboxEnv, checkToken, startProxy, stopProxy, proxyLogText, jsonLines,
} from "./slice1-lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const [clone, imageName, tokenFile, outRoot] = process.argv.slice(2);
if (!outRoot) throw new Error("usage: slice1-stdout-probe.mjs <clone> <image> <token file> <out root>");
const out = path.join(outRoot, "stdout-probe");
const cfgDir = path.join(outRoot, "factory-config"); // written by slice1-sandbox-probes.mjs
fs.mkdirSync(out, { recursive: true });
if (!fs.existsSync(path.join(cfgDir, "settings.json"))) throw new Error("run slice1-sandbox-probes.mjs first (factory-config)");

// Wrapper: Sandcastle's claudeCode() builds the print command. We keep its command and insert the flags.
// The raw stream is copied by tee into the mounted out dir. pipefail keeps claude's exit status.
function factoryClaudeCode(model) {
  // COACH_STACK_MEMORY_RUN is set on the sandbox (sandboxEnv); Sandcastle rejects it on both providers.
  const base = claudeCode(model, { permissionMode: "default", captureSessions: false });
  return {
    ...base,
    name: "claude-code-slice1",
    buildPrintCommand(options) {
      const p = base.buildPrintCommand(options);
      if (!p.command.includes(" -p -")) throw new Error("unexpected print command shape");
      const extra = " --setting-sources project --settings /mnt/factory-config/settings.json --max-turns 2 --max-budget-usd 0.25";
      const cmd = p.command.replace(" -p -", `${extra} -p -`) + " | tee /mnt/slice1-out/raw-stream.jsonl";
      return { ...p, command: `bash -o pipefail -c "${cmd}"` };
    },
  };
}

const tokenPath = checkToken(tokenFile, clone);
startProxy(tokenPath, path.join(HERE, "credential-proxy"));
let summary;
try {
  const r = await run({
    name: "s1-slice1-stdout",
    cwd: clone,
    agent: factoryClaudeCode(HAIKU),
    sandbox: dockerSandbox({
      imageName, containerUid: 1000, containerGid: 1000, network: NET,
      env: sandboxEnv(),
      mounts: [
        { hostPath: cfgDir, sandboxPath: "/mnt/factory-config", readonly: true },
        { hostPath: out, sandboxPath: "/mnt/slice1-out", readonly: false },
      ],
    }),
    branchStrategy: { type: "branch", branch: "spike/s1-slice1-stdout" },
    hooks: { sandbox: { onSandboxReady: [INSTALL_HOOK] } },
    prompt: "Run the shell command ls and then reply with the single word DONE.",
    maxIterations: 1,
    idleTimeoutSeconds: 120,
  }).then(
    (x) => ({ outcome: "resolved", stdout: x.stdout, commits: x.commits.length }),
    (e) => ({ outcome: "rejected", error: String(e?.message ?? e).slice(0, 400) }),
  );
  const raw = fs.existsSync(path.join(out, "raw-stream.jsonl")) ? fs.readFileSync(path.join(out, "raw-stream.jsonl"), "utf8") : "";
  const rawEvents = jsonLines(raw);
  // What Sandcastle's invokeAgent accumulates: text blocks from assistant events, plus each result string.
  const textBlocks = rawEvents.filter((e) => e.type === "assistant")
    .flatMap((e) => (e.message?.content ?? []).filter((b) => b.type === "text").map((b) => b.text));
  const resultStr = rawEvents.find((e) => e.type === "result")?.result ?? "";
  const expectedAccumulated = textBlocks.join("") + resultStr;
  summary = {
    outcome: r.outcome,
    error: r.error ?? null,
    stdout_bytes: r.stdout ? Buffer.byteLength(r.stdout) : null,
    stdout_first_char: r.stdout ? r.stdout[0] : null,
    stdout_lines_starting_with_brace: r.stdout ? r.stdout.split("\n").filter((l) => l.startsWith("{")).length : null,
    stdout_head: r.stdout ? r.stdout.slice(0, 160) : null,
    raw_stream_lines: raw.split("\n").filter(Boolean).length,
    raw_stream_json_lines: rawEvents.length,
    raw_event_types: [...new Set(rawEvents.map((e) => `${e.type}${e.subtype ? ":" + e.subtype : ""}`))],
    assistant_text_blocks: textBlocks.length,
    result_event_string: resultStr.slice(0, 120),
    stdout_equals_raw_text_accumulation: r.stdout === expectedAccumulated,
    stdout_equals_raw_lines: r.stdout === raw,
    result_event: rawEvents.find((e) => e.type === "result") ? {
      subtype: rawEvents.find((e) => e.type === "result").subtype,
      num_turns: rawEvents.find((e) => e.type === "result").num_turns,
      total_cost_usd: rawEvents.find((e) => e.type === "result").total_cost_usd,
      permission_denials: rawEvents.find((e) => e.type === "result").permission_denials ?? [],
    } : null,
  };
} finally {
  fs.writeFileSync(path.join(out, "proxy.log"), proxyLogText());
  stopProxy();
}
fs.writeFileSync(path.join(out, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));

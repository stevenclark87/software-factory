// S1 slice 1 pre-work, probes 1, 2, 3 and 5, in ONE sandbox with short `claude -p` calls.
// Evidence is taken from stream-json events (init, tool_use, tool_result, hook events, result), the
// session transcript, and sandbox exit codes. Not from the model's own answers.
// Trust is NOT accepted: no hasTrustDialogAccepted write anywhere (ADR 0003 decision 2).
// Usage: node slice1-sandbox-probes.mjs <scratch clone> <image> <token file> <out root>
import { createSandbox } from "@ai-hero/sandcastle";
import { docker as dockerSandbox } from "@ai-hero/sandcastle/sandboxes/docker";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  NET, HAIKU, OPUS, INSTALL_HOOK, sandboxEnv, checkToken, startProxy, stopProxy, proxyLogText,
  jsonLines, summarizeStream,
} from "./slice1-lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const [clone, imageName, tokenFile, outRoot] = process.argv.slice(2);
if (!outRoot) throw new Error("usage: slice1-sandbox-probes.mjs <clone> <image> <token file> <out root>");

const out = path.join(outRoot, "sandbox-probes");
const cfgDir = path.join(outRoot, "factory-config");
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(cfgDir, { recursive: true });

// Factory settings for probe 2. Mounted read-only into the sandbox, outside the worktree.
// `Bash(hostname)` is a probe marker: coach-stack's own settings do not deny it, so a denial can only
// come from this file.
const FACTORY_SETTINGS = {
  permissions: {
    allow: ["Read(./**)", "Edit(./**)", "Write(./**)", "Bash(ls *)"],
    deny: ["Read(./.env)", "Read(**/.env)", "Bash(curl:*)", "Bash(curl *)", "Bash(hostname)", "Bash(hostname *)"],
  },
};
fs.writeFileSync(path.join(cfgDir, "settings.json"), JSON.stringify(FACTORY_SETTINGS, null, 2) + "\n");

const PROMPT_OK = "Reply with the single word OK.";
const PROMPTS = {
  edit: (tag) => `Create a file named slice1-edit-${tag}.txt in the current directory containing the word hello, then reply DONE.`,
  curl: "Run the shell command curl --version and then reply DONE.",
  env: "Read the file .env and then reply DONE.",
  host: "Run the shell command hostname and then reply DONE.",
};
const FACTORY = "--setting-sources project --settings /mnt/factory-config/settings.json";
const CONTROL = "--setting-sources project";

const tokenPath = checkToken(tokenFile, clone);
startProxy(tokenPath, path.join(HERE, "credential-proxy"));

const results = {};
let sandboxInspect = null;

function copyOut(sb, file, dest) {
  execFileSync("docker", ["cp", `${sb.sandboxId}:${file}`, dest]);
}

async function claudeRun(sb, name, flags, prompt, { session = false, prefix = "" } = {}) {
  const sessCopy = session
    ? `; SESS=$(ls -t $HOME/.claude/projects/*/*.jsonl | head -1); cp "$SESS" /tmp/${name}.session.jsonl`
    : "";
  const cmd =
    `rm -f /tmp/${name}.jsonl /tmp/${name}.err /tmp/${name}.session.jsonl; ${prefix}` +
    `claude -p '${prompt}' ${flags} --output-format stream-json --verbose ` +
    `> /tmp/${name}.jsonl 2> /tmp/${name}.err; echo exit=$?${sessCopy}`;
  const r = await sb.exec(cmd);
  const files = ["jsonl", "err", ...(session ? ["session.jsonl"] : [])];
  for (const ext of files) copyOut(sb, `/tmp/${name}.${ext}`, path.join(out, `${name}.${ext}`));
  const events = jsonLines(fs.readFileSync(path.join(out, `${name}.jsonl`), "utf8"));
  const err = fs.readFileSync(path.join(out, `${name}.err`), "utf8");
  const rec = {
    name,
    exit: r.stdout.trim(),
    stderr_lines: err.split("\n").filter(Boolean).slice(0, 4).map((l) => l.slice(0, 200)),
    ...summarizeStream(events),
  };
  if (session) {
    const sessEvents = jsonLines(fs.readFileSync(path.join(out, `${name}.session.jsonl`), "utf8"));
    rec.transcript_attachments = sessEvents
      .filter((e) => e.type === "attachment")
      .map((e) => ({ type: e.attachment?.type ?? null, mentions_claude_md: JSON.stringify(e).includes("CLAUDE.md") }));
  }
  results[name] = rec;
  console.log(name, "exit", rec.exit, "subtype", rec.result?.subtype, "perm", rec.init?.permissionMode,
    "denials", rec.result?.permission_denials?.length ?? 0);
  return rec;
}

try {
  await using sb = await createSandbox({
    branch: "spike/s1-slice1-sandbox",
    cwd: clone,
    sandbox: dockerSandbox({
      imageName, containerUid: 1000, containerGid: 1000, network: NET,
      env: sandboxEnv(),
      mounts: [{ hostPath: cfgDir, sandboxPath: "/mnt/factory-config", readonly: true }],
    }),
    hooks: { sandbox: { onSandboxReady: [INSTALL_HOOK] } },
  });
  sandboxInspect = dockerInspect(sb.sandboxId);
  fs.writeFileSync(path.join(out, "sandbox-inspect-start.json"), sandboxInspect);

  // Dummy .env in the worktree (not committed; removed before close). Value is not a secret.
  await sb.exec("echo SLICE1_PROBE_NOT_A_SECRET > .env");
  results.config_mount_readonly = await sb.exec("touch /mnt/factory-config/x 2>&1; echo exit=$?").then((r) => r.stdout.trim());

  // ---- Probe 1: setting sources at the pin (Haiku, max-turns 1). Project vs local control.
  await claudeRun(sb, "p1-project", `--model ${HAIKU} --permission-mode default --max-turns 1 --setting-sources project`, PROMPT_OK, { session: true });
  await claudeRun(sb, "p1-local", `--model ${HAIKU} --permission-mode default --max-turns 1 --setting-sources local`, PROMPT_OK, { session: true });

  // ---- Probe 2a: does the project defaultMode apply when no --permission-mode flag is given?
  await claudeRun(sb, "p2a-project-noflag", `--model ${HAIKU} --max-turns 1 --setting-sources project`, PROMPT_OK);

  // ---- Probe 2: factory settings, project sources, default mode, max-turns 2.
  for (const [label, base] of [
    ["factory", `${FACTORY} --permission-mode default`],
    ["control", `${CONTROL} --permission-mode default`],
  ]) {
    for (const [kind, prompt] of [
      ["edit", PROMPTS.edit(label)],
      ["curl", PROMPTS.curl],
      ["env", PROMPTS.env],
      ["host", PROMPTS.host],
    ]) {
      await claudeRun(sb, `p2-${label}-${kind}`, `--model ${HAIKU} --max-turns 2 ${base}`, prompt);
    }
  }
  // Alternatives, run regardless so the matrix is complete.
  await claudeRun(sb, "p2-alt-acceptedits-edit", `--model ${HAIKU} --max-turns 2 ${FACTORY} --permission-mode acceptEdits`, PROMPTS.edit("alt-acceptedits"));
  const ALT_FLAGS = `--permission-mode default --allowedTools Edit Write Read --disallowedTools 'Bash(curl:*)' 'Read(./.env)' 'Bash(hostname)'`;
  await claudeRun(sb, "p2-alt-flags-edit", `--model ${HAIKU} --max-turns 2 ${CONTROL} ${ALT_FLAGS}`, PROMPTS.edit("alt-flags"));
  await claudeRun(sb, "p2-alt-flags-curl", `--model ${HAIKU} --max-turns 2 ${CONTROL} ${ALT_FLAGS}`, PROMPTS.curl);
  await claudeRun(sb, "p2-alt-flags-env", `--model ${HAIKU} --max-turns 2 ${CONTROL} ${ALT_FLAGS}`, PROMPTS.env);
  await claudeRun(sb, "p2-alt-flags-host", `--model ${HAIKU} --max-turns 2 ${CONTROL} ${ALT_FLAGS}`, PROMPTS.host);

  // Which edit files actually exist after the matrix (file system evidence, independent of the model).
  results.edit_files_present = await sb.exec("ls -1 slice1-edit-*.txt 2>/dev/null; echo done").then((r) => r.stdout.trim());

  // ---- Probe 3: Opus over OAuth through the proxy, one tiny call, json output for the result event.
  const p3 = await sb.exec(
    `rm -f /tmp/p3.json /tmp/p3.err; claude -p '${PROMPT_OK}' --model ${OPUS} --max-turns 1 --max-budget-usd 0.10 ` +
    `--output-format json > /tmp/p3.json 2> /tmp/p3.err; echo exit=$?`,
  );
  copyOut(sb, "/tmp/p3.json", path.join(out, "p3-opus.json"));
  copyOut(sb, "/tmp/p3.err", path.join(out, "p3-opus.err"));
  const p3json = JSON.parse(fs.readFileSync(path.join(out, "p3-opus.json"), "utf8") || "{}");
  results.p3_opus = {
    model_requested: OPUS,
    exit: p3.stdout.trim(),
    subtype: p3json.subtype ?? null,
    is_error: p3json.is_error ?? null,
    result: typeof p3json.result === "string" ? p3json.result.slice(0, 200) : null,
    num_turns: p3json.num_turns ?? null,
    total_cost_usd: p3json.total_cost_usd ?? null,
    usage: p3json.usage ?? null,
    modelUsage: p3json.modelUsage ? Object.keys(p3json.modelUsage) : null,
    stderr_head: fs.readFileSync(path.join(out, "p3-opus.err"), "utf8").slice(0, 400),
  };
  console.log("p3 opus", results.p3_opus.exit, results.p3_opus.subtype, results.p3_opus.is_error);

  // ---- Probe 5: memory snapshot unwrap. Container env COACH_STACK_MEMORY_RUN=1 is set (sandboxEnv).
  const unset = await sb.exec(
    "CLAUDE_PROJECT_DIR=$PWD env -u COACH_STACK_MEMORY_RUN node --no-warnings scripts/memory/session-start.mjs > /tmp/p5-unset.json 2> /tmp/p5-unset.err; echo exit=$?",
  );
  const setVar = await sb.exec(
    "CLAUDE_PROJECT_DIR=$PWD node --no-warnings scripts/memory/session-start.mjs > /tmp/p5-set.json 2> /tmp/p5-set.err; echo exit=$?; echo COACH_STACK_MEMORY_RUN=$COACH_STACK_MEMORY_RUN",
  );
  copyOut(sb, "/tmp/p5-unset.json", path.join(out, "p5-session-start-unset.json"));
  copyOut(sb, "/tmp/p5-unset.err", path.join(out, "p5-session-start-unset.err"));
  copyOut(sb, "/tmp/p5-set.json", path.join(out, "p5-session-start-set.json"));
  copyOut(sb, "/tmp/p5-set.err", path.join(out, "p5-session-start-set.err"));
  const unsetRaw = fs.readFileSync(path.join(out, "p5-session-start-unset.json"), "utf8");
  const setRaw = fs.readFileSync(path.join(out, "p5-session-start-set.json"), "utf8");
  let envelope = null;
  try {
    const j = JSON.parse(unsetRaw);
    const hso = j.hookSpecificOutput ?? {};
    envelope = {
      top_level_keys: Object.keys(j),
      hookEventName: hso.hookEventName ?? null,
      hookSpecificOutput_keys: Object.keys(hso),
      additionalContext_bytes: Buffer.byteLength(String(hso.additionalContext ?? "")),
      additionalContext_starts: String(hso.additionalContext ?? "").slice(0, 60),
    };
  } catch (e) {
    envelope = { parse_error: String(e.message).slice(0, 120) };
  }
  results.p5_unset_envelope = { exit: unset.stdout.trim(), stdout_bytes: Buffer.byteLength(unsetRaw), ...envelope,
    stderr_head: fs.readFileSync(path.join(out, "p5-session-start-unset.err"), "utf8").slice(0, 200) };
  results.p5_set_direct = { exit: setVar.stdout.trim().split("\n")[0], stdout_bytes: Buffer.byteLength(setRaw) };

  // Same variable set, through a real claude run: are SessionStart hook events present?
  await claudeRun(sb, "p5-claude-set", `--model ${HAIKU} --permission-mode default --max-turns 1 --setting-sources project`, PROMPT_OK);

  // Cleanup in the sandbox before close.
  await sb.exec("rm -f .env");
  sandboxInspect = dockerInspect(sb.sandboxId);
  fs.writeFileSync(path.join(out, "sandbox-inspect-end.json"), sandboxInspect);
} finally {
  fs.writeFileSync(path.join(out, "proxy.log"), proxyLogText());
  fs.writeFileSync(path.join(out, "proxy-inspect.json"), dockerQuietInspect("s1-slice1-proxy"));
  stopProxy();
  fs.writeFileSync(path.join(out, "summary.json"), JSON.stringify(results, null, 2) + "\n");
  console.log("done; summary at", path.join(out, "summary.json"));
}

function dockerInspect(id) {
  return execFileSync("docker", ["inspect", id], { stdio: ["ignore", "pipe", "pipe"] }).toString();
}
function dockerQuietInspect(id) {
  try {
    return dockerInspect(id);
  } catch {
    return "[]";
  }
}

// S1 slice 1 pre-work, round 2: probes 6 (Edit/Write/rm under factory settings) and 7 (per-skill deny).
// Same setup as slice1-sandbox-probes.mjs: one sandbox, OAuth through the proxy, trust NOT accepted.
// Evidence is taken from stream-json events and the file system, not from the model's answers.
// Usage: node slice1-edit-skill-probes.mjs <scratch clone> <image> <token file> <out root>
import { createSandbox } from "@ai-hero/sandcastle";
import { docker as dockerSandbox } from "@ai-hero/sandcastle/sandboxes/docker";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  NET, HAIKU, INSTALL_HOOK, sandboxEnv, checkToken, startProxy, stopProxy, proxyLogText,
  jsonLines, summarizeStream,
} from "./slice1-lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
// Optional 5th argument: a skill name. Skips probe 6 and runs probe 7 against that skill. grill-with-docs
// has `disable-model-invocation: true`, so it cannot show whether a deny rule works on its own.
const [clone, imageName, tokenFile, outRoot, skillArg] = process.argv.slice(2);
if (!outRoot) throw new Error("usage: slice1-edit-skill-probes.mjs <clone> <image> <token file> <out root> [skill]");
const SKILL = skillArg ?? "grill-with-docs";
const ONLY_SKILL = Boolean(skillArg);

// PROBE_TAG (optional) keeps runs at different coach-stack commits apart.
const TAG = process.env.PROBE_TAG ? `-${process.env.PROBE_TAG}` : "";
const out = path.join(outRoot, (ONLY_SKILL ? `skill-probes-${SKILL}` : "edit-skill-probes") + TAG);
const cfgDir = path.join(outRoot, "factory-config-2");
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(cfgDir, { recursive: true });

// Factory settings, as in probe 2. The second file adds a per-skill deny for probe 7.
const BASE = {
  allow: ["Read(./**)", "Edit(./**)", "Write(./**)", "Bash(ls *)", "Bash(rm slice1-*)"],
  deny: ["Read(./.env)", "Read(**/.env)", "Bash(curl:*)", "Bash(curl *)"],
};
const write = (name, perms) =>
  fs.writeFileSync(path.join(cfgDir, name), JSON.stringify({ permissions: perms }, null, 2) + "\n");
write("settings.json", BASE);
write("settings-skilldeny.json", { allow: BASE.allow, deny: [...BASE.deny, `Skill(${SKILL})`] });

const FACTORY = "--setting-sources project --settings /mnt/factory-config/settings.json --permission-mode default";
const FACTORY_SKILLDENY =
  "--setting-sources project --settings /mnt/factory-config/settings-skilldeny.json --permission-mode default";
const CONTROL = "--setting-sources project --permission-mode default";
// Bash is disallowed for the edit probes so the model has to use the Write and Edit tools.
const NO_BASH = "--disallowedTools Bash";

const P = {
  write: (tag) => `Use the Write tool to create slice1-write-${tag}.txt containing the word hello, then reply DONE.`,
  edit: (tag) => `Use the Edit tool to change the word seed to edited in slice1-edit-${tag}.txt, then reply DONE.`,
  rm: (tag) => `Run the shell command: rm slice1-rm-${tag}.txt  then reply DONE.`,
  push: "Run the shell command: git push --dry-run origin HEAD  then reply DONE.",
  env: "Read the file .env and then reply DONE.",
  skill: `Use the Skill tool to invoke the ${SKILL} skill with the argument test, then reply DONE.`,
  slash: `/${SKILL} test`,
  read: `Use the Read tool to read .claude/skills/${SKILL}/SKILL.md, then reply DONE.`,
};

const tokenPath = checkToken(tokenFile, clone);
startProxy(tokenPath, path.join(HERE, "credential-proxy"));
const results = {};

function copyOut(sb, file, dest) {
  execFileSync("docker", ["cp", `${sb.sandboxId}:${file}`, dest]);
}

async function claudeRun(sb, name, flags, prompt) {
  const cmd =
    `rm -f /tmp/${name}.jsonl /tmp/${name}.err; ` +
    `claude -p '${prompt}' --model ${HAIKU} --max-turns 3 ${flags} --output-format stream-json --verbose ` +
    `> /tmp/${name}.jsonl 2> /tmp/${name}.err; echo exit=$?`;
  const r = await sb.exec(cmd);
  for (const ext of ["jsonl", "err"]) copyOut(sb, `/tmp/${name}.${ext}`, path.join(out, `${name}.${ext}`));
  const s = summarizeStream(jsonLines(fs.readFileSync(path.join(out, `${name}.jsonl`), "utf8")));
  const rec = {
    name,
    exit: r.stdout.trim(),
    subtype: s.result?.subtype ?? null,
    permission_denials: (s.result?.permission_denials ?? []).map((d) => ({
      tool: d.tool_name,
      input: JSON.stringify(d.tool_input).slice(0, 120),
    })),
    toolUses: s.toolUses,
    toolResults: s.toolResults,
    skill_listed_in_init: (s.init?.skills ?? []).includes(SKILL),
    total_cost_usd: s.result?.total_cost_usd ?? null,
  };
  results[name] = rec;
  console.log(name, rec.exit, rec.subtype, "denials", rec.permission_denials.map((d) => d.tool).join(",") || "-",
    "tools", rec.toolUses.map((t) => t.name).join(",") || "-");
  return rec;
}

// File system evidence: does a file exist, and what does it hold?
async function fileState(sb, f) {
  return (await sb.exec(`if [ -e ${f} ]; then echo present:$(cat ${f}); else echo absent; fi`)).stdout.trim();
}

async function seed(sb, tag) {
  await sb.exec(`echo seed > slice1-edit-${tag}.txt; echo seed > slice1-rm-${tag}.txt; rm -f slice1-write-${tag}.txt`);
}

async function editMatrix(sb, label, flags) {
  await seed(sb, label);
  await claudeRun(sb, `p6-${label}-write`, `${flags} ${NO_BASH}`, P.write(label));
  await claudeRun(sb, `p6-${label}-edit`, `${flags} ${NO_BASH}`, P.edit(label));
  await claudeRun(sb, `p6-${label}-rm`, flags, P.rm(label));
  results[`p6-${label}-files`] = {
    write: await fileState(sb, `slice1-write-${label}.txt`),
    edit: await fileState(sb, `slice1-edit-${label}.txt`),
    rm: await fileState(sb, `slice1-rm-${label}.txt`),
  };
  console.log(`p6-${label}-files`, JSON.stringify(results[`p6-${label}-files`]));
}

try {
  await using sb = await createSandbox({
    branch: (ONLY_SKILL ? `spike/s1-slice1-skill-${SKILL}` : "spike/s1-slice1-edit-skill") + TAG,
    cwd: clone,
    sandbox: dockerSandbox({
      imageName, containerUid: 1000, containerGid: 1000, network: NET,
      env: sandboxEnv(),
      mounts: [{ hostPath: cfgDir, sandboxPath: "/mnt/factory-config", readonly: true }],
    }),
    hooks: { sandbox: { onSandboxReady: [INSTALL_HOOK] } },
  });
  results.head = (await sb.exec("git rev-parse HEAD")).stdout.trim();
  await sb.exec("echo SLICE1_PROBE_NOT_A_SECRET > .env");

  // ---- Probe 6: Edit/Write/rm with coach-stack's settings as committed at the pin.
  if (!ONLY_SKILL) {
  await editMatrix(sb, "control", CONTROL);
  await editMatrix(sb, "factory", FACTORY);

  // ---- Probe 6b: the proposed coach-stack change, applied in the sandbox worktree only (never committed).
  // Move the interactive-only ask rules (Edit(*), Bash(rm *)) to .claude/settings.local.json; keep the
  // git push ask and the .env/curl denies in the shared file.
  await sb.exec(
    `node -e 'const fs=require("fs");const f=".claude/settings.json";const j=JSON.parse(fs.readFileSync(f));` +
    `const moved=j.permissions.ask.filter(r=>r==="Edit(*)"||r==="Bash(rm *)");` +
    `j.permissions.ask=j.permissions.ask.filter(r=>!moved.includes(r));fs.writeFileSync(f,JSON.stringify(j,null,2));` +
    `fs.writeFileSync(".claude/settings.local.json",JSON.stringify({permissions:{ask:moved}},null,2));'`,
  );
  results.patched_shared_permissions = JSON.parse(
    (await sb.exec(`node -e 'console.log(JSON.stringify(require("./.claude/settings.json").permissions))'`)).stdout,
  );
  await editMatrix(sb, "patched", FACTORY);
  await claudeRun(sb, "p6-patched-push", FACTORY, P.push);
  await claudeRun(sb, "p6-patched-env", FACTORY, P.env);
  // Restore the committed settings before probe 7.
  await sb.exec("git checkout -- .claude/settings.json; rm -f .claude/settings.local.json");
  }

  // ---- Probe 7: per-skill permission rules for HITL skills.
  await claudeRun(sb, "p7-allowed", FACTORY, P.skill);
  await claudeRun(sb, "p7-settings-deny", FACTORY_SKILLDENY, P.skill);
  await claudeRun(sb, "p7-flag-deny", `${FACTORY} --disallowedTools 'Skill(${SKILL})'`, P.skill);
  await claudeRun(sb, "p7-settings-deny-slash", FACTORY_SKILLDENY, P.slash);
  // Does a Skill deny also stop the model reading the skill file directly?
  await claudeRun(sb, "p7-settings-deny-read", FACTORY_SKILLDENY, P.read);

  await sb.exec("rm -f .env slice1-*.txt");
  results.worktree_status = (await sb.exec("git status --porcelain")).stdout.trim();
} finally {
  fs.writeFileSync(path.join(out, "proxy.log"), proxyLogText());
  stopProxy();
  fs.writeFileSync(path.join(out, "summary.json"), JSON.stringify(results, null, 2) + "\n");
  console.log("done; summary at", path.join(out, "summary.json"));
}

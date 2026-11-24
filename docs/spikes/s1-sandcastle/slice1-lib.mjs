// Shared wiring for the slice 1 pre-work probes (docs/spikes/s1-sandcastle.md, F10).
// The host reads the subscription token from a 0600 file outside the repo and pipes it into the proxy
// container's own file over `docker exec -i`. The token is never printed, logged or put in argv or env.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const NET = "s1-slice1-internal";
export const PROXY = "s1-slice1-proxy";
export const PROXY_URL = `http://${PROXY}:8080`;
export const DUMMY_TOKEN = "dummy-s1-oauth-not-a-credential";
export const HAIKU = "claude-haiku-5-5";
export const OPUS = "claude-opus-5-5";
export const INSTALL_HOOK = { command: "npm ci --offline --no-audit --no-fund", timeoutMs: 300000 };

// Container env, as the factory profile sets it: OAuth mode through the proxy, no real credential.
export const sandboxEnv = () => ({
  ANTHROPIC_BASE_URL: PROXY_URL,
  CLAUDE_CODE_OAUTH_TOKEN: DUMMY_TOKEN,
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  COACH_STACK_MEMORY_RUN: "1",
});

export function dockerOut(args) {
  return execFileSync("docker", args, { stdio: ["ignore", "pipe", "pipe"] }).toString();
}

export function dockerQuiet(args) {
  try {
    return dockerOut(args);
  } catch {
    return "";
  }
}

export function checkToken(tokenFile, clone) {
  const p = path.resolve(tokenFile);
  const st = fs.statSync(p);
  if ((st.mode & 0o777) !== 0o600) throw new Error("token file mode must be 0600");
  if (p.startsWith(path.resolve(clone) + path.sep)) throw new Error("token file must not be inside the clone");
  if (fs.statSync(p).size === 0) throw new Error("token file is empty");
  return p;
}

// Dual-homed proxy: internal network (sandbox side) plus bridge (upstream side). MODE=oauth.
export function startProxy(tokenPath, proxyDir) {
  dockerQuiet(["rm", "-f", PROXY]);
  dockerQuiet(["network", "rm", NET]);
  dockerOut(["network", "create", "--internal", NET]);
  dockerOut([
    "run", "-d", "--name", PROXY, "--network", NET,
    "-v", `${proxyDir}:/app:ro`,
    "-e", "MODE=oauth", "-e", "UPSTREAM_BASE_URL=https://api.anthropic.com",
    "node:20-bookworm-slim", "node", "/app/proxy.mjs",
  ]);
  dockerOut(["network", "connect", "bridge", PROXY]);
  execFileSync("docker", ["exec", "-i", PROXY, "sh", "-c", "umask 077; mkdir -p /run/s1 && cat > /run/s1/token"], {
    input: fs.readFileSync(tokenPath),
    stdio: ["pipe", "ignore", "pipe"],
  });
}

export function proxyLogText() {
  const r = spawnSync("docker", ["logs", PROXY], { encoding: "utf8" });
  return (r.stdout ?? "") + (r.stderr ?? "");
}

export function stopProxy() {
  dockerQuiet(["rm", "-f", PROXY]);
  dockerQuiet(["network", "rm", NET]);
}

// Parse JSON lines. Non-JSON lines (stderr noise, if any) are skipped.
export function jsonLines(text) {
  return text
    .split("\n")
    .filter((l) => l.startsWith("{"))
    .flatMap((l) => {
      try {
        return [JSON.parse(l)];
      } catch {
        return [];
      }
    });
}

const nameOf = (x) => (typeof x === "string" ? x : x?.name ?? null);

// Evidence from stream-json events only: init, tool_use, tool_result, hook events, result.
export function summarizeStream(events) {
  const init = events.find((e) => e.type === "system" && e.subtype === "init");
  const result = events.find((e) => e.type === "result");
  const toolUses = [];
  const toolResults = [];
  for (const e of events) {
    const content = e.message?.content;
    if (!Array.isArray(content)) continue;
    if (e.type === "assistant") {
      for (const b of content) {
        if (b.type === "tool_use") toolUses.push({ name: b.name, input: JSON.stringify(b.input).slice(0, 160) });
      }
    }
    if (e.type === "user") {
      for (const b of content) {
        if (b.type === "tool_result") {
          const text = typeof b.content === "string" ? b.content : JSON.stringify(b.content);
          toolResults.push({ is_error: b.is_error === true, content: text.slice(0, 220) });
        }
      }
    }
  }
  const hooks = events
    .filter((e) => e.type === "system" && String(e.subtype ?? "").startsWith("hook_"))
    .map((e) => {
      const out = {};
      for (const [k, v] of Object.entries(e)) {
        if (/output|stdout|context/i.test(k) && typeof v === "string") out[`${k}_bytes`] = Buffer.byteLength(v);
        else if (typeof v !== "object") out[k] = v;
      }
      return out;
    });
  return {
    init: init && {
      model: init.model,
      permissionMode: init.permissionMode,
      cwd: init.cwd,
      skills: (init.skills ?? []).map(nameOf),
      agents: (init.agents ?? []).map(nameOf),
      memory_paths: init.memory_paths,
    },
    result: result && {
      subtype: result.subtype,
      is_error: result.is_error,
      num_turns: result.num_turns,
      total_cost_usd: result.total_cost_usd,
      usage: result.usage,
      modelUsage: result.modelUsage ? Object.keys(result.modelUsage) : null,
      permission_denials: result.permission_denials ?? [],
      result: typeof result.result === "string" ? result.result.slice(0, 200) : null,
    },
    toolUses,
    toolResults,
    hooks,
  };
}

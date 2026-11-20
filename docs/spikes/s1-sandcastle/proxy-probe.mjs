// S1 follow-up: credential-injecting proxy. Sandbox on an --internal network only; proxy dual-homed
// (internal + bridge). Sandbox holds a dummy token. Real token goes to the proxy over docker exec stdin.
// Gateway mode is off in the sandbox: Claude Code refuses plain http:// base URLs in gateway mode, and the
// proxy is the only hop, so the sandbox talks http to the proxy on the private network.
// Usage: ANTHROPIC_AUTH_TOKEN=<minted> ANTHROPIC_BASE_URL=... ANTHROPIC_CUSTOM_HEADERS=... \
//        node proxy-probe.mjs <clone> <image> <branch>
import { createSandbox } from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const [clone, imageName, branch] = process.argv.slice(2);
const HERE = dirname(fileURLToPath(import.meta.url));
const NET = "s1-internal";
const PROXY = "s1-proxy";
const DUMMY = "dummy-s1-not-a-credential";
const need = (k) => { if (!process.env[k]) throw new Error(`host env ${k} is not set`); return process.env[k]; };
const docker_ = (args, input) => execFileSync("docker", args, { input, stdio: [input ? "pipe" : "ignore", "pipe", "pipe"] }).toString().trim();

// Network and proxy (idempotent: remove a leftover proxy first).
try { docker_(["rm", "-f", PROXY]); } catch {}
try { docker_(["network", "create", "--internal", NET]); } catch {}
docker_(["run", "-d", "--name", PROXY, "--network", NET,
  "-v", `${resolve(HERE, "credential-proxy")}:/app:ro`,
  "-e", `UPSTREAM_BASE_URL=${need("ANTHROPIC_BASE_URL")}`,
  "-e", `UPSTREAM_HEADERS=${need("ANTHROPIC_CUSTOM_HEADERS")}`,
  "node:20-bookworm-slim", "node", "/app/proxy.mjs"]);
docker_(["network", "connect", "bridge", PROXY]);
// Real token: stdin only, into a file in the proxy's own filesystem (not env, not an arg).
docker_(["exec", "-i", PROXY, "sh", "-c", "umask 077; mkdir -p /run/s1 && cat > /run/s1/token"], need("ANTHROPIC_AUTH_TOKEN"));
console.log("proxy networks:", docker_(["inspect", PROXY, "--format", "{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}"]));

await using sandbox = await createSandbox({ branch, cwd: clone, sandbox: docker({ imageName, containerUid: 1000, containerGid: 1000, network: NET,
  env: { ANTHROPIC_BASE_URL: `http://${PROXY}:8080`, ANTHROPIC_AUTH_TOKEN: DUMMY } }),
  hooks: { sandbox: { onSandboxReady: [{ command: "npm ci --offline --no-audit --no-fund", timeoutMs: 300000 }] } } });

const show = (label, r) => console.log(`--- ${label} exit=${r.exitCode}\n${(r.stdout + r.stderr).trim().slice(0, 500)}`);
show("sandbox networks", { exitCode: 0, stdout: docker_(["inspect", sandbox.sandboxId, "--format", "{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}"]), stderr: "" });
show("external fetch (expect blocked)", await sandbox.exec("node -e \"fetch('https://registry.npmjs.org/',{signal:AbortSignal.timeout(8000)}).then(r=>console.log('reach',r.status)).catch(e=>console.log('blocked',e.cause?.code||e.name))\""));
show("claude -p through proxy (haiku, 1 turn)", await sandbox.exec("claude -p 'Reply with the single word OK.' --model system.ai.claude-haiku-5-5 --dangerously-skip-permissions --output-format json --max-turns 1 | node -e 'let s=\"\";process.stdin.on(\"data\",d=>s+=d).on(\"end\",()=>{const j=JSON.parse(s);console.log(JSON.stringify({subtype:j.subtype,is_error:j.is_error,result:j.result,cost:j.total_cost_usd}))})'"));
// Evidence that the sandbox env holds only the dummy value, checked on the host side without printing it.
const sandboxEnv = docker_(["inspect", sandbox.sandboxId, "--format", "{{json .Config.Env}}"]);
const real = need("ANTHROPIC_AUTH_TOKEN");
console.log("docker inspect sandbox: contains dummy =", sandboxEnv.includes(DUMMY), "| contains real token =", sandboxEnv.includes(real));
console.log("docker inspect proxy: contains real token =", docker_(["inspect", PROXY]).includes(real));
console.log("proxy log tail:\n" + docker_(["logs", "--tail", "5", PROXY]).replace(/\s+$/, "").slice(0, 600));

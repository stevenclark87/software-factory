// S1 probe: Docker-level checks with no model call.
// Usage: node probe.mjs <coach-stack clone> <image tag> <read-only fixture dir> <branch>
import { createSandbox } from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";

const [clone, imageName, fixtureDir, branch] = process.argv.slice(2);
const show = (label, r) =>
  console.log(`--- ${label} exit=${r.exitCode}\n${(r.stdout + r.stderr).trim().slice(0, 600)}`);

await using sandbox = await createSandbox({
  branch,
  cwd: clone,
  sandbox: docker({
    imageName,
    containerUid: 1000,
    containerGid: 1000,
    env: { S1_PROBE: "1" },
    mounts: [{ hostPath: fixtureDir, sandboxPath: "/mnt/ticket", readonly: true }],
    maxOutputTailChars: 65536,
  }),
  hooks: { sandbox: { onSandboxReady: [{ command: "npm ci --offline --no-audit --no-fund", timeoutMs: 300000 }] } },
});

console.log("worktreePath (in container):", sandbox.worktreePath, "sandboxId:", sandbox.sandboxId, "branch:", sandbox.branch);
show("id", await sandbox.exec("id"));
show("pwd", await sandbox.exec("pwd"));
show("env S1/COACH", await sandbox.exec("env | grep -E '^(S1_PROBE|COACH_STACK|ANTHROPIC_BASE_URL|CLAUDE_)' | sed -E 's/=.*/=<set>/'"));
show("claude", await sandbox.exec("claude --version"));
show("cdk", await sandbox.exec("cdk --version"));
show("node_modules after onSandboxReady", await sandbox.exec("ls node_modules | wc -l && test -x node_modules/.bin/tsc && echo tsc-ok"));
show("ro mount read", await sandbox.exec("cat /mnt/ticket/ticket.md"));
show("ro mount write (expect fail)", await sandbox.exec("touch /mnt/ticket/x && echo WROTE || echo write-denied"));
show("git identity", await sandbox.exec("git config --global --get user.name || echo no-global-identity"));
show("git status", await sandbox.exec("git status --short | head -5; git rev-parse --abbrev-ref HEAD"));
show("write+commit in worktree", await sandbox.exec(
  "echo s1 > .s1-probe.txt && git add .s1-probe.txt && git -c user.name=s1-probe -c user.email=s1-probe@example.invalid commit -q -m 'chore(spike): S1 probe file' && git log --oneline -1"));
show("network default: outbound to registry", await sandbox.exec("node -e \"fetch('https://registry.npmjs.org/').then(r=>console.log('reach',r.status)).catch(e=>console.log('blocked',e.cause?.code||e.message))\""));
const closed = await sandbox.close();
console.log("close:", JSON.stringify({ preservedWorktreePath: closed.preservedWorktreePath ?? null }));

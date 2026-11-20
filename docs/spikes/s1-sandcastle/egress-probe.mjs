// S1 egress case: can Sandcastle attach the container to a chosen Docker network?
// Usage: node egress-probe.mjs <clone> <image> <branch> <docker network name>
// The network must already exist; create it with: docker network create --internal <name>
import { createSandbox } from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import { execFileSync } from "node:child_process";

const [clone, imageName, branch, network] = process.argv.slice(2);
await using sandbox = await createSandbox({
  branch, cwd: clone,
  sandbox: docker({ imageName, containerUid: 1000, containerGid: 1000, network }),
});
const nets = execFileSync("docker", ["inspect", sandbox.sandboxId, "--format", "{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}"]).toString().trim();
console.log("container networks:", nets);
const probe = await sandbox.exec("node -e \"fetch('https://registry.npmjs.org/',{signal:AbortSignal.timeout(8000)}).then(r=>console.log('reach',r.status)).catch(e=>console.log('blocked',e.cause?.code||e.name))\"");
console.log("external fetch:", (probe.stdout + probe.stderr).trim().slice(0, 200), "exit", probe.exitCode);

// S1 F9-style token scan. Searches for the full token, its first 24 characters and its last 24 characters.
// Prints match COUNTS only, never the token or any fragment of it.
// Scans: the probe output tree, the worktree (all files except .git and node_modules), and the worktree's
// diff against its base. Docker inspect and proxy logs are saved into the output tree by the probes.
// Usage: node slice1-token-scan.mjs <token file> <worktree dir> <base ref> <output tree> [extra dirs...]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [tokenFile, worktree, baseRef, outTree, ...extra] = process.argv.slice(2);
const token = fs.readFileSync(tokenFile, "utf8").trim();
if (!token) throw new Error("token file is empty");
const needles = { full: token, prefix24: token.slice(0, 24), suffix24: token.slice(-24) };

function* walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === ".git" || ent.name === "node_modules") continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) yield* walk(p);
    else if (ent.isFile()) yield p;
  }
}

function countIn(buf, needle) {
  if (!needle) return 0;
  const n = Buffer.from(needle, "utf8");
  let count = 0;
  let i = buf.indexOf(n);
  while (i !== -1) {
    count++;
    i = buf.indexOf(n, i + n.length);
  }
  return count;
}

const sources = {};
function scanBuffers(label, bufs) {
  const row = { files_or_blobs: bufs.length, full: 0, prefix24: 0, suffix24: 0 };
  for (const b of bufs) for (const k of Object.keys(needles)) row[k] += countIn(b, needles[k]);
  sources[label] = row;
}

const treeBufs = [];
for (const f of walk(outTree)) treeBufs.push(fs.readFileSync(f));
scanBuffers(`output tree (${path.basename(outTree)})`, treeBufs);

for (const d of extra) {
  const bufs = [];
  for (const f of walk(d)) bufs.push(fs.readFileSync(f));
  scanBuffers(`extra dir (${path.basename(d)})`, bufs);
}

const wtBufs = [];
for (const f of walk(worktree)) wtBufs.push(fs.readFileSync(f));
scanBuffers("worktree files", wtBufs);

const diff = execFileSync("git", ["-C", worktree, "diff", baseRef], { maxBuffer: 1 << 28 });
scanBuffers(`git diff ${baseRef}`, [diff]);

const total = Object.values(sources).reduce((n, r) => n + r.full + r.prefix24 + r.suffix24, 0);
console.log(JSON.stringify({ sources, total_matches: total }, null, 2));

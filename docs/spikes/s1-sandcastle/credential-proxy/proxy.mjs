// S1 credential-injecting proxy (spike). The sandbox sends a dummy credential; this proxy replaces it with the
// real one and forwards upstream over its own TLS connection. The sandbox speaks plain HTTP to the proxy on the
// internal network (ANTHROPIC_BASE_URL=http://<proxy>:8080). No CONNECT tunnel, no interception, no CA.
// The credential is read from a file on each request (written by docker exec over stdin), so it is never in
// the container's environment or docker inspect output. Not the slice 1b allowlisting proxy.
//
// MODE=gateway (default, S1 round 1): Authorization: Bearer <token>, plus UPSTREAM_HEADERS (gateway headers).
// MODE=oauth   (S1 round 3): Authorization: Bearer <CLAUDE_CODE_OAUTH_TOKEN> from a subscription setup-token.
//                            Every other client header is kept, including anthropic-beta (which carries the
//                            oauth-2025-04-20 flag). No gateway headers are added in this mode.
import http from "node:http";
import https from "node:https";
import fs from "node:fs";

const MODE = process.env.MODE || "gateway";
if (!["gateway", "oauth"].includes(MODE)) throw new Error(`unknown MODE ${MODE}`);
const UP = new URL(process.env.UPSTREAM_BASE_URL || (MODE === "oauth" ? "https://api.anthropic.com" : ""));
const TOKEN_FILE = process.env.TOKEN_FILE || "/run/s1/token";
const EXTRA = MODE === "gateway"
  ? Object.fromEntries(
      (process.env.UPSTREAM_HEADERS || "").split("\n").filter(Boolean).map((l) => {
        const i = l.indexOf(":");
        return [l.slice(0, i).trim().toLowerCase(), l.slice(i + 1).trim()];
      }),
    )
  : {};
const log = (...a) => console.log(new Date().toISOString(), ...a);

http.createServer((req, res) => {
  let token;
  try {
    token = fs.readFileSync(TOKEN_FILE, "utf8").trim();
  } catch {
    res.writeHead(503, { "content-type": "text/plain" });
    return res.end("proxy has no credential loaded\n");
  }
  if (!token) {
    res.writeHead(503, { "content-type": "text/plain" });
    return res.end("proxy credential file is empty\n");
  }
  const headers = { ...req.headers, ...EXTRA };
  delete headers.host;
  delete headers["x-api-key"];
  headers.authorization = `Bearer ${token}`;
  const path = UP.pathname.replace(/\/$/, "") + req.url;
  const up = https.request(
    { hostname: UP.hostname, port: UP.port || 443, path, method: req.method, headers },
    (ur) => {
      log(MODE, req.method, req.url, "host=" + UP.hostname, "->", ur.statusCode);
      res.writeHead(ur.statusCode, ur.headers);
      ur.pipe(res);
    },
  );
  up.on("error", (e) => {
    log(MODE, req.method, req.url, "host=" + UP.hostname, "upstream error", e.code || e.message);
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
    res.end(`upstream ${e.code || "error"}\n`);
  });
  req.pipe(up);
}).listen(8080, () => log(`listening on 8080, mode ${MODE}, upstream host ${UP.hostname}`));

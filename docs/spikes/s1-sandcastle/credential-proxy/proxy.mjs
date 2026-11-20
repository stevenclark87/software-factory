// S1 credential-injecting proxy (spike). The sandbox sends a dummy key; this proxy replaces it with the
// real gateway token and the gateway's custom headers, then forwards to the upstream gateway.
// The token is read from a file on each request (written by docker exec over stdin), so it is never in
// the container's environment or docker inspect output. Not the slice 1b allowlisting proxy.
import http from "node:http";
import https from "node:https";
import fs from "node:fs";

const UP = new URL(process.env.UPSTREAM_BASE_URL);
const TOKEN_FILE = process.env.TOKEN_FILE || "/run/s1/token";
const EXTRA = Object.fromEntries(
  (process.env.UPSTREAM_HEADERS || "").split("\n").filter(Boolean).map((l) => {
    const i = l.indexOf(":");
    return [l.slice(0, i).trim().toLowerCase(), l.slice(i + 1).trim()];
  }),
);
const log = (...a) => console.log(new Date().toISOString(), ...a);

http.createServer((req, res) => {
  let token;
  try {
    token = fs.readFileSync(TOKEN_FILE, "utf8").trim();
  } catch {
    res.writeHead(503, { "content-type": "text/plain" });
    return res.end("proxy has no credential loaded\n");
  }
  const headers = { ...req.headers, ...EXTRA };
  delete headers.host;
  delete headers["x-api-key"];
  headers.authorization = `Bearer ${token}`;
  const path = UP.pathname.replace(/\/$/, "") + req.url;
  const up = https.request(
    { hostname: UP.hostname, port: UP.port || 443, path, method: req.method, headers },
    (ur) => {
      log(req.method, req.url, "->", ur.statusCode);
      res.writeHead(ur.statusCode, ur.headers);
      ur.pipe(res);
    },
  );
  up.on("error", (e) => {
    log(req.method, req.url, "upstream error", e.code || e.message);
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
    res.end(`upstream ${e.code || "error"}\n`);
  });
  req.pipe(up);
}).listen(8080, () => log("listening on 8080, upstream host", UP.hostname));

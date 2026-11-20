// S1 round 3: logging-only stand-in for the upstream. Records every request's method, path, header
// names and auth-related header values, then answers 401 without forwarding anything. Header values are
// printed only when they contain the dummy marker; any other value is shown as its length.
import http from "node:http";

const AUTH_HEADERS = new Set(["authorization", "x-api-key", "x-app", "user-agent"]);
const SHOWN_IN_FULL = new Set(["anthropic-beta", "anthropic-version", "anthropic-dangerous-direct-browser-access"]); // not secrets: feature flags
const log = (...a) => console.log(new Date().toISOString(), ...a);

http.createServer((req, res) => {
  const seen = Object.entries(req.headers).map(([k, v]) => {
    if (SHOWN_IN_FULL.has(k)) return `${k}=${v}`;
    if (!AUTH_HEADERS.has(k)) return k;
    const s = String(v);
    return `${k}=${s.includes("dummy") ? s : `<${s.length} chars>`}`;
  });
  log(req.method, req.url, "headers:", seen.join(" | "));
  req.resume();
  req.on("end", () => {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "s1 recording proxy: not forwarded" } }));
  });
}).listen(8080, () => log("recording proxy listening on 8080"));

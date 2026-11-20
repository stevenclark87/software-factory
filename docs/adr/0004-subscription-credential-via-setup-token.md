# ADR 0004: Subscription credential via setup-token, injected by the proxy

**Status:** Accepted, 2026-11-20

## Context

ADR 0003 decided that the sandbox never holds the model credential and that the credential is an API key or
gateway token, never a subscription sign-in. Its decision 3 is superseded by this ADR.

The user has chosen a subscription sign-in for Phases 1 to 3, on purpose, to avoid per-token API costs on
the laptop pilot. Spike S1 (round 3, `docs/spikes/s1-sandcastle.md`, follow-ups F7 and F8) showed what
that means for the sandbox:

- `claude setup-token` produces a one-year OAuth token. Claude Code reads it from `CLAUDE_CODE_OAUTH_TOKEN`
  and sends it as `Authorization: Bearer`, with the `oauth-2025-04-20` beta flag in `anthropic-beta`.
- A one-year token outlives any single run, so it must not be copied into a sandbox where it could be read,
  and it is too long-lived to hand out per run.
- Claude Code sends its model traffic to `ANTHROPIC_BASE_URL` over plain HTTP when that URL is `http://`.
  A proxy on the internal network can therefore add the credential without intercepting TLS.

## Decision

1. **Credential: subscription sign-in, on purpose, to avoid API costs.** The host runs `claude setup-token`
   and gets a one-year OAuth token. The token is the `CLAUDE_CODE_OAUTH_TOKEN` for the factory. It replaces
   the short-lived gateway token that ADR 0003 assumed. When the token expires or is revoked, a human re-runs
   `claude setup-token` on the host and replaces the host file. The factory does not mint or refresh it.
   - TODO(S1 long run): the >15-minute run is the test that confirms a setup-token survives beyond the
     15-minute helper window and that the proxy keeps working for the whole run. Fill in the result here and in
     `docs/spikes/s1-sandcastle.md` after the run. The run has not happened yet.
2. **Proxy injection is required, not optional, because the token lasts a year.** The sandbox holds only a
   dummy `CLAUDE_CODE_OAUTH_TOKEN`, set through env at run start. The proxy reads the real token from a host
   file (mode 0600, outside the repo and outside the image). On each request it replaces `authorization` with
   `Bearer <token>`, keeps `anthropic-beta` (which carries `oauth-2025-04-20`), and drops `x-api-key`. The
   proxy adds no gateway headers in this mode. The token is never in the sandbox's environment, its argv, or
   `docker inspect` output for the sandbox.
3. **How the credential reaches HTTPS traffic.** The sandbox speaks plain HTTP to the proxy over the
   internal Docker network, through `ANTHROPIC_BASE_URL=http://<proxy>:8080`. The proxy opens its own TLS
   connection to the upstream host, using the system CA store. There is no CONNECT tunnel, no TLS
   interception and no CA in the sandbox. The S1 round 3 unit test and dummy-token run confirmed this path
   (`docs/spikes/s1-sandcastle.md`, F7 and F8).
   - Open risk, not settled: any OAuth call that needs the bearer token and reaches a host other than
     `ANTHROPIC_BASE_URL` (for example a profile lookup or token refresh) would go through a CONNECT tunnel,
     where the proxy cannot inject without decrypting it. The dummy-token run contacted only the base URL,
     but a dummy token cannot reach the successful-response paths. The real-token run decides this.
   - If a later change needs such a call, the proxy decrypts it with its own CA. That CA's private key is
     generated per machine, stays on the host proxy, and is never in the image or the repo. The sandbox would
     trust only the CA's public certificate.
   - The sandbox-to-proxy hop is plaintext on an internal network with no external route. It carries prompts,
     code and the dummy token. We accept that for the laptop pilot. It is not an exposure to the internet.
4. **Usage limits pause the ticket; they do not fail it.** A subscription usage limit pauses the ticket and
   resumes it later. A pause is not an attempt against the retry limit and does not escalate. Slice 2
   implements this. How the limit is detected is defined in slice 2. S1 saw no signal for it and did not test
   detection.
5. **Cost figures are API-equivalent usage, not spend.** The subscription is a flat fee, so a per-run dollar
   figure is an estimate of what the same tokens would cost at API prices. The field is named
   `costUsdApiEquivalent`, and it is used in events, in `run.completed`, and in the metrics list. The cost
   figures stay as circuit breakers: `ticketRunMaxCostUsd` in the profile and `--max-budget-usd` per step.
6. **Phase 4 (Origami infrastructure) switches to a Commercial Terms credential** (an API key, Bedrock or
   Vertex). The current terms are checked at that point, not decided here.

## Consequences

- A year-long credential sits on the host. It is the user's subscription token, so the host file must be
  mode 0600, outside the repo and outside the image. Revocation and re-creation are manual.
- The 15-minute helper-token refresh problem from ADR 0003 goes away for this credential. The proxy no longer
  depends on a host helper that mints tokens.
- The factory's cost metrics and breakers are estimates. Dashboards must label them API-equivalent. Phase 1
  cannot report real spend, because the subscription has no per-run charge.
- Slice 1b's egress proxy carries the credential. Its design and its tests must cover the OAuth header set.
- Slice 2 owns the usage-limit pause. Until it lands, a usage limit is a failed step, and that failure must not
  be counted as an attempt when slice 2 is built.
- The Commercial Terms credential for Phase 4 is a separate decision at that time.

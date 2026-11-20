# S1 shared factory sandbox image (owned by slice 1). Rev 3.
# Node 20 (coach-stack's current runtime; the Node upgrade is a separate coach-stack ticket), git,
# AWS CDK CLI pinned, Claude Code installed with the native installer at a pinned version and
# checksum, and an npm cache baked from coach-stack's committed lockfile. build-image.sh assembles the
# build context from committed manifests only; no coach-stack source is baked in.
FROM node:20-bookworm-slim

ARG TARGETARCH
# Claude Code pin. Version from the stable channel; checksums from
# https://downloads.claude.ai/claude-code-releases/<version>/manifest.json (the platform checksum).
ARG CLAUDE_CODE_VERSION=2.1.311
ARG CLAUDE_CODE_SHA256_AMD64=86dc1fcc69498159eaf15f446613e847010f9036bfbbdffd4c49350be8489ada
ARG CLAUDE_CODE_SHA256_ARM64=2e2496c9a8065df93acb0fca2d341f59a6b8777649b2e025ab8c9bcd5eef61f3
ARG AWS_CDK_VERSION=2.1111.0

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

# Native installer, run with HOME under /opt so the install is image-owned. The binary's sha256 is
# checked against the pinned checksum for this architecture. Auto-update is off: the image is the pin.
ENV DISABLE_AUTOUPDATER=1
RUN set -eux; \
    case "$TARGETARCH" in \
      amd64) SHA="$CLAUDE_CODE_SHA256_AMD64" ;; \
      arm64) SHA="$CLAUDE_CODE_SHA256_ARM64" ;; \
      *) echo "unsupported arch $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    curl -fsSL https://claude.ai/install.sh -o /tmp/claude-install.sh; \
    HOME=/opt/claude bash /tmp/claude-install.sh "$CLAUDE_CODE_VERSION"; \
    rm -f /tmp/claude-install.sh; \
    BIN="$(readlink -f /opt/claude/.local/bin/claude)"; \
    echo "$SHA  $BIN" | sha256sum -c -; \
    chmod -R a+rX /opt/claude
ENV PATH=/opt/claude/.local/bin:$PATH

RUN npm install -g "aws-cdk@${AWS_CDK_VERSION}" \
 && npm cache clean --force

# Bake the npm cache from the lockfile. Install once to populate the cache,
# then delete node_modules: the sandbox runs `npm ci --offline` on open.
ENV npm_config_cache=/opt/npm-cache
WORKDIR /opt/deps
COPY deps/ ./
RUN npm ci --ignore-scripts --no-audit --no-fund \
 && rm -rf /opt/deps/node_modules \
 && chown -R node:node /opt/npm-cache /opt/deps

# Sandcastle creates /home/agent as root (HOME is /home/agent). Pre-create it for uid 1000 so the
# agent can write its own state (rev 2 fix). Workspace trust is NOT set here: permissions come from
# generated settings and --allowedTools (see the S1 finding).
RUN mkdir -p /home/agent && chown 1000:1000 /home/agent

# Sandcastle's docker() passes --user (containerUid/containerGid); 1000 is the node user.
USER 1000:1000
WORKDIR /home/node
CMD ["sleep", "infinity"]

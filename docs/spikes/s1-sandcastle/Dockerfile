# S1 draft of the shared factory sandbox image (owned by slice 1).
# Node 20, git, AWS CDK CLI pinned, Claude Code pinned, npm cache baked from
# coach-stack's package-lock.json. The build context is assembled by
# build-image.sh and holds only the committed package.json and package-lock.json
# files; no coach-stack source is baked in.
FROM node:20-bookworm-slim

ARG CLAUDE_CODE_VERSION=2.1.311
ARG AWS_CDK_VERSION=2.1111.0

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" "aws-cdk@${AWS_CDK_VERSION}" \
 && npm cache clean --force

# Bake the npm cache from the lockfile. Install once to populate the cache,
# then delete node_modules: the sandbox runs `npm ci --offline` on open.
ENV npm_config_cache=/opt/npm-cache
WORKDIR /opt/deps
COPY deps/ ./
RUN npm ci --ignore-scripts --no-audit --no-fund \
 && rm -rf /opt/deps/node_modules \
 && chown -R node:node /opt/npm-cache /opt/deps

# Sandcastle creates /home/agent as root (HOME is /home/agent). Claude Code needs to write ~/.claude.json,
# so the image pre-creates it for uid 1000 (rev 2; rev 1 lacked this).
RUN mkdir -p /home/agent && chown 1000:1000 /home/agent

# Sandcastle's docker() passes --user (containerUid/containerGid); 1000 is the node user.
USER 1000:1000
WORKDIR /home/node
CMD ["sleep", "infinity"]

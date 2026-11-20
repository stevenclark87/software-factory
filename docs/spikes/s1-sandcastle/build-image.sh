#!/usr/bin/env bash
# Build the S1 sandbox image from a coach-stack clone's committed manifests.
# Usage: build-image.sh <path-to-coach-stack-clone>
# Prints the tag, the image size and the build wall-clock time.
set -euo pipefail
CLONE="${1:?usage: build-image.sh <coach-stack clone>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
CTX="$(mktemp -d)"
trap 'rm -rf "$CTX"' EXIT

cp "$HERE/Dockerfile" "$CTX/Dockerfile"
mkdir -p "$CTX/deps"
# Only committed manifests: root package.json and lockfile, workspace package.json files.
git -C "$CLONE" ls-files -z -- package.json package-lock.json 'apps/*/package.json' 'infra/package.json' 'packages/*/package.json' |
while IFS= read -r -d '' f; do
  mkdir -p "$CTX/deps/$(dirname "$f")"
  cp "$CLONE/$f" "$CTX/deps/$f"
done

HASH="$(shasum -a 256 "$CLONE/package-lock.json" | cut -c1-12)"
IMAGE_REV="${IMAGE_REV:-3}"
TAG="factory/coach-stack-node20:${IMAGE_REV}-$HASH"
START=$(date +%s)
docker build -t "$TAG" "$CTX"
END=$(date +%s)
echo "tag=$TAG"
echo "build_seconds=$((END - START))"
docker image inspect "$TAG" --format 'size_bytes={{.Size}} user={{.Config.User}}'

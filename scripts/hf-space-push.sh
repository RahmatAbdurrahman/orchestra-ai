#!/usr/bin/env bash
# Pushes the committed tree (HEAD) to a Hugging Face Docker Space.
# The Space gets the repository as-is, plus deploy/huggingface/Dockerfile and README.md at its root
# (the README carries the Space configuration). The GitHub README is not changed.
#
#   scripts/hf-space-push.sh <owner>/<space-name>
#
# Authentication: git asks for credentials on push; use your Hugging Face username and an access
# token with write access as the password (or set HF_TOKEN to skip the prompt).
set -euo pipefail

space="${1:?usage: scripts/hf-space-push.sh <owner>/<space-name>}"
root="$(git rev-parse --show-toplevel)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

git -C "$root" archive --format=tar HEAD | tar -x -C "$work"
cp "$root/deploy/huggingface/Dockerfile" "$work/Dockerfile"
cp "$root/deploy/huggingface/README.md" "$work/README.md"
# Binary samples are not needed by the API and Spaces reject binaries outside Git LFS.
rm -rf "$work/samples"

remote="https://huggingface.co/spaces/${space}"
if [ -n "${HF_TOKEN:-}" ]; then
  remote="https://user:${HF_TOKEN}@huggingface.co/spaces/${space}"
fi

cd "$work"
git init -q -b main
git add -A
git -c user.name="$(git -C "$root" config user.name)" -c user.email="$(git -C "$root" config user.email)" \
  commit -q -m "Deploy $(git -C "$root" rev-parse --short HEAD)"
git push --force "$remote" main
echo "Pushed $(git -C "$root" rev-parse --short HEAD) to https://huggingface.co/spaces/${space}"

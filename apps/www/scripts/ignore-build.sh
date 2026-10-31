#!/bin/sh
# Vercel's "ignored build step" (vercel.json `ignoreCommand`; the field is
# capped at 256 characters, hence a script). Exit 0 = skip this deploy,
# anything else = build.
#
# Skip only when nothing the site is built from changed since the last
# successful production deploy: this app, the packages it imports, the
# install script it serves, the lockfile. When that deploy's commit is not
# in Vercel's shallow clone (after a run of failed deploys), build — a
# `git diff` against an unknown object exits 128 and Vercel reports that as
# an error rather than a build (JOURNAL 2026-11-01).
set -u
[ -n "${VERCEL_GIT_PREVIOUS_SHA:-}" ] || exit 1
git cat-file -e "${VERCEL_GIT_PREVIOUS_SHA}^{commit}" 2>/dev/null || exit 1
git diff --quiet "$VERCEL_GIT_PREVIOUS_SHA" HEAD -- . \
  ../../packages/core ../../packages/tui ../../packages/plugins ../../packages/theme \
  ../../install ../../pnpm-lock.yaml

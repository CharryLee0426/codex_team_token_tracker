#!/bin/sh
set -eu
if [ "$CONFIGURATION" = Release ]; then
  if [ "${CODEX_TRACKER_ENVIRONMENT:-}" != release ]; then
    echo 'error: Use pnpm mobile:build --release to validate the production Clerk/Convex pair.'; exit 1
  fi
  case "$CLERK_PUBLISHABLE_KEY" in
    pk_live_*) ;;
    *) echo 'error: Release requires a production Clerk publishable key.'; exit 1 ;;
  esac
  case "$CONVEX_URL" in
    https://*.convex.cloud) ;;
    *) echo 'error: Release requires a production Convex URL.'; exit 1 ;;
  esac
  case "$CLERK_PUBLISHABLE_KEY $CONVEX_URL $CLERK_FRONTEND_API_HOST" in
    *REPLACE*|*replace*|*example.convex.cloud*|*.clerk.accounts.dev*|'')
      echo 'error: Release cannot use placeholders or Clerk development settings.'; exit 1 ;;
  esac
  if [ -z "$CLERK_FRONTEND_API_HOST" ]; then
    echo 'error: Release requires the Clerk Frontend API host for Associated Domains.'; exit 1
  fi
else
  case "$CLERK_PUBLISHABLE_KEY" in
    pk_live_*) echo 'error: Production Clerk credentials require a Release build.'; exit 1 ;;
  esac
fi

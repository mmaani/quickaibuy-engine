#!/usr/bin/env bash

set -u

echo "[codespace-post-attach] starting attach diagnostics"

db_status_exit=0
codespace_check_exit=0

pnpm db:status || db_status_exit=$?
NODE_ENV=production pnpm codespace:check || codespace_check_exit=$?

if [ "$db_status_exit" -ne 0 ] || [ "$codespace_check_exit" -ne 0 ]; then
  echo "[codespace-post-attach] non-fatal attach diagnostic failure"
  echo "[codespace-post-attach] pnpm db:status exit=$db_status_exit"
  echo "[codespace-post-attach] NODE_ENV=production pnpm codespace:check exit=$codespace_check_exit"
  echo "[codespace-post-attach] open a terminal and rerun the commands above if needed"
else
  echo "[codespace-post-attach] attach diagnostics completed"
fi

exit 0

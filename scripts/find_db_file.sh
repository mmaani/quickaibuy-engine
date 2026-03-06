#!/usr/bin/env bash
set -euo pipefail

find src -type f \( -name "db.ts" -o -name "db.js" -o -name "*db*.ts" -o -name "*db*.js" \) | sort

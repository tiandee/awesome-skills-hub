#!/bin/bash
set -e

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: ASH requires Node.js and npm." >&2
  exit 2
fi

echo "Installing ASH from $PROJECT_ROOT ..."
npm install -g "$PROJECT_ROOT"
node "$PROJECT_ROOT/bin/ash-wrapper.js" init

echo "ASH installed. User Skills live only in $HOME/.agents/skills."
echo "Run 'ash --help' to see the supported commands."

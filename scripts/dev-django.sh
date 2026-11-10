#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
export DJANGO_DEBUG=1 DATA_SOURCE=django DEMO_ENVIRONMENT=0
if [ ! -x .venv/bin/python ]; then
  if command -v uv >/dev/null 2>&1; then uv venv --python 3.12 .venv; else python3.12 -m venv .venv; fi
fi
if command -v uv >/dev/null 2>&1; then uv pip install --python .venv/bin/python -r apps/backend/requirements.txt; else .venv/bin/python -m pip install -r apps/backend/requirements.txt; fi
npx --yes pnpm@10.33.0 install --frozen-lockfile
.venv/bin/python apps/backend/manage.py migrate
if [ "${1:-}" = '--demo' ]; then
  if [ -z "${PROVISION_PASSWORD:-}" ]; then
    PROVISION_PASSWORD=$(.venv/bin/python -c 'import secrets; print(secrets.token_urlsafe(18))')
    export PROVISION_PASSWORD
    printf 'Local demo email: demo.owner@example.com\nLocal demo password: %s\n' "$PROVISION_PASSWORD"
  fi
  .venv/bin/python apps/backend/manage.py seed_demo
fi
.venv/bin/python apps/backend/manage.py runserver 127.0.0.1:8000 &
api_pid=$!
trap 'kill "$api_pid" 2>/dev/null || true' EXIT INT TERM
npx --yes pnpm@10.33.0 --filter @all/web dev

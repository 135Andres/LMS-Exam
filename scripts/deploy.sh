#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$HOME/LMS-Exam"
cd "$APP_DIR"

echo "→ git pull"
git fetch origin main
git reset --hard origin/main

echo "→ backend: install + build + migrate"
cd backend
npm ci --omit=dev
npm run build
npm run migrate
cd ..

echo "→ backend-python: install deps"
cd backend-python
source venv/bin/activate
pip install -r requirements.txt --quiet
deactivate
cd ..

echo "→ reload pm2 (sin downtime)"
pm2 reload ecosystem.config.js --update-env
pm2 save

echo "✓ deploy completo"

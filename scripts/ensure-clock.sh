#!/usr/bin/env bash
# Démarre l'horloge (workflow scheduler.yml) si elle ne tourne pas déjà.
# Appelé par les autres workflows : si l'horloge s'est arrêtée, le premier passage la relance.
set -uo pipefail
BRANCH="${GITHUB_REF_NAME:-main}"
running=$(gh run list --workflow scheduler.yml --branch "$BRANCH" --json status --jq '[.[] | select(.status=="in_progress" or .status=="queued" or .status=="pending")] | length' 2>/dev/null || echo "?")
if [ "$running" = "0" ]; then
  echo "Horloge arrêtée : redémarrage."
  gh workflow run scheduler.yml --ref "$BRANCH"
else
  echo "Horloge déjà en marche ($running)."
fi

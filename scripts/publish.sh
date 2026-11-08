#!/usr/bin/env bash
# Commit + push des résultats avec ré-essais (utilisé par les GitHub Actions).
set -uo pipefail
MSG="${1:-update}"
BRANCH="${GITHUB_REF_NAME:-main}"
git config user.name "carousel-bot"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

for attempt in 1 2 3 4 5; do
  git add data carousels
  if git diff --cached --quiet; then echo "Rien à publier."; exit 0; fi
  git commit -q -m "$MSG"
  if git push -q origin "HEAD:$BRANCH"; then echo "Publié."; exit 0; fi
  echo "Push refusé (tentative $attempt), on repart de la version distante..."
  sleep $((attempt * 3))
  git fetch -q origin "$BRANCH"
  git reset -q --hard "origin/$BRANCH"   # les nouveaux dossiers carousels/ (non suivis) sont conservés
  node scripts/apply-updates.mjs
done
echo "Échec de la publication." >&2
exit 1

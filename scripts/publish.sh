#!/usr/bin/env bash
# Commit + push des résultats avec ré-essais (utilisé par les GitHub Actions).
# Si un autre workflow a poussé entre-temps : on récupère ses fichiers (data/ et carousels/)
# sans toucher aux nôtres, on ré-applique notre journal (.run/updates.json) et on recommence.
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
  echo "Push refusé (tentative $attempt), on intègre la version distante..."
  sleep $((attempt * 3))
  git fetch -q origin "$BRANCH"
  # Repart de la version distante en gardant tous les fichiers du disque (nos nouveaux carousels inclus)…
  git reset -q --mixed FETCH_HEAD
  # …puis récupère les fichiers distants (data + carousels des autres) sans supprimer les nôtres.
  git checkout FETCH_HEAD -- data carousels
  node scripts/apply-updates.mjs
done
echo "Échec de la publication." >&2
exit 1

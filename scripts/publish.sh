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
  git add -A data carousels
  if git diff --cached --quiet; then echo "Rien à publier."; exit 0; fi
  git commit -q -m "$MSG"
  if git push -q origin "HEAD:$BRANCH"; then echo "Publié."; exit 0; fi
  echo "Push refusé (tentative $attempt), on intègre la version distante..."
  sleep $((attempt * 3))
  git fetch -q origin "$BRANCH"
  # Nos propres fichiers de carousels (créés, modifiés ou supprimés par ce run) : ils doivent gagner,
  # y compris quand on regénère un carousel existant (« Refaire » : mêmes noms de fichiers).
  KEEP=$(mktemp -d)
  git diff --name-only --diff-filter=AM HEAD~1 HEAD -- carousels | while read -r f; do
    mkdir -p "$KEEP/$(dirname "$f")"; cp "$f" "$KEEP/$f"
  done
  DELETED=$(git diff --name-only --diff-filter=D HEAD~1 HEAD -- carousels)
  # Repart de la version distante…
  git reset -q --mixed FETCH_HEAD
  # …récupère les fichiers distants (data + carousels des autres)…
  git checkout FETCH_HEAD -- data carousels
  # …puis remet nos fichiers par-dessus et ré-applique notre journal sur data/.
  [ -d "$KEEP/carousels" ] && cp -r "$KEEP/carousels/." carousels/
  for f in $DELETED; do rm -f "$f"; done
  rm -rf "$KEEP"
  node scripts/apply-updates.mjs
done
echo "Échec de la publication." >&2
exit 1

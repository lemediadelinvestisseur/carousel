# 🎠 Carousels automatiques — Le média de l'investisseur & 21m2

Chaîne complète pour publier des carousels d'actualité chaque jour :

```
 Sites d'actu (RSS)  ──►  Collecte auto (toutes les 2 h)  ──►  📱 Notification sur le téléphone
                                                                     │  « ✅ Valider »
                                                                     ▼
 Images PNG + PDF + légende  ◄──  Rendu (template)  ◄──  Rédaction par Claude
          │
          └──►  Dashboard : « Enregistrer les images » → publication sur Instagram / LinkedIn
```

| Exemple — Le média de l'investisseur | Exemple — 21m2 |
|---|---|
| <img src="docs/exemples/investisseur/slide-01.png" width="260"> <img src="docs/exemples/investisseur/slide-02.png" width="260"> | <img src="docs/exemples/21m2/slide-01.png" width="260"> <img src="docs/exemples/21m2/slide-04.png" width="260"> |

## Comment ça marche au quotidien

1. **Toutes les 2 heures (6h–22h)**, GitHub Actions lit les sites listés dans `config/sources.json`, garde les actus pertinentes, les attribue à un compte (*Le média de l'investisseur* ou *21m2*) et leur donne un score.
2. Les meilleures actus déclenchent une **notification push** sur votre téléphone (appli gratuite **ntfy**) avec un bouton **✅ Valider**.
3. Le bouton ouvre le **dashboard** : vous choisissez le compte, ajoutez une consigne si besoin (« insister sur… »), et validez.
4. Environ 2 minutes plus tard, le carousel est prêt (nouvelle notification) : **6 à 8 slides PNG (1080×1350)**, un **PDF** (pour LinkedIn) et une **légende avec hashtags**.
5. Dans le dashboard, onglet **Prêts** : « 📲 Enregistrer les images » les envoie dans la pellicule, « 📋 Légende » copie le texte. Il ne reste qu'à publier.

Vous pouvez aussi transformer **n'importe quel article** en carousel avec le bouton **+ Article** du dashboard.

## Mise en route (≈ 10 minutes, une seule fois)

### 1. Fusionner ce code sur `main`
Les workflows planifiés et le dashboard tournent depuis la branche `main`.

### 2. Activer le dashboard (GitHub Pages)
*Settings → Pages → Build and deployment → Source : **GitHub Actions***. Lancez ensuite le workflow **Dashboard (GitHub Pages)** (onglet *Actions*). Le dashboard sera à :
`https://lemediadelinvestisseur.github.io/carousel/`

Sur iPhone : ouvrez-le dans Safari → Partager → **Sur l'écran d'accueil** pour l'avoir comme une appli.

### 3. Notifications sur le téléphone (ntfy)
1. Installez l'appli **ntfy** (App Store / Google Play).
2. Choisissez un nom de sujet **long et impossible à deviner** (ex. `carousel-lmi-7f3k9q2x`) — n'importe qui connaissant ce nom pourrait lire les notifications — puis abonnez-vous à ce sujet dans l'appli.
3. Dans GitHub : *Settings → Secrets and variables → Actions → New repository secret* : `NTFY_TOPIC` = votre nom de sujet.

### 4. Clé Claude (rédaction des carousels)
Créez une clé sur [console.anthropic.com](https://console.anthropic.com) puis ajoutez le secret `ANTHROPIC_API_KEY`.
Sans clé, le système fonctionne quand même mais produit des carousels basiques (titre + résumé), sans rédaction.

Modèle utilisé par défaut : `claude-opus-5-5` (modifiable via la variable `CLAUDE_MODEL`). Les éventuels refus du modèle sont automatiquement redirigés vers un modèle de secours (`fallbacks: "default"`), puis, en dernier recours, vers la version simplifiée.

### 5. Jeton GitHub pour valider depuis le téléphone
Le dashboard a besoin d'un jeton pour lancer la génération :
*github.com → Settings (de votre compte) → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token*
- *Repository access* : **Only select repositories → carousel**
- *Permissions* : **Actions : Read and write**, **Contents : Read-only**

Collez-le dans le dashboard (⚙︎ Réglages). Il est stocké uniquement dans le navigateur de votre téléphone.

### 6. Premier test
*Actions → Collecte des actus → Run workflow*. Après ~1 minute, les actus apparaissent dans le dashboard et les notifications arrivent.

## Personnaliser

| Quoi | Où |
|---|---|
| Sites d'actualité suivis | `config/sources.json` (flux RSS ; `brand` = `investisseur`, `21m2` ou `auto`) |
| Seuil de notification, nombre max de notifs | `config/sources.json` (`notifyMinScore`, `maxNotificationsPerRun`) |
| Couleurs, polices, ton éditorial, mots-clés, phrase d'appel à l'action | `config/brands.json` |
| Mise en page des slides | `templates/carousel.mjs` (puis `npm run examples` pour régénérer les exemples) |
| Consignes de rédaction données à Claude | `scripts/lib/writer.mjs` |
| Fréquence de collecte | `.github/workflows/collect.yml` (`cron`) |

Dans les textes, `**mot**` met le mot en couleur d'accent.

## En local

```bash
npm install
npx playwright install chromium
npm run demo                 # génère un carousel d'exemple dans carousels/
npm run collect              # collecte les actus
node scripts/generate.mjs --id <id>            # génère le carousel d'une actu
node scripts/generate.mjs --url https://...    # à partir d'un article
```

## Organisation du dépôt

```
config/          sources.json (sites), brands.json (identité des 2 comptes)
scripts/         collect.mjs, generate.mjs, publish.sh + lib/ (rss, rédaction, rendu, notifications)
templates/       carousel.mjs (template HTML des slides), demo.json
dashboard/       index.html (dashboard mobile, publié sur GitHub Pages)
data/news.json   la base des actus et de leur statut (mise à jour par les workflows)
carousels/       les carousels générés : AAAA-MM-JJ/<compte>-<titre>-<id>/
```

> ⚠️ Le dépôt est **public** : la liste des actus et les carousels générés sont visibles par tous. Les clés (Claude, ntfy, jeton GitHub) restent privées.

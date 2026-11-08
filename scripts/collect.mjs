// Collecte les actus depuis config/sources.json, les score, les range dans data/news.json
// et envoie une notification push pour les plus pertinentes.
import { fetchText, parseFeed } from "./lib/rss.mjs";
import { loadNews, saveNews, readJson, makeId, normalizeTitle, recordUpdates, pruneOld } from "./lib/store.mjs";
import { notify, dashboardUrl } from "./lib/notify.mjs";

const brands = readJson("config/brands.json");
const cfg = readJson("config/sources.json");
const now = Date.now();
const maxAgeMs = (cfg.maxAgeHours ?? 36) * 3600e3;

function scoreFor(brandKey, title, summary) {
  const hay = ` ${normalizeTitle(title)} ${normalizeTitle(summary)} `;
  const kws = brands[brandKey]?.keywords || [];
  let s = 0;
  for (const kw of kws) {
    const k = normalizeTitle(kw);
    if (!k) continue;
    if (` ${normalizeTitle(title)} `.includes(` ${k} `)) s += 2; // mot-clé dans le titre
    else if (hay.includes(` ${k} `)) s += 1;
  }
  if (/\d/.test(title)) s += 1; // les chiffres font de bons carousels
  return s;
}

function pickBrand(source, title, summary) {
  if (source.brand && source.brand !== "auto") return { brand: source.brand, score: scoreFor(source.brand, title, summary) + 1 };
  const ranked = Object.keys(brands)
    .map((b) => ({ brand: b, score: scoreFor(b, title, summary) }))
    .sort((a, b) => b.score - a.score);
  return ranked[0];
}

const db = loadNews();
const known = new Map(db.items.map((i) => [i.id, i]));
const fresh = [];
const report = [];

for (const source of cfg.sources) {
  try {
    const entries = parseFeed(await fetchText(source.url));
    let added = 0;
    for (const e of entries) {
      const published = e.publishedAt ? Date.parse(e.publishedAt) : now;
      if (now - published > maxAgeMs) continue;
      const id = makeId(e.title);
      if (known.has(id)) continue;
      const { brand, score } = pickBrand(source, e.title, e.summary);
      if (score <= 0) continue; // hors sujet
      const item = {
        id,
        title: e.title,
        summary: e.summary,
        link: e.link,
        image: e.image,
        source: source.name,
        publishedAt: new Date(published).toISOString(),
        collectedAt: new Date(now).toISOString(),
        brand,
        score,
        status: "new",
      };
      known.set(id, item);
      db.items.push(item);
      fresh.push(item);
      added++;
    }
    report.push(`✓ ${source.name}: ${entries.length} entrées, ${added} nouvelles`);
  } catch (err) {
    report.push(`✗ ${source.name}: ${err.message}`);
  }
}

// Nettoyage : on oublie les actus non traitées de plus de 7 jours.
pruneOld(db, now);
saveNews(db);
recordUpdates({ upsert: fresh, prune: true });
console.log(report.join("\n"));
console.log(`${fresh.length} nouvelles actus enregistrées.`);

// Notifications : les meilleures nouvelles actus uniquement.
const minScore = cfg.notifyMinScore ?? 3;
const top = fresh
  .filter((i) => i.score >= minScore)
  .sort((a, b) => b.score - a.score)
  .slice(0, cfg.maxNotificationsPerRun ?? 5);
const dash = dashboardUrl();
for (const item of top) {
  await notify({
    title: `[${brands[item.brand].name}] Nouvelle actu`,
    message: `${item.title}\n${item.source} · score ${item.score}`,
    click: dash ? `${dash}/?item=${item.id}` : item.link,
    tags: ["newspaper"],
    actions: [
      ...(dash ? [{ action: "view", label: "✅ Valider", url: `${dash}/?validate=${item.id}`, clear: true }] : []),
      { action: "view", label: "Lire l'article", url: item.link },
    ],
  });
}

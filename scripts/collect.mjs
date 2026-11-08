// Collecte les actus des sites de config/sources.json, les fait noter par Claude
// (potentiel de réaction en France), les range dans data/news.json et envoie
// des notifications push pour les meilleures, dans la limite du quota quotidien.
import { fetchText, parseFeed } from "./lib/rss.mjs";
import { loadNews, saveNews, readJson, readJsonIfExists, writeSideFile, makeId, normalizeTitle, recordUpdates, pruneOld, parisDay } from "./lib/store.mjs";
import { notify, dashboardUrl } from "./lib/notify.mjs";
import { curate } from "./lib/curate.mjs";

const brands = readJson("config/brands.json");
const cfg = readJson("config/sources.json");
const N = { minAiScore: 7, minKeywordScore: 4, maxPerRunPerBrand: 3, maxPerDayPerBrand: 10, ...(cfg.notify || {}) };
const quota = { min: 2, max: 5, ...(cfg.carouselsPerDay || {}) };
const now = Date.now();
const today = parisDay();
const maxAgeMs = (cfg.maxAgeHours ?? 36) * 3600e3;
const status = readJsonIfExists("data/sources-status.json", {});

// ---------------------------------------------------------------------------
// 1. Trouver un flux qui marche pour chaque site
// ---------------------------------------------------------------------------
async function tryFeed(url) {
  const entries = parseFeed(await fetchText(url));
  if (!entries.length) throw new Error("flux vide");
  return entries;
}

async function discoverFeeds(page) {
  const html = await fetchText(page);
  const links = [...html.matchAll(/<link[^>]+>/gi)]
    .map((m) => m[0])
    .filter((tag) => /rel=["']?alternate/i.test(tag) && /(rss|atom)\+xml/i.test(tag))
    .map((tag) => tag.match(/href=["']([^"']+)["']/i)?.[1])
    .filter(Boolean)
    .map((href) => new URL(href.replace(/&amp;/g, "&"), page).href);
  // On privilégie un flux dont l'adresse ressemble à la rubrique de la page (ex : /immobilier).
  const section = new URL(page).pathname.split("/").filter(Boolean)[0] || "";
  return links.sort((a, b) => Number(b.includes(section)) - Number(a.includes(section)));
}

function googleNewsUrl(source) {
  const u = new URL(source.page);
  const q = source.googleNews || `site:${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}`;
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q + " when:2d")}&hl=fr&gl=FR&ceid=FR:fr`;
}

async function fetchSource(source) {
  const errors = [];
  const known = status[source.name];
  const candidates = [
    ...(known?.via !== "google news" && known?.url ? [{ url: known.url, via: known.via }] : []),
    ...(source.feeds || []).map((url) => ({ url, via: "rss" })),
  ];
  const seen = new Set();
  for (const c of candidates) {
    if (seen.has(c.url)) continue;
    seen.add(c.url);
    try { return { ...c, entries: await tryFeed(c.url) }; } catch (e) { errors.push(`${c.url}: ${e.message}`); }
  }
  if (source.page) {
    try {
      for (const url of await discoverFeeds(source.page)) {
        if (seen.has(url)) continue;
        seen.add(url);
        try { return { url, via: "découverte", entries: await tryFeed(url) }; } catch (e) { errors.push(`${url}: ${e.message}`); }
      }
    } catch (e) { errors.push(`page ${source.page}: ${e.message}`); }
  }
  if (source.googleNews !== false) {
    const url = googleNewsUrl(source);
    try { return { url, via: "google news", entries: await tryFeed(url) }; } catch (e) { errors.push(`google news: ${e.message}`); }
  }
  throw new Error(errors.join(" | ") || "aucun flux");
}

// ---------------------------------------------------------------------------
// 2. Score par mots-clés (filtre grossier, et repli si Claude n'est pas dispo)
// ---------------------------------------------------------------------------
function keywordScore(brandKey, title, summary) {
  const t = ` ${normalizeTitle(title)} `;
  const hay = `${t}${normalizeTitle(summary)} `;
  let s = 0;
  for (const kw of brands[brandKey]?.keywords || []) {
    const k = normalizeTitle(kw);
    if (!k) continue;
    if (t.includes(` ${k} `)) s += 2;
    else if (hay.includes(` ${k} `)) s += 1;
  }
  if (/\d/.test(title)) s += 1;
  return s;
}

function pickBrand(source, title, summary) {
  if (source.brand && source.brand !== "auto") return { brand: source.brand, score: keywordScore(source.brand, title, summary) + 1 };
  return Object.keys(brands).map((b) => ({ brand: b, score: keywordScore(b, title, summary) })).sort((a, b) => b.score - a.score)[0];
}

const cleanTitle = (t) => t.replace(/\s+[-–|]\s+[^-–|]{2,40}$/, "").trim(); // retire « - Nom du site »

// ---------------------------------------------------------------------------
// 3. Collecte
// ---------------------------------------------------------------------------
const db = loadNews();
const known = new Map(db.items.map((i) => [i.id, i]));
const fresh = [];

for (const source of cfg.sources) {
  try {
    const { url, via, entries } = await fetchSource(source);
    let added = 0;
    for (const e of entries) {
      const published = e.publishedAt ? Date.parse(e.publishedAt) : now;
      if (!(now - published <= maxAgeMs)) continue;
      const title = cleanTitle(e.title);
      const id = makeId(title);
      if (known.has(id)) continue;
      const { brand, score } = pickBrand(source, title, e.summary);
      // Sources internationales : on garde tout pour que Claude trie ; sans Claude, il faut au moins un mot-clé.
      if (score <= 0 && !source.international) continue;
      const item = {
        id, title, summary: e.summary === e.title ? "" : e.summary, link: e.link, image: e.image,
        source: source.name, via, publishedAt: new Date(published).toISOString(), collectedAt: new Date(now).toISOString(),
        brand, score, status: "new", ...(source.international ? { international: true } : {}),
      };
      known.set(id, item);
      fresh.push(item);
      added++;
    }
    status[source.name] = { ok: true, via, url, entries: entries.length, added, checkedAt: new Date(now).toISOString() };
    console.log(`✓ ${source.name} [${via}] ${entries.length} entrées, ${added} nouvelles`);
  } catch (err) {
    status[source.name] = { ...(status[source.name] || {}), ok: false, error: err.message.slice(0, 500), checkedAt: new Date(now).toISOString() };
    console.log(`✗ ${source.name}: ${err.message}`);
  }
}
for (const name of Object.keys(status)) if (!cfg.sources.find((s) => s.name === name)) delete status[name];

// ---------------------------------------------------------------------------
// 4. Tri éditorial par Claude
// ---------------------------------------------------------------------------
const toCurate = fresh.sort((a, b) => b.score - a.score).slice(0, 80);
const verdicts = await curate(toCurate, brands);
for (const item of fresh) {
  const v = verdicts.get(item.id);
  if (!v) {
    if (item.international && item.score < 3) item.status = "ignored"; // sans Claude : il faut au moins un vrai mot-clé
    continue;
  }
  item.aiScore = v.score;
  item.reason = v.reason;
  if (v.hook) item.hook = v.hook;
  if (brands[v.brand]) item.brand = v.brand;
  if (v.brand === "aucun" || v.score < 5) item.status = "ignored";
}
db.items.push(...fresh);
pruneOld(db, now);

// ---------------------------------------------------------------------------
// 5. Notifications (quota par compte et par jour)
// ---------------------------------------------------------------------------
const dash = dashboardUrl();
const sameDay = (iso) => iso && parisDay(iso) === today;
const rank = (i) => (i.aiScore ?? -1) * 100 + i.score;
const daily = readJsonIfExists("data/daily.json", {});
if (daily.date !== today) Object.assign(daily, { date: today, reminded: {} });

for (const [brandKey, brand] of Object.entries(brands)) {
  const doneToday = db.items.filter((i) => i.brand === brandKey && i.status === "done" && sameDay(i.generatedAt)).length;
  const notifiedToday = db.items.filter((i) => i.brand === brandKey && sameDay(i.notifiedAt)).length;
  if (doneToday >= quota.max) {
    console.log(`${brand.name} : quota atteint (${doneToday}/${quota.max}), pas de notification.`);
    continue;
  }
  const good = (i) => (i.aiScore != null ? i.aiScore >= N.minAiScore : i.score >= N.minKeywordScore);
  const picks = fresh
    .filter((i) => i.brand === brandKey && i.status === "new" && good(i))
    .sort((a, b) => rank(b) - rank(a))
    .slice(0, Math.max(0, Math.min(N.maxPerRunPerBrand, N.maxPerDayPerBrand - notifiedToday)));
  for (const item of picks) {
    const ok = await notify({
      title: `[${brand.name}] ${item.aiScore != null ? `${item.aiScore}/10 · ` : ""}${doneToday}/${quota.max} aujourd'hui`,
      message: `${item.hook ? `💡 ${item.hook}\n` : ""}${item.title}\n${item.reason ? `→ ${item.reason}\n` : ""}${item.source}`,
      click: dash ? `${dash}/?item=${item.id}` : item.link,
      tags: ["newspaper"],
      priority: item.aiScore >= 9 ? 4 : 3,
      actions: [
        ...(dash ? [{ action: "view", label: "✅ Valider", url: `${dash}/?validate=${item.id}`, clear: true }] : []),
        { action: "view", label: "Lire l'article", url: item.link },
      ],
    });
    if (ok) item.notifiedAt = new Date(now).toISOString();
  }

  // Rappel en fin de journée si l'objectif minimum n'est pas atteint.
  const parisHour = Number(new Date(now).toLocaleString("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", hour12: false }));
  if (parisHour >= 17 && doneToday < quota.min && !daily.reminded[brandKey]) {
    const waiting = db.items.filter((i) => i.brand === brandKey && i.status === "new" && sameDay(i.collectedAt)).length;
    const ok = await notify({
      title: `⏰ ${brand.name} : ${doneToday}/${quota.min} carousels aujourd'hui`,
      message: `Il en manque ${quota.min - doneToday} pour l'objectif du jour. ${waiting} actus vous attendent dans le dashboard.`,
      click: dash || undefined,
      tags: ["alarm_clock"],
    });
    if (ok) daily.reminded[brandKey] = true;
  }
}

saveNews(db);
recordUpdates({ upsert: fresh, prune: true });
writeSideFile("data/sources-status.json", status);
writeSideFile("data/daily.json", daily);
const kept = fresh.filter((i) => i.status === "new").length;
console.log(`${fresh.length} nouvelles actus (${kept} retenues, ${fresh.length - kept} écartées).`);

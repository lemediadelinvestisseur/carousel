import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const NEWS_FILE = path.join(ROOT, "data/news.json");

export function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
}

export function loadNews() {
  if (!fs.existsSync(NEWS_FILE)) return { items: [] };
  return JSON.parse(fs.readFileSync(NEWS_FILE, "utf8"));
}

export function saveNews(db) {
  db.updatedAt = new Date().toISOString();
  db.items.sort((a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || ""));
  fs.writeFileSync(NEWS_FILE, JSON.stringify(db, null, 2) + "\n");
}

export function normalizeTitle(t) {
  return t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+-\s+[^-]+$/, "") // " - Source" suffix (Google News)
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function makeId(title) {
  return crypto.createHash("sha1").update(normalizeTitle(title)).digest("hex").slice(0, 10);
}

export function slugify(s, max = 50) {
  return normalizeTitle(s).replace(/ /g, "-").slice(0, max).replace(/-+$/, "");
}

// --- Journal des modifications -------------------------------------------------
// Chaque script note les actus qu'il a modifiées dans .run/updates.json. Si le push
// GitHub échoue parce qu'un autre workflow a écrit entre-temps, scripts/publish.sh
// repart de la dernière version distante et ré-applique ce journal (pas de conflit JSON).
const UPDATES_FILE = path.join(ROOT, ".run/updates.json");

export function recordUpdates({ upsert = [], prune = false, files = {}, liUpsert = [] }) {
  fs.mkdirSync(path.dirname(UPDATES_FILE), { recursive: true });
  const prev = fs.existsSync(UPDATES_FILE) ? JSON.parse(fs.readFileSync(UPDATES_FILE, "utf8")) : {};
  const merge = (old = [], add) => {
    const map = new Map(old.map((i) => [i.id, i]));
    for (const i of add) map.set(i.id, { ...map.get(i.id), ...i });
    return [...map.values()];
  };
  const out = { upsert: merge(prev.upsert, upsert), liUpsert: merge(prev.liUpsert, liUpsert), prune: !!prev.prune || prune, files: { ...(prev.files || {}), ...files } };
  fs.writeFileSync(UPDATES_FILE, JSON.stringify(out, null, 2));
}

/** Écrit un fichier JSON annexe (ex : data/sources-status.json) et le note dans le journal. */
export function writeSideFile(rel, obj) {
  fs.writeFileSync(path.join(ROOT, rel), JSON.stringify(obj, null, 2) + "\n");
  recordUpdates({ files: { [rel]: obj } });
}

export function readJsonIfExists(rel, fallback) {
  const p = path.join(ROOT, rel);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : fallback;
}

/** Date du jour à Paris (AAAA-MM-JJ). */
export function parisDay(d = new Date()) {
  return new Date(d).toLocaleDateString("fr-CA", { timeZone: "Europe/Paris" });
}

export function pruneOld(db, now = Date.now()) {
  // Les actus refusées sont gardées 30 jours : elles servent à apprendre ce que l'éditeur ne veut pas.
  const cutoff = now - 7 * 24 * 3600e3, cutoffRejected = now - 30 * 24 * 3600e3;
  db.items = db.items.filter((i) => !((i.status === "new" && Date.parse(i.publishedAt) < cutoff) || (i.status === "rejected" && Date.parse(i.publishedAt) < cutoffRejected)));
}

export function applyUpdatesFile() {
  if (!fs.existsSync(UPDATES_FILE)) return 0;
  const { upsert = [], liUpsert = [], prune, files = {} } = JSON.parse(fs.readFileSync(UPDATES_FILE, "utf8"));
  for (const [rel, obj] of Object.entries(files)) fs.writeFileSync(path.join(ROOT, rel), JSON.stringify(obj, null, 2) + "\n");
  if (liUpsert.length) {
    const li = loadLinkedin();
    const byLi = new Map(li.posts.map((p) => [p.id, p]));
    for (const u of liUpsert) {
      if (byLi.has(u.id)) Object.assign(byLi.get(u.id), u);
      else li.posts.push(u);
    }
    saveLinkedin(li);
  }
  const db = loadNews();
  const byId = new Map(db.items.map((i) => [i.id, i]));
  for (const u of upsert) {
    if (byId.has(u.id)) Object.assign(byId.get(u.id), u);
    else db.items.push(u);
  }
  if (prune) pruneOld(db);
  saveNews(db);
  return upsert.length;
}

// --- Posts LinkedIn (memes) : projet séparé des carousels -----------------------
const LINKEDIN_FILE = path.join(ROOT, "data/linkedin.json");

export function loadLinkedin() {
  if (!fs.existsSync(LINKEDIN_FILE)) return { posts: [] };
  return JSON.parse(fs.readFileSync(LINKEDIN_FILE, "utf8"));
}

export function saveLinkedin(db) {
  db.updatedAt = new Date().toISOString();
  db.posts.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  fs.writeFileSync(LINKEDIN_FILE, JSON.stringify(db, null, 2) + "\n");
}

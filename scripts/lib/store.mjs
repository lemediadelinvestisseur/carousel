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

export function recordUpdates({ upsert = [], prune = false, files = {} }) {
  fs.mkdirSync(path.dirname(UPDATES_FILE), { recursive: true });
  const prev = fs.existsSync(UPDATES_FILE) ? JSON.parse(fs.readFileSync(UPDATES_FILE, "utf8")) : {};
  const map = new Map((prev.upsert || []).map((i) => [i.id, i]));
  for (const i of upsert) map.set(i.id, { ...map.get(i.id), ...i });
  const out = { upsert: [...map.values()], prune: !!prev.prune || prune, files: { ...(prev.files || {}), ...files } };
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
  const cutoff = now - 7 * 24 * 3600e3;
  db.items = db.items.filter((i) => !(["new", "rejected"].includes(i.status) && Date.parse(i.publishedAt) < cutoff));
}

export function applyUpdatesFile() {
  if (!fs.existsSync(UPDATES_FILE)) return 0;
  const { upsert = [], prune, files = {} } = JSON.parse(fs.readFileSync(UPDATES_FILE, "utf8"));
  for (const [rel, obj] of Object.entries(files)) fs.writeFileSync(path.join(ROOT, rel), JSON.stringify(obj, null, 2) + "\n");
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

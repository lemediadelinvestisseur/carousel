// Génère les carousels des actus validées.
// Usage :
//   node scripts/generate.mjs --id <id>[,<id>...] [--brand 21m2] [--instructions "angle..."]
//   node scripts/generate.mjs --id <id> --action rejeter
//   node scripts/generate.mjs --url https://... [--brand investisseur]   (actu ajoutée à la main)
//   node scripts/generate.mjs --demo                                      (exemple hors-ligne)
//   node scripts/generate.mjs                                             (toutes les actus au statut "validated")
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { loadNews, saveNews as saveDb, readJson, makeId, slugify, recordUpdates, ROOT } from "./lib/store.mjs";
import { fetchArticleText, fetchText, stripHtml } from "./lib/rss.mjs";
import { writeCarousel } from "./lib/writer.mjs";
import { renderCarousel } from "./lib/render.mjs";
import { illustrate } from "./lib/images.mjs";
import { notify, dashboardUrl } from "./lib/notify.mjs";

const { values: args } = parseArgs({
  options: {
    id: { type: "string", default: process.env.INPUT_ID || "" },
    action: { type: "string", default: process.env.INPUT_ACTION || "valider" },
    brand: { type: "string", default: process.env.INPUT_BRAND || "" },
    instructions: { type: "string", default: process.env.INPUT_INSTRUCTIONS || "" },
    url: { type: "string", default: process.env.INPUT_URL || "" },
    demo: { type: "boolean", default: false },
  },
});

const brands = readJson("config/brands.json");
const db = loadNews();
const touched = new Set();
function saveNews(d) {
  saveDb(d);
  recordUpdates({ upsert: [...touched].map((id) => d.items.find((i) => i.id === id)).filter(Boolean) });
}

if (args.demo) {
  const item = {
    id: "demo",
    title: "La BCE baisse ses taux de 0,25 point, une première depuis un an",
    summary: "La Banque centrale européenne a abaissé jeudi son taux de dépôt de 0,25 point à 2,25 %. L'inflation en zone euro est revenue à 2,1 % en octobre. Les marchés anticipent une nouvelle baisse en début d'année prochaine. Les taux des crédits immobiliers pourraient en profiter.",
    link: "https://example.com/demo",
    source: "Exemple",
    publishedAt: new Date().toISOString(),
    brand: args.brand || "investisseur",
  };
  await processItem(item, { save: false, demo: true });
  process.exit(0);
}

async function itemFromUrl(url) {
  let title = url;
  let summary = "";
  try {
    const html = await fetchText(url);
    title = stripHtml(html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)?.[1] || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || url);
    summary = stripHtml(html.match(/<meta[^>]+(?:name|property)="(?:og:)?description"[^>]+content="([^"]+)"/i)?.[1] || "");
  } catch (e) {
    console.warn(`Impossible de lire ${url}: ${e.message}`);
  }
  const item = {
    id: makeId(title + url),
    title, summary, link: url,
    source: new URL(url).hostname.replace(/^www\./, ""),
    publishedAt: new Date().toISOString(),
    collectedAt: new Date().toISOString(),
    brand: args.brand || "investisseur",
    score: 99,
    status: "validated",
    manual: true,
    ...(/visualcapitalist\.com|voronoiapp\.com/i.test(url) ? { kind: "data" } : {}),
  };
  db.items.push(item);
  return item;
}

/** Couvertures des derniers carousels de la marque (publiés d'abord), pour le profil affiché sur la dernière page. */
function recentCovers(brandKey, exceptId) {
  const isPub = (i) => Object.values(i.published || {}).some((v) => v && (v.id || v.url));
  return db.items
    // Jamais une couverture sans photo ; d'abord les carousels publiés (déjà validés), puis ceux avec photo.
    .filter((i) => i.brand === brandKey && i.id !== exceptId && i.status === "done" && i.carousel?.dir && i.carousel.coverPhoto !== false)
    .sort((a, b) => Number(isPub(b)) - Number(isPub(a)) || Number(!!b.carousel.coverPhoto) - Number(!!a.carousel.coverPhoto) || (b.generatedAt || "").localeCompare(a.generatedAt || ""))
    .map((i) => path.join(ROOT, i.carousel.dir, "slide-01.jpg"))
    .filter((f) => fs.existsSync(f))
    .slice(0, 3)
    .map((f) => `data:image/jpeg;base64,${fs.readFileSync(f).toString("base64")}`);
}

async function processItem(item, { save = true, demo = false } = {}) {
  const brandKey = args.brand || item.brand;
  const brand = brands[brandKey];
  if (!brand) throw new Error(`Marque inconnue : ${brandKey}`);
  item.brand = brandKey;
  item.status = "generating";
  touched.add(item.id);
  if (save) saveNews(db);

  console.log(`→ ${brand.name} : ${item.title}`);
  const hasKey = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
  const articleText = demo || item.link.includes("news.google.com") ? "" : await fetchArticleText(item.link);
  const carousel = demo && !hasKey
    ? { ...readJson("templates/demo.json"), slides: readJson("templates/demo.json").slides.map((s) => (s.kind === "cta" ? { ...s, title: brand.cta, body: brand.handle } : s)) }
    : await writeCarousel({ item, brand, articleText, instructions: args.instructions || item.instructions });

  const day = (item.publishedAt || new Date().toISOString()).slice(0, 10);
  const rel = path.posix.join("carousels", day, `${brandKey}-${slugify(item.title, 40)}-${item.id}`);
  const outDir = path.join(ROOT, rel);
  fs.rmSync(outDir, { recursive: true, force: true }); // « Refaire » : on repart d'un dossier propre
  const images = brand.template === "photo" && !demo ? await illustrate({ slides: carousel.slides, item }) : [];
  carousel.ctaThumbs = recentCovers(brandKey, item.id);
  const files = await renderCarousel({ carousel, brand, outDir, sourceLabel: item.source, images });
  // Description du post : le texte seul (ni hashtags ni sources, à la demande de l'éditeur).
  const caption = String(carousel.caption || "").replace(/\n*(?:#[\p{L}\p{N}_]+\s*)+$/u, "").trim();
  fs.writeFileSync(path.join(outDir, "caption.txt"), caption + "\n");
  fs.writeFileSync(path.join(outDir, "carousel.json"), JSON.stringify({ item, carousel }, null, 2) + "\n");

  item.status = "done";
  item.generatedAt = new Date().toISOString();
  item.carousel = { dir: rel, files, generator: carousel.generator, slides: carousel.slides.length, hooks: carousel.hook_alternatives || [], coverPhoto: !!images[0] };
  if (save) saveNews(db);
  console.log(`  ✓ ${files.length} fichiers dans ${rel}`);

  const dash = dashboardUrl();
  await notify({
    title: `🎠 Carousel prêt — ${brand.name}`,
    message: item.title,
    click: dash ? `${dash}/?item=${item.id}` : undefined,
    tags: ["white_check_mark"],
  });
}

let targets = [];
if (args.url) targets = [await itemFromUrl(args.url)];
else if (args.id) {
  const ids = args.id.split(",").map((s) => s.trim()).filter(Boolean);
  targets = db.items.filter((i) => ids.includes(i.id));
  const missing = ids.filter((id) => !targets.find((t) => t.id === id));
  if (missing.length) console.warn(`Actus introuvables : ${missing.join(", ")}`);
} else targets = db.items.filter((i) => i.status === "validated");

if (args.action === "rejeter") {
  targets.forEach((i) => { i.status = "rejected"; touched.add(i.id); });
  saveNews(db);
  console.log(`${targets.length} actu(s) rejetée(s).`);
  process.exit(0);
}

// « Supprimer » : on efface les images et l'actu revient dans « À valider », prête à être refaite.
if (args.action === "supprimer") {
  for (const i of targets) {
    if (i.published && Object.keys(i.published).length) { console.log(`  ${i.title} : déjà publié, conservé`); continue; }
    if (i.carousel?.dir) fs.rmSync(path.join(ROOT, i.carousel.dir), { recursive: true, force: true });
    Object.assign(i, { status: "new", carousel: null, generatedAt: null, schedules: [], scheduled: null, error: null, publishError: null, instructions: null });
    touched.add(i.id);
    console.log(`  🗑 ${i.title}`);
  }
  saveNews(db);
  process.exit(0);
}

if (args.instructions) targets.forEach((i) => (i.instructions = args.instructions));
let failed = 0;
for (const item of targets) {
  try {
    await processItem(item);
  } catch (err) {
    failed++;
    item.status = "error";
    item.error = err.message;
    saveNews(db);
    console.error(`  ✗ ${item.title}: ${err.stack || err.message}`);
  }
}
if (!targets.length) console.log("Rien à générer.");
process.exit(failed ? 1 : 0);

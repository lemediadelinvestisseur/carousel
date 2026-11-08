// Publie un carousel sur Instagram et/ou la Page Facebook de sa marque.
// Usage :
//   node scripts/publish-social.mjs --mode connexion                      (vérifie les jetons des marques)
//   node scripts/publish-social.mjs --id <id> --mode test                 (prépare tout sans publier)
//   node scripts/publish-social.mjs --id <id> --mode publier [--targets instagram,facebook] [--force]
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { loadNews, saveNews, readJson, recordUpdates, ROOT } from "./lib/store.mjs";
import { pageToken, whoAmI, publishInstagram, publishFacebook } from "./lib/meta.mjs";
import { notify, dashboardUrl } from "./lib/notify.mjs";

const { values: args } = parseArgs({
  options: {
    id: { type: "string", default: process.env.INPUT_ID || "" },
    mode: { type: "string", default: process.env.INPUT_MODE || "test" },
    targets: { type: "string", default: process.env.INPUT_TARGETS || "instagram,facebook" },
    force: { type: "boolean", default: process.env.INPUT_FORCE === "true" },
  },
});

const brands = readJson("config/brands.json");
const targets = args.targets.split(",").map((s) => s.trim()).filter(Boolean);

if (args.mode === "connexion") {
  let ok = 0;
  for (const key of Object.keys(brands)) {
    try {
      const me = await whoAmI(pageToken(key));
      console.log(`✓ ${brands[key].name} : Page « ${me.pageName} » (${me.pageId})${me.igId ? `, Instagram @${me.igUsername} (${me.igId})` : ", ⚠️ aucun Instagram professionnel relié"}`);
      ok++;
    } catch (e) {
      console.log(`✗ ${brands[key].name} : ${e.message}`);
    }
  }
  process.exit(ok ? 0 : 1);
}

const db = loadNews();
const item = db.items.find((i) => i.id === args.id);
if (!item) throw new Error(`Actu introuvable : ${args.id}`);
if (item.status !== "done" || !item.carousel) throw new Error("Ce carousel n'est pas encore généré");

const repo = process.env.GITHUB_REPOSITORY || "lemediadelinvestisseur/carousel";
const branch = process.env.GITHUB_REF_NAME || "main";
const raw = (f) => `https://raw.githubusercontent.com/${repo}/${branch}/${item.carousel.dir}/${f}`;
const imageUrls = item.carousel.files.filter((f) => /\.jpe?g$/i.test(f)).map(raw);
const caption = fs.readFileSync(path.join(ROOT, item.carousel.dir, "caption.txt"), "utf8").trim();
const dryRun = args.mode !== "publier";

const token = pageToken(item.brand);
const me = await whoAmI(token);
console.log(`→ ${brands[item.brand].name} : Page « ${me.pageName} »${me.igUsername ? `, Instagram @${me.igUsername}` : ""}`);
console.log(`  ${imageUrls.length} images, légende de ${caption.length} caractères${dryRun ? " — MODE TEST, rien ne sera publié" : ""}`);

item.published = item.published || {};
const results = {};
let failed = 0;
for (const target of targets) {
  if (!dryRun && item.published[target]?.id && !args.force) {
    console.log(`  ${target} : déjà publié (${item.published[target].url || item.published[target].id}), ignoré`);
    continue;
  }
  try {
    const fn = target === "instagram" ? publishInstagram : target === "facebook" ? publishFacebook : null;
    if (!fn) throw new Error(`cible inconnue : ${target}`);
    const r = await fn({ igId: me.igId, pageId: me.pageId, token, imageUrls, caption, dryRun });
    results[target] = r;
    if (!dryRun) item.published[target] = { ...r, at: new Date().toISOString() };
  } catch (e) {
    failed++;
    console.error(`  ✗ ${target} : ${e.message}`);
    results[target] = { error: e.message };
  }
}

if (!dryRun) {
  saveNews(db);
  recordUpdates({ upsert: [item] });
  const done = Object.entries(results).filter(([, r]) => r.url || r.id);
  if (done.length) {
    await notify({
      title: `🚀 Publié — ${brands[item.brand].name}`,
      message: `${item.title}\n${done.map(([t]) => t).join(" + ")}`,
      click: done[0][1].url || dashboardUrl() || undefined,
      tags: ["rocket"],
    });
  }
}
process.exit(failed ? 1 : 0);

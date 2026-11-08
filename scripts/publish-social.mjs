// Publie un carousel sur Instagram et/ou la Page Facebook de sa marque, tout de suite ou à une heure programmée.
// Usage :
//   node scripts/publish-social.mjs --mode connexion                       (vérifie les jetons des marques)
//   node scripts/publish-social.mjs --id <id> --mode test                  (prépare tout sans publier)
//   node scripts/publish-social.mjs --id <id> --mode publier [--targets instagram,facebook] [--force]
//   node scripts/publish-social.mjs --id <id> --mode programmer --at 2026-11-09T11:30:00Z [--targets …]
//   node scripts/publish-social.mjs --id <id> --mode annuler              (annule la programmation)
//   node scripts/publish-social.mjs --mode echeances                      (publie ce qui est arrivé à échéance)
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
    at: { type: "string", default: process.env.INPUT_AT || "" },
    force: { type: "boolean", default: process.env.INPUT_FORCE === "true" },
  },
});

const brands = readJson("config/brands.json");
const parseTargets = (t) => String(t || "").split(",").map((s) => s.trim()).filter(Boolean);
const parisTime = (iso) =>
  new Date(iso).toLocaleString("fr-FR", { timeZone: "Europe/Paris", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// ---------------------------------------------------------------------------
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
const save = (items) => {
  saveNews(db);
  recordUpdates({ upsert: items });
};

/** Publie (ou teste) un carousel. Retourne le nombre d'échecs. */
async function publishItem(item, targets, { dryRun = false, force = false } = {}) {
  if (item.status !== "done" || !item.carousel) throw new Error("Ce carousel n'est pas encore généré");
  const repo = process.env.GITHUB_REPOSITORY || "lemediadelinvestisseur/carousel";
  const branch = process.env.GITHUB_REF_NAME || "main";
  const raw = (f) => `https://raw.githubusercontent.com/${repo}/${branch}/${item.carousel.dir}/${f}`;
  const imageUrls = item.carousel.files.filter((f) => /\.jpe?g$/i.test(f)).map(raw);
  const caption = fs.readFileSync(path.join(ROOT, item.carousel.dir, "caption.txt"), "utf8").trim();

  const token = pageToken(item.brand);
  const me = await whoAmI(token);
  console.log(`→ ${brands[item.brand].name} : Page « ${me.pageName} »${me.igUsername ? `, Instagram @${me.igUsername}` : ""}`);
  console.log(`  ${imageUrls.length} images, description de ${caption.length} caractères${dryRun ? " — MODE TEST, rien ne sera publié" : ""}`);

  item.published = item.published || {};
  const done = [];
  let failed = 0;
  for (const target of targets) {
    if (!dryRun && item.published[target]?.id && !force) {
      console.log(`  ${target} : déjà publié (${item.published[target].url || item.published[target].id}), ignoré`);
      continue;
    }
    try {
      const fn = target === "instagram" ? publishInstagram : target === "facebook" ? publishFacebook : null;
      if (!fn) throw new Error(`cible inconnue : ${target}`);
      const r = await fn({ igId: me.igId, pageId: me.pageId, token, imageUrls, caption, dryRun });
      if (!dryRun) {
        item.published[target] = { ...r, at: new Date().toISOString() };
        done.push([target, r]);
      }
    } catch (e) {
      failed++;
      console.error(`  ✗ ${target} : ${e.message}`);
      if (!dryRun) item.publishError = `${target} : ${e.message}`;
    }
  }
  if (!dryRun && done.length) {
    item.publishError = null;
    await notify({
      title: `🚀 Publié — ${brands[item.brand].name}`,
      message: `${item.title}\n${done.map(([t]) => t).join(" + ")}`,
      click: done[0][1].url || dashboardUrl() || undefined,
      tags: ["rocket"],
    });
  }
  return failed;
}

// ---------------------------------------------------------------------------
// Publications programmées arrivées à échéance (lancé toutes les 10 minutes).
if (args.mode === "echeances") {
  const now = Date.now();
  const due = db.items.filter((i) => i.scheduled?.at && Date.parse(i.scheduled.at) <= now);
  if (!due.length) {
    const next = db.items.filter((i) => i.scheduled?.at).sort((a, b) => a.scheduled.at.localeCompare(b.scheduled.at))[0];
    console.log(`Rien à publier.${next ? ` Prochaine publication : ${parisTime(next.scheduled.at)} (${next.title}).` : ""}`);
    process.exit(0);
  }
  let failed = 0;
  for (const item of due) {
    const { targets } = item.scheduled;
    console.log(`Publication programmée pour ${parisTime(item.scheduled.at)} : ${item.title}`);
    try {
      const f = await publishItem(item, parseTargets(targets));
      failed += f;
      if (f) {
        await notify({ title: `⚠️ Publication programmée en échec — ${brands[item.brand]?.name}`, message: `${item.title}\n${item.publishError || ""}`, click: dashboardUrl() || undefined, tags: ["warning"], priority: 4 });
      }
    } catch (e) {
      failed++;
      item.publishError = e.message;
      console.error(`  ✗ ${e.message}`);
      await notify({ title: `⚠️ Publication programmée en échec — ${brands[item.brand]?.name}`, message: `${item.title}\n${e.message}`, click: dashboardUrl() || undefined, tags: ["warning"], priority: 4 });
    }
    item.scheduled = null; // pas de nouvel essai automatique : on prévient l'éditeur en cas d'échec
  }
  save(due);
  process.exit(failed ? 1 : 0);
}

// ---------------------------------------------------------------------------
const item = db.items.find((i) => i.id === args.id);
if (!item) throw new Error(`Actu introuvable : ${args.id}`);

if (args.mode === "programmer") {
  const at = Date.parse(args.at);
  if (!args.at || Number.isNaN(at)) throw new Error(`Date de publication invalide : « ${args.at} »`);
  if (item.status !== "done" || !item.carousel) throw new Error("Ce carousel n'est pas encore généré");
  if (at < Date.now() - 5 * 60e3) throw new Error(`La date choisie (${parisTime(args.at)}) est déjà passée`);
  item.scheduled = { at: new Date(at).toISOString(), targets: parseTargets(args.targets).join(","), createdAt: new Date().toISOString() };
  item.publishError = null;
  save([item]);
  console.log(`🕒 Programmé pour ${parisTime(item.scheduled.at)} (heure de Paris) sur ${item.scheduled.targets}`);
  process.exit(0);
}

if (args.mode === "annuler") {
  const had = !!item.scheduled;
  item.scheduled = null;
  save([item]);
  console.log(had ? "Programmation annulée." : "Aucune programmation à annuler.");
  process.exit(0);
}

const dryRun = args.mode !== "publier";
const failed = await publishItem(item, parseTargets(args.targets), { dryRun, force: args.force });
if (!dryRun) {
  item.scheduled = null; // publié à la main : la programmation éventuelle n'a plus lieu d'être
  save([item]);
}
process.exit(failed ? 1 : 0);

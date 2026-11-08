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
import { loadNews, saveNews, readJson, recordUpdates, writeSideFile, ROOT } from "./lib/store.mjs";
import { pageToken, whoAmI, publishInstagram, publishFacebook } from "./lib/meta.mjs";
import { linkedinToken, myOrganizations, organizationFor, publishLinkedIn } from "./lib/linkedin.mjs";
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
  // État des comptes, affiché dans le dashboard (page LinkedIn notamment).
  const status = { checkedAt: new Date().toISOString(), brands: {} };
  for (const key of Object.keys(brands)) {
    status.brands[key] = { instagram: null, facebook: null, linkedin: null };
    try {
      const me = await whoAmI(pageToken(key));
      console.log(`✓ ${brands[key].name} : Page « ${me.pageName} » (${me.pageId})${me.igId ? `, Instagram @${me.igUsername} (${me.igId})` : ", ⚠️ aucun Instagram professionnel relié"}`);
      status.brands[key].facebook = { ok: true, name: me.pageName };
      status.brands[key].instagram = me.igId ? { ok: true, name: `@${me.igUsername}` } : { ok: false, error: "aucun Instagram professionnel relié" };
      ok++;
    } catch (e) {
      console.log(`✗ ${brands[key].name} : ${e.message}`);
      status.brands[key].facebook = status.brands[key].instagram = { ok: false, error: e.message };
    }
  }
  if (process.env.LINKEDIN_TOKEN) {
    try {
      const orgs = await myOrganizations(linkedinToken());
      console.log(`LinkedIn : Pages administrées → ${orgs.map((o) => `${o.name} (${o.id})`).join(", ") || "aucune"}`);
      for (const key of Object.keys(brands)) {
        try { const o = await organizationFor(brands[key], linkedinToken()); console.log(`✓ ${brands[key].name} : Page LinkedIn « ${o.name} » (${o.id})`); status.brands[key].linkedin = { ok: true, name: o.name }; }
        catch (e) { console.log(`✗ ${brands[key].name} : ${e.message}`); status.brands[key].linkedin = { ok: false, error: e.message }; }
      }
    } catch (e) {
      console.log(`✗ LinkedIn : ${e.message}`);
      for (const key of Object.keys(brands)) status.brands[key].linkedin = { ok: false, error: e.message };
    }
  } else {
    console.log("LinkedIn : pas encore configuré (secret LINKEDIN_TOKEN absent)");
    for (const key of Object.keys(brands)) status.brands[key].linkedin = { ok: false, error: "pas encore configuré", pending: true };
  }
  writeSideFile("data/social-status.json", status);
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

  const needsMeta = targets.some((t) => t === "instagram" || t === "facebook");
  const token = needsMeta ? pageToken(item.brand) : null;
  const me = needsMeta ? await whoAmI(token) : {};
  console.log(`→ ${brands[item.brand].name}${needsMeta ? ` : Page « ${me.pageName} »${me.igUsername ? `, Instagram @${me.igUsername}` : ""}` : ""}`);
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
      let r;
      if (target === "linkedin") {
        const pdf = path.join(ROOT, item.carousel.dir, "carousel.pdf");
        if (!fs.existsSync(pdf)) throw new Error("PDF du carousel introuvable");
        r = await publishLinkedIn({ brand: brands[item.brand], token: linkedinToken(), pdfPath: pdf, title: item.title, caption, dryRun });
      } else {
        const fn = target === "instagram" ? publishInstagram : target === "facebook" ? publishFacebook : null;
        if (!fn) throw new Error(`cible inconnue : ${target}`);
        r = await fn({ igId: me.igId, pageId: me.pageId, token, imageUrls, caption, dryRun });
      }
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
// Programmations : un carousel peut en avoir plusieurs (ex : Instagram à 18 h, LinkedIn le lendemain à 8 h).
// item.schedules = [{ at, targets: "instagram,facebook", createdAt }]. L'ancien format item.scheduled est repris.
function schedulesOf(item) {
  const list = Array.isArray(item.schedules) ? [...item.schedules] : [];
  if (item.scheduled?.at) list.push(item.scheduled);
  return list.filter((s) => s && s.at && s.targets);
}
function setSchedules(item, list) {
  item.schedules = list.filter((s) => parseTargets(s.targets).length).sort((a, b) => a.at.localeCompare(b.at));
  item.scheduled = null;
}
/** Retire des cibles de toutes les programmations d'un carousel (une cible n'est programmée qu'une fois). */
function withoutTargets(list, targets) {
  return list.map((s) => ({ ...s, targets: parseTargets(s.targets).filter((t) => !targets.includes(t)).join(",") }));
}

// Publications programmées arrivées à échéance (lancé toutes les 10 minutes).
if (args.mode === "echeances") {
  const now = Date.now();
  const due = db.items.filter((i) => schedulesOf(i).some((s) => Date.parse(s.at) <= now));
  if (!due.length) {
    const next = db.items.flatMap((i) => schedulesOf(i).map((s) => ({ s, i }))).sort((a, b) => a.s.at.localeCompare(b.s.at))[0];
    console.log(`Rien à publier.${next ? ` Prochaine publication : ${parisTime(next.s.at)} sur ${next.s.targets} (${next.i.title}).` : ""}`);
    process.exit(0);
  }
  let failed = 0;
  for (const item of due) {
    const all = schedulesOf(item);
    const ready = all.filter((s) => Date.parse(s.at) <= now);
    const targets = [...new Set(ready.flatMap((s) => parseTargets(s.targets)))];
    console.log(`Publication programmée (${ready.map((s) => parisTime(s.at)).join(", ")}) sur ${targets.join(", ")} : ${item.title}`);
    try {
      const f = await publishItem(item, targets);
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
    // Les programmations échues sont retirées (pas de nouvel essai automatique : l'éditeur est prévenu en cas d'échec).
    setSchedules(item, all.filter((s) => Date.parse(s.at) > now));
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
  const targets = parseTargets(args.targets);
  const entry = { at: new Date(at).toISOString(), targets: targets.join(","), createdAt: new Date().toISOString() };
  setSchedules(item, [...withoutTargets(schedulesOf(item), targets), entry]);
  item.publishError = null;
  save([item]);
  console.log(`🕒 Programmé pour ${parisTime(entry.at)} (heure de Paris) sur ${entry.targets}`);
  process.exit(0);
}

if (args.mode === "annuler") {
  // Sans cible précisée (ou avec toutes) : tout est annulé ; sinon seulement les réseaux indiqués.
  const targets = process.env.INPUT_TARGETS || process.argv.includes("--targets") ? parseTargets(args.targets) : ["instagram", "facebook", "linkedin"];
  const before = schedulesOf(item);
  setSchedules(item, withoutTargets(before, targets));
  save([item]);
  console.log(before.length ? `Programmation annulée pour ${targets.join(", ")}.` : "Aucune programmation à annuler.");
  process.exit(0);
}

const dryRun = args.mode !== "publier";
const targetsNow = parseTargets(args.targets);
const failed = await publishItem(item, targetsNow, { dryRun, force: args.force });
if (!dryRun) {
  setSchedules(item, withoutTargets(schedulesOf(item), targetsNow)); // publié à la main sur ces réseaux : leur programmation tombe
  save([item]);
}
process.exit(failed ? 1 : 0);

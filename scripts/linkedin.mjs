// Projet LinkedIn : posts memes pour le profil personnel (indépendant des carousels).
// Usage :
//   node scripts/linkedin.mjs --mode proposer [--count 3]                 (nouvelles propositions, aussi lancé chaque matin)
//   node scripts/linkedin.mjs --mode idee --idea "…" [--format template|photo] [--instructions "…"]
//   node scripts/linkedin.mjs --mode refaire --id <id> [--instructions "…"]
//   node scripts/linkedin.mjs --mode modifier --id <id> --text "…"       (nouveau texte du post)
//   node scripts/linkedin.mjs --mode ecarter --id <id>
//   node scripts/linkedin.mjs --mode publier|test --id <id>
//   node scripts/linkedin.mjs --mode programmer --id <id> --at <ISO>
//   node scripts/linkedin.mjs --mode annuler --id <id>
//   node scripts/linkedin.mjs --mode echeances                           (publie ce qui est arrivé à échéance)
//   node scripts/linkedin.mjs --mode connexion                           (vérifie le jeton LinkedIn)
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { parseArgs } from "node:util";
import { loadLinkedin, saveLinkedin, loadNews, readJson, readJsonIfExists, recordUpdates, writeSideFile, parisDay, ROOT } from "./lib/store.mjs";
import { writeMemePosts, memeImage, placeLabels, renderMeme } from "./lib/memes.mjs";
import { linkedinToken, me, publishImagePost } from "./lib/linkedin.mjs";
import { notify, dashboardUrl } from "./lib/notify.mjs";

const { values: args } = parseArgs({
  options: {
    mode: { type: "string", default: process.env.INPUT_MODE || "proposer" },
    id: { type: "string", default: process.env.INPUT_ID || "" },
    idea: { type: "string", default: process.env.INPUT_IDEA || "" },
    instructions: { type: "string", default: process.env.INPUT_INSTRUCTIONS || "" },
    format: { type: "string", default: process.env.INPUT_FORMAT || "" },
    text: { type: "string", default: process.env.INPUT_TEXT || "" },
    at: { type: "string", default: process.env.INPUT_AT || "" },
    count: { type: "string", default: process.env.INPUT_COUNT || "" },
  },
});

const cfg = readJson("config/linkedin.json");
const db = loadLinkedin();
const save = (posts) => {
  saveLinkedin(db);
  recordUpdates({ liUpsert: posts });
};
const parisTime = (iso) => new Date(iso).toLocaleString("fr-FR", { timeZone: "Europe/Paris", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const dash = () => dashboardUrl() ? `${dashboardUrl()}/?projet=linkedin` : undefined;

// ---------------------------------------------------------------------------
if (args.mode === "connexion") {
  const status = { checkedAt: new Date().toISOString() };
  try {
    const who = await me(linkedinToken());
    Object.assign(status, { ok: true, name: who.name });
    console.log(`✓ LinkedIn : profil « ${who.name} »`);
  } catch (e) {
    Object.assign(status, { ok: false, error: e.message, pending: !process.env.LINKEDIN_TOKEN });
    console.log(`✗ LinkedIn : ${e.message}`);
  }
  writeSideFile("data/linkedin-status.json", status);
  process.exit(status.ok ? 0 : 1);
}

// ---------------------------------------------------------------------------
// Création des memes
function context() {
  const since = Date.now() - 48 * 3600e3;
  const news = loadNews().items
    .filter((i) => Date.parse(i.publishedAt) > since && (i.aiScore ?? 0) >= 6)
    .sort((a, b) => (b.aiScore ?? 0) - (a.aiScore ?? 0))
    .slice(0, 25);
  const recent = db.posts.filter((p) => p.angle).slice(0, 30).map((p) => p.angle);
  return { news, recent, insights: readJsonIfExists("data/linkedin-insights.json", null) };
}

async function build(post, meme) {
  const img = await memeImage(meme);
  let boxes = null;
  if (meme.format === "labels" && meme.labels.length) {
    try { boxes = await placeLabels(img, meme.labels); }
    catch (e) {
      console.log(`  [memes] placement impossible (${e.message}) : passage en légende au-dessus`);
      meme.format = "caption";
      meme.caption = meme.caption || meme.labels.join(" / ");
    }
  }
  const rel = `carousels/linkedin/${parisDay()}/${post.id}.jpg`;
  if (post.image && post.image !== rel) fs.rmSync(path.join(ROOT, post.image), { force: true });
  await renderMeme({ post: meme, img, boxes, outFile: path.join(ROOT, rel) });
  Object.assign(post, {
    status: "ready",
    angle: meme.angle,
    text: meme.post_text.trim(),
    image: rel,
    meme: { image_source: meme.image_source, format: meme.format, template: meme.template || null, image_query: meme.image_query || null, caption: meme.caption || null, labels: meme.labels || [] },
    generator: meme.generator,
    generatedAt: new Date().toISOString(),
    error: null,
    errorAt: null,
  });
  console.log(`  ✓ ${meme.angle} (${meme.image_source}${meme.template ? ` « ${meme.template} »` : ""}, ${meme.format}) → ${rel}`);
}

async function create({ count, idea, instructions, format, existing }) {
  const { news, recent, insights } = context();
  const memes = await writeMemePosts({ cfg, count, idea, instructions, format, news, recent, insights });
  const done = [];
  for (let k = 0; k < memes.length; k++) {
    const post = existing || { id: crypto.randomBytes(5).toString("hex"), createdAt: new Date().toISOString(), origin: idea ? "idee" : "auto", idea: idea || null };
    if (!existing) db.posts.push(post);
    if (instructions) post.instructions = instructions;
    try {
      await build(post, memes[k]);
    } catch (e) {
      console.error(`  ✗ ${memes[k].angle} : ${e.message}`);
      Object.assign(post, { status: existing ? post.status : "error", angle: post.angle || memes[k].angle, error: e.message, errorAt: new Date().toISOString() });
    }
    done.push(post);
  }
  save(done);
  return done;
}

if (["proposer", "idee", "refaire"].includes(args.mode)) {
  let posts;
  if (args.mode === "refaire") {
    const post = db.posts.find((p) => p.id === args.id);
    if (!post) throw new Error(`Post introuvable : ${args.id}`);
    const base = post.idea || `Refais une variante de cette idée : ${post.angle}`;
    posts = await create({ count: 1, idea: base, instructions: args.instructions, format: args.format, existing: post });
  } else if (args.mode === "idee") {
    if (!args.idea.trim()) throw new Error("Idée vide");
    posts = await create({ count: 1, idea: args.idea.trim(), instructions: args.instructions, format: args.format });
  } else {
    const n = Math.max(1, Math.min(5, Number(args.count) || cfg.postsPerDay || 3));
    posts = await create({ count: n, instructions: args.instructions, format: args.format });
  }
  const ok = posts.filter((p) => p.status === "ready");
  if (ok.length) {
    await notify({
      title: `💼 LinkedIn — ${ok.length > 1 ? `${ok.length} memes à valider` : "meme prêt"}`,
      message: ok.map((p) => `• ${p.angle}`).join("\n"),
      click: dash(),
      tags: ["briefcase"],
    });
  }
  process.exit(ok.length ? 0 : 1);
}

// ---------------------------------------------------------------------------
async function publish(post, { dryRun = false } = {}) {
  if (post.status !== "ready" || !post.image) throw new Error("Ce post n'est pas prêt");
  if (!dryRun && post.published?.id) { console.log(`Déjà publié : ${post.published.url || post.published.id}`); return; }
  const r = await publishImagePost({ token: linkedinToken(), imagePath: path.join(ROOT, post.image), text: post.text, altText: post.meme?.caption || post.angle, dryRun });
  if (dryRun) return;
  post.published = { ...r, at: new Date().toISOString() };
  post.publishError = null;
  post.schedules = [];
  await notify({ title: "🚀 Publié sur LinkedIn", message: post.angle, click: r.url || dash(), tags: ["rocket"] });
}

if (args.mode === "echeances") {
  const now = Date.now();
  const due = db.posts.filter((p) => (p.schedules || []).some((s) => Date.parse(s.at) <= now));
  if (!due.length) { console.log("Aucun post LinkedIn à publier."); process.exit(0); }
  let failed = 0;
  for (const post of due) {
    console.log(`Publication programmée : ${post.angle}`);
    try { await publish(post); }
    catch (e) {
      failed++;
      post.publishError = e.message;
      post.schedules = [];
      console.error(`  ✗ ${e.message}`);
      await notify({ title: "⚠️ Publication LinkedIn en échec", message: `${post.angle}\n${e.message}`, click: dash(), tags: ["warning"], priority: 4 });
    }
  }
  save(due);
  process.exit(failed ? 1 : 0);
}

const post = db.posts.find((p) => p.id === args.id);
if (!post) throw new Error(`Post introuvable : ${args.id}`);

if (args.mode === "modifier") {
  if (!args.text.trim()) throw new Error("Texte vide");
  post.text = args.text.trim();
  save([post]);
  console.log("Texte du post enregistré.");
} else if (args.mode === "ecarter") {
  post.status = "rejected";
  post.schedules = [];
  save([post]);
  console.log("Post écarté.");
} else if (args.mode === "programmer") {
  const at = Date.parse(args.at);
  if (!args.at || Number.isNaN(at)) throw new Error(`Date de publication invalide : « ${args.at} »`);
  if (at < Date.now() - 5 * 60e3) throw new Error(`La date choisie (${parisTime(args.at)}) est déjà passée`);
  if (post.status !== "ready") throw new Error("Ce post n'est pas prêt");
  post.schedules = [{ at: new Date(at).toISOString(), createdAt: new Date().toISOString() }];
  post.publishError = null;
  save([post]);
  console.log(`🕒 Programmé pour ${parisTime(post.schedules[0].at)} (heure de Paris)`);
} else if (args.mode === "annuler") {
  post.schedules = [];
  save([post]);
  console.log("Programmation annulée.");
} else if (args.mode === "publier" || args.mode === "test") {
  try { await publish(post, { dryRun: args.mode === "test" }); }
  catch (e) {
    if (args.mode === "publier") { post.publishError = e.message; save([post]); }
    console.error(`✗ ${e.message}`);
    process.exit(1);
  }
  if (args.mode === "publier") save([post]);
} else {
  throw new Error(`Mode inconnu : ${args.mode}`);
}

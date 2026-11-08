// Posts LinkedIn à base de memes : idées et textes par Claude, image (template de meme connu ou photo), rendu en JPEG.
// Deux formats d'image :
//   - « caption » : une légende au-dessus de l'image, façon tweet (marche avec n'importe quel template ou photo) ;
//   - « labels »  : des textes placés directement dans le template (Drake, Distracted boyfriend…), positionnés par Claude.
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod/v4";
import { chromium } from "playwright";
import { download, gather, downloadSome } from "./images.mjs";

const MODEL = () => process.env.CLAUDE_MODEL || "claude-opus-5-5";
const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" };
const hasKey = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

// ---------------------------------------------------------------------------
// Templates de memes (les 100 plus populaires d'Imgflip)
let templatesCache = null;
export async function memeTemplates() {
  if (templatesCache) return templatesCache;
  try {
    const res = await fetch("https://api.imgflip.com/get_memes", { signal: AbortSignal.timeout(15000) });
    const data = await res.json();
    templatesCache = (data?.data?.memes || []).map((m) => ({ id: m.id, name: m.name, url: m.url, width: m.width, height: m.height, boxes: m.box_count }));
  } catch (e) {
    console.log(`[memes] liste des templates indisponible (${e.message})`);
    templatesCache = [];
  }
  return templatesCache;
}

const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

// ---------------------------------------------------------------------------
// Rédaction
const Post = z.object({
  angle: z.string().describe("L'idée du post en une phrase (pour le tableau de bord)"),
  image_source: z.enum(["template", "photo"]).describe("template = un meme connu de la liste ; photo = une vraie photo trouvée sur le web"),
  format: z.enum(["caption", "labels"]).describe("caption = légende au-dessus de l'image ; labels = textes placés dans l'image (template à plusieurs cases seulement)"),
  template: z.string().describe("Nom EXACT du template choisi dans la liste (vide si photo)"),
  image_query: z.string().describe("Pour une photo : recherche d'image précise, en anglais si plus efficace (vide si template)"),
  caption: z.string().describe("Format caption : la légende au-dessus de l'image, 5 à 25 mots (vide si labels)"),
  labels: z.array(z.string()).describe("Format labels : un texte court par case du template, dans l'ordre de lecture (vide si caption)"),
  post_text: z.string().describe("Texte du post LinkedIn qui accompagne l'image"),
});
const PostsSchema = z.object({ posts: z.array(Post) });

function systemPrompt(cfg) {
  return `Tu écris des posts LinkedIn humoristiques à base de MEMES pour le profil personnel d'un créateur français.
QUI PUBLIE : ${cfg.about}
${cfg.myInvestments ? `SES INVESTISSEMENTS PERSONNELS (faits réels, à utiliser tels quels) : ${cfg.myInvestments}\n` : ""}SUJETS : ${(cfg.topics || []).join(" ; ")}.

LE MEME :
- Il doit être VRAIMENT drôle et immédiatement compréhensible par un Français qui scrolle LinkedIn : une situation vécue, une vérité que tout le monde pense tout bas, un décalage absurde.
- Choisis entre un TEMPLATE CONNU (liste fournie ; prends seulement un template dont tu connais bien l'image et le sens) et une PHOTO réelle (personnalité, scène de la vie courante, actu), selon ce qui est le plus drôle. Varie les formats d'un post à l'autre.
- Format « caption » : une légende courte au-dessus de l'image (style tweet), qui donne le contexte ; l'image fait la chute. Marche avec n'importe quelle image.
- Format « labels » : seulement pour un template à plusieurs cases (Drake, Distracted Boyfriend, Two Buttons, Expanding Brain…) ; un texte TRÈS court par case (1 à 8 mots), autant de textes que de cases (box_count).
- Français naturel, familier, tutoiement possible. Pas de jeu de mots lourd, pas d'humour qui rabaisse une catégorie de personnes, rien de politique clivant, rien de vulgaire.

LE TEXTE DU POST (post_text) :
- 40 à 150 mots. Première ligne = accroche qui donne envie de cliquer sur « voir plus ».
- Prolonge la blague ou raconte l'anecdote, puis termine par une question simple pour faire réagir en commentaire.
- Phrases courtes, sauts de ligne, ton humain : jamais de formules « d'IA » (« Dans un monde où… », « Et vous ? Qu'en pensez-vous ? » plat, « Décryptage »).
- 0 à 2 emojis, pas de hashtags, pas de lien.
- N'invente JAMAIS un fait personnel (achat, montant, perte, gain) : n'utilise que les investissements personnels indiqués ci-dessus ou l'idée fournie. Sinon parle de « on », des investisseurs en général.
- Pas de conseil en investissement présenté comme tel.
${cfg.styleNotes ? `\nSTYLE OBSERVÉ CHEZ LES COMPTES QUI MARCHENT (à suivre) :\n${cfg.styleNotes}\n` : ""}`;
}

export async function writeMemePosts({ cfg, count = 3, idea = "", instructions = "", format = "", news = [], recent = [] }) {
  if (!hasKey()) throw new Error("Clé ANTHROPIC_API_KEY absente : impossible de créer des memes");
  const templates = await memeTemplates();
  const today = new Date().toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const user = `DATE DU JOUR : ${today}

TEMPLATES DISPONIBLES (nom — nombre de cases) :
${templates.map((t) => `${t.name} — ${t.boxes}`).join("\n") || "(liste indisponible : utilise des photos)"}

ACTUS RÉCENTES (pour t'inspirer si c'est drôle, sans obligation) :
${news.map((n) => `- ${n.title}${n.hook ? ` (${n.hook})` : ""}`).join("\n") || "(aucune)"}

POSTS DÉJÀ FAITS (ne pas répéter la même blague) :
${recent.map((r) => `- ${r}`).join("\n") || "(aucun)"}
${idea ? `\nIDÉE DE L'AUTEUR (à transformer en meme, prioritaire) :\n${idea}\n` : ""}${instructions ? `\nCONSIGNES (prioritaires) :\n${instructions}\n` : ""}${format === "template" ? "\nUtilise un template de meme connu.\n" : format === "photo" ? "\nUtilise une vraie photo.\n" : ""}
Imagine une quinzaine d'idées, garde les ${count} plus drôles et les plus variées, et rédige ${count === 1 ? "ce post" : `ces ${count} posts`}.`;
  const client = new Anthropic();
  const res = await client.beta.messages.parse({
    model: MODEL(),
    max_tokens: 12000,
    ...FALLBACK,
    output_config: { effort: "high", format: betaZodOutputFormat(PostsSchema) },
    system: systemPrompt(cfg),
    messages: [{ role: "user", content: user }],
  });
  if (res.stop_reason === "refusal") throw new Error("refus du modèle");
  const posts = res.parsed_output?.posts || [];
  if (!posts.length) throw new Error(`aucun post rédigé (stop_reason=${res.stop_reason})`);
  return posts.slice(0, count).map((p) => ({ ...p, generator: res.model }));
}

// ---------------------------------------------------------------------------
// Image
const Pick = z.object({ index: z.number().int().describe("Numéro de la meilleure image (0 = aucune)"), reason: z.string() });

async function choosePhoto(imgs, post) {
  if (imgs.length <= 1) return imgs[0] || null;
  const content = [];
  imgs.forEach((im, i) => {
    content.push({ type: "text", text: `Image ${i + 1} (${im.width}x${im.height}) :` });
    content.push({ type: "image", source: { type: "base64", media_type: im.type, data: im.buf.toString("base64") } });
  });
  content.push({ type: "text", text: `Choisis la photo qui rend ce meme le plus drôle et le plus clair.
Légende du meme : « ${post.caption || post.labels.join(" / ")} »
Ce que la photo doit montrer : ${post.image_query}
Préférence : expression ou situation parlante, sujet reconnaissable, photo nette. Éliminatoire : filigrane, texte incrusté, logo d'un autre média, capture d'écran, image floue. Réponds 0 si aucune ne convient.` });
  try {
    const res = await new Anthropic().beta.messages.parse({
      model: MODEL(), max_tokens: 1500, ...FALLBACK,
      output_config: { effort: "low", format: betaZodOutputFormat(Pick) },
      messages: [{ role: "user", content }],
    });
    const idx = res.parsed_output?.index ?? 1;
    console.log(`  [memes] photo ${idx}/${imgs.length} — ${res.parsed_output?.reason || ""}`);
    return idx >= 1 && idx <= imgs.length ? imgs[idx - 1] : null;
  } catch (e) {
    console.log(`  [memes] choix de photo impossible (${e.message}), première retenue`);
    return imgs[0];
  }
}

/** Trouve l'image du meme : le template demandé ou une photo. Retourne { buf, type, width, height, dataUri, source }. */
export async function memeImage(post) {
  if (post.image_source === "template") {
    const templates = await memeTemplates();
    const t = templates.find((x) => norm(x.name) === norm(post.template)) || templates.find((x) => norm(x.name).includes(norm(post.template)) || norm(post.template).includes(norm(x.name)));
    if (t) {
      try {
        const img = await download({ url: t.url, source: "imgflip" }, 200);
        return { ...img, template: t };
      } catch (e) { console.log(`  [memes] template « ${t.name} » indisponible (${e.message})`); }
    } else console.log(`  [memes] template « ${post.template} » introuvable`);
    if (!post.image_query) post.image_query = post.template;
    post.image_source = "photo";
    post.format = "caption";
  }
  const cands = await gather({ query: post.image_query, entity: "", articleUrl: "", includeArticle: false });
  const imgs = (await downloadSome(cands, 6, new Set(), 400, null)).filter((im) => im.buf.length < 4_500_000 && ["image/jpeg", "image/png", "image/webp"].includes(im.type));
  if (!imgs.length) throw new Error(`aucune photo trouvée pour « ${post.image_query} »`);
  return hasKey() ? (await choosePhoto(imgs, post)) || imgs[0] : imgs[0];
}

// Placement des textes dans un template à plusieurs cases : Claude regarde l'image et indique où écrire.
const Boxes = z.object({
  boxes: z.array(z.object({
    x: z.number(), y: z.number(), w: z.number(), h: z.number(),
    color: z.enum(["white", "black"]).describe("white = texte blanc contouré de noir, sur une photo ; black = texte noir, sur une zone blanche ou claire"),
  })),
});

export async function placeLabels(img, labels) {
  const res = await new Anthropic().beta.messages.parse({
    model: MODEL(), max_tokens: 2000, ...FALLBACK,
    output_config: { effort: "medium", format: betaZodOutputFormat(Boxes) },
    messages: [{ role: "user", content: [
      { type: "image", source: { type: "base64", media_type: img.type, data: img.buf.toString("base64") } },
      { type: "text", text: `C'est un template de meme${img.template ? ` (« ${img.template.name} »)` : ""}. Je dois y écrire ces ${labels.length} textes, dans cet ordre :
${labels.map((l, i) => `${i + 1}. ${l}`).join("\n")}
Pour chaque texte, donne la zone où l'écrire, comme dans la version classique de ce meme (ex : Drake → moitié droite de chaque case ; Distracted Boyfriend → sur chaque personne). La zone ne doit pas cacher les visages ni l'élément clé de l'image. Coordonnées en fractions de 0 à 1 (x, y = coin haut gauche ; w, h = largeur, hauteur). Une zone par texte, dans le même ordre.` },
    ] }],
  });
  const boxes = res.parsed_output?.boxes || [];
  if (boxes.length < labels.length) throw new Error("placement des textes incomplet");
  const c = (v) => Math.min(1, Math.max(0, Number(v) || 0));
  return boxes.slice(0, labels.length).map((b) => ({ x: c(b.x), y: c(b.y), w: Math.max(0.08, c(b.w)), h: Math.max(0.05, c(b.h)), color: b.color }));
}

// ---------------------------------------------------------------------------
// Rendu
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const W = 1080;

function memeHtml({ post, img, boxes }) {
  const ratio = img.height / img.width;
  const imgH = Math.round(W * ratio);
  const fonts = `<link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600;800&family=Anton&display=swap" rel="stylesheet">`;
  if (post.format === "labels" && boxes) {
    return `<!doctype html><html><head><meta charset="utf-8">${fonts}<style>
*{margin:0;box-sizing:border-box}body{background:#fff}
#m{position:relative;width:${W}px;height:${imgH}px;overflow:hidden}
#m img{width:100%;height:100%;display:block}
.l{position:absolute;display:flex;align-items:center;justify-content:center;text-align:center;padding:6px;overflow:hidden}
.l span{display:block;line-height:1.08;font-family:Inter,Arial,sans-serif;font-weight:800;word-break:normal;overflow-wrap:anywhere}
.l.white span{color:#fff;-webkit-text-stroke:0;text-shadow:0 0 3px #000,0 0 3px #000,2px 2px 0 #000,-2px -2px 0 #000,2px -2px 0 #000,-2px 2px 0 #000;font-family:Anton,Impact,sans-serif;font-weight:400;text-transform:uppercase;letter-spacing:.01em}
.l.black span{color:#111}
</style></head><body><div id="m"><img src="${img.dataUri}">
${post.labels.map((t, i) => { const b = boxes[i]; return `<div class="l ${b.color}" style="left:${b.x * 100}%;top:${b.y * 100}%;width:${b.w * 100}%;height:${b.h * 100}%"><span>${esc(t)}</span></div>`; }).join("")}
</div><script>
window.__fitDone=document.fonts.ready.then(()=>{document.querySelectorAll('.l').forEach(l=>{const s=l.querySelector('span');let f=Math.min(84,l.clientHeight*0.6);s.style.fontSize=f+'px';while(f>16&&(s.scrollHeight>l.clientHeight-8||s.scrollWidth>l.clientWidth-8)){f-=2;s.style.fontSize=f+'px';}});});
</script></body></html>`;
  }
  // Légende au-dessus de l'image (façon tweet). L'image est recadrée si l'ensemble dépasse le format 4:5.
  const capLen = String(post.caption || "").length;
  const fs = capLen < 60 ? 54 : capLen < 110 ? 48 : 42;
  return `<!doctype html><html><head><meta charset="utf-8">${fonts}<style>
*{margin:0;box-sizing:border-box}body{background:#fff}
#m{width:${W}px;background:#fff}
.cap{padding:48px 56px 40px;font-family:Inter,Arial,sans-serif;font-weight:600;font-size:${fs}px;line-height:1.25;color:#0f1419}
.pic{width:${W}px;height:${imgH}px;overflow:hidden}
.pic img{width:100%;height:100%;object-fit:cover;object-position:center 30%;display:block}
</style></head><body><div id="m"><div class="cap">${esc(post.caption)}</div><div class="pic"><img src="${img.dataUri}"></div></div><script>
window.__fitDone=document.fonts.ready.then(()=>{const m=document.getElementById('m'),p=document.querySelector('.pic');const max=${Math.round(W * 1.25)};if(m.offsetHeight>max){p.style.height=Math.max(420,max-document.querySelector('.cap').offsetHeight)+'px';}});
</script></body></html>`;
}

export async function renderMeme({ post, img, boxes, outFile }) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  try {
    const page = await browser.newPage({ viewport: { width: W, height: 1400 }, deviceScaleFactor: 1 });
    await page.setContent(memeHtml({ post, img, boxes }), { waitUntil: "networkidle", timeout: 45000 }).catch(() => {});
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => window.__fitDone || null);
    await page.locator("#m").screenshot({ path: outFile, type: "jpeg", quality: 90 });
  } finally {
    await browser.close();
  }
}

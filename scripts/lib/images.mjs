// Recherche d'illustrations pour les slides.
// Sources, dans l'ordre : Google Images, Bing Images, Wikipédia (personnes / entreprises),
// image de l'article (og:image). Pour la couverture, Claude regarde les candidates et choisit la meilleure.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod/v4";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
const BOT_UA = "CarouselBot/1.0 (https://github.com/lemediadelinvestisseur/carousel)";

async function get(url, { ua = BROWSER_UA, timeout = 15000, accept = "*/*" } = {}) {
  const res = await fetch(url, {
    headers: { "user-agent": ua, accept, "accept-language": "fr-FR,fr;q=0.9,en;q=0.8" },
    signal: AbortSignal.timeout(timeout),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

const unescapeJs = (s) =>
  s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\\//g, "/").replace(/&amp;/g, "&");

const BLOCKED_HOSTS = /(gstatic\.com|googleusercontent|facebook|fbsbx|instagram|lookaside|tiktok|pinimg\.com\/(?:75|236)x|shutterstock|alamy|gettyimages|istockphoto|dreamstime|123rf|depositphotos|adobestock|stock\.adobe)/i;

/** Google Images (page de résultats HTML). */
export async function searchGoogle(query) {
  const url = `https://www.google.com/search?tbm=isch&hl=fr&gl=fr&safe=active&q=${encodeURIComponent(query)}`;
  const html = await (await get(url, { accept: "text/html" })).text();
  const out = [];
  // Les résultats apparaissent sous la forme ["https://…jpg",hauteur,largeur]
  for (const m of html.matchAll(/\["(https?:\/\/[^"]+?)",(\d{3,5}),(\d{3,5})\]/g)) {
    const src = unescapeJs(m[1]);
    if (BLOCKED_HOSTS.test(src)) continue;
    out.push({ url: src, height: Number(m[2]), width: Number(m[3]), source: "google" });
  }
  return dedupe(out);
}

/** Bing Images (page de résultats HTML, attribut m="{…murl…}"). */
export async function searchBing(query) {
  const url = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&qft=+filterui:imagesize-large&form=IRFLTR&setlang=fr`;
  const html = await (await get(url, { accept: "text/html" })).text();
  const out = [];
  for (const m of html.matchAll(/m="(\{[^"]*?murl[^"]*?\})"/g)) {
    try {
      const data = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
      if (data.murl && !BLOCKED_HOSTS.test(data.murl)) out.push({ url: data.murl, source: "bing" });
    } catch {}
  }
  return dedupe(out);
}

/** Image principale de la page Wikipédia (fr puis en). */
export async function wikipediaImage(title) {
  const out = [];
  for (const lang of ["fr", "en"]) {
    try {
      const api = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&redirects=1&prop=pageimages&piprop=thumbnail&pithumbsize=1600&titles=${encodeURIComponent(title)}`;
      const data = await (await get(api, { ua: BOT_UA })).json();
      for (const p of Object.values(data.query?.pages || {})) {
        if (p.thumbnail?.source) out.push({ url: p.thumbnail.source, width: p.thumbnail.width, height: p.thumbnail.height, source: "wikipedia" });
      }
      if (out.length) break;
    } catch {}
  }
  return out;
}

/** og:image de l'article source. */
export async function articleImage(pageUrl) {
  if (!pageUrl || /news\.google\.com/.test(pageUrl)) return [];
  try {
    const html = await (await get(pageUrl, { accept: "text/html", timeout: 12000 })).text();
    const m =
      html.match(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i) ||
      html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);
    return m ? [{ url: new URL(m[1].replace(/&amp;/g, "&"), pageUrl).href, source: "article" }] : [];
  } catch {
    return [];
  }
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((c) => (seen.has(c.url) ? false : (seen.add(c.url), true)));
}

// --- Téléchargement + contrôle qualité --------------------------------------
function imageSize(buf) {
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), type: "image/png" };
  // JPEG : on parcourt les segments jusqu'au SOF
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7), type: "image/jpeg" };
      i += 2 + len;
    }
    return { width: 0, height: 0, type: "image/jpeg" };
  }
  // WebP
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const chunk = buf.toString("ascii", 12, 16);
    if (chunk === "VP8X") return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3), type: "image/webp" };
    if (chunk === "VP8 ") return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff, type: "image/webp" };
    if (chunk === "VP8L") {
      const b = buf.readUInt32LE(21);
      return { width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff), type: "image/webp" };
    }
    return { width: 0, height: 0, type: "image/webp" };
  }
  return null;
}

export async function download(candidate, minSide = 600) {
  const res = await get(candidate.url, { timeout: 15000, accept: "image/avif,image/webp,image/*,*/*;q=0.8", ua: candidate.source === "wikipedia" ? BOT_UA : BROWSER_UA });
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 20000) throw new Error("image trop légère");
  if (buf.length > 8_000_000) throw new Error("image trop lourde");
  const info = imageSize(buf);
  if (!info) throw new Error("format non supporté");
  if (Math.min(info.width, info.height) < minSide) throw new Error(`trop petite (${info.width}x${info.height})`);
  return { ...candidate, ...info, buf, dataUri: `data:${info.type};base64,${buf.toString("base64")}` };
}

/** Rassemble des candidates pour une slide (requête + entité Wikipédia), sans doublons globaux. */
async function gather({ query, entity, articleUrl, includeArticle }) {
  const lists = await Promise.all([
    query ? searchGoogle(query).catch((e) => (console.log(`  [images] Google : ${e.message}`), [])) : [],
    query ? searchBing(query).catch((e) => (console.log(`  [images] Bing : ${e.message}`), [])) : [],
    entity ? wikipediaImage(entity) : [],
    includeArticle ? articleImage(articleUrl) : [],
  ]);
  const [google, bing, wiki, article] = lists;
  // Alterne les sources pour garder de la diversité.
  const merged = [];
  for (let i = 0; i < 8; i++) for (const l of [google, bing]) if (l[i]) merged.push(l[i]);
  return dedupe([...article, ...merged.slice(0, 6), ...wiki, ...merged.slice(6)]);
}

async function downloadSome(cands, n, used, minSide) {
  const ok = [];
  for (const c of cands) {
    if (ok.length >= n) break;
    if (used.has(c.url)) continue;
    try {
      ok.push(await download(c, minSide));
    } catch (e) {
      console.log(`  [images] ✗ ${c.source} ${c.url.slice(0, 80)} : ${e.message}`);
    }
  }
  return ok;
}

const Choice = z.object({
  index: z.number().int().describe("Numéro de la meilleure image (0 = aucune ne convient)"),
  reason: z.string(),
});

/** Claude regarde les candidates et choisit la meilleure illustration. */
async function chooseWithClaude(images, subject) {
  if (images.length < 2 || !(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN)) return images[0];
  const usable = images.filter((im) => im.buf.length < 4_500_000 && ["image/jpeg", "image/png", "image/webp"].includes(im.type));
  if (usable.length < 2) return images[0];
  const content = [];
  usable.forEach((im, i) => {
    content.push({ type: "text", text: `Image ${i + 1} (${im.width}x${im.height}, source ${im.source}) :` });
    content.push({ type: "image", source: { type: "base64", media_type: im.type, data: im.buf.toString("base64") } });
  });
  content.push({
    type: "text",
    text: `Sujet de la couverture : ${subject}
Choisis l'image qui ferait la meilleure photo de couverture plein écran d'un carousel Instagram de média financier.
Critères : représente clairement la personne ou l'entreprise du sujet ; photo nette et esthétique, idéalement en situation (dirigeant sur scène, siège, produit, logo sur un bâtiment) ; pas de texte incrusté, pas de filigrane, pas de montage, pas de capture d'écran ; cadrage compatible avec un format vertical 4:5.
Réponds 0 si aucune ne convient.`,
  });
  try {
    const client = new Anthropic();
    const res = await client.beta.messages.parse({
      model: process.env.CLAUDE_MODEL || "claude-opus-5-5",
      max_tokens: 2000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: betaZodOutputFormat(Choice) },
      messages: [{ role: "user", content }],
    });
    const idx = res.parsed_output?.index ?? 1;
    console.log(`  [images] Claude choisit l'image ${idx} : ${res.parsed_output?.reason || ""}`);
    return idx >= 1 && idx <= usable.length ? usable[idx - 1] : null;
  } catch (e) {
    console.log(`  [images] choix par Claude impossible (${e.message}), première image retenue`);
    return usable[0];
  }
}

/**
 * Trouve une illustration par slide.
 * slides: [{kind, image_query, image_entity}] → tableau de dataUri (ou null) aligné sur les slides.
 */
export async function illustrate({ slides, item }) {
  const used = new Set();
  const result = new Array(slides.length).fill(null);
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    if (s.kind === "cta") continue;
    const query = s.image_query?.trim();
    const entity = s.image_entity?.trim();
    if (!query && !entity) continue;
    const isCover = s.kind === "cover";
    try {
      const cands = await gather({ query, entity, articleUrl: item.link, includeArticle: isCover });
      const imgs = await downloadSome(cands, isCover ? 5 : 1, used, isCover ? 800 : 600);
      const pick = isCover ? await chooseWithClaude(imgs, `${item.title} — recherche : ${query || entity}`) : imgs[0];
      if (pick) {
        used.add(pick.url);
        result[i] = pick.dataUri;
        console.log(`  [images] slide ${i + 1} : ${pick.source} ${pick.width}x${pick.height}`);
      } else console.log(`  [images] slide ${i + 1} : aucune image retenue`);
    } catch (e) {
      console.log(`  [images] slide ${i + 1} : ${e.message}`);
    }
  }
  // Les slides sans image réutilisent la couverture (floutée/assombrie par le template).
  return result;
}

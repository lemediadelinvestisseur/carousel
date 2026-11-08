// Recherche d'illustrations pour les slides.
// Sources, dans l'ordre : Google Images, Bing Images, Wikipédia (personnes / entreprises),
// image de l'article (og:image). Pour la couverture, Claude regarde les candidates et choisit la meilleure.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod/v4";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
const BOT_UA = "CarouselBot/1.0 (https://github.com/lemediadelinvestisseur/carousel)";

async function get(url, { ua = BROWSER_UA, timeout = 15000, accept = "*/*", headers = {} } = {}) {
  const res = await fetch(url, {
    headers: { "user-agent": ua, accept, "accept-language": "fr-FR,fr;q=0.9,en;q=0.8", ...headers },
    signal: AbortSignal.timeout(timeout),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

const unescapeJs = (s) =>
  s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\\//g, "/").replace(/&amp;/g, "&");

const BLOCKED_HOSTS = /(gstatic\.com|googleusercontent|facebook|fbsbx|instagram|lookaside|tiktok|pinimg\.com\/(?:75|236)x|shutterstock|alamy|gettyimages|istockphoto|dreamstime|123rf|depositphotos|adobestock|stock\.adobe|ftcdn\.net|freepik|vecteezy|vectorstock|canstockphoto|bigstockphoto|pond5|storyblocks|nooncdn|media-amazon|ssl-images-amazon|alicdn|aliexpress|ebayimg|cdiscount|temu|youtube\.com|ytimg|\/_next\/image)/i;

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

/** Unsplash : photos professionnelles gratuites, très fortes sur les villes, monuments et ambiances.
 *  Nécessite une clé d'accès gratuite (secret UNSPLASH_ACCESS_KEY) ; sans clé, la source est ignorée. */
export async function searchUnsplash(query) {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) return [];
  const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=20&content_filter=high`;
  const data = await (await get(url, { accept: "application/json", headers: { authorization: `Client-ID ${key}`, "accept-version": "v1" } })).json();
  return (data.results || [])
    .filter((r) => r.urls?.raw && !r.premium && !r.plus)
    .map((r) => ({ url: `${r.urls.raw}&w=2400&q=85&fm=jpg&fit=max`, width: r.width, height: r.height, source: "unsplash" }));
}

/** DuckDuckGo Images (jeton vqd puis API JSON i.js). */
export async function searchDuckDuckGo(query) {
  const page = await (await get(`https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`, { accept: "text/html" })).text();
  const vqd = page.match(/vqd=["']?([\d-]+)["']?/)?.[1];
  if (!vqd) throw new Error("jeton introuvable");
  const api = `https://duckduckgo.com/i.js?l=fr-fr&o=json&q=${encodeURIComponent(query)}&vqd=${vqd}&f=size:Large,,,,,&p=1`;
  const data = await (await get(api, { accept: "application/json", headers: { referer: "https://duckduckgo.com/" } })).json();
  return dedupe(
    (data.results || [])
      .filter((r) => r.image && !BLOCKED_HOSTS.test(r.image))
      .map((r) => ({ url: r.image, width: r.width, height: r.height, source: "duckduckgo" })),
  );
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

export async function download(candidate, minSide = 600, minSize = null) {
  const res = await get(candidate.url, { timeout: 15000, accept: "image/avif,image/webp,image/*,*/*;q=0.8", ua: candidate.source === "wikipedia" ? BOT_UA : BROWSER_UA });
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 20000) throw new Error("image trop légère");
  if (buf.length > 8_000_000) throw new Error("image trop lourde");
  const info = imageSize(buf);
  if (!info) throw new Error("format non supporté");
  if (Math.min(info.width, info.height) < minSide) throw new Error(`trop petite (${info.width}x${info.height})`);
  if (minSize && (info.width < minSize.width || info.height < minSize.height)) throw new Error(`trop petite (${info.width}x${info.height})`);
  if (minSize?.landscape && info.width / info.height < minSize.landscape) throw new Error(`pas au format paysage (${info.width}x${info.height})`);
  return { ...candidate, ...info, buf, dataUri: `data:${info.type};base64,${buf.toString("base64")}` };
}

/** Rassemble des candidates pour une slide (requête + entité Wikipédia), sans doublons globaux. */
async function gather({ query, entity, articleUrl, includeArticle }) {
  const safe = (name, fn) => fn().catch((e) => (console.log(`  [images] ${name} : ${e.message}`), []));
  const [unsplash, google, bing, ddg, wiki, article] = await Promise.all([
    query ? safe("Unsplash", () => searchUnsplash(query)) : [],
    query ? safe("Google", () => searchGoogle(query)) : [],
    query ? safe("Bing", () => searchBing(query)) : [],
    query ? safe("DuckDuckGo", () => searchDuckDuckGo(query)) : [],
    entity ? wikipediaImage(entity) : [],
    includeArticle ? articleImage(articleUrl) : [],
  ]);
  if (query) console.log(`  [images] « ${query} » : unsplash ${unsplash.length}, google ${google.length}, bing ${bing.length}, duckduckgo ${ddg.length}, wikipédia ${wiki.length}`);
  // Alterne les sources pour garder de la diversité (Unsplash en tête : photos de meilleure qualité).
  const merged = [];
  for (let i = 0; i < 10; i++) for (const l of [unsplash, bing, ddg, google]) if (l[i]) merged.push(l[i]);
  return dedupe([...article, ...merged.slice(0, 10), ...wiki, ...merged.slice(10)]);
}

async function downloadSome(cands, n, used, minSide, minSize) {
  const ok = [];
  for (const c of cands) {
    if (ok.length >= n) break;
    if (used.has(c.url)) continue;
    try {
      ok.push(await download(c, minSide, minSize));
    } catch (e) {
      console.log(`  [images] ✗ ${c.source} ${c.url.slice(0, 80)} : ${e.message}`);
    }
  }
  return ok;
}

const Choice = z.object({
  index: z.number().int().describe("Numéro de la meilleure image (0 = aucune ne convient)"),
  reason: z.string(),
  focus: z
    .object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })
    .describe("Cadre du sujet principal dans l'image choisie (logo, visage, produit), en fractions de 0 à 1 : x,y = coin haut gauche, w,h = largeur, hauteur"),
});

const hasKey = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

/** Claude regarde les candidates et choisit la meilleure illustration (ou aucune). */
async function chooseWithClaude(images, { subject, isCover }) {
  const usable = images.filter((im) => im.buf.length < 4_500_000 && ["image/jpeg", "image/png", "image/webp"].includes(im.type));
  if (!usable.length) return null;
  if (!hasKey()) return usable[0];
  const content = [];
  usable.forEach((im, i) => {
    content.push({ type: "text", text: `Image ${i + 1} (${im.width}x${im.height}) :` });
    content.push({ type: "image", source: { type: "base64", media_type: im.type, data: im.buf.toString("base64") } });
  });
  content.push({
    type: "text",
    text: `${isCover ? "Photo de COUVERTURE plein écran" : "Illustration d'une slide"} d'un carousel Instagram de média financier.
Ce que la slide doit montrer : ${subject}
Choisis la meilleure image. Critères éliminatoires : filigrane (Adobe Stock, Shutterstock…), publicité ou visuel marketing (prix, « free shipping », « new arrival »), logo ou nom d'un autre média incrusté, texte incrusté important, montage grossier, capture d'écran de site, image floue.
Critères de qualité : représente clairement le sujet (la personne, l'entreprise, l'objet, la ville), photo réelle nette et esthétique${isCover ? ", personne ou entreprise du sujet clairement reconnaissable, cadrage compatible avec un format vertical 4:5" : ""}.
BEAUTÉ AVANT TOUT : choisis la photo la plus belle, digne d'une carte postale ou d'un magazine : lumière dorée ou coucher de soleil, ciel coloré, couleurs vives, composition soignée, vue dégagée ou panorama pour une ville ou un monument. Pour une ville, préfère une VUE D'ENSEMBLE (skyline, panorama, vue aérienne, quais, toits) à un gros plan sur un bâtiment.
Écarte les photos ternes (ciel gris ou blanc, lumière plate), les photos d'amateur prises au téléphone (premier plan encombré par des branches ou des feuilles, image floue ou de travers, éclairage de nuit sale), les cadrages serrés sans contexte, même si elles montrent le bon sujet. Mieux vaut répondre 0 qu'accepter une photo moyenne.
Réponds 0 si aucune image n'est acceptable. Donne aussi le cadre (focus) du sujet principal dans l'image choisie : il servira à cadrer la photo.`,
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
    const out = res.parsed_output;
    const idx = out?.index ?? 1;
    console.log(`  [images] Claude : image ${idx}/${usable.length} — ${out?.reason || ""}`);
    if (!(idx >= 1 && idx <= usable.length)) return null;
    const f = out.focus;
    const clamp = (v) => Math.min(1, Math.max(0, Number(v) || 0));
    const focus = f && f.w > 0 && f.h > 0 ? { x: clamp(f.x), y: clamp(f.y), w: clamp(f.w), h: clamp(f.h) } : null;
    return { ...usable[idx - 1], focus };
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
      // Couverture : photo assez grande pour ne jamais être agrandie (largeur ≥ 1000 px, hauteur ≥ 700 px).
      // Jamais d'agrandissement visible : couverture ≥ 1000x700, pages intérieures ≥ 960x540 (zone photo 1080x600).
      // Pages intérieures : photo paysage obligatoire, pour remplir tout le cadre sans flou ni coupure.
      const imgs = await downloadSome(cands, isCover ? 8 : 6, used, 540, isCover ? { width: 1000, height: 700 } : { width: 1080, height: 600, landscape: 1.3 });
      const subject = isCover ? `${item.title} (recherche : ${query || entity})` : `${s.title.replace(/\*\*/g, "")} — ${query || entity}`;
      const pick = await chooseWithClaude(imgs, { subject, isCover });
      if (pick) {
        used.add(pick.url);
        result[i] = { src: pick.dataUri, width: pick.width, height: pick.height, focus: pick.focus || null };
        console.log(`  [images] slide ${i + 1} : ${pick.source} ${pick.width}x${pick.height}`);
      } else console.log(`  [images] slide ${i + 1} : aucune image retenue`);
    } catch (e) {
      console.log(`  [images] slide ${i + 1} : ${e.message}`);
    }
  }
  // Chaque entrée : { src, width, height, focus } ou null. Les slides sans image réutilisent la couverture floutée.
  return result;
}

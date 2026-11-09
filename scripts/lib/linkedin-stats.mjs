// Statistiques du profil LinkedIn personnel : import de l'export « Analytics » de LinkedIn,
// relevé par l'API quand elle est autorisée, et analyse par Claude de ce qui marche.
//
// Pourquoi un export ? Le jeton actuel (w_member_social) peut publier mais pas lire les statistiques.
// Lire les stats d'un profil perso passe par l'API « Member Post Analytics » (produit Community
// Management API, autorisations r_member_postAnalytics / r_member_profileAnalytics), accordée par
// LinkedIn sur dossier. Si le jeton l'a, `refreshFromApi` s'en sert ; sinon l'export suffit.
//
// L'export (linkedin.com → Analytics → Contenu → Exporter, fichier .xlsx) est converti par le
// dashboard en { sheets: { NomFeuille: lignes[][] } } puis lu ici sans dépendre des noms de colonnes
// (le fichier change selon la langue de LinkedIn).
import zlib from "node:zlib";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod/v4";

export const STATS_FILE = "data/linkedin-stats.json";
export const INSIGHTS_FILE = "data/linkedin-insights.json";
const MODEL = () => process.env.CLAUDE_MODEL || "claude-opus-5-5";
const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" };

// ---------------------------------------------------------------------------
// Identifiants LinkedIn : les nombres des URN (activity, share, ugcPost) contiennent l'instant de
// publication (les 41 premiers bits = millisecondes depuis 1970). Ça donne l'heure exacte du post,
// et permet de relier un post de l'export à un post publié depuis le dashboard.
export function urnTime(urnOrUrl) {
  const m = String(urnOrUrl || "").match(/(?:activity|share|ugcPost)[:%3A-]+(\d{15,22})/i) || String(urnOrUrl || "").match(/(\d{18,22})/);
  if (!m) return null;
  const ms = Number(BigInt(m[1]) >> 22n);
  return ms > Date.parse("2015-01-01") && ms < Date.now() + 864e5 ? ms : null;
}
export function urnOf(urnOrUrl) {
  const m = String(urnOrUrl || "").match(/urn:li:(activity|share|ugcPost):(\d+)/i) || String(urnOrUrl || "").match(/(activity|share|ugcPost)[-:](\d{15,22})/i);
  return m ? `urn:li:${m[1].toLowerCase() === "ugcpost" ? "ugcPost" : m[1].toLowerCase()}:${m[2]}` : null;
}
/** Début du texte du post, tiré du lien (linkedin.com/posts/pseudo_mon-texte-du-post-share-…). */
export function titleFromUrl(url) {
  const m = String(url || "").match(/\/posts\/[^_/]+_(.+?)-(?:share|ugcpost|activity)-\d{15,22}/i);
  if (!m) return null;
  let t = m[1];
  try { t = decodeURIComponent(t); } catch {}
  t = t.replace(/-/g, " ").replace(/\s+/g, " ").trim();
  return t ? t[0].toUpperCase() + t.slice(1) : null;
}

// ---------------------------------------------------------------------------
// Lecture de l'export
const num = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v ?? "").replace(/[\s  ]/g, "").replace(/%$/, "");
  if (!/^-?[\d.,]+$/.test(s)) return null;
  const n = Number(s.includes(",") && !s.includes(".") ? s.replace(",", ".") : s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

// Dates : ISO (cellules date converties par le dashboard), nombre de série Excel, ou texte j/m/a ou m/j/a.
function dateParser(values) {
  const slash = values.map((v) => String(v ?? "").trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/)).filter(Boolean);
  const dayFirst = slash.some((m) => Number(m[1]) > 12);
  return (v) => {
    if (v == null || v === "") return null;
    if (typeof v === "number" && v > 30000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 864e5).toISOString().slice(0, 10);
    const s = String(v).trim();
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) {
      // Une date seule convertie en ISO depuis un fuseau en avance sur UTC (ex. 2026-03-01T23:00:00.000Z = 2 mars à Paris).
      const d = new Date(s);
      if (/T(1\d|2[0-3]):/.test(s) && !Number.isNaN(d)) return new Date(d.getTime() + 12 * 3600e3).toISOString().slice(0, 10);
      return `${iso[1]}-${iso[2]}-${iso[3]}`;
    }
    const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
    if (!m) return null;
    const [a, b, y] = [Number(m[1]), Number(m[2]), Number(m[3].length === 2 ? "20" + m[3] : m[3])];
    const [day, month] = dayFirst ? [a, b] : [b, a];
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  };
}

const low = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const isImpr = (h) => /impression/.test(low(h));
const isEng = (h) => /engagement|interaction/.test(low(h));
const isFollow = (h) => /follower|abonne/.test(low(h));
const isReach = (h) => /reached|touche|atteint|unique/.test(low(h));

// Colonnes des tableaux de posts (export FR ou EN) → champ.
function postField(h) {
  const x = low(h).trim();
  if (!x) return null;
  if (/^(url|post url)|url du post|lien/.test(x)) return "url";
  if (/date/.test(x)) return "date";
  if (/type/.test(x)) return "type";
  if (/impression/.test(x) && /(dans le|in) ?(reseau|network)|in-network/.test(x)) return "inNetworkPct";
  if (/impression/.test(x) && /(hors|out)/.test(x)) return "outNetworkPct";
  if (/impression/.test(x)) return "impressions";
  if (/touche|reached/.test(x)) return "membersReached";
  if (/abonne|follower/.test(x)) return "followersGained";
  if (/vues du profil|profile view/.test(x)) return "profileViews";
  if (/reaction/.test(x)) return "reactions";
  if (/comment/.test(x)) return "comments";
  if (/republication|repost|partage/.test(x)) return "reposts";
  if (/enregistrement|save/.test(x)) return "saves";
  if (/envoi|send/.test(x)) return "sends";
  if (/bouton|button/.test(x)) return null;
  if (/interaction|engagement/.test(x)) return "engagements";
  return null;
}

/** Lit l'export LinkedIn ({ sheets: { nom: lignes[][] } }) et renvoie posts, jours, abonnés, démographie. */
export function parseExport({ sheets }) {
  const out = { posts: new Map(), daily: {}, followers: null, discovery: {}, demographics: [], period: null };
  // Format des dates (j/m/a ou m/j/a) décidé sur tout le fichier : un seul jour > 12 suffit à trancher.
  const toDate = dateParser(Object.values(sheets || {}).flat(2));
  for (const [name, rows0] of Object.entries(sheets || {})) {
    const rows = (rows0 || []).map((r) => (Array.isArray(r) ? r : []));
    const sheet = low(name);
    const allCells = rows.flat();

    // 1. Tableaux de posts : une ligne d'en-tête avec « URL du post », éventuellement plusieurs tableaux côte à côte.
    let blocks = null;
    for (const r of rows) {
      const urlCols = r.map((c, k) => (postField(c) === "url" && !/linkedin\.com/i.test(String(c)) ? k : -1)).filter((k) => k >= 0);
      if (urlCols.length) {
        blocks = urlCols.map((c, i) => {
          const endCol = i + 1 < urlCols.length ? urlCols[i + 1] : r.length;
          const cols = [];
          for (let k = c; k < endCol && String(r[k] ?? "").trim(); k++) cols.push([k, postField(r[k])]);
          return cols;
        });
        continue;
      }
      if (!blocks) continue;
      for (const cols of blocks) {
        const url = String(r[cols[0][0]] ?? "").trim();
        if (!/linkedin\.com\//i.test(url)) continue;
        const key = urnOf(url) || url;
        const post = out.posts.get(key) || { url, urn: urnOf(url), title: titleFromUrl(url) };
        for (const [k, f] of cols.slice(1)) {
          if (!f || r[k] == null || r[k] === "") continue;
          if (f === "date") post.date = toDate(r[k]) || post.date;
          else if (f === "type") post.type = String(r[k]);
          else if (num(r[k]) != null) post[f] = num(r[k]);
        }
        out.posts.set(key, post);
      }
    }

    // 2. Séries par jour : une colonne de dates suivie de nombres, avec une ligne d'en-tête.
    let headers = null;
    for (const r of rows) {
      const d = toDate(r[0]);
      if (!d) {
        if (r.filter((c) => typeof c === "string" && c.trim()).length >= 2 && num(r[1]) == null) headers = r;
        continue;
      }
      if (!headers || /linkedin\.com/.test(r.join(" "))) continue;
      const day = (out.daily[d] ||= {});
      headers.forEach((h, k) => {
        if (k === 0 || num(r[k]) == null) return;
        if (isImpr(h)) day.impressions = num(r[k]);
        else if (isEng(h)) day.engagements = num(r[k]);
        else if (isFollow(h) || /follow|abonn/.test(sheet)) day.newFollowers = num(r[k]);
      });
    }

    // 3. Totaux « libellé : valeur » (abonnés, impressions, membres touchés).
    for (const r of rows) {
      if (r.some((c) => /linkedin\.com/i.test(String(c ?? "")))) continue;
      const label = r.find((c) => typeof c === "string" && c.trim() && num(c) == null);
      const value = r.map(num).find((n) => n != null);
      if (!label || value == null || toDate(r[0])) continue;
      if (isFollow(label) && /total/.test(low(label))) out.followers = value;
      else if (/discovery|decouverte/.test(sheet) && isImpr(label)) out.discovery.impressions = value;
      else if (/discovery|decouverte/.test(sheet) && isReach(label)) out.discovery.membersReached = value;
    }
    // Période couverte par l'export (ex. « 10/11/2025 - 9/11/2026 »).
    for (const c of allCells) {
      const m = String(c ?? "").match(/(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})\s*[-–]\s*(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})/);
      if (m && !out.period) out.period = { from: toDate(m[1]), to: toDate(m[2]) };
    }

    // 4. Démographie : catégorie, valeur, pourcentage (« 36 % », « < 1% » ou 0,36).
    if (/demograph/.test(sheet)) {
      const scope = /contenu|content/.test(sheet) || /sur le c/.test(sheet) ? "contenu" : "audience";
      for (const r of rows) {
        const cells = r.filter((c) => c !== "" && c != null);
        if (cells.length < 3 || typeof cells[0] !== "string" || typeof cells[1] !== "string") continue;
        const raw = String(cells[2]);
        let pct = /^\s*<\s*1/.test(raw) ? 0.5 : num(raw);
        if (pct == null) continue;
        if (typeof cells[2] === "number" && pct <= 1) pct = Math.round(pct * 1000) / 10;
        out.demographics.push({ scope, category: cells[0], value: cells[1], percent: pct });
      }
    }
  }
  for (const p of out.posts.values()) {
    // Date et heure exactes depuis l'identifiant.
    const t = urnTime(p.urn || p.url);
    if (t) { p.publishedAt = new Date(t).toISOString(); p.date = parisDayOf(t); }
    // Pas de colonne « Interactions » (tableau des posts récents) : somme des réactions, commentaires, republications.
    if (p.engagements == null && [p.reactions, p.comments, p.reposts].some((v) => v != null)) p.engagements = (p.reactions || 0) + (p.comments || 0) + (p.reposts || 0);
  }
  out.posts = [...out.posts.values()].filter((p) => p.impressions != null || p.engagements != null);
  return out;
}
const parisDayOf = (t) => new Date(t).toLocaleDateString("fr-CA", { timeZone: "Europe/Paris" });

/** Décode la donnée envoyée par le dashboard : JSON, éventuellement gzip + base64. */
export function decodePayload(s) {
  const t = String(s || "").trim();
  if (!t) throw new Error("Aucune donnée reçue");
  if (t.startsWith("{")) return JSON.parse(t);
  return JSON.parse(zlib.gunzipSync(Buffer.from(t.replace(/^gz:/, ""), "base64")).toString("utf8"));
}

// ---------------------------------------------------------------------------
// Base des statistiques
export function emptyStats() {
  return { posts: [], daily: {}, followers: null, followersHistory: [], discovery: {}, demographics: [], imports: [], api: null };
}

/** Fusionne un export dans la base : les nouvelles valeurs remplacent les anciennes, rien n'est perdu. */
export function mergeExport(stats, parsed, { file = "", at = new Date().toISOString() } = {}) {
  const byKey = new Map(stats.posts.map((p) => [p.urn || p.url, p]));
  for (const p of parsed.posts) {
    const key = p.urn || p.url;
    const old = byKey.get(key) || {};
    byKey.set(key, { ...old, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v != null)), updatedAt: at });
  }
  stats.posts = [...byKey.values()].sort((a, b) => (b.publishedAt || b.date || "").localeCompare(a.publishedAt || a.date || ""));
  for (const [d, v] of Object.entries(parsed.daily)) stats.daily[d] = { ...stats.daily[d], ...v };
  stats.daily = Object.fromEntries(Object.entries(stats.daily).sort(([a], [b]) => a.localeCompare(b)));
  if (parsed.followers != null) {
    stats.followers = parsed.followers;
    stats.followersHistory = [...(stats.followersHistory || []).filter((h) => h.date !== at.slice(0, 10)), { date: at.slice(0, 10), total: parsed.followers }];
  }
  if (Object.keys(parsed.discovery).length) stats.discovery = { ...parsed.discovery, period: parsed.period };
  if (parsed.demographics.length) stats.demographics = parsed.demographics;
  stats.imports = [...(stats.imports || []), { at, file, period: parsed.period, posts: parsed.posts.length, days: Object.keys(parsed.daily).length }].slice(-30);
  return stats;
}

/** Relie les posts de l'export aux memes publiés depuis le dashboard (même instant de publication à 10 min près). */
export function linkToolPosts(stats, liPosts) {
  const pub = liPosts.filter((p) => p.published && (p.published.id || p.published.at)).map((p) => ({ p, t: urnTime(p.published.id) || Date.parse(p.published.at) }));
  for (const s of stats.posts) {
    const t = s.publishedAt ? Date.parse(s.publishedAt) : null;
    const hit = t && pub.find((x) => Math.abs(x.t - t) < 10 * 60e3);
    if (!hit) continue;
    Object.assign(s, {
      toolPostId: hit.p.id,
      text: s.text || hit.p.text,
      angle: hit.p.angle,
      meme: hit.p.meme ? { source: hit.p.meme.image_source, format: hit.p.meme.format, template: hit.p.meme.template } : undefined,
    });
  }
}

/** Texte des posts publics, lu sur la page du post (au mieux : LinkedIn bloque parfois les robots). */
export async function fetchPostTexts(stats, { max = 40, log = console.log } = {}) {
  const todo = stats.posts.filter((p) => !p.text && !p.textUnavailable && p.urn).slice(0, max);
  let ok = 0, blocked = 0;
  for (const p of todo) {
    try {
      const res = await fetch(`https://www.linkedin.com/feed/update/${p.urn}/`, {
        headers: { "user-agent": "Mozilla/5.0 (compatible; carousel-stats/1.0)", "accept-language": "fr-FR,fr;q=0.9" },
        redirect: "follow",
        signal: AbortSignal.timeout(15000),
      });
      const html = res.ok ? await res.text() : "";
      const ld = html.match(/"articleBody"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      const og = html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]*)"/i) || html.match(/<meta[^>]+content="([^"]*)"[^>]+property="og:description"/i);
      const text = ld ? JSON.parse(`"${ld[1]}"`) : og ? og[1].replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(n)).replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'") : "";
      if (text && text.length > 20) { p.text = text.trim(); ok++; }
      else { blocked++; if (res.status === 404 || res.status === 410) p.textUnavailable = true; }
    } catch { blocked++; }
    await new Promise((r) => setTimeout(r, 800));
  }
  if (todo.length) log(`  Textes des posts : ${ok} récupéré(s), ${blocked} non lisible(s)`);
  return ok;
}

// ---------------------------------------------------------------------------
// API LinkedIn (seulement si le jeton a les autorisations de statistiques)
async function api(path, token) {
  const res = await fetch(`${process.env.LINKEDIN_API_URL || "https://api.linkedin.com"}/rest/${path}`, {
    headers: { authorization: `Bearer ${token}`, "linkedin-version": process.env.LINKEDIN_VERSION || "202610", "x-restli-protocol-version": "2.0.0" },
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`LinkedIn ${res.status} : ${data.message || "erreur"}`), { status: res.status });
  return data;
}

export async function refreshFromApi(stats, liPosts, { token, log = console.log }) {
  const at = new Date().toISOString();
  try {
    const f = await api("memberFollowersCount?q=me", token);
    const total = f.elements?.[0]?.memberFollowersCount;
    if (total != null) {
      stats.followers = total;
      stats.followersHistory = [...(stats.followersHistory || []).filter((h) => h.date !== at.slice(0, 10)), { date: at.slice(0, 10), total }];
    }
    let n = 0;
    for (const p of liPosts.filter((x) => x.published?.id)) {
      const id = p.published.id;
      const kind = /ugcPost/i.test(id) ? "ugcPost" : "share";
      const metrics = {};
      for (const [q, key] of [["IMPRESSION", "impressions"], ["MEMBERS_REACHED", "membersReached"], ["REACTION", "reactions"], ["COMMENT", "comments"], ["RESHARE", "reposts"]]) {
        const d = await api(`memberCreatorPostAnalytics?q=entity&entity=(${kind}:${encodeURIComponent(id)})&queryType=${q}&aggregation=TOTAL`, token);
        metrics[key] = d.elements?.[0]?.count ?? null;
      }
      metrics.engagements = (metrics.reactions || 0) + (metrics.comments || 0) + (metrics.reposts || 0);
      const t = urnTime(id);
      const existing = stats.posts.find((s) => s.toolPostId === p.id || (t && s.publishedAt && Math.abs(Date.parse(s.publishedAt) - t) < 10 * 60e3));
      const row = existing || { url: p.published.url, urn: id };
      if (!existing) stats.posts.unshift(row);
      Object.assign(row, metrics, { publishedAt: row.publishedAt || (t ? new Date(t).toISOString() : p.published.at), text: row.text || p.text, toolPostId: p.id, angle: p.angle, updatedAt: at, source: "api" });
      if (p.meme) row.meme = { source: p.meme.image_source, format: p.meme.format, template: p.meme.template };
      n++;
    }
    stats.api = { ok: true, at, posts: n };
    log(`  API LinkedIn : ${total ?? "?"} abonnés, ${n} post(s) mis à jour`);
  } catch (e) {
    const denied = e.status === 401 || e.status === 403;
    stats.api = { ok: false, at, error: denied ? "Le jeton LinkedIn n'a pas l'autorisation de lire les statistiques : utilise l'export (voir README)" : e.message };
    log(`  API LinkedIn indisponible : ${stats.api.error}`);
  }
}

// ---------------------------------------------------------------------------
// Chiffres calculés (sans IA)
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const round = (n, d = 1) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d);

export function computeSummary(stats, now = Date.now()) {
  const posts = stats.posts.map((p) => ({ ...p, rate: p.impressions ? round((100 * (p.engagements || 0)) / p.impressions, 2) : null }));
  const window = (days) => {
    const from = new Date(now - days * 864e5).toISOString().slice(0, 10);
    const rows = Object.entries(stats.daily).filter(([d]) => d >= from).map(([, v]) => v);
    const sum = (k) => rows.reduce((s, r) => s + (r[k] || 0), 0);
    return { days: rows.length, impressions: sum("impressions"), engagements: sum("engagements"), newFollowers: sum("newFollowers") };
  };
  const group = (keyFn) => {
    const m = {};
    for (const p of posts) {
      const k = keyFn(p);
      if (k == null || p.impressions == null) continue;
      (m[k] ||= []).push(p);
    }
    return Object.entries(m).map(([k, list]) => ({ key: k, posts: list.length, medianImpressions: median(list.map((p) => p.impressions)), medianEngagements: median(list.map((p) => p.engagements || 0)), medianRate: round(median(list.filter((p) => p.rate != null).map((p) => p.rate)), 2) }))
      .sort((a, b) => (b.medianImpressions || 0) - (a.medianImpressions || 0));
  };
  const paris = (iso, opt) => new Date(iso).toLocaleString("fr-FR", { timeZone: "Europe/Paris", ...opt });
  const withTime = (p) => p.publishedAt && urnTime(p.urn || p.url);
  const top = (k) => posts.filter((p) => p[k] != null).sort((a, b) => b[k] - a[k]).slice(0, 10);
  return {
    generatedAt: new Date(now).toISOString(),
    followers: stats.followers,
    last30: window(30),
    last90: window(90),
    posts: posts.length,
    postsWithText: posts.filter((p) => p.text).length,
    medianImpressions: median(posts.filter((p) => p.impressions != null).map((p) => p.impressions)),
    medianEngagements: median(posts.filter((p) => p.engagements != null).map((p) => p.engagements)),
    medianRate: round(median(posts.filter((p) => p.rate != null).map((p) => p.rate)), 2),
    byWeekday: group((p) => (p.publishedAt ? paris(p.publishedAt, { weekday: "long" }) : null)),
    byHour: group((p) => (withTime(p) ? paris(p.publishedAt, { hour: "2-digit" }) : null)),
    byMemeFormat: group((p) => (p.meme ? `${p.meme.source === "template" ? `template${p.meme.template ? ` « ${p.meme.template} »` : ""}` : "photo"} · ${p.meme.format}` : null)),
    byLength: group((p) => (p.text ? (p.text.length < 400 ? "court (< 400 car.)" : p.text.length < 1000 ? "moyen (400-1000 car.)" : "long (> 1000 car.)") : null)),
    topByEngagements: top("engagements").map(slim),
    topByImpressions: top("impressions").map(slim),
    topByRate: posts.filter((p) => p.rate != null && p.impressions >= 300).sort((a, b) => b.rate - a.rate).slice(0, 10).map(slim),
    demographics: stats.demographics,
    series: dailySeries(stats),
    ranking: posts.filter((p) => p.impressions != null || p.engagements != null).map(slim),
  };
}
const slim = (p) => ({
  url: p.url, publishedAt: p.publishedAt || p.date, title: p.title || null, type: p.type || null,
  impressions: p.impressions ?? null, engagements: p.engagements ?? null, rate: p.rate ?? null,
  reactions: p.reactions ?? null, comments: p.comments ?? null, reposts: p.reposts ?? null,
  membersReached: p.membersReached ?? null, followersGained: p.followersGained ?? null,
  angle: p.angle || null, text: p.text ? p.text.slice(0, 280) : null,
});

/** Courbes par jour : [date, impressions, interactions, nouveaux abonnés, total d'abonnés]. */
function dailySeries(stats) {
  const days = Object.keys(stats.daily).sort();
  if (!days.length) return [];
  // Total d'abonnés reconstitué à rebours depuis le dernier total connu.
  const last = (stats.followersHistory || []).at(-1);
  const totals = {};
  if (stats.followers != null) {
    let total = stats.followers;
    const anchor = last?.date && last.date < days.at(-1) ? last.date : days.at(-1);
    for (let k = days.length - 1; k >= 0; k--) {
      const d = days[k];
      if (d > anchor) continue;
      totals[d] = total;
      total -= stats.daily[d].newFollowers || 0;
    }
  }
  return days.map((d) => { const v = stats.daily[d]; return [d, v.impressions ?? null, v.engagements ?? null, v.newFollowers ?? null, totals[d] ?? null]; });
}

// ---------------------------------------------------------------------------
// Analyse par Claude
const Insights = z.object({
  summary: z.string().describe("Bilan en 3 à 5 phrases : niveau actuel, tendance, ce qui ressort le plus"),
  what_works: z.array(z.string()).describe("Ce qui fait performer les posts, chaque point appuyé sur des chiffres de l'export"),
  what_to_avoid: z.array(z.string()).describe("Ce qui sous-performe, chiffres à l'appui"),
  best_times: z.string().describe("Meilleurs jours et heures de publication (ou « pas assez de données »)"),
  hook_patterns: z.array(z.string()).describe("Types d'accroches (première ligne) qui marchent, avec un exemple réel tiré des meilleurs posts"),
  writing_rules: z.array(z.string()).describe("Consignes concrètes et directement applicables pour rédiger les prochains posts (ton, longueur, structure, sujets, format d'image, question finale…)"),
  topics_to_test: z.array(z.string()).describe("3 à 6 idées de sujets ou d'angles à tester ensuite, déduites des données"),
  confidence: z.enum(["faible", "moyenne", "bonne"]).describe("Fiabilité des conclusions selon le volume de données"),
});

export async function analyze({ stats, summary, cfg, log = console.log }) {
  if (!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN)) { log("  Analyse IA ignorée : clé ANTHROPIC_API_KEY absente"); return null; }
  const rows = stats.posts
    .filter((p) => p.impressions != null || p.engagements != null)
    .slice(0, 150)
    .map((p) => ({
      date: p.publishedAt ? new Date(p.publishedAt).toLocaleString("fr-FR", { timeZone: "Europe/Paris", weekday: "short", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : p.date,
      impressions: p.impressions ?? null,
      engagements: p.engagements ?? null,
      reactions: p.reactions, comments: p.comments, reposts: p.reposts,
      taux: p.impressions ? round((100 * (p.engagements || 0)) / p.impressions, 2) : null,
      format: p.meme ? `${p.meme.source}/${p.meme.format}${p.meme.template ? `/${p.meme.template}` : ""}` : undefined,
      type: p.type, membres_touches: p.membersReached, abonnes_acquis: p.followersGained,
      texte: p.text ? p.text.slice(0, 1200) : p.title ? `(début du texte seulement) ${p.title}…` : "(texte inconnu)",
    }));
  if (rows.length < 3) { log("  Analyse IA ignorée : moins de 3 posts avec des chiffres"); return null; }
  const { topByEngagements, topByImpressions, topByRate, demographics, ...agg } = summary;
  const client = new Anthropic();
  const res = await client.beta.messages.parse({
    model: MODEL(),
    max_tokens: 8000,
    ...FALLBACK,
    output_config: { effort: "high", format: betaZodOutputFormat(Insights) },
    system: `Tu es analyste de contenu LinkedIn. Tu étudies les statistiques réelles d'un profil personnel français pour en tirer des règles de rédaction.
QUI PUBLIE : ${cfg.about}
Règles :
- Appuie chaque conclusion sur les chiffres fournis (impressions, engagements, taux d'engagement = engagements / impressions). Compare à la médiane du compte.
- Distingue ce qui fait de la PORTÉE (impressions) de ce qui fait RÉAGIR (taux d'engagement).
- Méfie-toi des conclusions sur 1 ou 2 posts : dis-le. LinkedIn n'exporte que les meilleurs posts : les plus faibles peuvent manquer.
- Les « writing_rules » seront données telles quelles à un rédacteur IA qui écrit les prochains posts : formule-les comme des consignes claires et actionnables, en français, sans jargon.
- Les posts sans texte connu comptent pour les chiffres mais pas pour l'analyse du style.`,
    messages: [{ role: "user", content: `CHIFFRES GLOBAUX :\n${JSON.stringify(agg, null, 1)}\n\nDÉMOGRAPHIE DE L'AUDIENCE :\n${JSON.stringify(demographics)}\n\nPOSTS (du plus récent au plus ancien) :\n${JSON.stringify(rows, null, 1)}\n\nAnalyse ce compte.` }],
  });
  if (res.stop_reason === "refusal" || !res.parsed_output) { log(`  Analyse IA impossible (stop_reason=${res.stop_reason})`); return null; }
  log(`  Analyse IA terminée (${res.model})`);
  return { ...res.parsed_output, model: res.model };
}

/** Meilleurs posts du compte avec leur texte : exemples donnés au rédacteur de memes. */
export function bestExamples(stats, n = 4) {
  const med = median(stats.posts.filter((p) => p.impressions).map((p) => p.impressions)) || 1;
  return stats.posts
    .filter((p) => p.text && (p.engagements != null || p.impressions != null))
    .map((p) => ({ p, score: (p.engagements || 0) / Math.max(1, med / 100) + (p.impressions || 0) / med }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map(({ p }) => ({ text: p.text.slice(0, 1500), impressions: p.impressions ?? null, engagements: p.engagements ?? null, meme: p.meme || null }));
}

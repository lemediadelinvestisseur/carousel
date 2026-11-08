import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", textNodeName: "#text" });

const text = (v) => {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (Array.isArray(v)) return text(v[0]);
  return v["#text"] != null ? String(v["#text"]) : "";
};

export function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

const UA = "Mozilla/5.0 (compatible; CarouselNewsBot/1.0)";

export async function fetchText(url, timeoutMs = 15000) {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "*/*" }, signal: AbortSignal.timeout(timeoutMs), redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** Parse RSS 2.0 or Atom into [{title, link, summary, publishedAt, image}] */
export function parseFeed(xml) {
  const doc = parser.parse(xml);
  let entries = [];
  if (doc.rss?.channel) {
    const items = doc.rss.channel.item || [];
    entries = (Array.isArray(items) ? items : [items]).map((it) => ({
      title: stripHtml(text(it.title)),
      link: text(it.link) || text(it.guid),
      summary: stripHtml(text(it.description) || text(it["content:encoded"])).slice(0, 600),
      publishedAt: it.pubDate ? new Date(text(it.pubDate)).toISOString() : null,
      image: it["media:content"]?.["@url"] || it.enclosure?.["@url"] || null,
    }));
  } else if (doc.feed) {
    const items = doc.feed.entry || [];
    entries = (Array.isArray(items) ? items : [items]).map((it) => {
      const links = Array.isArray(it.link) ? it.link : [it.link];
      const link = links.find((l) => !l?.["@rel"] || l["@rel"] === "alternate")?.["@href"] || "";
      return {
        title: stripHtml(text(it.title)),
        link,
        summary: stripHtml(text(it.summary) || text(it.content)).slice(0, 600),
        publishedAt: it.published || it.updated ? new Date(text(it.published) || text(it.updated)).toISOString() : null,
        image: null,
      };
    });
  }
  return entries.filter((e) => e.title && e.link);
}

/** Best-effort article text extraction (paragraphs only). */
export async function fetchArticleText(url, maxChars = 8000) {
  try {
    const html = await fetchText(url, 12000);
    const paras = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
      .map((m) => stripHtml(m[1]))
      .filter((p) => p.length > 60);
    return paras.join("\n").slice(0, maxChars);
  } catch {
    return "";
  }
}

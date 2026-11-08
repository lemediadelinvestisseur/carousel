// Rédaction du carousel : Claude (si ANTHROPIC_API_KEY est défini) sinon une version simple sans IA.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod/v4";

const Slide = z.object({
  kind: z.enum(["cover", "text", "stat", "list", "quote", "cta"]),
  kicker: z.string().describe("Petit sur-titre en majuscules (2-4 mots), peut être vide"),
  title: z.string().describe("Titre de la slide, 4 à 12 mots maximum"),
  body: z.string().describe("Texte de la slide, 15 à 45 mots maximum, peut être vide"),
  stat: z.string().describe("Pour kind=stat : le chiffre clé (ex: '3,2 %', '+18 %', '450 000'), sinon vide"),
  bullets: z.array(z.string()).describe("Pour kind=list : 3 à 4 puces courtes, sinon tableau vide"),
});

export const CarouselSchema = z.object({
  slides: z.array(Slide).describe("6 à 8 slides : la 1re est 'cover', la dernière est 'cta'"),
  caption: z.string().describe("Légende du post (80-150 mots), avec une question pour engager"),
  hashtags: z.array(z.string()).describe("5 à 8 hashtags sans le #"),
});

function systemPrompt(brand) {
  return `Tu es le rédacteur en chef des réseaux sociaux de « ${brand.name} » (${brand.handle}).
Ligne éditoriale : ${brand.description}
Ton : ${brand.tone}

Tu transformes une actualité en carousel Instagram/LinkedIn en français (format 4:5).
Règles :
- Slide 1 (cover) : un titre-accroche fort qui donne envie de swiper, sans clickbait mensonger.
- Slides intermédiaires : une idée par slide. Utilise "stat" quand un chiffre clé existe, "list" pour 3-4 points, "quote" pour une citation réelle présente dans la source.
- Avant-dernière slide : "Ce que ça change pour vous" (impact concret pour le lecteur).
- Dernière slide (cta) : appel à l'action : « ${brand.cta} ».
- N'utilise QUE les faits présents dans la source fournie. N'invente aucun chiffre, aucune date, aucune citation. Si la source est maigre, fais moins de slides plutôt que d'inventer.
- Pas de conseil d'investissement personnalisé ; si pertinent, rappelle que ce n'est pas un conseil.
- Textes très courts : c'est lu sur un téléphone.`;
}

export async function writeCarousel({ item, brand, articleText, instructions }) {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.log("[writer] Pas de clé Anthropic : génération simplifiée sans IA.");
    return fallbackCarousel(item, brand);
  }
  const client = new Anthropic();
  const userContent = `ACTUALITÉ
Titre : ${item.title}
Source : ${item.source} — ${item.link}
Date : ${item.publishedAt}
Résumé : ${item.summary || "(aucun)"}

TEXTE DE L'ARTICLE (peut être incomplet ou vide) :
${articleText || "(non disponible — base-toi uniquement sur le titre et le résumé)"}
${instructions ? `\nCONSIGNES SPÉCIFIQUES DE L'ÉDITEUR :\n${instructions}\n` : ""}
Rédige le carousel.`;

  try {
    const res = await client.beta.messages.parse({
      model: process.env.CLAUDE_MODEL || "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: betaZodOutputFormat(CarouselSchema) },
      system: systemPrompt(brand),
      messages: [{ role: "user", content: userContent }],
    });
    if (res.stop_reason === "refusal") throw new Error("refus du modèle");
    if (!res.parsed_output) throw new Error(`sortie non exploitable (stop_reason=${res.stop_reason})`);
    return { ...res.parsed_output, generator: res.model };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) console.error("[writer] Clé ANTHROPIC_API_KEY invalide.");
    else if (err instanceof Anthropic.RateLimitError) console.error("[writer] Limite de débit atteinte.");
    else console.error(`[writer] Erreur Claude : ${err.message}`);
    console.log("[writer] Repli sur la génération simplifiée.");
    return fallbackCarousel(item, brand);
  }
}

function sentences(t) {
  return (t || "").split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 20);
}

export function fallbackCarousel(item, brand) {
  const title = item.title.replace(/\s+-\s+[^-]+$/, "");
  const sents = sentences(item.summary);
  const stat = (item.title + " " + item.summary).match(/[+-]?\d+(?:[.,]\d+)?\s?(?:%|€|milliards?|millions?|points?)/i)?.[0];
  const slides = [{ kind: "cover", kicker: "L'ACTU DU JOUR", title, body: "", stat: "", bullets: [] }];
  if (stat) slides.push({ kind: "stat", kicker: "LE CHIFFRE", title: "À retenir", body: sents[0] || title, stat, bullets: [] });
  sents.slice(stat ? 1 : 0, 3).forEach((s, i) => slides.push({ kind: "text", kicker: i === 0 ? "CE QU'IL FAUT SAVOIR" : "EN DÉTAIL", title: "", body: s, stat: "", bullets: [] }));
  slides.push({ kind: "text", kicker: "SOURCE", title: item.source, body: "Retrouvez l'article complet via le lien en légende.", stat: "", bullets: [] });
  slides.push({ kind: "cta", kicker: "", title: brand.cta, body: brand.handle, stat: "", bullets: [] });
  return {
    slides,
    caption: `${title}\n\n${item.summary || ""}\n\nSource : ${item.source}\n\nQu'en pensez-vous ?`,
    hashtags: brand.name === "21m2" ? ["immobilier", "investissementimmobilier", "21m2"] : ["bourse", "investissement", "finance"],
    generator: "fallback",
  };
}

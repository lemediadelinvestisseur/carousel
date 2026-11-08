// Rédaction du carousel : Claude (si ANTHROPIC_API_KEY est défini) sinon une version simple sans IA.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod/v4";

const Slide = z.object({
  kind: z.enum(["cover", "content", "stat", "list", "quote", "cta"]),
  kicker: z.string().describe("Étiquette courte en majuscules (1 à 3 mots), ex : LE CONTEXTE, POURQUOI, LES CRAINTES. Vide pour cover et cta"),
  title: z.string().describe("Titre. Pour cover : la phrase d'accroche (voir règles), mots-clés entre **…**. Pour les autres slides : 1 seul passage entre **…**"),
  body: z.string().describe("Texte : 15 à 45 mots. **…** pour mettre en valeur 1 ou 2 mots-clés. Vide pour cover"),
  stat: z.string().describe("Pour kind=stat : le chiffre clé tel qu'écrit dans la source (ex : '80,7 Md$', '+18 %'), sinon vide"),
  bullets: z.array(z.string()).describe("Pour kind=list : 3 à 4 puces de 4 à 12 mots, sinon tableau vide"),
  image_query: z.string().describe("Recherche Google Images pour illustrer la slide (ex : 'Jensen Huang Nvidia keynote', 'siège Binance Paris'). Vide pour cta"),
  image_entity: z.string().describe("Titre exact de la page Wikipédia de la personne ou entreprise montrée (ex : 'Jensen Huang', 'Nvidia'), vide si aucune"),
});

export const CarouselSchema = z.object({
  category: z.string().describe("Étiquette de la couverture, à choisir parmi les étiquettes autorisées du compte"),
  slides: z.array(Slide).describe("5 à 8 slides : la 1re est 'cover', la dernière est 'cta'"),
  hook_alternatives: z.array(z.string()).describe("3 autres accroches possibles pour la couverture, avec **…**"),
  caption: z.string().describe("Légende du post (80-150 mots), avec une question pour engager"),
  hashtags: z.array(z.string()).describe("5 à 8 hashtags sans le #"),
});

const HOOK_GUIDE = `LA COUVERTURE (slide 1) EST LE PLUS IMPORTANT : elle décide si les gens swipent.
Format validé : une phrase informative de 15 à 28 mots (une ou deux phrases), qui donne l'info principale ET une raison de lire la suite.
- 3 à 5 mots-clés entre **…** (mis en gras) : le nom de l'entreprise ou de la personne, les chiffres, la date, le mot qui choque. Jamais une phrase entière en gras.
- Exemples du style attendu :
  • « **Binance** fermera les comptes de ses **utilisateurs français** le **31 décembre**. Il te reste **53 jours** pour agir. »
  • « Le **plafond** du **Livret A** pourrait monter jusqu'à **30 000** euros en février 2027. Il n'avait plus **bougé** depuis **2013**. »
  • « **GTA 6** dépasserait **600 millions** de dollars de précommandes alors que l'action Take-Two touche son **plus bas de l'année**. »
  • « **Barbie** a **67 ans** et elle rapporte toujours plus d'**un milliard** de dollars de ventes par an à Mattel. »
- La 2e partie crée l'envie de swiper : une conséquence pour le lecteur, un contraste, une question (« Quel impact sur… ? », « Pourquoi… ? »).
- TEMPS DES VERBES : futur pour ce qui n'a pas encore eu lieu (« fermera », « augmentera »), conditionnel pour ce qui n'est pas confirmé (« pourrait », « dépasserait »), passé pour ce qui est fait. Ne présente jamais une annonce comme un fait accompli.
- Décompte (« il te reste X jours ») : calcule-le exactement à partir de la date du jour fournie.
- Interdits : clickbait mensonger, points d'exclamation, emojis, majuscules à outrance.`

const PLAN_GUIDE = `PLAN DU CAROUSEL (adapte selon la richesse de la source) :
1. cover : l'accroche.
2. Ce qui s'est passé (kicker « L'ACTU » ou « LE CONTEXTE ») : les faits essentiels.
3. Pourquoi / le pourquoi du comment (kicker « POURQUOI ? »).
4. Le chiffre clé (kind=stat) s'il y en a un vraiment marquant dans la source.
5. Les craintes / les risques (kicker « LES CRAINTES » ou « LE RISQUE »).
6. Les solutions / ce que tu peux faire / ce que ça change pour toi (kind=list si plusieurs points).
7. cta : appel à s'abonner.
Si la source est maigre, fusionne ou supprime des étapes (5 slides minimum) plutôt que d'inventer.`;

function systemPrompt(brand) {
  const photo = brand.template === "photo";
  return `Tu es le rédacteur en chef des réseaux sociaux de « ${brand.name} » (${brand.handle}).
Ligne éditoriale : ${brand.description}
Public : ${brand.audience || "particuliers français"}
Ton : ${brand.tone}

Tu transformes une actualité en carousel Instagram/LinkedIn en français (format 4:5).

${HOOK_GUIDE}

${PLAN_GUIDE}

RÈGLES DE FOND :
- N'utilise QUE les faits présents dans la source fournie. N'invente aucun chiffre, aucune date, aucune citation, aucun nom.
- Tu peux expliquer des notions générales connues (ce qu'est un ETF, un portefeuille froid…) pour donner des solutions, sans affirmer de faits nouveaux sur l'actualité.
- Pas de conseil d'investissement personnalisé ; la slide « solutions » propose des pistes générales, et la légende rappelle que ce n'est pas un conseil.
- Textes très courts : c'est lu sur un téléphone. Toujours en français, même si la source est en anglais.
- kind=quote seulement pour une citation réelle présente dans la source.

ILLUSTRATIONS${photo ? " (chaque slide sauf cta a une photo)" : ""} :
- image_query : ce qu'il faut chercher sur Google Images. Pour la cover, vise une photo de presse de qualité, en haute résolution : la personne au cœur du sujet (dirigeant en conférence, portrait) ou l'entreprise (logo sur la façade du siège, logo sur un smartphone, produit phare, magasin). Ajoute « photo » ou le nom du lieu plutôt que des termes génériques. Pour les autres slides, varie : produit, bâtiment, dirigeant, objet symbolique (billets, graphique boursier, Bourse de Paris, smartphone avec l'appli…).
- Écris la requête dans la langue où l'on trouve les meilleures photos (souvent l'anglais pour les sujets internationaux).
- image_entity : le titre Wikipédia de la personne ou de l'entreprise si elle existe (sert de photo de secours).
- Évite deux fois la même requête.

SLIDE FINALE (cta) :
- title : « ${brand.ctaSlide?.title || `Abonne-toi à ${brand.name}`} » (garde cette formule, tu peux mettre **…** sur le nom).
- body : « ${brand.ctaSlide?.subtitle || "pour ne rien rater de l'actu"} ».

ÉTIQUETTE DE COUVERTURE (category) : ${(brand.categories || ["Actualité"]).map((c) => `« ${c} »`).join(", ")}.
Choisis « Le saviez-vous ? » pour un fait étonnant ou historique, « Résultats » pour des résultats d'entreprise, « Données » pour une statistique ou une étude, sinon « Actualité ».`;
}

export async function writeCarousel({ item, brand, articleText, instructions }) {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.log("[writer] Pas de clé Anthropic : génération simplifiée sans IA.");
    return fallbackCarousel(item, brand);
  }
  const client = new Anthropic();
  const today = new Date().toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const userContent = `DATE DU JOUR (publication) : ${today}

ACTUALITÉ
Titre : ${item.title}
Source : ${item.source} — ${item.link}
Date : ${item.publishedAt}
Résumé : ${item.summary || "(aucun)"}
${item.reason ? `Pourquoi ça intéresse notre public : ${item.reason}\n` : ""}${item.hook ? `Idée d'accroche (à dépasser) : ${item.hook}\n` : ""}${item.international ? "Actu internationale : explique en quoi elle concerne un investisseur français, convertis les montants en euros seulement si la source le permet.\n" : ""}
TEXTE DE L'ARTICLE (peut être incomplet ou vide) :
${articleText || "(non disponible — base-toi uniquement sur le titre et le résumé)"}
${instructions ? `\nCONSIGNES SPÉCIFIQUES DE L'ÉDITEUR (prioritaires) :\n${instructions}\n` : ""}
Rédige le carousel. Commence par chercher la meilleure phrase de couverture : imagine-en une dizaine, garde la plus forte pour la cover et mets 3 autres bonnes dans hook_alternatives.`;

  try {
    const res = await client.beta.messages.parse({
      model: process.env.CLAUDE_MODEL || "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "high", format: betaZodOutputFormat(CarouselSchema) },
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
  const stat = (item.title + " " + item.summary).match(/[+-]?\d+(?:[.,]\d+)?\s?(?:%|€|milliards?|millions?)/i)?.[0];
  const base = { kicker: "", body: "", stat: "", bullets: [], image_query: "", image_entity: "" };
  const slides = [{ ...base, kind: "cover", title, image_query: title }];
  if (stat) slides.push({ ...base, kind: "stat", kicker: "LE CHIFFRE", title: "À retenir", body: sents[0] || title, stat });
  sents.slice(stat ? 1 : 0, 3).forEach((s, i) => slides.push({ ...base, kind: "content", kicker: i === 0 ? "L'ACTU" : "EN DÉTAIL", title: "", body: s }));
  slides.push({ ...base, kind: "cta", title: brand.ctaSlide?.title || brand.cta, body: brand.ctaSlide?.subtitle || brand.handle });
  return {
    category: (brand.categories || ["Actualité"])[0],
    slides,
    hook_alternatives: [],
    caption: `${title}\n\n${item.summary || ""}\n\nSource : ${item.source}\n\nQu'en pensez-vous ?`,
    hashtags: brand.name === "21m2" ? ["immobilier", "investissementimmobilier", "21m2"] : ["bourse", "investissement", "finance"],
    generator: "fallback",
  };
}

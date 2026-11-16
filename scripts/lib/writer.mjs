// Rédaction du carousel, en deux temps :
//   1. Recherche : Claude lit l'article et d'autres sources sur le web, et en tire un dossier de faits sourcés.
//   2. Écriture : Claude rédige le carousel à partir de ce dossier (sortie structurée).
// Sans clé Anthropic : version simplifiée sans IA.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod/v4";

const MODEL = () => process.env.CLAUDE_MODEL || "claude-opus-5-5";
const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" };

const Slide = z.object({
  kind: z.enum(["cover", "photo", "stat", "bars", "rank", "cta"]),
  kicker: z.string().describe("Étiquette de la page en MAJUSCULES, 1 à 3 mots (L'EXPLICATION, LES FOYERS, LE SOMMET, LE CONTEXTE, ET APRÈS ?…). Vide pour cover, rank et cta"),
  title: z.string().describe("cover : l'accroche avec 2 à 4 groupes de mots-clés entre **…**. photo/stat/bars : titre court (3 à 7 mots), sans **. rank : le nom de l'élément classé. cta : question courte"),
  body: z.string().describe("photo : 1 ou 2 paragraphes courts séparés par un saut de ligne, 18 à 40 mots au total, mots-clés entre **…**. stat/bars : UNE phrase de 12 à 28 mots. rank : une phrase de 10 à 22 mots. cover/cta : vide"),
  stat: z.object({
    value: z.string().describe("Le chiffre affiché en très gros, format français : « 47,7 % », « 92,6 Md€ », « x3 », « 1 322 € »"),
    label: z.string().describe("Ce que mesure le chiffre, 2 à 6 mots (« des foyers imposés »)"),
    percent: z.number().nullable().describe("Si value est un pourcentage entre 0 et 100 : sa valeur numérique (47.7) → affiché en jauge. Sinon null"),
    marker_percent: z.number().nullable().describe("Repère de comparaison sur la jauge (ex : 52.3 pour le niveau de 2012), sinon null"),
    marker_label: z.string().describe("Texte du repère (« 2012 : 52,3 % »), sinon vide"),
  }).describe("Seulement pour kind=stat ; sinon value et label vides, nombres à null"),
  bars: z.array(z.object({
    label: z.string().describe("Ce qu'on compare (« Les 1 % les plus aisés », « Paris »)"),
    amount: z.number().describe("Valeur numérique qui fixe la longueur de la barre (valeur absolue)"),
    value_text: z.string().describe("Valeur affichée dans la barre, format français (« -5,1 % », « 12,7 % »)"),
    note: z.string().describe("Précision à droite du libellé, courte (« 69 125 € »), sinon vide"),
  })).describe("Seulement pour kind=bars : 2 à 6 lignes ; sinon tableau vide"),
  rank: z.object({
    position: z.string().describe("Rang affiché (« N°1 », « #3 »)"),
    name: z.string().describe("Nom de la ville, du pays ou de l'entreprise"),
    figures: z.array(z.object({ value: z.string(), label: z.string() })).describe("1 à 3 chiffres clés (« 12,7 % » / « rendement brut »)"),
  }).describe("Seulement pour kind=rank ; sinon champs vides et tableau vide"),
  image_query: z.string().describe("cover, photo, rank : recherche d'une VRAIE photo précise (ex : 'Jensen Huang keynote', 'Palais Brongniart Paris', 'Mulhouse panorama'). stat, bars, cta : vide"),
  image_entity: z.string().describe("Titre Wikipédia de la personne, entreprise ou lieu montré (cover, photo, rank), sinon vide"),
});

export const CarouselSchema = z.object({
  format: z.enum(["single", "carousel"]).describe("single = une seule image (la couverture) qui se suffit à elle-même ; carousel = plusieurs pages"),
  category: z.string().describe("Étiquette de la couverture, parmi les étiquettes autorisées"),
  slides: z.array(Slide).describe("single : uniquement la cover. carousel : cover, 3 à 10 pages intérieures, cta"),
  hook_alternatives: z.array(z.string()).describe("3 autres accroches possibles, même format que le titre de couverture"),
  caption: z.string().describe("Description du post Instagram selon les règles DESCRIPTION DU POST, sans hashtags ni sources"),
  sources: z.array(z.string()).describe("Noms des médias utilisés comme sources (ex : Les Echos)"),
});

// ---------------------------------------------------------------------------
// 1. Recherche
// ---------------------------------------------------------------------------
// Études et graphiques (Visual Capitalist, Voronoi…) : pas une actu, un sujet chiffré à raconter.
function dataResearchPrompt(item, today) {
  return `Nous sommes le ${today}. Prépare un dossier factuel sur cette ÉTUDE / ce GRAPHIQUE pour un carousel Instagram « Données » destiné à des investisseurs particuliers français.

Sujet : ${item.title}${item.titleOriginal ? ` (titre original : ${item.titleOriginal})` : ""}
Source : ${item.source} — ${item.link}

Lis la page de la source (web_fetch), puis fais 1 à 3 recherches pour compléter. Le dossier doit contenir :
1. Les chiffres du graphique, exacts, avec leur unité, leur année et la source des données (ex : « FMI, 2025 »).
2. Le classement complet ou les 5 à 10 premiers, et les écarts les plus frappants.
3. La position de la France (ou de l'Europe) si elle existe, sinon un point de comparaison parlant pour un Français (salaire moyen, Livret A, CAC 40…).
4. Pourquoi c'est comme ça : 2 ou 3 explications sourcées.
5. Ce que ça change ou dit pour un investisseur particulier.
N'invente aucun chiffre : si une donnée manque, dis-le.`;
}

async function research(client, item, articleText) {
  const today = new Date().toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "long", year: "numeric" });
  const messages = [
    {
      role: "user",
      content: item.kind === "data" ? dataResearchPrompt(item, today) : `Nous sommes le ${today}. Prépare un dossier factuel sur cette actualité pour un carousel Instagram destiné à des investisseurs particuliers français.

Actualité : ${item.title}
Source d'origine : ${item.source} — ${item.link}
${articleText ? `Extrait de l'article :\n${articleText.slice(0, 6000)}\n` : ""}
Fais des recherches web (2 à 4 recherches) et lis les articles les plus fiables, en français de préférence. Le dossier doit contenir :
1. Les faits : quoi, qui, quand, combien (dates et chiffres exacts).
2. Le contexte : pourquoi c'est arrivé.
3. Ce qui change concrètement pour un particulier français.
4. Les risques ou points de vigilance.
5. Des solutions concrètes et actionnables (acteurs, produits ou démarches réels cités par les sources).
6. Les perspectives (et après ?).
Indique pour chaque fait le média qui le rapporte, et signale les points où les sources divergent. N'invente rien : si une information manque, dis-le.`,
    },
  ];
  const tools = [
    { type: "web_search_20260209", name: "web_search", max_uses: 5 },
    { type: "web_fetch_20260209", name: "web_fetch", max_uses: 6 },
  ];
  let text = "";
  for (let turn = 0; turn < 6; turn++) {
    const stream = client.beta.messages.stream({
      model: MODEL(),
      max_tokens: 32000,
      ...FALLBACK,
      output_config: { effort: "medium" },
      tools,
      messages,
    });
    const res = await stream.finalMessage();
    if (res.stop_reason === "refusal") throw new Error("recherche refusée par le modèle");
    text += res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    if (res.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: res.content }); // reprise d'un tour long côté serveur
  }
  return text.trim();
}

// ---------------------------------------------------------------------------
// 2. Écriture
// ---------------------------------------------------------------------------
const FORMAT_GUIDE = `DEUX FORMATS POSSIBLES (champ format) :
- « single » : UNE SEULE IMAGE, la couverture. Pour un fait unique et fort qui se comprend en une phrase (une annonce, un retournement, un chiffre choc, une décision). L'accroche dit TOUT l'essentiel ; la description du post donne les détails. slides = [cover] uniquement, sans cta.
- « carousel » : couverture + 3 à 10 pages intérieures + cta. Pour un sujet qui a de la matière : chiffres à montrer, classement, réforme avec plusieurs effets, histoire avec rebondissements.
Si l'éditeur impose un format, respecte-le.`;

const COVER_GUIDE = `COUVERTURE (elle décide de tout : on doit comprendre l'info et avoir envie de swiper en 2 secondes).
- Étiquette (category) en haut, puis une phrase INFORMATIVE de 10 à 22 mots qui donne le fait le plus fort, avec 2 à 4 groupes de mots-clés en **gras** (noms, chiffres, verbe-clé). Le gras doit se lire seul et résumer l'info.
- Exemples du style attendu :
  • « Trois jours après sa démission, **Jensen Huang** envisage un **retour** à la tête de **NVIDIA** »
  • « **L'impôt** sur le revenu rapporte **92,6 milliards** d'euros mais les **plus riches** en **paient moins** »
  • « **Édouard Philippe** veut supprimer les **frais de notaire** pour les **moins de 35 ans** »
  • « **Leopold Aschenbrenner** déclarait **20 milliards** de dollars d'actions fin juin. Elles en **valent 11** aujourd'hui. »
  • « Ton **Livret A** va pouvoir monter jusqu'à **30 000 €** dès **février 2027** »
- Un chiffre précis vaut mieux qu'un adjectif. Pas de question en couverture, pas de « découvrez », pas de point d'exclamation.
- PHOTO DE COUVERTURE (image_query + image_entity) : la PERSONNE dont parle l'accroche (portrait de presse : conférence, interview, sortie officielle), sinon le lieu ou le bâtiment emblématique (siège, Bourse de Paris, Bercy, BCE à Francfort), sinon l'objet concret (pièce de monnaie, carte bancaire, immeuble, clés). Si l'accroche parle d'une mesure politique, montre la personnalité qui la porte. JAMAIS d'infographie, de carte, de graphique ou d'image avec du texte.
- LIMITE JURIDIQUE (impérative) : n'affirme jamais comme un fait une accusation non prouvée contre une personne ou une entreprise réelle. Utilise « aurait », « accusé de », « selon <média> ». Aucun chiffre ni fait inventé.`;

const INNER_GUIDE = `PAGES INTÉRIEURES (format carousel). RÈGLE D'OR : chaque page montre quelque chose — une photo OU un graphique. Jamais une page de texte seul.
Types de pages :
- kind=photo : une photo en haut + étiquette + titre court + 1 ou 2 paragraphes courts. Pour raconter, expliquer, contextualiser. image_query OBLIGATOIRE et précise (la personne, le lieu, le bâtiment, l'objet dont parle la page).
- kind=stat : UN chiffre clé affiché en très gros. Si c'est un pourcentage de 0 à 100, remplis stat.percent (jauge) et, si utile, un repère de comparaison (marker_percent + marker_label, ex : niveau d'une année passée). Une phrase de contexte dans body.
- kind=bars : comparaison chiffrée de 2 à 6 éléments (catégories, années, pays, villes, entreprises) en barres horizontales. Mets les éléments dans un ordre logique (croissant, décroissant ou chronologique).
- kind=rank : UN élément d'un classement par page, en photo plein cadre (ville, pays, entreprise, personne). Pour un classement (« les 5 villes où… », « les pays les plus… »), fais UNE PAGE kind=rank PAR ÉLÉMENT, jusqu'à 10, dans l'ordre du classement (N°1 d'abord, ou compte à rebours si c'est plus fort). image_query = « <ville> panorama » / « <ville> skyline golden hour » / « <pays> landmark » / « <entreprise> headquarters ». rank.figures = 1 à 3 chiffres clés de l'élément.
Construction :
- Dès qu'il y a des chiffres, MONTRE-LES avec stat ou bars plutôt que de les écrire dans un paragraphe.
- Alterne les types : pas plus de 2 pages photo d'affilée (sauf une suite de pages rank).
- Une idée par page, lisible en 5 secondes. Chaque page apporte une info nouvelle.
- Sujet simple : 3 ou 4 pages intérieures. Sujet riche ou classement : jusqu'à 10.
- Étiquettes (kicker) courtes et concrètes en majuscules : LES FOYERS, LE SOMMET, L'EXPLICATION, LE CONTEXTE, LA SUITE…
DERNIÈRE PAGE — cta : title = une question TRÈS courte liée au sujet (4 à 10 mots, sans gras), body vide, image_query vide.`;

const DATA_GUIDE = `CE CAROUSEL N'EST PAS UNE ACTU : c'est un carousel tiré d'une étude ou d'un graphique (category = « Classement » ou « Le saviez-vous »).
- Couverture : l'accroche repose sur LE chiffre le plus frappant ou la comparaison qui pique (ex : « Un **Suisse** gagne **3 fois plus** qu'un Français pour le même travail »). Photo : le pays, la ville, l'entreprise ou l'objet du chiffre, jamais le graphique de la source.
- S'il y a un classement : une page kind=rank par élément (5 à 10), puis une page bars ou stat pour situer la France si elle n'est pas dans le top, puis éventuellement une page photo « POURQUOI ».
- Chaque chiffre est exact, avec son année ; convertis en euros quand c'est utile en le précisant.
- TOUT EN FRANÇAIS : traduis noms de pays, catégories et unités (« $1.2T » → « 1 200 milliards de dollars »). Nombres au format français (1 200,5 ; 12 %).`;

const STYLE_GUIDE = `STYLE (très important) :
- Écris comme un journaliste éco qui tutoie un ami. Pas de formules creuses ou « d'IA » (« Décryptage », « Zoom sur », « Ce qu'il faut retenir », métaphores bancales).
- Titres simples et concrets, comme à l'oral (« Un record depuis 2012 », « Plus riche, moins d'impôt », « Des dividendes avancés »).
- Phrases complètes et précises, bon temps des verbes (futur pour ce qui va arriver, conditionnel seulement pour ce qui n'est pas confirmé).
- Décompte (« il te reste X jours ») : calcule-le exactement à partir de la date du jour.
- Interdits sur les images : points d'exclamation, emojis (sauf 👇 au cta), mention « pas un conseil en investissement ».
- N'utilise QUE les faits du dossier de recherche. N'invente aucun chiffre, aucune date, aucun nom.

PHOTOS (image_query) — on veut des photos de PRESSE ou de MAGAZINE, réelles et belles :
- Personne : son nom complet (+ « portrait », « keynote », « interview »). Lieu : son nom + « panorama », « golden hour », « aerial view ». Entreprise : « <nom> headquarters » ou son produit phare.
- Écris la requête dans la langue où l'on trouve les meilleures photos (souvent l'anglais), sauf pour les lieux français.
- Varie les sujets d'une page à l'autre ; jamais deux fois la même requête.
- Jamais d'infographie, de carte, de graphique, d'illustration ou de visuel avec du texte : nos graphiques sont faits par les pages stat et bars.`;

const CAPTION_GUIDE = (brand) => `DESCRIPTION DU POST (caption) — c'est le texte affiché sous le post, il complète les images (150 à 280 mots ; en format single, c'est là que se trouvent tous les détails) :
- 1re ligne : la phrase d'accroche qui résume l'info (elle apparaît avant « … plus »). Factuelle et forte.
- Puis 4 à 7 paragraphes courts (1 à 3 phrases), séparés par une ligne vide. Tu peux commencer un ou deux paragraphes par « • ».
- Donne plus de détails que les images : chiffres précis, comparaisons parlantes (« la commande pèse moins d'une journée de ventes »), contexte, ce que ça change pour le lecteur, ce qu'il faut surveiller.
- Termine par une question qui pousse à commenter, puis une ligne d'appel : « 🔔 Abonne-toi à ${brand.handle} pour ne rien rater de l'actu qui touche ton argent. » ou « 🔖 Enregistre ce post et partage-le à quelqu'un de concerné. »
- 1 à 3 emojis maximum dans tout le texte.
- AUCUN hashtag, AUCUNE mention des sources.

ÉCRIRE COMME UN HUMAIN (la description doit sonner comme un journaliste qui parle à un ami, pas comme une IA) :
- Phrases complètes et précises, avec le bon temps : « si tu laisses tes cryptos sur la plateforme, ça te coûtera de l'argent », jamais la version raccourcie « ça te coûte ».
- Pas de formules toutes faites ni de tics : évite « En clair : », « Bref. », « Le signal à suivre », « Dans les faits : », « Spoiler : », « Et ce n'est pas tout », « Le hic », les questions rhétoriques à répétition, les tirets cadratins.
- Pas de phrases sans verbe enchaînées, pas d'effets de style forcés : dis les choses simplement.
- Relis chaque phrase en te demandant : « est-ce qu'un journaliste français l'écrirait comme ça ? » Sinon, réécris-la.
- Exemple du ton attendu :
« Binance ferme la porte à ses utilisateurs français.

C'est officiel : au 31 décembre 2026, tous les comptes des utilisateurs français seront clôturés. La raison ? Binance n'a pas obtenu l'agrément MiCA, l'autorisation devenue obligatoire en Europe.

Il y a une date à ne pas rater : le 29 novembre. À partir de là, Binance prélèvera des frais de 0,025 % de ton solde par mois, avec un minimum de 10 USDC.

Si tu laisses tes cryptos sur la plateforme, ça te coûtera donc de l'argent. Les dépôts sont déjà bloqués, et après le 31 décembre, les fonds encore présents pourront être convertis ou transférés sans que tu choisisses où.

Tu as un compte Binance en France ? Retire ou transfère tes cryptos avant le 29 novembre.

🔖 Enregistre ce post et partage-le à quelqu'un de concerné. »`;

function systemPrompt(brand) {
  return `Tu es le rédacteur en chef des réseaux sociaux de « ${brand.name} » (${brand.handle}).
Ligne éditoriale : ${brand.description}
Public : ${brand.audience || "particuliers français"}
Ton : ${brand.tone}

Tu transformes une actualité en post Instagram (format 4:5) — image unique ou carousel — à partir d'un dossier de recherche.

${FORMAT_GUIDE}

${COVER_GUIDE}

${INNER_GUIDE}

${STYLE_GUIDE}

${CAPTION_GUIDE(brand)}

${brand.writerNotes ? `CONSIGNES PROPRES À CE COMPTE (prioritaires) :\n${brand.writerNotes}\n\n` : ""}ÉTIQUETTE DE COUVERTURE (category) : ${(brand.categories || ["À l'instant"]).map((c) => `« ${c} »`).join(", ")}.
« À l'instant » pour une actu chaude, « Le saviez-vous » pour un fait étonnant ou une statistique, « Classement » pour un classement, « Résultats » pour des résultats d'entreprise, « Ce qui change » pour une nouvelle règle.`;
}

/** Erreur « Claude indisponible » (pas de clé, crédit épuisé, clé invalide) : on ne publie rien plutôt qu'un carousel au rabais. */
export class ClaudeUnavailable extends Error {}

function explain(err) {
  const msg = String(err?.message || err);
  if (/credit balance is too low/i.test(msg)) return new ClaudeUnavailable("Crédit Claude épuisé : recharge sur console.anthropic.com (Plans & Billing), puis relance.");
  if (err instanceof Anthropic.AuthenticationError) return new ClaudeUnavailable("Clé ANTHROPIC_API_KEY invalide.");
  if (err instanceof Anthropic.PermissionDeniedError) return new ClaudeUnavailable(`Accès Claude refusé : ${msg}`);
  return null;
}

const FORMATS = { single: "« single » (une seule image)", carousel: "« carousel » (plusieurs pages)" };

export async function writeCarousel({ item, brand, articleText, instructions, format }) {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) throw new ClaudeUnavailable("Pas de clé ANTHROPIC_API_KEY : impossible de rédiger.");
  const client = new Anthropic();

  let dossier = "";
  try {
    dossier = await research(client, item, articleText);
    console.log(`[writer] Dossier de recherche : ${dossier.length} caractères.`);
  } catch (err) {
    const fatal = explain(err);
    if (fatal) throw fatal;
    console.error(`[writer] Recherche impossible (${err.message}), rédaction à partir de l'article seul.`);
  }

  const today = new Date().toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const userContent = `DATE DU JOUR (publication) : ${today}

ACTUALITÉ : ${item.title}
Source d'origine : ${item.source}
${item.reason ? `Pourquoi ça intéresse notre public : ${item.reason}\n` : ""}
DOSSIER DE RECHERCHE :
${dossier || articleText || `(seulement le titre et le résumé : ${item.summary || "aucun"})`}
${item.kind === "data" ? `\n${DATA_GUIDE}\n` : ""}${FORMATS[format] ? `\nFORMAT IMPOSÉ PAR L'ÉDITEUR : ${FORMATS[format]}.\n` : ""}${instructions ? `\nCONSIGNES SPÉCIFIQUES DE L'ÉDITEUR (prioritaires) :\n${instructions}\n` : ""}
Choisis le format, puis rédige. Pour la couverture, imagine une dizaine d'accroches, garde la plus forte et mets 3 autres bonnes dans hook_alternatives.`;

  let res;
  try {
    res = await client.beta.messages.parse({
      model: MODEL(),
      max_tokens: 20000,
      ...FALLBACK,
      output_config: { effort: "high", format: betaZodOutputFormat(CarouselSchema) },
      system: systemPrompt(brand),
      messages: [{ role: "user", content: userContent }],
    });
  } catch (err) {
    throw explain(err) || err;
  }
  if (res.stop_reason === "refusal") throw new Error("Claude a refusé de rédiger ce sujet.");
  if (!res.parsed_output) throw new Error(`Rédaction inexploitable (stop_reason=${res.stop_reason}).`);
  return normalize({ ...res.parsed_output, dossier, generator: res.model }, format);
}

/** Garde-fous sur la structure : format respecté, une couverture en tête, un cta à la fin d'un carousel. */
export function normalize(c, forced) {
  const fmt = FORMATS[forced] ? forced : c.format === "single" ? "single" : "carousel";
  let slides = (c.slides || []).filter(Boolean);
  const coverSlide = slides.find((s) => s.kind === "cover") || slides[0];
  if (!coverSlide) throw new Error("Rédaction sans couverture.");
  coverSlide.kind = "cover";
  if (fmt === "single") slides = [coverSlide];
  else {
    const inner = slides.filter((s) => s !== coverSlide && s.kind !== "cta");
    const ctaSlide = slides.find((s) => s.kind === "cta") || { kind: "cta", kicker: "", title: "Et toi, tu en penses quoi ?", body: "", image_query: "", image_entity: "" };
    if (!inner.length) slides = [coverSlide];
    else slides = [coverSlide, ...inner, ctaSlide];
  }
  return { ...c, format: slides.length === 1 ? "single" : "carousel", slides };
}

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
  kind: z.enum(["cover", "content", "list", "cta"]),
  kicker: z.string().describe("Étiquette de la page en majuscules, 1 à 3 mots (LE CONTEXTE, CE QUI CHANGE, LE RISQUE, LES SOLUTIONS, ET APRÈS ?…). Vide pour cover et cta"),
  title: z.string().describe("cover : la phrase de couverture. content/list : titre court et naturel. cta : la question posée au lecteur. Mots-clés entre **…**"),
  body: z.string().describe("content : 1 ou 2 paragraphes courts (séparés par un saut de ligne), 20 à 38 mots au total. cta : vide. list : vide. cover : vide, sauf si les consignes du compte demandent un sous-titre de couverture"),
  bullets: z.array(z.string()).describe("list : 3 étapes ou options concrètes de 8 à 16 mots, sinon tableau vide"),
  image_query: z.string().describe("Recherche d'image précise liée au texte de la page (ex : 'Ledger Nano X', 'Changpeng Zhao', 'siège AMF Paris'). Vide pour cta"),
  image_entity: z.string().describe("Titre Wikipédia de la personne, entreprise, produit ou lieu montré, sinon vide"),
});

export const CarouselSchema = z.object({
  category: z.string().describe("Étiquette de la couverture, parmi les étiquettes autorisées"),
  slides: z.array(Slide).describe("4 à 9 pages selon la richesse du sujet : cover, 2 à 7 pages intérieures, cta"),
  hook_alternatives: z.array(z.string()).describe("3 autres phrases de couverture possibles, même format que le titre de couverture"),
  caption: z.string().describe("Description du post Instagram (150 à 280 mots), selon les règles DESCRIPTION DU POST, sans hashtags ni sources"),
  sources: z.array(z.string()).describe("Noms des médias utilisés comme sources (ex : Cointelegraph, Les Echos)"),
});

// ---------------------------------------------------------------------------
// 1. Recherche
// ---------------------------------------------------------------------------
// Études et graphiques (Visual Capitalist, Voronoi…) : pas une actu, un sujet chiffré à raconter.
function dataResearchPrompt(item, today) {
  return `Nous sommes le ${today}. Prépare un dossier factuel sur cette ÉTUDE / ce GRAPHIQUE pour un carousel Instagram « Données » destiné à des investisseurs particuliers français.

Sujet : ${item.title}
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
const COVER_GUIDE = `COUVERTURE (le plus important : elle décide si les gens swipent).
Une accroche COURTE et CLIVANTE : une seule phrase de 6 à 14 mots, qui se lit en 2 secondes. Elle fait réagir (choc, surprise, indignation, curiosité) et donne envie de swiper.
- AUCUN mot en gras : n'utilise jamais **…** dans le titre de couverture ni dans hook_alternatives (sauf si les consignes propres au compte demandent un format différent).
- Va droit au fait le plus fort, avec des mots simples et percutants. Une seule idée : pas de deuxième phrase d'explication, pas de date précise ni de détail secondaire (ils vont dans les pages suivantes).
- Exemples du style attendu (le premier a été publié et validé) :
  • « Binance France : moins de deux mois pour sortir tes cryptos »
  • « Le patron de Nvidia aurait trompé sa femme avec une espionne présumée »
  • « Christine Lagarde quitte la BCE avant la fin de son mandat »
  • « Ton Livret A va pouvoir monter à 30 000 € »
  • « Barbie a 67 ans et rapporte encore 1 milliard par an »
  Trop long (à éviter) : « Christine Lagarde quittera la BCE le 7 février 2027, près de neuf mois avant la fin de son mandat. Deux candidats se disputent déjà sa place. »
- PHOTO DE COUVERTURE : elle doit montrer le SUJET DE L'ACCROCHE. Si l'accroche parle d'une personne (dirigeant, banquier central, ministre…), image_query = son nom complet et image_entity = son titre Wikipédia, même si elle n'est pas nommée dans l'accroche (ex : « Binance change de directeur financier » → le nom du dirigeant concerné, ou à défaut celui du patron de Binance). Sinon, l'entreprise (son siège, son logo sur un bâtiment, son produit phare), le lieu ou l'objet dont parle l'accroche. Jamais d'image vague ou de produit dérivé.
- LIMITE JURIDIQUE (impérative) : clivant ne veut pas dire faux. N'affirme jamais comme un fait une accusation non prouvée contre une personne ou une entreprise réelle (espionnage, fraude, infidélité, crime…). Utilise « aurait », « soupçonné(e) de », « accusé(e) de », « selon <média> ». Aucun chiffre ni fait inventé.`;

const INNER_GUIDE = `NOMBRE DE PAGES : entre 4 et 9 au total (couverture et CTA compris), selon ce que le sujet mérite.
- Sujet simple ou fait étonnant (« Le saviez-vous ? ») : 4 ou 5 pages.
- Actualité classique : 6 ou 7 pages.
- Sujet riche (réforme, crise, résultats détaillés, plusieurs impacts) : 8 ou 9 pages.
Ne remplis jamais pour remplir : chaque page doit apporter une info nouvelle et utile.

PAGES INTÉRIEURES — ADAPTE-LES À LA NATURE DE L'ACTU. Choisis et ordonne seulement les pages qui ont du sens pour CETTE actu :
- Toujours utiles : LE CONTEXTE (ce qui s'est passé et pourquoi), QUI EST … (la personne ou l'entreprise, si le public ne la connaît pas bien), LES CHIFFRES / LES RÉSULTATS (les données clés), LES RÉACTIONS (marché, action en Bourse, concurrents, politiques), ET APRÈS ? (ce qu'il faut surveiller, la suite probable).
- Seulement si l'actu touche directement l'argent ou les décisions du lecteur (épargne, impôts, crédit, placements, une plateforme qu'il utilise, une action qu'il peut détenir) : CE QUI CHANGE POUR TOI, LE RISQUE, LES SOLUTIONS (kind=list, 3 actions concrètes et réalistes, en nommant les acteurs ou produits réels quand les sources les citent).
- Pour une actu « pure » (scandale, people, enquête, nomination, coulisses d'une entreprise), PAS de page risque ni solutions : raconte l'histoire (contexte, faits, personnages, réactions, impact sur l'entreprise ou son action, suite).
Chaque page : une étiquette (kicker), un titre court, 1 ou 2 paragraphes COURTS de 20 à 38 mots au total (une idée par page, ça doit se lire en 5 secondes), 2 à 4 mots-clés en **gras**.

DERNIÈRE PAGE — CTA : la page est surtout un appel à s'abonner (déjà mis en page). title = une question TRÈS courte liée au sujet pour faire réagir en commentaire, 4 à 10 mots, sans gras (ex : « Tu avais des cryptos sur Binance ? »), body = vide.`;

const DATA_GUIDE = `CE CAROUSEL N'EST PAS UNE ACTU : c'est un carousel « Données » tiré d'une étude ou d'un graphique (category = « Données », ou « Le saviez-vous ? » pour un fait historique).
- Couverture : l'accroche CLIVANTE repose sur LE chiffre le plus choquant ou la comparaison qui pique (ex : « Un Suisse gagne 3 fois plus qu'un Français pour le même travail », « 10 entreprises valent plus que toute la Bourse européenne »). Pas de date d'actu, pas de « vient de ».
- Pages intérieures, dans cet ordre : LES CHIFFRES (kind=list, 3 puces qui commencent par la valeur en **gras**), LE CLASSEMENT (kind=list, le top 3 à 5 avec les valeurs), ET LA FRANCE ? (la position de la France ou une comparaison parlante), POURQUOI (2 ou 3 explications), CE QUE ÇA CHANGE POUR TOI (seulement si c'est vrai). 4 à 7 pages au total.
- Chaque chiffre est exact, avec son année et sa source (ex : « selon le FMI, 2025 ») dans la page ; convertis en euros quand c'est utile en le précisant (« soit environ … € »).
- Photo de couverture : le sujet du chiffre (le pays, la ville, l'entreprise, l'objet), jamais le graphique de la source.`;

const STYLE_GUIDE = `STYLE (très important) :
- Écris comme un humain, journaliste éco qui tutoie un ami. Pas de formules creuses ou « d'IA » : pas de titres en métaphore bancale (« frais en approche », « perdre la main »), pas de « Décryptage », « Zoom sur », « Ce qu'il faut retenir ».
- Titres : simples et concrets, comme on le dirait à l'oral (« Plus de dépôts, et bientôt des frais », « Recalé par l'Europe », « Après le 31 décembre, c'est Binance qui décide »).
- Phrases complètes et précises : jamais « impossible de déposer » sans dire quoi (« impossible de déposer de l'argent »).
- Temps des verbes : futur pour ce qui n'a pas encore eu lieu (« fermera »), conditionnel seulement pour ce qui n'est pas confirmé (« pourrait »), passé pour ce qui est fait. Jamais de conditionnel bizarre (« tu ne choisirais plus » → « tu ne pourras plus choisir »).
- Décompte (« il te reste X jours ») : calcule-le exactement à partir de la date du jour.
- N'écris jamais de mention du type « pas un conseil en investissement » sur les pages (elle peut figurer dans la légende).
- Interdits : points d'exclamation, emojis (sauf 👇 dans le CTA), clickbait mensonger.
- N'utilise QUE les faits du dossier de recherche. N'invente aucun chiffre, aucune date, aucun nom.

ILLUSTRATIONS (une photo différente par page, liée à ce que dit la page) :
- image_query doit correspondre au texte de la page : si la page cite Ledger, cherche « Ledger Nano X » ; si elle parle du dirigeant, cherche son nom ; si elle parle du régulateur, cherche « AMF Paris ».
- Couverture : photo de presse de qualité (logo de l'entreprise sur sa façade ou sur un smartphone, dirigeant en conférence, produit phare).
- Varie les sujets d'une page à l'autre (entreprise, dirigeant, produit, lieu, objet symbolique comme une pièce Bitcoin ou un graphique boursier).
- Écris la requête dans la langue où l'on trouve les meilleures photos (souvent l'anglais).
- Vise de BELLES photos : pour une ville, un lieu ou un monument, ajoute « golden hour », « sunset », « panorama » ou « aerial view » à la requête (ex : « Paris Eiffel Tower sunset panorama », « Lyon Fourvière golden hour »).`;

const CAPTION_GUIDE = (brand) => `DESCRIPTION DU POST (caption) — c'est le texte affiché sous le carousel, il complète les images :
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

Tu transformes une actualité en carousel Instagram de 4 à 9 pages (format 4:5), à partir d'un dossier de recherche.

${COVER_GUIDE}

${INNER_GUIDE}

${STYLE_GUIDE}

${CAPTION_GUIDE(brand)}

${brand.writerNotes ? `CONSIGNES PROPRES À CE COMPTE (prioritaires) :\n${brand.writerNotes}\n\n` : ""}ÉTIQUETTE DE COUVERTURE (category) : ${(brand.categories || ["Actualité"]).map((c) => `« ${c} »`).join(", ")}.
« Le saviez-vous ? » pour un fait étonnant ou historique, « Résultats » pour des résultats d'entreprise, « Données » pour une statistique ou une étude, sinon « Actualité ».`;
}

export async function writeCarousel({ item, brand, articleText, instructions }) {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.log("[writer] Pas de clé Anthropic : génération simplifiée sans IA.");
    return fallbackCarousel(item, brand);
  }
  const client = new Anthropic();

  let dossier = "";
  try {
    dossier = await research(client, item, articleText);
    console.log(`[writer] Dossier de recherche : ${dossier.length} caractères.`);
  } catch (err) {
    console.error(`[writer] Recherche impossible (${err.message}), rédaction à partir de l'article seul.`);
  }

  const today = new Date().toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const userContent = `DATE DU JOUR (publication) : ${today}

ACTUALITÉ : ${item.title}
Source d'origine : ${item.source}
${item.reason ? `Pourquoi ça intéresse notre public : ${item.reason}\n` : ""}
DOSSIER DE RECHERCHE :
${dossier || articleText || `(seulement le titre et le résumé : ${item.summary || "aucun"})`}
${item.kind === "data" ? `\n${DATA_GUIDE}\n` : ""}${instructions ? `\nCONSIGNES SPÉCIFIQUES DE L'ÉDITEUR (prioritaires) :\n${instructions}\n` : ""}
Rédige le carousel. Pour la couverture, imagine une dizaine de phrases, garde la plus forte et mets 3 autres bonnes dans hook_alternatives.`;

  try {
    const res = await client.beta.messages.parse({
      model: MODEL(),
      max_tokens: 16000,
      ...FALLBACK,
      output_config: { effort: "high", format: betaZodOutputFormat(CarouselSchema) },
      system: systemPrompt(brand),
      messages: [{ role: "user", content: userContent }],
    });
    if (res.stop_reason === "refusal") throw new Error("refus du modèle");
    if (!res.parsed_output) throw new Error(`sortie non exploitable (stop_reason=${res.stop_reason})`);
    return { ...res.parsed_output, dossier, generator: res.model };
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
  const base = { kicker: "", body: "", bullets: [], image_query: "", image_entity: "" };
  const slides = [{ ...base, kind: "cover", title, image_query: title }];
  sentences(item.summary)
    .slice(0, 3)
    .forEach((s, i) => slides.push({ ...base, kind: "content", kicker: i === 0 ? "L'ACTU" : "EN DÉTAIL", title: "", body: s }));
  slides.push({ ...base, kind: "cta", title: "Et toi, qu'en penses-tu ?", body: "Dis-le-nous en commentaire 👇" });
  return {
    category: (brand.categories || ["Actualité"])[0],
    slides,
    hook_alternatives: [],
    caption: `${title}\n\n${item.summary || ""}`.trim(),
    sources: [item.source],
    generator: "fallback",
  };
}

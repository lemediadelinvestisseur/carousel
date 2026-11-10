// Tri éditorial par Claude : pour chaque nouvelle actu, une note de 0 à 10 sur
// « est-ce que ça va faire réagir un public français ? », le bon compte et une idée d'accroche.
// Sans clé Anthropic, on garde le score par mots-clés.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod/v4";

const Verdict = z.object({
  id: z.string(),
  score: z.number().int().describe("0 à 10 : potentiel de réaction et de partage auprès du public français du compte"),
  brand: z.enum(["investisseur", "21m2", "aucun"]).describe("Compte le plus adapté, ou 'aucun' si hors ligne éditoriale"),
  reason: z.string().describe("Pourquoi ça intéresse (ou pas) les Français, en une phrase courte"),
  hook: z.string().describe("Proposition d'accroche pour la 1re slide (max 12 mots), en français, vide si score < 5"),
  title_fr: z.string().describe("Pour une [ÉTUDE] en anglais : son titre traduit en bon français naturel ; sinon vide"),
});
const Verdicts = z.object({ verdicts: z.array(Verdict) });

function systemPrompt(brands) {
  const lines = Object.entries(brands)
    .map(([k, b]) => `- "${k}" = ${b.name} : ${b.description}${b.audience ? ` Public : ${b.audience}` : ""}`)
    .join("\n");
  return `Tu es rédacteur en chef de deux comptes Instagram/LinkedIn français :
${lines}

On te donne des actualités brutes (souvent internationales). Pour chacune, note de 0 à 10 son potentiel à FAIRE RÉAGIR un public français (likes, commentaires, partages, enregistrements).

Ce qui fait monter la note :
- Ça touche directement le portefeuille des Français : épargne (Livret A, assurance-vie, PEA), impôts, retraite, crédit, loyers, prix de l'immobilier, pouvoir d'achat.
- Acteurs connus en France : CAC 40, grandes entreprises françaises (LVMH, TotalEnergies, Airbus…), marques grand public, géants US mondialement connus (Apple, Nvidia, Tesla…), Bitcoin, BCE/Fed, gouvernement français.
- French Tech : levées de fonds marquantes, licornes, échecs retentissants, startups que les gens utilisent.
- Un chiffre frappant, un record, une surprise, un sujet qui divise ou qui crée un débat.

Ce qui fait baisser la note :
- Petites capitalisations étrangères inconnues, résultats trimestriels sans surprise, actus très techniques (obligations obscures, matières premières de niche), marchés locaux étrangers (sauf si énorme).
- Doublon d'un sujet déjà présent dans la liste (note le doublon le moins bon à 0).
- Contenu sponsorisé, communiqué promotionnel, fait divers sans lien avec l'argent.

LES LIGNES MARQUÉES [ÉTUDE] ne sont pas des actualités : ce sont des graphiques et études chiffrées (Visual Capitalist, Voronoi), souvent en anglais, pour le compte "investisseur". On en tire des carousels « Données » qui montrent des chiffres frappants. Note-les avec ce barème :
- 8 à 10 : un chiffre ou un classement qui choque ou surprend et qui permet une accroche clivante pour un Français (fortunes, salaires, prix, dettes, Bourse, IA et emplois, pays qui s'enrichissent ou s'effondrent, la France comparée aux autres). Thèmes : Bourse, argent, IA, monde.
- 5 à 7 : intéressant mais moins fort, ou trop américain sans comparaison possible.
- 0 à 4 : trop technique, de niche (matières premières obscures, énergie industrielle, démographie sans lien avec l'argent), publicité, ou sans chiffre clé.
Pour une [ÉTUDE], le champ hook = une accroche CLIVANTE en français, construite sur le chiffre le plus fort (ex : « Un Suisse gagne 3 fois plus qu'un Français pour le même travail »).

CHOIX DU COMPTE (très important) :
- "21m2" UNIQUEMENT pour l'immobilier : logement, prix au m², loyers, crédit immobilier, achat de sa résidence, investissement locatif, SCPI, DPE et rénovation, fiscalité immobilière, construction, promoteurs, notaires, Airbnb.
- "investisseur" pour tout le reste qui touche l'argent : Bourse, actions, résultats d'entreprises, CAC 40, Wall Street, marchés, pétrole, crypto, banques, BCE et taux directeurs (sauf si l'angle est le crédit immobilier), épargne, assurance vie, impôts, salaires, économie, French Tech.
- Le site d'origine n'est qu'un indice : un site immobilier publie aussi des actus Bourse ou épargne. Classe selon le SUJET de l'actu, pas selon le site.
- "aucun" pour ce qui ne concerne pas l'argent (politique pure, sport, faits divers…).

Barème : 9-10 = sujet incontournable du jour ; 7-8 = très bon sujet ; 5-6 = correct ; 0-4 = à ignorer.
Sois exigeant : en général, seulement 10 à 20 % des actus méritent 7 ou plus.`;
}

/**
 * Préférences de l'éditeur : règles écrites (config/editorial.json) + exemples appris de ses validations et refus.
 * prefs = { rules, liked: [{brand,title}], disliked: [{brand,title}], covered: [title] }
 */
function prefsPrompt(brands, prefs = {}) {
  const r = prefs.rules || {};
  const bl = (k) => {
    const x = r[k] || {};
    const liked = (prefs.liked || []).filter((i) => i.brand === k).map((i) => `    ✓ ${i.title}`);
    const disliked = (prefs.disliked || []).filter((i) => i.brand === k).map((i) => `    ✗ ${i.title}`);
    return `### ${brands[k]?.name || k}
- Ce qu'il aime : ${(x.likes || []).join(" ") || "—"}
- Ce qu'il ne veut PAS (note 0 à 4) : ${(x.dislikes || []).map((d) => `\n  • ${d}`).join("") || "—"}
${liked.length ? `- Actus qu'il a VALIDÉES récemment :\n${liked.join("\n")}\n` : ""}${disliked.length ? `- Actus qu'il a REFUSÉES récemment (ne propose plus ce genre de sujet) :\n${disliked.join("\n")}\n` : ""}`;
  };
  const covered = (prefs.covered || []).map((t) => `- ${t}`).join("\n");
  return `

PRÉFÉRENCES DE L'ÉDITEUR (prioritaires sur tout le reste) :
Il refuse la grande majorité de ce qu'on lui propose : sois beaucoup plus sélectif. Inspire-toi de ce qu'il a validé et refusé ; une actu qui ressemble à un refus doit avoir 4 ou moins, même si elle concerne beaucoup de Français.
${Object.keys(brands).map(bl).join("\n")}${covered ? `\nSUJETS DÉJÀ TRAITÉS EN CAROUSEL (une actu sur le même sujet = doublon, note 0, sauf rebondissement majeur) :\n${covered}` : ""}`;
}

/** items: [{id,title,summary,source,brand}] → Map(id → verdict). Par lots, pour que chaque actu soit notée. */
export async function curate(items, brands, prefs = {}) {
  const out = new Map();
  for (let k = 0; k < items.length; k += 40) {
    for (const [id, v] of await curateBatch(items.slice(k, k + 40), brands, prefs)) out.set(id, v);
  }
  if (items.length) console.log(`[curate] ${out.size}/${items.length} actus notées par Claude au total.`);
  return out;
}

async function curateBatch(items, brands, prefs) {
  if (!items.length) return new Map();
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return new Map();
  const client = new Anthropic();
  const list = items
    .map((i) => `[${i.id}] ${i.kind === "data" ? "[ÉTUDE] " : ""}(${i.source}) ${i.title}${i.summary ? ` — ${i.summary.slice(0, 280)}` : ""}`)
    .join("\n");
  const out = new Map();
  try {
    const res = await client.beta.messages.parse({
      model: process.env.CLAUDE_CURATION_MODEL || process.env.CLAUDE_MODEL || "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: betaZodOutputFormat(Verdicts) },
      system: systemPrompt(brands) + prefsPrompt(brands, prefs),
      messages: [{ role: "user", content: `Actualités à noter (${items.length}) :\n${list}\n\nRends un verdict pour chaque identifiant.` }],
    });
    if (res.stop_reason === "refusal" || !res.parsed_output) throw new Error(`stop_reason=${res.stop_reason}`);
    for (const v of res.parsed_output.verdicts) out.set(v.id, v);
    console.log(`[curate] ${out.size}/${items.length} actus notées par Claude.`);
  } catch (err) {
    console.error(`[curate] Tri par Claude indisponible (${err.message}) : score par mots-clés utilisé.`);
  }
  return out;
}

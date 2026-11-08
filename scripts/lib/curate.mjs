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
  hook: z.string().describe("Proposition d'accroche pour la 1re slide (max 12 mots), vide si score < 5"),
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

Barème : 9-10 = sujet incontournable du jour ; 7-8 = très bon sujet ; 5-6 = correct ; 0-4 = à ignorer.
Sois exigeant : en général, seulement 10 à 20 % des actus méritent 7 ou plus.`;
}

/** items: [{id,title,summary,source,brand}] → Map(id → verdict) */
export async function curate(items, brands) {
  if (!items.length) return new Map();
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return new Map();
  const client = new Anthropic();
  const list = items
    .map((i) => `[${i.id}] (${i.source}) ${i.title}${i.summary ? ` — ${i.summary.slice(0, 280)}` : ""}`)
    .join("\n");
  const out = new Map();
  try {
    const res = await client.beta.messages.parse({
      model: process.env.CLAUDE_CURATION_MODEL || process.env.CLAUDE_MODEL || "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: betaZodOutputFormat(Verdicts) },
      system: systemPrompt(brands),
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

// Statistiques LinkedIn : import de l'export, relevé API (si autorisé) et analyse par Claude.
// Usage :
//   node scripts/linkedin-stats.mjs --mode importer --data <gz:base64 | JSON>   (envoyé par le dashboard)
//   node scripts/linkedin-stats.mjs --mode importer --file export.json        ({ sheets: { nom: lignes[][] } })
//   node scripts/linkedin-stats.mjs --mode analyser                           (relevé API + nouvelle analyse)
// Résultats : data/linkedin-stats.json (chiffres bruts, cumulés d'un import à l'autre)
//             data/linkedin-insights.json (bilan + règles de rédaction utilisées pour les prochains memes)
import fs from "node:fs";
import { parseArgs } from "node:util";
import { readJson, readJsonIfExists, loadLinkedin, writeSideFile } from "./lib/store.mjs";
import { STATS_FILE, INSIGHTS_FILE, decodePayload, parseExport, emptyStats, mergeExport, linkToolPosts, fetchPostTexts, refreshFromApi, computeSummary, analyze, bestExamples } from "./lib/linkedin-stats.mjs";
import { notify, dashboardUrl } from "./lib/notify.mjs";

const { values: args } = parseArgs({
  options: {
    mode: { type: "string", default: process.env.INPUT_MODE || "analyser" },
    data: { type: "string", default: process.env.INPUT_DATA || "" },
    name: { type: "string", default: process.env.INPUT_NAME || "" },
    file: { type: "string", default: "" },
    "no-ai": { type: "boolean", default: false },
  },
});

const cfg = readJson("config/linkedin.json");
const stats = { ...emptyStats(), ...readJsonIfExists(STATS_FILE, {}) };
const liPosts = loadLinkedin().posts;

if (args.mode === "importer") {
  const payload = args.file ? JSON.parse(fs.readFileSync(args.file, "utf8")) : decodePayload(args.data);
  const parsed = parseExport(payload);
  console.log(`Export « ${args.name || payload.name || "?"} » : ${parsed.posts.length} post(s), ${Object.keys(parsed.daily).length} jour(s), abonnés : ${parsed.followers ?? "?"}`);
  if (!parsed.posts.length && !Object.keys(parsed.daily).length) throw new Error("Aucune donnée reconnue dans ce fichier : est-ce bien l'export de LinkedIn Analytics (.xlsx) ?");
  mergeExport(stats, parsed, { file: args.name || payload.name || "" });
} else if (args.mode !== "analyser") {
  throw new Error(`Mode inconnu : ${args.mode}`);
}

linkToolPosts(stats, liPosts);
if (process.env.LINKEDIN_TOKEN) await refreshFromApi(stats, liPosts, { token: process.env.LINKEDIN_TOKEN });
await fetchPostTexts(stats);
stats.updatedAt = new Date().toISOString();
writeSideFile(STATS_FILE, stats);

const summary = computeSummary(stats);
const previous = readJsonIfExists(INSIGHTS_FILE, null);
const ai = args["no-ai"] ? null : await analyze({ stats, summary, cfg }).catch((e) => { console.log(`  Analyse IA en échec : ${e.message}`); return null; });
const days = Object.keys(stats.daily).sort();
const period = stats.discovery?.period || (days.length ? { from: days[0], to: days.at(-1) } : null);
const insights = { generatedAt: new Date().toISOString(), period, summary, analysis: ai || previous?.analysis || null, analysisAt: ai ? new Date().toISOString() : previous?.analysisAt || null, examples: bestExamples(stats) };
writeSideFile(INSIGHTS_FILE, insights);

console.log(`✓ ${summary.posts} post(s) suivis, ${summary.postsWithText} avec texte · médiane ${summary.medianImpressions ?? "?"} impressions / ${summary.medianEngagements ?? "?"} engagements`);
if (ai) {
  await notify({
    title: "📊 LinkedIn — nouvelle analyse de tes posts",
    message: ai.summary.slice(0, 300),
    click: dashboardUrl() ? `${dashboardUrl()}/?projet=linkedin` : undefined,
    tags: ["bar_chart"],
  });
}

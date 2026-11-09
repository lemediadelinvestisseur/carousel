// Veilleur des publications programmées.
// Les déclencheurs « toutes les 10 minutes » de GitHub ne sont pas fiables (parfois une seule exécution en
// plusieurs heures). Ce script tourne dans un job qui reste éveillé : il relit régulièrement les programmations
// (carousels + LinkedIn), et à chaque échéance lance le workflow « Publication réseaux sociaux » en mode échéances.
// Il s'arrête quand plus rien n'est programmé, et se relance lui-même avant la limite de 6 h d'un job GitHub.
import { execSync } from "node:child_process";
import { ROOT } from "./lib/store.mjs";

const MAX_RUN_MS = 5.5 * 3600e3; // un job GitHub est limité à 6 h
const POLL_MS = 5 * 60e3; // relecture des programmations toutes les 5 minutes
const BRANCH = process.env.GITHUB_REF_NAME || "main";
const started = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sh = (cmd, quiet = false) => execSync(cmd, { cwd: ROOT, stdio: ["ignore", "pipe", quiet ? "ignore" : "inherit"] }).toString();
const fmt = (t) => new Date(t).toLocaleString("fr-FR", { timeZone: "Europe/Paris", weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

function readRemote(rel) {
  try { return JSON.parse(sh(`git show origin/${BRANCH}:${rel}`, true)); } catch { return null; }
}

/** Toutes les dates de publication programmées (en ms). */
function schedules() {
  try { sh(`git fetch -q origin ${BRANCH}`); } catch (e) { console.log(`git fetch impossible : ${e.message}`); }
  const at = [];
  for (const i of readRemote("data/news.json")?.items || []) {
    for (const s of i.schedules || []) if (s?.at && s.targets) at.push(Date.parse(s.at));
    if (i.scheduled?.at) at.push(Date.parse(i.scheduled.at));
  }
  for (const p of readRemote("data/linkedin.json")?.posts || []) for (const s of p.schedules || []) if (s?.at) at.push(Date.parse(s.at));
  return at.filter((t) => !Number.isNaN(t)).sort((a, b) => a - b);
}

function dispatch(workflow, fields = "") {
  sh(`gh workflow run ${workflow} --ref ${BRANCH} ${fields}`);
}

const fired = new Set(); // échéances déjà confiées au workflow de publication
const retried = new Set(); // échéances relancées une seconde fois
let lastFire = 0;
for (;;) {
  const now = Date.now();
  const all = schedules();
  const due = all.filter((t) => t <= now + 30e3 && !fired.has(t));
  // Une échéance déjà confiée mais toujours là 10 minutes après : on relance une fois (publication ratée ou en file).
  const stale = all.filter((t) => fired.has(t) && !retried.has(t) && t <= now && now - lastFire > 10 * 60e3);
  if (due.length || stale.length) {
    console.log(`→ ${due.length + stale.length} publication(s) à échéance (${[...due, ...stale].map(fmt).join(", ")}) : lancement de la publication`);
    dispatch("social.yml", "-f mode=echeances");
    due.forEach((t) => fired.add(t));
    stale.forEach((t) => retried.add(t));
    lastFire = now;
    await sleep(90e3);
    continue;
  }
  const next = all.find((t) => t > now);
  // Échéances passées qui restent affichées malgré deux essais : on ne boucle pas dessus.
  if (!next) {
    console.log("Plus aucune publication programmée : fin de la veille.");
    break;
  }
  if (now - started > MAX_RUN_MS) {
    console.log("Limite de durée du job proche : relance d'un nouveau veilleur.");
    dispatch("scheduler.yml");
    break;
  }
  const wait = Math.max(5e3, Math.min(next - now, POLL_MS));
  console.log(`Prochaine publication : ${fmt(next)} — attente ${Math.round(wait / 1000)} s`);
  await sleep(wait);
}

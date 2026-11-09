// Horloge du projet : remplace les déclencheurs planifiés de GitHub, qui ne sont pas fiables
// (sur un dépôt peu actif, « toutes les 2 heures » peut devenir une fois par nuit).
// Ce script tourne dans un job qui reste éveillé en permanence (il se relance lui-même avant la limite de 6 h)
// et lance au bon moment :
//   - la collecte des actus : toutes les 2 heures de 6 h à 22 h (heure de Paris) ;
//   - les propositions LinkedIn du matin : 7 h 13 ;
//   - les publications programmées (carousels et LinkedIn), à 1 minute près.
// Il ne garde aucun état : il regarde l'historique Git pour savoir ce qui a déjà été fait, donc un redémarrage
// ne lance jamais deux fois la même chose, et rattrape ce qui a été manqué récemment.
import { execSync } from "node:child_process";
import { ROOT } from "./lib/store.mjs";

const COLLECT_HOURS = [6, 8, 10, 12, 14, 16, 18, 20, 22]; // heure de Paris, à h07
const COLLECT_MINUTE = 7;
const LINKEDIN_AT = [7, 13]; // propositions LinkedIn du matin
const MAX_RUN_MS = 5.5 * 3600e3; // un job GitHub est limité à 6 h
const POLL_MS = 60e3;
const BRANCH = process.env.GITHUB_REF_NAME || "main";
const DRY = process.env.SCHEDULER_DRY === "1"; // tests : n'exécute rien
const started = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sh = (cmd, quiet = false) => execSync(cmd, { cwd: ROOT, stdio: ["ignore", "pipe", quiet ? "ignore" : "inherit"] }).toString();
const fmt = (t) => new Date(t).toLocaleString("fr-FR", { timeZone: "Europe/Paris", weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

// --- Heure de Paris -----------------------------------------------------------
function parisParts(t) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Paris", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(t));
  const g = (k) => Number(p.find((x) => x.type === k).value);
  return { y: g("year"), mo: g("month"), d: g("day"), h: g("hour"), mi: g("minute"), s: g("second") };
}
const parisOffset = (t) => { const p = parisParts(t); return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(t / 1000) * 1000; };
/** Instant (ms) correspondant à hh:mm heure de Paris, le jour de Paris de `t` décalé de `dayShift`. */
function parisAt(t, h, m, dayShift = 0) {
  const p = parisParts(t);
  const guess = Date.UTC(p.y, p.mo - 1, p.d + dayShift, h, m);
  return guess - parisOffset(guess);
}
/** Dernier créneau passé (ms) parmi des heures de Paris, sur aujourd'hui et hier. */
function lastSlot(now, slots) {
  const all = [-1, 0].flatMap((d) => slots.map(([h, m]) => parisAt(now, h, m, d)));
  return Math.max(...all.filter((x) => x <= now));
}
function nextSlot(now, slots) {
  const all = [0, 1].flatMap((d) => slots.map(([h, m]) => parisAt(now, h, m, d)));
  return Math.min(...all.filter((x) => x > now));
}

// --- Dépôt ----------------------------------------------------------------------
function refresh() {
  try { sh(`git fetch -q --shallow-since="3 days ago" origin ${BRANCH}`, true); }
  catch { try { sh(`git fetch -q origin ${BRANCH}`); } catch (e) { console.log(`git fetch impossible : ${e.message}`); } }
}
function readRemote(rel) {
  try { return JSON.parse(sh(`git show origin/${BRANCH}:${rel}`, true)); } catch { return null; }
}
/** Date (ms) du dernier commit dont le message commence par `prefix`, ou 0. */
function lastCommit(prefix) {
  try { return Number(sh(`git log origin/${BRANCH} --format=%ct --grep="^${prefix}" -1`, true).trim()) * 1000 || 0; } catch { return 0; }
}
/** Dates de publication programmées (ms). */
function schedules() {
  const at = [];
  for (const i of readRemote("data/news.json")?.items || []) {
    for (const s of i.schedules || []) if (s?.at && s.targets) at.push(Date.parse(s.at));
    if (i.scheduled?.at) at.push(Date.parse(i.scheduled.at));
  }
  for (const p of readRemote("data/linkedin.json")?.posts || []) for (const s of p.schedules || []) if (s?.at) at.push(Date.parse(s.at));
  return at.filter((t) => !Number.isNaN(t)).sort((a, b) => a - b);
}
function dispatch(workflow, fields = "") {
  console.log(`  ↳ gh workflow run ${workflow} ${fields}`);
  if (!DRY) sh(`gh workflow run ${workflow} --ref ${BRANCH} ${fields}`);
}

// --- Tâches à heure fixe ---------------------------------------------------------
const TASKS = [
  // catchUp : une tâche manquée (horloge arrêtée) est rattrapée si son créneau date de moins que ce délai.
  { name: "collecte des actus", slots: COLLECT_HOURS.map((h) => [h, COLLECT_MINUTE]), catchUp: 115 * 60e3, commit: "actus: collecte", run: () => dispatch("collect.yml") },
  { name: "propositions LinkedIn", slots: [LINKEDIN_AT], catchUp: 3 * 3600e3, commit: "linkedin: proposer", run: () => dispatch("linkedin.yml", "-f mode=proposer") },
];

const firedSlots = new Set(); // « tâche@créneau » déjà lancés par cette horloge
const firedPubs = new Set(); // échéances de publication déjà confiées
const retriedPubs = new Set();
let lastPubFire = 0;

console.log(`Horloge démarrée ${fmt(Date.now())}.`);
for (;;) {
  const now = Date.now();
  refresh();

  for (const task of TASKS) {
    const slot = lastSlot(now, task.slots);
    const key = `${task.name}@${slot}`;
    if (firedSlots.has(key) || now - slot > task.catchUp) continue;
    if (lastCommit(task.commit) >= slot) { firedSlots.add(key); continue; } // déjà fait (horloge précédente ou déclencheur GitHub)
    console.log(`→ ${task.name} (créneau de ${fmt(slot)})`);
    try { task.run(); firedSlots.add(key); } catch (e) { console.log(`  ✗ ${e.message}`); }
  }

  const all = schedules();
  const due = all.filter((t) => t <= now + 30e3 && !firedPubs.has(t));
  // Une échéance confiée mais toujours là 10 minutes après : on relance une seule fois.
  const stale = all.filter((t) => firedPubs.has(t) && !retriedPubs.has(t) && t <= now && now - lastPubFire > 10 * 60e3);
  if (due.length || stale.length) {
    console.log(`→ ${due.length + stale.length} publication(s) à échéance (${[...due, ...stale].map(fmt).join(", ")})`);
    try {
      dispatch("social.yml", "-f mode=echeances");
      due.forEach((t) => firedPubs.add(t));
      stale.forEach((t) => retriedPubs.add(t));
      lastPubFire = now;
    } catch (e) { console.log(`  ✗ ${e.message}`); }
  }

  if (now - started > MAX_RUN_MS) {
    console.log("Limite de durée du job proche : relance d'une nouvelle horloge.");
    dispatch("scheduler.yml");
    break;
  }
  if (DRY) break;

  const upcoming = [...TASKS.map((t) => nextSlot(now, t.slots)), ...all.filter((t) => t > now)].sort((a, b) => a - b)[0];
  const wait = Math.max(5e3, Math.min(POLL_MS, upcoming - Date.now()));
  await sleep(wait);
}

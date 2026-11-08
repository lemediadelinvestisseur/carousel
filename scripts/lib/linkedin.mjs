// Publication sur les Pages LinkedIn : le carousel est publié en « document » (le PDF à feuilleter).
// Secret : LINKEDIN_TOKEN — jeton de l'administrateur des Pages (autorisations w_organization_social,
// r_organization_social, rw_organization_admin), généré avec l'outil OAuth du portail développeur LinkedIn.
// Il couvre toutes les Pages dont il est admin ; la Page de chaque marque est retrouvée par son nom
// (ou fixée dans config/brands.json : linkedin.organizationId).
import fs from "node:fs";

const API = () => process.env.LINKEDIN_API_URL || "https://api.linkedin.com/rest"; // LINKEDIN_API_URL : tests uniquement
const VERSION = () => process.env.LINKEDIN_VERSION || "202610";

export function linkedinToken() {
  const t = process.env.LINKEDIN_TOKEN;
  if (!t) throw new Error("Secret LINKEDIN_TOKEN manquant (Settings → Secrets and variables → Actions)");
  return t;
}

async function call(method, path, { token, body, query } = {}) {
  const url = `${API()}/${path}${query ? `?${query}` : ""}`;
  const res = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "linkedin-version": VERSION(),
      "x-restli-protocol-version": "2.0.0",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000),
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }
  if (!res.ok) {
    const hint = res.status === 401 ? " — le jeton LinkedIn a probablement expiré (il dure 60 jours) : génère-en un nouveau" : "";
    throw new Error(`LinkedIn ${res.status} : ${data.message || text || "erreur inconnue"}${hint}`);
  }
  return { data, headers: res.headers };
}

/** Pages LinkedIn administrées par le titulaire du jeton : [{ id, urn, name }] */
export async function myOrganizations(token) {
  const { data } = await call("GET", "organizationAcls", { token, query: "q=roleAssignee&role=ADMINISTRATOR&state=APPROVED" });
  const urns = (data.elements || []).map((e) => e.organization).filter(Boolean);
  const out = [];
  for (const urn of urns) {
    const id = urn.split(":").pop();
    let name = id;
    try { name = (await call("GET", `organizations/${id}`, { token })).data.localizedName || id; } catch {}
    out.push({ id, urn, name });
  }
  return out;
}

const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

/** Retrouve la Page LinkedIn d'une marque (identifiant fixé dans la config, sinon par le nom). */
export async function organizationFor(brand, token) {
  if (brand.linkedin?.organizationId) return { id: String(brand.linkedin.organizationId), urn: `urn:li:organization:${brand.linkedin.organizationId}`, name: brand.name };
  const orgs = await myOrganizations(token);
  const match = orgs.find((o) => norm(o.name) === norm(brand.linkedin?.pageName || brand.name)) || orgs.find((o) => norm(o.name).includes(norm(brand.name)));
  if (!match) throw new Error(`Page LinkedIn « ${brand.name} » introuvable parmi tes Pages : ${orgs.map((o) => o.name).join(", ") || "aucune"}`);
  return match;
}

// Le texte des posts LinkedIn utilise un format où certains caractères ont un sens spécial.
const escapeCommentary = (s) => s.replace(/[\\|{}@[\]()<>#*_~]/g, (c) => "\\" + c);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Publie le PDF du carousel comme document sur la Page. dryRun = vérifie l'accès sans publier. */
export async function publishLinkedIn({ brand, token, pdfPath, title, caption, dryRun = false, log = console.log }) {
  const org = await organizationFor(brand, token);
  if (dryRun) {
    log(`  LinkedIn : Page « ${org.name} » accessible (mode test, rien n'est publié)`);
    return { dryRun: true };
  }
  // 1. Déclarer le document, 2. envoyer le PDF, 3. attendre son traitement, 4. créer le post.
  const { data: init } = await call("POST", "documents", { token, query: "action=initializeUpload", body: { initializeUploadRequest: { owner: org.urn } } });
  const { uploadUrl, document } = init.value || {};
  if (!uploadUrl || !document) throw new Error("LinkedIn : réponse inattendue à l'envoi du document");
  const up = await fetch(uploadUrl, { method: "PUT", headers: { authorization: `Bearer ${token}`, "content-type": "application/pdf" }, body: fs.readFileSync(pdfPath), signal: AbortSignal.timeout(120000) });
  if (!up.ok) throw new Error(`LinkedIn : envoi du PDF refusé (${up.status})`);
  log("  LinkedIn : PDF envoyé");
  for (let k = 0; k < 20; k++) {
    const { data } = await call("GET", `documents/${encodeURIComponent(document)}`, { token }).catch(() => ({ data: {} }));
    if (data.status === "AVAILABLE") break;
    if (data.status === "PROCESSING_FAILED") throw new Error("LinkedIn : le traitement du PDF a échoué");
    await sleep(3000);
  }
  const { headers } = await call("POST", "posts", {
    token,
    body: {
      author: org.urn,
      commentary: escapeCommentary(caption).slice(0, 3000),
      visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      content: { media: { title: title.slice(0, 200), id: document } },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    },
  });
  const id = headers.get("x-restli-id") || headers.get("x-linkedin-id");
  const url = id ? `https://www.linkedin.com/feed/update/${id}/` : null;
  log(`  LinkedIn : publié ${url || "(identifiant non renvoyé)"}`);
  return { id, url };
}

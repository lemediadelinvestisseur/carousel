// Publication sur le profil LinkedIn PERSONNEL : un post avec une image (le meme) et son texte.
// Secret : LINKEDIN_TOKEN — jeton du membre avec les autorisations openid, profile et w_member_social
// (produits « Sign In with LinkedIn using OpenID Connect » et « Share on LinkedIn » de l'app LinkedIn),
// généré avec l'outil OAuth Token Tools du portail développeur. Il expire au bout de 60 jours.
import fs from "node:fs";

const BASE = () => process.env.LINKEDIN_API_URL || "https://api.linkedin.com"; // LINKEDIN_API_URL : tests uniquement
const VERSION = () => process.env.LINKEDIN_VERSION || "202610";

export function linkedinToken() {
  const t = process.env.LINKEDIN_TOKEN;
  if (!t) throw new Error("Secret LINKEDIN_TOKEN manquant (Settings → Secrets and variables → Actions)");
  return t;
}

async function call(method, path, { token, body, query } = {}) {
  const url = `${BASE()}/${path}${query ? `?${query}` : ""}`;
  const res = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(path.startsWith("rest/") ? { "linkedin-version": VERSION(), "x-restli-protocol-version": "2.0.0" } : {}),
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

/** Le titulaire du jeton : { id, urn, name }. */
export async function me(token) {
  const { data } = await call("GET", "v2/userinfo", { token });
  if (!data.sub) throw new Error("LinkedIn : profil introuvable (autorisations openid et profile nécessaires)");
  return { id: data.sub, urn: `urn:li:person:${data.sub}`, name: data.name || [data.given_name, data.family_name].filter(Boolean).join(" ") };
}

// Le texte des posts LinkedIn utilise un format où certains caractères ont un sens spécial.
export const escapeCommentary = (s) => s.replace(/[\\|{}@[\]()<>#*_~]/g, (c) => "\\" + c);

/** Publie une image + texte sur le profil. dryRun = vérifie l'accès sans publier. */
export async function publishImagePost({ token, imagePath, text, altText = "", dryRun = false, log = console.log }) {
  const who = await me(token);
  if (dryRun) {
    log(`  LinkedIn : profil « ${who.name} » accessible (mode test, rien n'est publié)`);
    return { dryRun: true };
  }
  // 1. Déclarer l'image, 2. l'envoyer, 3. créer le post.
  const { data: init } = await call("POST", "rest/images", { token, query: "action=initializeUpload", body: { initializeUploadRequest: { owner: who.urn } } });
  const { uploadUrl, image } = init.value || {};
  if (!uploadUrl || !image) throw new Error("LinkedIn : réponse inattendue à l'envoi de l'image");
  const up = await fetch(uploadUrl, { method: "PUT", headers: { authorization: `Bearer ${token}`, "content-type": "image/jpeg" }, body: fs.readFileSync(imagePath), signal: AbortSignal.timeout(120000) });
  if (!up.ok) throw new Error(`LinkedIn : envoi de l'image refusé (${up.status})`);
  log("  LinkedIn : image envoyée");
  const { headers } = await call("POST", "rest/posts", {
    token,
    body: {
      author: who.urn,
      commentary: escapeCommentary(text).slice(0, 3000),
      visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      content: { media: { id: image, altText: altText.slice(0, 300) } },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    },
  });
  const id = headers.get("x-restli-id") || headers.get("x-linkedin-id");
  const url = id ? `https://www.linkedin.com/feed/update/${id}/` : null;
  log(`  LinkedIn : publié ${url || "(identifiant non renvoyé)"}`);
  return { id, url };
}

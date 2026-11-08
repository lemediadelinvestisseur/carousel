// Publication sur Instagram (carousel) et sur la Page Facebook reliée, via l'API Graph de Meta.
// Un seul secret par marque : META_PAGE_TOKEN_<MARQUE> (jeton de la Page Facebook, sans expiration).
// L'identifiant de la Page et celui du compte Instagram professionnel relié sont retrouvés à partir du jeton.

const VERSION = () => process.env.META_GRAPH_VERSION || "v23.0";
const GRAPH = () => process.env.META_GRAPH_URL || `https://graph.facebook.com/${VERSION()}`; // META_GRAPH_URL : tests uniquement

export function pageToken(brandKey) {
  const name = `META_PAGE_TOKEN_${brandKey.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
  const token = process.env[name];
  if (!token) throw new Error(`Secret ${name} manquant (Settings → Secrets and variables → Actions)`);
  return token;
}

async function call(method, path, params, token) {
  const url = new URL(`${GRAPH()}/${path}`);
  const body = new URLSearchParams({ ...params, access_token: token });
  const res =
    method === "GET"
      ? await fetch(`${url}?${body}`, { signal: AbortSignal.timeout(60000) })
      : await fetch(url, { method, body, signal: AbortSignal.timeout(60000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const e = data.error || {};
    throw new Error(`Meta ${res.status} ${e.type || ""} (code ${e.code ?? "?"}${e.error_subcode ? "/" + e.error_subcode : ""}) : ${e.error_user_msg || e.message || "erreur inconnue"}`);
  }
  return data;
}

/** Vérifie le jeton et retrouve la Page et le compte Instagram relié. */
export async function whoAmI(token) {
  const me = await call("GET", "me", { fields: "id,name,instagram_business_account{id,username}" }, token);
  return {
    pageId: me.id,
    pageName: me.name,
    igId: me.instagram_business_account?.id || null,
    igUsername: me.instagram_business_account?.username || null,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitReady(containerId, token, label) {
  for (let k = 0; k < 30; k++) {
    const d = await call("GET", containerId, { fields: "status_code" }, token);
    const status = d.status_code;
    if (status === "FINISHED" || status === "PUBLISHED" || (!status && k > 0)) return;
    if (status === "ERROR" || status === "EXPIRED") throw new Error(`${label} : préparation refusée par Instagram (${status})`);
    await sleep(3000);
  }
  throw new Error(`${label} : préparation trop longue`);
}

/**
 * Carousel Instagram : un conteneur par image, puis le conteneur carousel, puis la publication.
 * dryRun = prépare tout (vérifie que Meta accepte les images et la légende) sans publier.
 */
export async function publishInstagram({ igId, token, imageUrls, caption, dryRun = false, log = console.log }) {
  if (!igId) throw new Error("Aucun compte Instagram professionnel n'est relié à cette Page Facebook");
  if (imageUrls.length < 2 || imageUrls.length > 10) throw new Error(`Un carousel Instagram doit avoir 2 à 10 images (ici ${imageUrls.length})`);
  const children = [];
  for (const [i, image_url] of imageUrls.entries()) {
    const { id } = await call("POST", `${igId}/media`, { image_url, is_carousel_item: "true" }, token);
    children.push(id);
    log(`  Instagram : image ${i + 1}/${imageUrls.length} acceptée`);
  }
  for (const id of children) await waitReady(id, token, "Image");
  const { id: carouselId } = await call("POST", `${igId}/media`, { media_type: "CAROUSEL", children: children.join(","), caption: caption.slice(0, 2200) }, token);
  await waitReady(carouselId, token, "Carousel");
  if (dryRun) {
    log("  Instagram : carousel prêt (mode test, rien n'est publié)");
    return { dryRun: true };
  }
  const { id: mediaId } = await call("POST", `${igId}/media_publish`, { creation_id: carouselId }, token);
  const { permalink } = await call("GET", mediaId, { fields: "permalink" }, token).catch(() => ({}));
  log(`  Instagram : publié ${permalink || mediaId}`);
  return { id: mediaId, url: permalink || null };
}

/** Post Facebook avec plusieurs photos : photos envoyées sans publication, puis un post qui les regroupe. */
export async function publishFacebook({ pageId, token, imageUrls, caption, dryRun = false, log = console.log }) {
  if (dryRun) {
    await call("GET", pageId, { fields: "id,name" }, token);
    log("  Facebook : Page accessible (mode test, rien n'est publié)");
    return { dryRun: true };
  }
  const media = [];
  for (const [i, url] of imageUrls.entries()) {
    const { id } = await call("POST", `${pageId}/photos`, { url, published: "false" }, token);
    media.push(id);
    log(`  Facebook : photo ${i + 1}/${imageUrls.length} envoyée`);
  }
  const params = { message: caption };
  media.forEach((id, i) => (params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id })));
  const { id } = await call("POST", `${pageId}/feed`, params, token);
  const url = `https://www.facebook.com/${id}`;
  log(`  Facebook : publié ${url}`);
  return { id, url };
}

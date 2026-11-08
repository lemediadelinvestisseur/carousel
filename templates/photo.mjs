// Template « photo » (1080 x 1350).
// Couverture (validée) : photo plein écran cadrée sur le sujet sans agrandissement, étiquette en haut
// à gauche, phrase informative avec mots-clés en gras, dégradé bleu, nom du média centré + flèche.
// Pages intérieures (validées) : étiquette blanche façon machine à écrire, titre souligné, texte avec
// mots-clés en gras, photo pleine largeur ; alternance texte en haut / photo en bas puis l'inverse.
// Dernière page : question pour faire commenter, actions, encart d'abonnement.
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const hl = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<span class="hl">$1</span>');
const strong = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
const plain = (s) => String(s ?? "").replace(/\*\*/g, "");

const bold = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(\d) (?=[\p{L}%€$])/gu, "$1&nbsp;");

function coverSize(t) {
  const n = plain(t).length;
  if (n <= 70) return 72;
  if (n <= 125) return 66;
  if (n <= 160) return 60;
  return 54;
}
function titleSize(t) {
  const n = plain(t).length;
  if (n <= 30) return 76;
  if (n <= 55) return 66;
  return 58;
}

// Nom du média en texte, sur deux lignes (« LE MÉDIA DE » / « L'INVESTISSEUR »).
function logo(brand, size = "md") {
  if (brand.logoDataUri) return `<img class="logo-img ${size}" src="${brand.logoDataUri}" alt="">`;
  const lines = brand.wordmark || [brand.name];
  return `<div class="wordmark ${size}">${lines.map(esc).join("<br>")}</div>`;
}

// Une image peut être une simple URL/dataUri ou un objet { src, width, height, focus }.
const srcOf = (img) => (img && typeof img === "object" ? img.src : img);

function bg(img, cls = "") {
  const src = srcOf(img);
  return src ? `<img class="bg ${cls}" src="${src}" alt="">` : `<div class="bg fallback ${cls}"></div>`;
}

/**
 * Placement de la photo de couverture : jamais agrandie (sauf de 10 % au plus), largeur 1080 couverte,
 * sujet (focus, en fractions de l'image) placé dans la moitié haute, au-dessus du texte.
 * Si la photo n'est pas assez haute, son bas se fond dans le dégradé.
 */
function coverPlacement(img) {
  if (!img || typeof img !== "object" || !img.width || !img.height) return null;
  const W = 1080, H = 1350, TEXT_TOP = 760;
  const f = img.focus || { x: 0.5, y: 0.4, w: 0.5, h: 0.5 };
  let s = Math.max(W / img.width, TEXT_TOP / img.height);
  // Si on peut réduire l'image en gardant le sujet entier, on dézoome (jusqu'à couvrir la largeur).
  const subjectW = f.w * img.width, subjectH = f.h * img.height;
  const maxFit = Math.min((W * 0.92) / subjectW, (TEXT_TOP * 0.82) / subjectH);
  if (maxFit < 1 && maxFit > s) s = Math.min(1, maxFit);
  s = Math.min(Math.max(s, W / img.width, TEXT_TOP / img.height), Math.max(1, W / img.width, TEXT_TOP / img.height));
  const iw = img.width * s, ih = img.height * s;
  const cx = (f.x + f.w / 2) * iw, cy = (f.y + f.h / 2) * ih;
  const left = Math.min(0, Math.max(W - iw, W / 2 - cx));
  // Haut : le sujet vers 35 % de la zone photo ; l'image doit au moins descendre jusqu'au texte,
  // et couvrir toute la hauteur si elle en est capable.
  const minTop = ih >= H ? H - ih : TEXT_TOP - ih;
  const top = Math.min(0, Math.max(minTop, TEXT_TOP * 0.45 - cy));
  const fade = ih + top < H;
  return `style="inset:auto;object-fit:fill;width:${iw.toFixed(0)}px;height:${ih.toFixed(0)}px;left:${left.toFixed(0)}px;top:${top.toFixed(0)}px${fade ? ";-webkit-mask-image:linear-gradient(180deg,#000 75%,transparent 99%)" : ""}"`;
}

function cover(s, ctx) {
  const src = srcOf(ctx.img);
  const place = coverPlacement(ctx.img);
  const image = src ? `<img class="bg" ${place || ""} src="${src}" alt="">` : `<div class="bg fallback"></div>`;
  return `${image}<div class="shade-cover"></div>
    ${ctx.category ? `<div class="pill">${esc(ctx.category)}</div>` : ""}
    <h1 style="font-size:${coverSize(s.title)}px">${bold(s.title)}</h1>
    <div class="cover-foot">${logo(ctx.brand, "md")}</div>`;
}

/** Place une image dans une boîte (cover) en centrant le sujet (focus) ; jamais agrandie de plus de ~12 %. */
function boxImage(img, boxW, boxH) {
  const src = srcOf(img);
  if (!src) return "";
  if (!img || typeof img !== "object" || !img.width || !img.height) return `<img class="fill" src="${src}" alt="">`;
  const f = img.focus || { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };
  const s = Math.max(boxW / img.width, boxH / img.height);
  const iw = img.width * s, ih = img.height * s;
  const cx = (f.x + f.w / 2) * iw, cy = (f.y + f.h / 2) * ih;
  const left = Math.min(0, Math.max(boxW - iw, boxW / 2 - cx));
  const top = Math.min(0, Math.max(boxH - ih, boxH / 2 - cy));
  return `<img class="placed" style="width:${iw.toFixed(0)}px;height:${ih.toFixed(0)}px;left:${left.toFixed(0)}px;top:${top.toFixed(0)}px" src="${src}" alt="">`;
}

const IMG_BOTTOM_H = 600; // page « texte en haut, photo en bas »
const IMG_TOP_H = 450; // page « photo en haut, texte en bas »

function contentSlide(s, ctx) {
  let inner = `${s.kicker ? `<div class="label">${esc(s.kicker)}</div>` : ""}${s.title ? `<div class="h2wrap"><h2>${bold(s.title)}</h2></div>` : ""}`;
  if (s.kind === "list") {
    inner += `<ol>${(s.bullets || []).map((b, i) => `<li><span class="n">${i + 1}</span><span>${bold(b)}</span></li>`).join("")}</ol>`;
    if (s.body) inner += `<p class="after">${bold(s.body)}</p>`;
  } else {
    if (s.kind === "stat" && s.stat) inner += `<div class="stat">${esc(s.stat)}</div>`;
    for (const para of String(s.body || "").split(/\n+/).filter(Boolean)) inner += `<p>${bold(para)}</p>`;
  }
  const hasImg = !!srcOf(ctx.img);
  if (!hasImg) return `<div class="text alone">${inner}</div><div class="foot">${logo(ctx.brand, "md")}</div>`;
  // Alternance : 1re page intérieure texte en haut, la suivante photo en haut, etc.
  if (ctx.innerIndex % 2 === 0) {
    return `<div class="photo bottom" style="height:${IMG_BOTTOM_H}px">${boxImage(ctx.img, 1080, IMG_BOTTOM_H)}</div>
      <div class="text top">${inner}</div>`;
  }
  return `<div class="photo top" style="height:${IMG_TOP_H}px">${boxImage(ctx.img, 1080, IMG_TOP_H)}</div>
    <div class="text under">${inner}</div><div class="foot">${logo(ctx.brand, "md")}</div>`;
}

function cta(s, ctx) {
  const b = ctx.brand;
  const c = b.ctaSlide || {};
  const actions = c.actions || [["🔖", "Enregistre"], ["📤", "Partage à un ami concerné"], ["❤️", "Like"]];
  return `<div class="cta">
      <div class="q">${bold(s.title || "Et toi, qu'en penses-tu ?")}</div>
      <div class="sub">${bold(s.body || "Dis-le-nous en commentaire 👇")}</div>
      <div class="actions">${actions.map(([i, t]) => `<div><span>${i}</span>${esc(t)}</div>`).join("")}</div>
      <div class="follow"><div class="t">${bold(c.title || `Abonne-toi à ${b.name}`)}</div>${c.subtitle ? `<div class="d">${esc(c.subtitle)}</div>` : ""}<div class="h">${esc(b.handle)}</div></div>
    </div><div class="foot">${logo(b, "md")}</div>`;
}

export function renderHtml({ carousel, brand, images = [] }) {
  const t = brand.theme;
  let innerIndex = 0;
  const slides = carousel.slides
    .map((s, index) => {
      const ctx = { brand, index, img: images[index], category: carousel.category, innerIndex };
      let body;
      if (s.kind === "cover") body = cover(s, ctx);
      else if (s.kind === "cta") body = cta(s, ctx);
      else { body = contentSlide(s, ctx); innerIndex++; }
      return `<section class="slide k-${s.kind}" id="s${index + 1}">${body}</section>`;
    })
    .join("\n");

  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@800&display=block" rel="stylesheet">
<style>
:root{--accent:${t.accent};--accent2:${t.accent2 || t.accent}}
*{box-sizing:border-box;margin:0;padding:0}
@page{size:1080px 1350px;margin:0}
body{background:#444;font-family:Montserrat,system-ui,sans-serif;color:#fff}
.slide{width:1080px;height:1350px;position:relative;overflow:hidden;page-break-after:always;
  background:radial-gradient(120% 70% at 100% 100%,rgba(46,107,240,.35) 0%,rgba(46,107,240,0) 60%),linear-gradient(180deg,#070a12 0%,#0a1020 100%)}
.bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 30%}
.bg.fallback{background:radial-gradient(circle at 70% 20%,${t.bg2},${t.bg} 70%)}
b{font-weight:800}

/* Couverture */
.k-cover{background:#05080f}
.shade-cover{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.28) 0%,rgba(0,0,0,0) 16%,rgba(0,0,0,0) 40%,rgba(5,10,25,.85) 64%,rgba(5,12,32,1) 84%,${t.gradientEnd || "rgba(20,45,110,1)"} 100%)}
.pill{position:absolute;left:80px;top:90px;border:5px solid #fff;border-radius:30px;padding:4px 30px 7px;font-weight:800;font-size:44px;background:rgba(0,0,0,.55);z-index:2}
h1{position:absolute;left:80px;right:80px;bottom:240px;font-weight:500;line-height:1.22;letter-spacing:-.005em}
h1 b{font-weight:800}
.cover-foot{position:absolute;left:80px;right:80px;bottom:72px;display:flex;justify-content:center;align-items:center}
.wordmark{font-weight:800;letter-spacing:.18em;line-height:1.3;text-align:center;text-transform:uppercase}
.wordmark.md{font-size:22px}.wordmark.sm{font-size:20px}
.logo-img.md{height:56px}.logo-img.sm{height:44px}

/* Pages intérieures */
.photo{position:absolute;left:0;right:0;overflow:hidden}
.photo.top{top:0}.photo.bottom{bottom:0}
.photo .placed{position:absolute;max-width:none}
.photo .fill{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.photo.top::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,0) 70%,rgba(7,10,18,.9) 100%)}
.photo.bottom::after{content:"";position:absolute;inset:0;background:linear-gradient(0deg,rgba(0,0,0,0) 70%,rgba(7,10,18,.9) 100%)}
.text{position:absolute;left:96px;right:96px;overflow:hidden}
.text.top{top:110px;bottom:${IMG_BOTTOM_H + 40}px}
.text.under{top:${IMG_TOP_H + 40}px;bottom:130px}
.text.alone{top:140px;bottom:150px;display:flex;flex-direction:column;justify-content:center}
.label{display:inline-block;background:#fff;color:#0a0a0a;font-family:'JetBrains Mono',monospace;font-weight:800;font-size:40px;letter-spacing:.16em;padding:10px 22px 12px;margin-bottom:44px;text-transform:uppercase;align-self:flex-start}
.h2wrap{margin-bottom:40px}
h2{display:inline;font-weight:700;font-size:60px;line-height:1.3;background-image:linear-gradient(var(--accent2),var(--accent2));background-repeat:no-repeat;background-size:100% 12px;background-position:0 92%;-webkit-box-decoration-break:clone;box-decoration-break:clone}
h2 b{font-weight:700}
p{font-size:42px;line-height:1.42;font-weight:400;margin-bottom:26px}
p b{font-weight:700}
.stat{font-weight:800;font-size:120px;line-height:1;color:var(--accent);margin-bottom:28px}
ol{list-style:none;display:flex;flex-direction:column;gap:20px}
li{display:flex;gap:24px;font-size:37px;line-height:1.34}
li b{font-weight:700}
.n{flex:none;width:56px;height:56px;background:var(--accent2);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:32px}
p.after{font-size:30px;color:#C9D2E3;margin-top:22px}
.foot{position:absolute;left:0;right:0;bottom:48px;display:flex;justify-content:center}

/* Dernière page */
.cta{position:absolute;left:96px;right:96px;top:150px}
.cta .q{font-weight:800;font-size:76px;line-height:1.15;margin-bottom:34px}
.cta .q b{color:var(--accent)}
.cta .sub{font-size:44px;line-height:1.4;margin-bottom:70px}
.actions{display:flex;gap:20px;margin-bottom:80px}
.actions div{flex:1;border:3px solid rgba(255,255,255,.85);border-radius:24px;padding:26px 10px;text-align:center;font-weight:700;font-size:32px}
.actions span{display:block;font-size:56px;margin-bottom:10px}
.follow{background:var(--accent2);padding:44px 48px;text-align:center}
.follow .t{font-weight:800;font-size:46px;line-height:1.2;margin-bottom:14px}
.follow .t b{font-weight:800}
.follow .d{font-size:34px;line-height:1.4}
.follow .h{margin-top:20px;font-weight:700;font-size:34px}
</style></head><body>${slides}
<script>
// Le texte doit tenir dans sa zone : on agrandit d'abord la zone (photo réduite), puis on réduit le texte.
// Lancé une fois les polices chargées (sinon les mesures sont faites avec une police de secours).
function fit(){
document.querySelectorAll('.text').forEach(t=>{
  const over=()=>t.scrollHeight-t.clientHeight;
  const slide=t.parentElement, photo=slide.querySelector('.photo');
  if(over()>2&&photo){
    const gain=Math.min(over()+20,150);
    photo.style.height=(photo.offsetHeight-gain)+'px';
    if(t.classList.contains('top')) t.style.bottom=(parseFloat(getComputedStyle(t).bottom)-gain)+'px';
    else t.style.top=(t.offsetTop-gain)+'px';
  }
  for(let k=0;k<14&&over()>2;k++) t.querySelectorAll('h2,p,li,.stat').forEach(el=>{el.style.fontSize=(parseFloat(getComputedStyle(el).fontSize)*0.94)+'px'});
});
document.querySelectorAll('h1').forEach(h=>{for(let k=0;k<12&&h.getBoundingClientRect().top<560;k++)h.style.fontSize=(parseFloat(getComputedStyle(h).fontSize)*0.93)+'px'});
}
window.__fitDone=document.fonts.ready.then(fit);
</script>
</body></html>`;
}

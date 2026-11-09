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
function headlineSize(t) {
  const n = plain(t).length;
  if (n <= 30) return 100;
  if (n <= 45) return 88;
  if (n <= 60) return 78;
  return 68;
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
  // Le haut du sujet (flèche d'un monument, tête d'une personne) reste toujours visible.
  const top = Math.min(0, Math.max(minTop, TEXT_TOP * 0.45 - cy, -f.y * ih + 30));
  const fade = ih + top < H;
  return `style="inset:auto;object-fit:fill;width:${iw.toFixed(0)}px;height:${ih.toFixed(0)}px;left:${left.toFixed(0)}px;top:${top.toFixed(0)}px${fade ? ";-webkit-mask-image:linear-gradient(180deg,#000 75%,transparent 99%)" : ""}"`;
}

function cover(s, ctx) {
  const src = srcOf(ctx.img);
  const place = coverPlacement(ctx.img);
  const image = src ? `<img class="bg" ${place || ""} src="${src}" alt="">` : `<div class="bg fallback"></div>`;
  return `${image}<div class="shade-cover"></div>
    ${ctx.category ? `<div class="pill">${esc(ctx.category)}</div>` : ""}
    ${ctx.brand.coverStyle === "headline" && s.body
      ? `<div class="cover-block"><h1 class="headline" style="font-size:${headlineSize(s.title)}px">${bold(s.title)}</h1><p class="cover-sub">${bold(s.body)}</p></div>`
      : `<h1 style="font-size:${coverSize(s.title)}px">${bold(String(s.title || "").replace(/\*\*/g, ""))}</h1>`}
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
  const top = Math.min(0, Math.max(boxH - ih, boxH / 2 - cy, -f.y * ih + 15));
  return `<img class="placed" style="width:${iw.toFixed(0)}px;height:${ih.toFixed(0)}px;left:${left.toFixed(0)}px;top:${top.toFixed(0)}px" src="${src}" alt="">`;
}

const IMG_BOTTOM_H = 640; // page « texte en haut, photo en bas »
const IMG_TOP_H = 520; // page « photo en haut, texte en bas »

// --- Pages intérieures « texte » (21m2) : fond bleu nuit, mots-clés en couleur, cartes blanches à gros chiffres.
const STOP = new Set(["le", "la", "les", "l", "un", "une", "des", "du", "de", "et", "en", "ce", "qui", "que", "pour", "a", "à"]);
function card(b, i) {
  // « **12,7 %** de rendement brut à Mulhouse » → gros chiffre + libellé ; sinon numéro d'étape.
  const m = String(b).match(/^\s*\*\*([^*]{1,14})\*\*\s*(.*)$/);
  const isValue = m && /\d/.test(m[1]);
  const value = isValue ? m[1] : String(i + 1);
  const label = isValue ? m[2] : b;
  return `<div class="card${isValue ? " value" : ""}"><span class="big">${esc(value)}</span><span class="lab">${bold(label)}</span></div>`;
}
function textSlide(s, ctx) {
  let inner = `${s.kicker ? `<div class="tx-label"><i></i>${esc(s.kicker)}</div>` : ""}${s.title ? `<h2 class="tx-title">${bold(s.title)}</h2>` : ""}`;
  if (s.kind === "list") {
    inner += `<div class="cards">${(s.bullets || []).map(card).join("")}</div>`;
    if (s.body) inner += `<p class="tx-p small">${bold(s.body)}</p>`;
  } else {
    for (const para of String(s.body || "").split(/\n+/).filter(Boolean)) inner += `<p class="tx-p">${bold(para)}</p>`;
  }
  if (srcOf(ctx.img)) inner += `<div class="tx-photo">${boxImage(ctx.img, 912, 520)}</div>`;
  return `<div class="tx-head">${logo(ctx.brand, "sm")}<span class="tx-page">${ctx.index + 1}/${ctx.total}</span></div>
    <div class="text tx">${inner}</div>`;
}

function contentSlide(s, ctx) {
  if (ctx.brand.innerStyle === "text") return textSlide(s, ctx);
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

// Dernière page : la question pour les commentaires, les dernières couvertures de la marque en éventail
// (« ce que tu vas recevoir »), puis un gros bouton « S'abonner » avec le compte.
function cta(s, ctx) {
  const b = ctx.brand;
  const c = b.ctaSlide || {};
  const thumbs = (ctx.thumbs || []).slice(0, 3);
  const fan = thumbs.length
    ? `<div class="fan n${thumbs.length}">${thumbs.map((t, k) => `<img class="f${k}" src="${t}" alt="">`).join("")}</div>`
    : "";
  return `${srcOf(ctx.coverImg) ? `<img class="bg cta-bg" src="${srcOf(ctx.coverImg)}" alt="">` : ""}<div class="cta-shade"></div>
    ${s.title ? `<div class="cta-q"><div class="qq">${esc(plain(s.title))}</div><div class="qh">Réponds en commentaire 👇</div></div>` : ""}
    ${fan}
    <div class="cta-follow${fan ? "" : " alone"}">
      <div class="cta-line">${esc(c.subtitle || "Chaque jour, l'actu qui compte.")}</div>
      <div class="sub-btn"><span class="plus">+</span>${esc(c.button || "S'abonner")}</div>
      <div class="cta-handle">${esc(b.handle || "")}</div>
    </div>
    <div class="foot">${logo(b, "md")}</div>`;
}

function fontsQuery(t) {
  const fams = [...new Set([t.titleFont, t.bodyFont].filter((f) => f && f !== "Montserrat"))];
  return fams.map((f) => `&family=${f.replace(/ /g, "+")}:wght@400;500;600;700`).join("");
}

export function renderHtml({ carousel, brand, images = [] }) {
  const t = brand.theme;
  let innerIndex = 0;
  const slides = carousel.slides
    .map((s, index) => {
      const ctx = { brand, index, total: carousel.slides.length, img: images[index], category: carousel.category, innerIndex, coverImg: images[0], thumbs: carousel.ctaThumbs };
      let body;
      if (s.kind === "cover") body = cover(s, ctx);
      else if (s.kind === "cta") body = cta(s, ctx);
      else { body = contentSlide(s, ctx); innerIndex++; }
      return `<section class="slide k-${s.kind}" id="s${index + 1}">${body}</section>`;
    })
    .join("\n");

  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@800${fontsQuery(t)}&display=block" rel="stylesheet">
<style>
:root{--avbg:${t.bg || "#0A1430"};--accent:${t.accent};--accent2:${t.accent2 || t.accent};--ft:${t.titleFont ? `'${t.titleFont}',` : ""}Montserrat,system-ui,sans-serif;--fb:${t.bodyFont ? `'${t.bodyFont}',` : ""}Montserrat,system-ui,sans-serif;--shade:${t.shadeRgb || "5,12,32"}}
*{box-sizing:border-box;margin:0;padding:0}
@page{size:1080px 1350px;margin:0}
body{background:#444;font-family:var(--fb);color:#fff}
.slide{width:1080px;height:1350px;position:relative;overflow:hidden;page-break-after:always;
  background:${t.slideBg || "radial-gradient(120% 70% at 100% 100%,rgba(46,107,240,.35) 0%,rgba(46,107,240,0) 60%),linear-gradient(180deg,#070a12 0%,#0a1020 100%)"}}
.bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 30%}
.bg.fallback{background:radial-gradient(circle at 70% 20%,${t.bg2},${t.bg} 70%)}
b{font-weight:800}

/* Couverture */
.k-cover{background:#05080f}
.shade-cover{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.28) 0%,rgba(0,0,0,0) 16%,rgba(0,0,0,0) 40%,rgba(var(--shade),.85) 64%,rgba(var(--shade),1) 84%,${t.gradientEnd || "rgba(20,45,110,1)"} 100%)}
.pill{position:absolute;left:80px;top:90px;border:5px solid #fff;border-radius:30px;padding:4px 30px 7px;font-weight:800;font-size:44px;background:rgba(0,0,0,.55);z-index:2}
h1{position:absolute;left:80px;right:80px;bottom:240px;font-family:var(--ft);font-weight:500;line-height:1.22;letter-spacing:-.005em}
h1 b{font-weight:800}
.cover-block{position:absolute;left:80px;right:80px;bottom:220px}
.cover-block h1.headline{position:static;font-weight:700;line-height:1.04;letter-spacing:-.02em;margin-bottom:28px}
.cover-block h1.headline b{color:var(--accent);font-weight:700}
.cover-sub{font-size:38px;line-height:1.38;font-weight:500;color:#E3E8FA}
.cover-sub b{color:#fff;font-weight:800}
.cover-foot{position:absolute;left:80px;right:80px;bottom:72px;display:flex;justify-content:center;align-items:center}
.wordmark{font-weight:800;letter-spacing:.18em;line-height:1.3;text-align:center;text-transform:uppercase}
.wordmark.md{font-size:22px}.wordmark.sm{font-size:20px}
.logo-img.md{height:56px}.logo-img.sm{height:44px}

/* Pages intérieures */
.photo{position:absolute;left:0;right:0;overflow:hidden}
.photo.top{top:0}.photo.bottom{bottom:0}
.photo .placed{position:absolute;max-width:none}
.photo .fill{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.photo.top::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,0) 82%,rgba(7,10,18,.75) 100%)}
.photo.bottom::after{content:"";position:absolute;inset:0;background:linear-gradient(0deg,rgba(0,0,0,0) 82%,rgba(7,10,18,.75) 100%)}
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

/* Pages intérieures « texte » (21m2) */
.tx-head{position:absolute;left:84px;right:84px;top:72px;display:flex;justify-content:space-between;align-items:center;z-index:2}
.tx-page{font-family:var(--ft);font-weight:600;font-size:28px;color:rgba(255,255,255,.55)}
.text.tx{top:190px;bottom:120px;left:84px;right:84px;display:flex;flex-direction:column;justify-content:center}
.tx-label{display:flex;align-items:center;gap:16px;font-family:var(--ft);font-weight:700;font-size:32px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);margin-bottom:34px}
.tx-label i{display:inline-block;width:26px;height:26px;border:4px solid var(--accent);position:relative}
.tx-label i::after{content:"";position:absolute;left:3px;bottom:3px;width:9px;height:9px;background:var(--accent)}
.tx-title{display:block;background:none;font-family:var(--ft);font-weight:700;font-size:76px;line-height:1.08;letter-spacing:-.015em;margin-bottom:40px}
.tx-title b{color:var(--accent);font-weight:700}
.tx-p{font-size:42px;line-height:1.45;font-weight:500;color:#D7DEFA;margin-bottom:24px}
.tx-p b{color:#fff;font-weight:800}
.tx-p.small{font-size:32px;margin-top:18px}
.cards{display:flex;flex-direction:column;gap:22px}
.card{background:#fff;border-radius:30px;padding:26px 34px;display:flex;align-items:center;gap:28px;color:#3D4361}
.card .big{flex:none;font-family:var(--ft);font-weight:700;font-size:62px;line-height:1;color:var(--accent2);min-width:56px}
.card.value .big{min-width:0}
.card .lab{font-size:34px;line-height:1.3;font-weight:600}
.card .lab b{color:#16205A;font-weight:800}
.tx-photo{position:relative;height:520px;border-radius:30px;overflow:hidden;margin-top:30px;flex:none}
.tx-photo .placed{position:absolute;max-width:none}
.tx-photo .fill{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}

/* Dernière page */
.k-cta .cta-bg{filter:blur(6px) saturate(1.1);transform:scale(1.06)}
.cta-shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(var(--shade),.86) 0%,rgba(var(--shade),.7) 50%,rgba(var(--shade),.92) 100%)}
.cta-q{position:absolute;left:80px;right:80px;top:100px;text-align:center}
.cta-q .qq{font-family:var(--ft);font-weight:800;font-size:62px;line-height:1.15;letter-spacing:-.01em}
.cta-q .qh{margin-top:18px;font-size:34px;font-weight:600;color:var(--accent)}
.fan{position:absolute;left:0;right:0;top:420px;height:470px}
.fan img{position:absolute;top:0;left:50%;width:300px;height:375px;object-fit:cover;border-radius:22px;border:5px solid #fff;box-shadow:0 24px 50px rgba(0,0,0,.55)}
.fan .f0{transform:translateX(-50%) translateX(-230px) translateY(48px) rotate(-11deg)}
.fan .f2{transform:translateX(-50%) translateX(230px) translateY(48px) rotate(11deg)}
.fan .f1{transform:translateX(-50%) translateY(-6px);z-index:2}
.fan.n1 .f0{transform:translateX(-50%)}
.fan.n2 .f0{transform:translateX(-50%) translateX(-140px) rotate(-7deg)}.fan.n2 .f1{transform:translateX(-50%) translateX(140px) rotate(7deg)}
.cta-follow{position:absolute;left:80px;right:80px;top:930px;text-align:center}
.cta-follow.alone{top:560px}
.cta-line{font-size:40px;line-height:1.3;font-weight:500;color:#E8ECF6;margin-bottom:30px}
.sub-btn{display:inline-flex;align-items:center;gap:22px;background:var(--accent2);color:#fff;border-radius:999px;padding:24px 64px 26px 40px;font-family:var(--ft);font-weight:800;font-size:56px;box-shadow:0 18px 40px rgba(0,0,0,.4)}
.sub-btn .plus{display:inline-flex;align-items:center;justify-content:center;width:62px;height:62px;border-radius:50%;background:#fff;color:var(--accent2);font-size:52px;line-height:1;padding-bottom:6px}
.cta-handle{margin-top:22px;font-size:34px;font-weight:700;color:rgba(255,255,255,.85)}
</style></head><body>${slides}
<script>
// Le texte doit tenir dans sa zone : on agrandit d'abord la zone (photo réduite), puis on réduit le texte.
// Lancé une fois les polices chargées (sinon les mesures sont faites avec une police de secours).
function fit(){
document.querySelectorAll('.text').forEach(t=>{
  const over=()=>t.scrollHeight-t.clientHeight;
  const slide=t.parentElement, photo=slide.querySelector('.photo');
  const txPhoto=t.querySelector('.tx-photo');
  if(over()>2&&txPhoto){txPhoto.style.height=Math.max(260,txPhoto.offsetHeight-over()-10)+'px';}
  if(over()>2&&photo){
    const gain=Math.min(over()+20,150);
    photo.style.height=(photo.offsetHeight-gain)+'px';
    if(t.classList.contains('top')) t.style.bottom=(parseFloat(getComputedStyle(t).bottom)-gain)+'px';
    else t.style.top=(t.offsetTop-gain)+'px';
  }
  for(let k=0;k<14&&over()>2;k++) t.querySelectorAll('h2,p,li,.stat,.card .lab,.card .big').forEach(el=>{el.style.fontSize=(parseFloat(getComputedStyle(el).fontSize)*0.94)+'px'});
});
document.querySelectorAll('h1:not(.headline)').forEach(h=>{for(let k=0;k<12&&h.getBoundingClientRect().top<560;k++)h.style.fontSize=(parseFloat(getComputedStyle(h).fontSize)*0.93)+'px'});
document.querySelectorAll('.cover-block').forEach(b=>{const h=b.querySelector('h1'),p=b.querySelector('.cover-sub');for(let k=0;k<12&&b.getBoundingClientRect().top<520;k++){[h,p].forEach(el=>el.style.fontSize=(parseFloat(getComputedStyle(el).fontSize)*0.94)+'px')}});
}
function fitCta(){document.querySelectorAll('.k-cta').forEach(sl=>{const q=sl.querySelector('.cta-q .qq');if(!q)return;const lim=sl.getBoundingClientRect().top+(sl.querySelector('.fan')?400:520);for(let k=0;k<10&&sl.querySelector('.cta-q').getBoundingClientRect().bottom>lim;k++)q.style.fontSize=(parseFloat(getComputedStyle(q).fontSize)*0.93)+'px';});}
window.__fitDone=document.fonts.ready.then(()=>{fit();fitCta();});
</script>
</body></html>`;
}

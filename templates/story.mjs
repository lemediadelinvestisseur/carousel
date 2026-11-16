// Template « story » (1080 x 1350), inspiré des carousels de médias éco à forte audience.
// Règle d'or : AUCUNE page vide. Chaque page a soit une photo, soit un graphique (jauge, barres, gros chiffre).
//
// Pages :
//  - cover : photo plein cadre, étiquette colorée, accroche avec mots-clés en gras, logo centré, flèche.
//            Sert aussi de post « image unique » (format single).
//  - photo : photo en haut (fondue dans le fond), étiquette, titre souligné, texte court.
//  - stat  : gros chiffre ; jauge en demi-cercle si c'est un pourcentage (avec repère éventuel).
//  - bars  : comparaison en barres horizontales (la plus forte en couleur).
//  - rank  : un élément d'un classement (ville, pays, entreprise) en photo plein cadre, rang + chiffres clés.
//  - cta   : question pour les commentaires + abonnement.
// Les pages sans photo à elles reçoivent la photo de couverture, floutée et assombrie, en fond.

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const plain = (s) => String(s ?? "").replace(/\*\*/g, "");
// **mot** → gras ; espace insécable entre un nombre et son unité.
const bold = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(\d) (?=[\p{L}%€$])/gu, "$1&nbsp;");
const srcOf = (img) => (img && typeof img === "object" ? img.src : img);

/** Photo plein cadre centrée sur le sujet (focus en fractions de l'image). */
function photoTag(img, cls = "") {
  const src = srcOf(img);
  if (!src) return "";
  const f = img?.focus;
  const pos = f ? `object-position:${Math.round((f.x + f.w / 2) * 100)}% ${Math.round(Math.min(1, f.y + f.h * 0.35) * 100)}%` : "object-position:50% 30%";
  return `<img class="ph ${cls}" style="${pos}" src="${src}" alt="">`;
}

/**
 * Photo plein cadre (couverture, classement) sans agrandissement visible : si la photo est assez grande,
 * elle remplit toute la page ; sinon elle couvre au moins le haut (jusqu'au texte) et son bas se fond dans le noir.
 */
function fullPhoto(img) {
  const src = srcOf(img);
  if (!src) return "";
  if (!img.width || !img.height) return photoTag(img, "full");
  const W = 1080, H = 1350, MIN_H = 860;
  const f = img.focus || { x: 0.3, y: 0.15, w: 0.4, h: 0.6 };
  const fill = Math.max(W / img.width, H / img.height);
  const s = fill <= 1.25 ? fill : Math.max(W / img.width, Math.min(H, MIN_H) / img.height);
  const iw = img.width * s, ih = img.height * s;
  const cx = (f.x + f.w / 2) * iw, cy = (f.y + f.h / 2) * ih;
  const left = Math.min(0, Math.max(W - iw, W / 2 - cx));
  const top = ih >= H ? Math.min(0, Math.max(H - ih, H * 0.33 - cy, -f.y * ih + 30)) : 0;
  const fade = ih + top < H - 2 ? ";-webkit-mask-image:linear-gradient(180deg,#000 72%,transparent 99%)" : "";
  return `<img class="ph" style="width:${iw.toFixed(0)}px;height:${ih.toFixed(0)}px;left:${left.toFixed(0)}px;top:${top.toFixed(0)}px;max-width:none${fade}" src="${src}" alt="">`;
}

function logo(brand) {
  if (brand.logoDataUri) return `<img class="logo-img" src="${brand.logoDataUri}" alt="">`;
  const lines = brand.wordmark || [brand.name];
  return `<div class="wordmark">${lines.map(esc).join("<br>")}</div>`;
}

const ARROW = `<svg class="arrow" viewBox="0 0 64 32" aria-hidden="true"><path d="M2 16h56M44 3l15 13-15 13" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const foot = (ctx) => `<div class="foot">${logo(ctx.brand)}</div>${ctx.last ? "" : ARROW}`;

/** Fond des pages sans photo : la couverture floutée, très assombrie. */
const ambient = (ctx) => (srcOf(ctx.coverImg) ? `<img class="ambient" src="${srcOf(ctx.coverImg)}" alt="">` : "") + `<div class="ambient-shade"></div>`;

const label = (k) => (k ? `<div class="label">${esc(k)}</div>` : "");
const title = (t) => (t ? `<h2><span>${bold(t)}</span></h2>` : "");
const paras = (body, cls = "") => String(body || "").split(/\n+/).filter(Boolean).map((p) => `<p class="${cls}">${bold(p)}</p>`).join("");

function coverSize(t) {
  const n = plain(t).length;
  if (n <= 60) return 74;
  if (n <= 95) return 66;
  if (n <= 130) return 60;
  return 54;
}

// --- Pages -----------------------------------------------------------------
function cover(s, ctx) {
  return `${fullPhoto(ctx.img) || `<div class="ph full empty"></div>`}<div class="shade-cover"></div>
    <div class="cover-text">
      ${ctx.category ? `<div class="tag">${esc(ctx.category)}</div>` : ""}
      <h1 style="font-size:${coverSize(s.title)}px">${bold(s.title)}</h1>
    </div>${foot(ctx)}`;
}

function photoPage(s, ctx) {
  if (!srcOf(ctx.img)) return textPage(s, ctx);
  return `<div class="top-photo">${photoTag(ctx.img)}</div><div class="top-fade"></div>
    <div class="zone under">${label(s.kicker)}${title(s.title)}${paras(s.body)}</div>${foot(ctx)}`;
}

function textPage(s, ctx) {
  return `${ambient(ctx)}<div class="zone mid">${label(s.kicker)}${title(s.title)}${paras(s.body)}</div>${foot(ctx)}`;
}

function gauge(st) {
  const p = Math.max(0, Math.min(100, Number(st.percent)));
  const R = 330, CX = 420, CY = 400, W = 64;
  const pt = (v) => {
    const a = Math.PI * (1 - v / 100);
    return [CX + R * Math.cos(a), CY - R * Math.sin(a)];
  };
  const [x0, y0] = pt(0), [x1, y1] = pt(100), [xp, yp] = pt(p);
  let marker = "";
  if (st.marker_percent != null && st.marker_percent !== "" && !Number.isNaN(Number(st.marker_percent))) {
    const m = Math.max(0, Math.min(100, Number(st.marker_percent)));
    const a = Math.PI * (1 - m / 100);
    const r1 = R - W / 2 - 10, r2 = R + W / 2 + 14;
    const [ax, ay] = [CX + r1 * Math.cos(a), CY - r1 * Math.sin(a)];
    const [bx, by] = [CX + r2 * Math.cos(a), CY - r2 * Math.sin(a)];
    const anchor = m > 55 ? "start" : m < 45 ? "end" : "middle";
    marker = `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="#fff" stroke-width="5" stroke-dasharray="10 8"/>
      <text x="${bx + (anchor === "start" ? 12 : anchor === "end" ? -12 : 0)}" y="${by - 10}" text-anchor="${anchor}" class="g-mark">${esc(st.marker_label || "")}</text>`;
  }
  return `<svg class="gauge" viewBox="0 0 840 470">
    <path d="M${x0} ${y0} A${R} ${R} 0 0 1 ${x1} ${y1}" fill="none" stroke="rgba(255,255,255,.16)" stroke-width="${W}" stroke-linecap="round"/>
    ${p > 0 ? `<path d="M${x0} ${y0} A${R} ${R} 0 0 1 ${xp} ${yp}" fill="none" stroke="var(--pop)" stroke-width="${W}" stroke-linecap="round"/>` : ""}
    ${marker}
    <text x="${x0}" y="${CY + 70}" text-anchor="middle" class="g-end">0 %</text>
    <text x="${x1}" y="${CY + 70}" text-anchor="middle" class="g-end">100 %</text>
  </svg>`;
}

function statPage(s, ctx) {
  const st = s.stat || {};
  const isGauge = st.percent != null && st.percent !== "" && !Number.isNaN(Number(st.percent));
  const big = `<div class="big-value${isGauge ? " in-gauge" : ""}">${esc(st.value || "")}</div>${st.label ? `<div class="big-label">${bold(st.label)}</div>` : ""}`;
  const viz = isGauge ? `<div class="gauge-wrap">${gauge(st)}<div class="gauge-center">${big}</div></div>` : `<div class="big-wrap">${big}</div>`;
  const bg = srcOf(ctx.img) ? `${photoTag(ctx.img, "full dim")}<div class="ambient-shade strong"></div>` : ambient(ctx);
  return `${bg}<div class="zone stat">${label(s.kicker)}${title(s.title)}${paras(s.body)}${viz}</div>${foot(ctx)}`;
}

function barsPage(s, ctx) {
  const rows = (s.bars || []).filter((r) => r && r.label).slice(0, 6);
  const nums = rows.map((r) => Math.abs(Number(r.amount) || 0));
  const max = Math.max(...nums, 1);
  const top = nums.indexOf(Math.max(...nums));
  const list = rows
    .map((r, i) => {
      const w = Math.max(14, Math.round((nums[i] / max) * 100));
      return `<div class="bar-row">
        <div class="bar-head"><span>${bold(r.label)}</span>${r.note ? `<span class="bar-note">${esc(r.note)}</span>` : ""}</div>
        <div class="bar${i === top ? " hot" : ""}" style="width:${w}%"><span>${esc(r.value_text || "")}</span></div>
      </div>`;
    })
    .join("");
  return `${ambient(ctx)}<div class="zone bars">${label(s.kicker)}${title(s.title)}${paras(s.body, "short")}<div class="bar-list n${rows.length}">${list}</div></div>${foot(ctx)}`;
}

function rankPage(s, ctx) {
  const r = s.rank || {};
  const figs = (r.figures || []).filter((f) => f && f.value).slice(0, 3);
  return `${fullPhoto(ctx.img) || ambient(ctx)}<div class="shade-rank"></div>
    <div class="rank-text">
      <div class="rank-pos">${esc(r.position || "")}</div>
      <h3>${bold(r.name || s.title || "")}</h3>
      ${figs.length ? `<div class="figs">${figs.map((f) => `<div class="fig"><b>${esc(f.value)}</b><span>${esc(f.label || "")}</span></div>`).join("")}</div>` : ""}
      ${s.body ? `<p class="rank-p">${bold(s.body)}</p>` : ""}
    </div>${foot(ctx)}`;
}

function cta(s, ctx) {
  const b = ctx.brand, c = b.ctaSlide || {};
  const thumbs = (ctx.thumbs || []).slice(0, 3);
  const fan = thumbs.length ? `<div class="fan n${thumbs.length}">${thumbs.map((t, k) => `<img class="f${k}" src="${t}" alt="">`).join("")}</div>` : "";
  return `${ambient(ctx)}
    ${s.title ? `<div class="cta-q"><div class="qq">${esc(plain(s.title))}</div><div class="qh">Réponds en commentaire 👇</div></div>` : ""}
    ${fan}
    <div class="cta-follow${fan ? "" : " alone"}">
      <div class="cta-line">${esc(c.subtitle || "Chaque jour, l'actu qui compte.")}</div>
      <div class="sub-btn"><span class="plus">+</span>${esc(c.button || "S'abonner")}</div>
      <div class="cta-handle">${esc(b.handle || "")}</div>
    </div>
    <div class="foot">${logo(b)}</div>`;
}

const PAGES = { cover, photo: photoPage, content: photoPage, list: photoPage, stat: statPage, bars: barsPage, rank: rankPage, cta };

function fontsQuery(t) {
  const fams = [...new Set([t.titleFont, t.bodyFont].filter((f) => f && f !== "Poppins"))];
  return fams.map((f) => `&family=${f.replace(/ /g, "+")}:wght@400;500;600;700;800`).join("");
}

export function renderHtml({ carousel, brand, images = [] }) {
  const t = brand.theme || {};
  const total = carousel.slides.length;
  const slides = carousel.slides
    .map((s, index) => {
      const ctx = { brand, index, total, last: index === total - 1, img: images[index], coverImg: images[0] || images.find(Boolean), category: carousel.category, thumbs: carousel.ctaThumbs };
      const fn = PAGES[s.kind] || photoPage;
      return `<section class="slide k-${esc(s.kind)}" id="s${index + 1}">${fn(s, ctx)}</section>`;
    })
    .join("\n");

  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&family=JetBrains+Mono:wght@700;800${fontsQuery(t)}&display=block" rel="stylesheet">
<style>
:root{--bg:${t.storyBg || "#07080c"};--pop:${t.pop || t.accent || "#5B8CFF"};--popText:${t.popText || "#0a0a0a"};--tag:${t.tag || "#E8323C"};--line:${t.underline || t.accent2 || "#5b3cff"};--glow:${t.glow || "rgba(91,140,255,.35)"};
  --ft:${t.titleFont ? `'${t.titleFont}',` : ""}Poppins,system-ui,sans-serif;--fb:${t.bodyFont ? `'${t.bodyFont}',` : ""}Poppins,system-ui,sans-serif}
*{box-sizing:border-box;margin:0;padding:0}
@page{size:1080px 1350px;margin:0}
body{background:#333;font-family:var(--fb);color:#fff}
.slide{width:1080px;height:1350px;position:relative;overflow:hidden;page-break-after:always;
  background:radial-gradient(60% 38% at 92% 100%,var(--glow) 0%,transparent 70%),var(--bg)}
b{font-weight:800}
.ph{position:absolute;object-fit:cover}
.ph.full{inset:0;width:100%;height:100%}
.ph.full.empty{background:radial-gradient(circle at 70% 25%,#2a3350,var(--bg) 70%)}
.ph.dim{filter:saturate(.9)}

/* Couverture */
.shade-cover{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.18) 0%,rgba(0,0,0,0) 22%,rgba(0,0,0,0) 42%,color-mix(in srgb,var(--bg) 72%,transparent) 62%,color-mix(in srgb,var(--bg) 94%,transparent) 80%,var(--bg) 100%),radial-gradient(55% 22% at 95% 100%,var(--glow) 0%,transparent 70%)}
.cover-text{position:absolute;left:84px;right:84px;bottom:220px}
.tag{display:inline-block;background:var(--tag);color:#fff;font-family:'JetBrains Mono',monospace;font-weight:800;font-size:44px;letter-spacing:.12em;line-height:1;padding:14px 24px 16px;margin-bottom:34px;text-transform:uppercase}
h1{font-family:var(--ft);font-weight:400;line-height:1.2;letter-spacing:-.01em}
h1 b{font-weight:800}

/* Pied de page */
.foot{position:absolute;left:0;right:0;bottom:62px;display:flex;justify-content:center;z-index:3}
.wordmark{font-family:var(--ft);font-weight:800;letter-spacing:.16em;line-height:1.25;text-align:center;text-transform:uppercase;font-size:22px}
.logo-img{height:58px}
.arrow{position:absolute;right:70px;bottom:66px;width:84px;height:42px;color:var(--pop);z-index:3}

/* Zones de texte des pages intérieures */
.zone{position:absolute;left:84px;right:84px;z-index:2;display:flex;flex-direction:column;align-items:flex-start}
.zone.under{top:600px;bottom:170px;justify-content:flex-start}
.zone.mid{top:110px;bottom:170px;justify-content:center}
.zone.stat,.zone.bars{top:96px;bottom:170px}
.label{display:inline-block;background:#fff;color:#0a0a0a;font-family:'JetBrains Mono',monospace;font-weight:800;font-size:42px;letter-spacing:.12em;line-height:1;padding:13px 22px 15px;margin-bottom:40px;text-transform:uppercase}
h2{font-family:var(--ft);font-weight:700;font-size:58px;line-height:1.28;margin-bottom:34px;letter-spacing:-.01em}
h2 span{background-image:linear-gradient(var(--line),var(--line));background-repeat:no-repeat;background-size:100% 9px;background-position:0 96%;-webkit-box-decoration-break:clone;box-decoration-break:clone}
h2 b{font-weight:700}
p{font-size:42px;line-height:1.4;font-weight:400;margin-bottom:30px;color:#F2F3F7}
p b{font-weight:700;color:#fff}
p.short{font-size:38px}

/* Page photo */
.top-photo{position:absolute;left:0;right:0;top:0;height:560px;overflow:hidden}
.top-photo .ph{inset:0;width:100%;height:100%}
.top-fade{position:absolute;left:0;right:0;top:400px;height:170px;background:linear-gradient(180deg,transparent,var(--bg))}

/* Fond flou */
.ambient{position:absolute;inset:-40px;width:calc(100% + 80px);height:calc(100% + 80px);object-fit:cover;filter:blur(28px) saturate(1.1);opacity:.55}
.ambient-shade{position:absolute;inset:0;background:radial-gradient(60% 38% at 92% 100%,var(--glow) 0%,transparent 70%),linear-gradient(180deg,color-mix(in srgb,var(--bg) 86%,transparent) 0%,color-mix(in srgb,var(--bg) 78%,transparent) 50%,color-mix(in srgb,var(--bg) 90%,transparent) 100%)}
.ambient-shade.strong{background:linear-gradient(180deg,color-mix(in srgb,var(--bg) 92%,transparent),color-mix(in srgb,var(--bg) 86%,transparent))}

/* Gros chiffre / jauge */
.gauge-wrap{position:relative;width:840px;height:470px;margin:20px auto 0;align-self:center}
.gauge{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.g-end{fill:rgba(255,255,255,.6);font:600 30px var(--fb)}
.g-mark{fill:rgba(255,255,255,.75);font:700 30px var(--fb)}
.gauge-center{position:absolute;left:0;right:0;top:215px;text-align:center}
.big-wrap{flex:1;display:flex;flex-direction:column;justify-content:center;align-items:center;align-self:stretch;text-align:center}
.big-value{font-family:var(--ft);font-weight:800;font-size:190px;line-height:1;color:var(--pop);letter-spacing:-.03em}
.big-value.in-gauge{font-size:150px}
.big-label{font-size:40px;font-weight:700;margin-top:14px;line-height:1.25}

/* Barres */
.bar-list{align-self:stretch;display:flex;flex-direction:column;gap:34px;margin-top:20px;flex:1;justify-content:center}
.bar-head{display:flex;justify-content:space-between;gap:24px;font-size:36px;font-weight:600;padding-bottom:14px;margin-bottom:16px;border-bottom:3px dashed rgba(255,255,255,.25)}
.bar-note{color:rgba(255,255,255,.7);white-space:nowrap}
.bar{height:76px;border-radius:12px;background:rgba(255,255,255,.18);display:flex;align-items:center;justify-content:flex-end;padding:0 22px;min-width:max-content}
.bar span{font-family:var(--ft);font-weight:800;font-size:40px;white-space:nowrap}
.bar.hot{background:var(--pop);color:var(--popText)}
.bar-list.n5,.bar-list.n6{gap:22px}
.bar-list.n5 .bar,.bar-list.n6 .bar{height:60px}
.bar-list.n5 .bar-head,.bar-list.n6 .bar-head{font-size:32px;padding-bottom:8px;margin-bottom:10px}

/* Classement : une page par élément */
.shade-rank{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.25) 0%,rgba(0,0,0,0) 25%,rgba(0,0,0,.15) 45%,color-mix(in srgb,var(--bg) 85%,transparent) 68%,var(--bg) 100%)}
.rank-text{position:absolute;left:84px;right:84px;bottom:190px;z-index:2}
.rank-pos{display:inline-block;background:var(--pop);color:var(--popText);font-family:var(--ft);font-weight:800;font-size:64px;line-height:1;padding:14px 26px 16px;border-radius:14px;margin-bottom:24px}
h3{font-family:var(--ft);font-weight:800;font-size:96px;line-height:1.02;letter-spacing:-.02em;margin-bottom:28px}
.figs{display:flex;gap:18px;margin-bottom:26px;flex-wrap:wrap}
.fig{background:rgba(255,255,255,.12);border:2px solid rgba(255,255,255,.22);backdrop-filter:blur(8px);border-radius:18px;padding:16px 24px;display:flex;flex-direction:column;min-width:200px;max-width:440px}
.fig b{font-family:var(--ft);font-size:50px;line-height:1.05;color:var(--pop)}
.fig span{font-size:27px;line-height:1.25;color:#E8EAF0;margin-top:6px}
.rank-p{font-size:36px;margin:0}

/* Dernière page */
.cta-q{position:absolute;left:80px;right:80px;top:110px;text-align:center;z-index:2}
.cta-q .qq{font-family:var(--ft);font-weight:800;font-size:64px;line-height:1.15;letter-spacing:-.01em}
.cta-q .qh{margin-top:20px;font-size:36px;font-weight:600;color:var(--pop)}
.fan{position:absolute;left:0;right:0;top:430px;height:470px;z-index:2}
.fan img{position:absolute;top:0;left:50%;width:300px;height:375px;object-fit:cover;border-radius:22px;border:5px solid #fff;box-shadow:0 24px 50px rgba(0,0,0,.55)}
.fan .f0{transform:translateX(-50%) translateX(-230px) translateY(48px) rotate(-11deg)}
.fan .f2{transform:translateX(-50%) translateX(230px) translateY(48px) rotate(11deg)}
.fan .f1{transform:translateX(-50%) translateY(-6px);z-index:2}
.fan.n1 .f0{transform:translateX(-50%)}
.fan.n2 .f0{transform:translateX(-50%) translateX(-140px) rotate(-7deg)}.fan.n2 .f1{transform:translateX(-50%) translateX(140px) rotate(7deg)}
.cta-follow{position:absolute;left:80px;right:80px;top:940px;text-align:center;z-index:2}
.cta-follow.alone{top:560px}
.cta-line{font-size:40px;line-height:1.3;font-weight:500;color:#E8ECF6;margin-bottom:30px}
.sub-btn{display:inline-flex;align-items:center;gap:22px;background:var(--pop);color:var(--popText);border-radius:999px;padding:24px 64px 26px 40px;font-family:var(--ft);font-weight:800;font-size:56px}
.sub-btn .plus{display:inline-flex;align-items:center;justify-content:center;width:62px;height:62px;border-radius:50%;background:var(--popText);color:var(--pop);font-size:52px;line-height:1;padding-bottom:6px}
.cta-handle{margin-top:22px;font-size:34px;font-weight:700;color:rgba(255,255,255,.85)}
</style></head><body>${slides}
<script>
// Le texte doit tenir dans sa zone : on réduit progressivement les polices si besoin.
function shrink(els,f){els.forEach(el=>{el.style.fontSize=(parseFloat(getComputedStyle(el).fontSize)*f)+'px'})}
function fit(){
  document.querySelectorAll('.zone').forEach(z=>{
    const over=()=>z.scrollHeight-z.clientHeight>2;
    // Page photo : on remonte d'abord le texte (photo un peu moins haute).
    if(z.classList.contains('under')){const ph=z.parentElement.querySelector('.top-photo'),fd=z.parentElement.querySelector('.top-fade');
      for(let k=0;k<6&&over();k++){const h=ph.offsetHeight-40;if(h<380)break;ph.style.height=h+'px';fd.style.top=(h-160)+'px';z.style.top=(z.offsetTop-40)+'px';}}
    for(let k=0;k<16&&over();k++){shrink(z.querySelectorAll('h2,p,.big-label,.bar-head'),.95);
      const g=z.querySelector('.gauge-wrap');if(g&&k>3){g.style.transform='scale('+(1-0.04*(k-3))+')';g.style.transformOrigin='top center';g.style.marginBottom=(-470*0.04*(k-3))+'px'}
      const bv=z.querySelector('.big-value:not(.in-gauge)');if(bv)shrink([bv],.95);}
  });
  document.querySelectorAll('.cover-text').forEach(c=>{const h=c.querySelector('h1');for(let k=0;k<14&&c.getBoundingClientRect().top-c.closest('.slide').getBoundingClientRect().top<520;k++)shrink([h],.94)});
  document.querySelectorAll('.rank-text').forEach(c=>{for(let k=0;k<12&&c.getBoundingClientRect().top-c.closest('.slide').getBoundingClientRect().top<420;k++)shrink(c.querySelectorAll('h3,.rank-p,.fig b,.fig span'),.94)});
  document.querySelectorAll('.k-cta').forEach(sl=>{const q=sl.querySelector('.cta-q .qq');if(!q)return;const lim=sl.getBoundingClientRect().top+(sl.querySelector('.fan')?410:520);for(let k=0;k<10&&sl.querySelector('.cta-q').getBoundingClientRect().bottom>lim;k++)shrink([q],.93)});
}
window.__fitDone=document.fonts.ready.then(fit);
</script>
</body></html>`;
}

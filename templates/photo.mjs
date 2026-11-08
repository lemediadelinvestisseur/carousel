// Template « photo » (1080 x 1350) : couverture photo plein écran + accroche surlignée,
// slides d'explication illustrées, slide finale d'abonnement avec maquette de profil.
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const hl = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<span class="hl">$1</span>');
const strong = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
const plain = (s) => String(s ?? "").replace(/\*\*/g, "");

function coverSize(t) {
  const n = plain(t).length;
  if (n <= 40) return 92;
  if (n <= 60) return 82;
  if (n <= 85) return 72;
  return 62;
}
function titleSize(t) {
  const n = plain(t).length;
  if (n <= 30) return 76;
  if (n <= 55) return 66;
  return 58;
}

function logo(brand, size = "md") {
  if (brand.logoDataUri) return `<img class="logo-img ${size}" src="${brand.logoDataUri}" alt="">`;
  return `<div class="logo ${size}"><span class="logo-mark">${esc(brand.logoMark || brand.name[0])}</span><span>${esc(brand.logoText || brand.name)}</span></div>`;
}

function bg(img, cls = "") {
  return img ? `<img class="bg ${cls}" src="${img}" alt="">` : `<div class="bg fallback ${cls}"></div>`;
}

function cover(s, ctx) {
  return `${bg(ctx.img)}<div class="shade-cover"></div>
    ${ctx.category ? `<div class="pill">${esc(ctx.category)}</div>` : ""}
    <h1 style="font-size:${coverSize(s.title)}px">${hl(s.title)}</h1>
    <div class="cover-logo">${logo(ctx.brand)}</div>`;
}

function contentSlide(s, ctx) {
  let inner;
  if (s.kind === "stat") {
    const n = plain(s.stat).length;
    const size = n <= 4 ? 200 : n <= 7 ? 160 : n <= 10 ? 124 : 96;
    inner = `<div class="stat" style="font-size:${size}px">${esc(s.stat)}</div>${s.title ? `<h2 style="font-size:${titleSize(s.title)}px">${hl(s.title)}</h2>` : ""}${s.body ? `<p>${strong(s.body)}</p>` : ""}`;
  } else if (s.kind === "list") {
    inner = `${s.title ? `<h2 style="font-size:${titleSize(s.title)}px">${hl(s.title)}</h2>` : ""}
      <ol>${(s.bullets || []).map((b, i) => `<li><span class="num">${i + 1}</span><span>${strong(b)}</span></li>`).join("")}</ol>`;
  } else if (s.kind === "quote") {
    inner = `<div class="qmark">“</div><blockquote>${strong(s.body)}</blockquote>${s.title ? `<div class="author">— ${esc(s.title)}</div>` : ""}`;
  } else {
    inner = `${s.title ? `<h2 style="font-size:${titleSize(s.title)}px">${hl(s.title)}</h2>` : ""}${s.body ? `<p>${strong(s.body)}</p>` : ""}`;
  }
  const hasImg = !!ctx.img;
  const head = hasImg
    ? `<div class="top">${bg(ctx.img)}<div class="shade-top"></div></div>`
    : `${bg(ctx.coverImg, "blur dim")}<div class="shade-full"></div>`;
  return `${head}
    <div class="content ${hasImg ? "" : "centered"} ${s.kind === "list" ? "is-list" : ""}">
      ${s.kicker ? `<div class="kicker">${esc(s.kicker)}</div>` : ""}
      ${inner}
    </div>
    <div class="foot">${logo(ctx.brand, "sm")}<span class="page">${ctx.index + 1}/${ctx.total}</span></div>`;
}

function cta(s, ctx) {
  const b = ctx.brand;
  const c = b.ctaSlide || {};
  const thumbs = ctx.allImages.filter(Boolean).slice(0, 3);
  while (thumbs.length && thumbs.length < 3) thumbs.push(thumbs[0]);
  return `${bg(ctx.coverImg, "blur")}<div class="shade-cta"></div>
    <div class="cta-text">
      <h2 class="cta-title">🛎️ ${hl(s.title || c.title || `Abonne-toi à ${b.name}`)}</h2>
      <p class="cta-sub">${strong(s.body || c.subtitle || "pour ne rien rater de nos prochaines publications")}</p>
    </div>
    <div class="phone">
      <div class="notch"></div>
      <div class="status"><span>9:41</span><span>●●● 􀙇</span></div>
      <div class="ph-head"><span class="chev">‹</span><b>${esc(b.handle.replace(/^@/, ""))}</b><span class="dots">···</span></div>
      <div class="ph-profile">
        <div class="avatar">${b.logoDataUri ? `<img src="${b.logoDataUri}" alt="">` : `<span>${esc(b.logoMark || b.name[0])}</span>`}</div>
        <div><div class="ph-name">${esc(b.name)}</div><div class="ph-cat">Média</div></div>
      </div>
      <div class="ph-bio">${(c.bio || []).map((l) => `<div>${esc(l)}</div>`).join("")}${c.website ? `<div class="ph-link">🔗 ${esc(c.website)}</div>` : ""}</div>
      <div class="ph-btns"><span class="follow">S'abonner</span><span class="msg">Message</span></div>
      <div class="ph-grid">${thumbs.map((t) => `<div style="background-image:url('${t}')"></div>`).join("")}</div>
    </div>
    <div class="hand">👉</div>`;
}

export function renderHtml({ carousel, brand, images = [] }) {
  const t = brand.theme;
  const coverImg = images[0] || images.find(Boolean) || null;
  const total = carousel.slides.length;
  const slides = carousel.slides
    .map((s, index) => {
      const ctx = { brand, index, total, img: images[index], coverImg, allImages: images, category: carousel.category };
      const body = s.kind === "cover" ? cover(s, ctx) : s.kind === "cta" ? cta(s, ctx) : contentSlide(s, ctx);
      return `<section class="slide k-${s.kind}" id="s${index + 1}">${body}</section>`;
    })
    .join("\n");

  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800;900&display=block" rel="stylesheet">
<style>
:root{--bg:${t.bg};--bg2:${t.bg2};--text:#fff;--muted:${t.muted};--accent:${t.accent};--hlBg:${t.highlightBg || t.accent};--hlText:${t.highlightText || t.accentText}}
*{box-sizing:border-box;margin:0;padding:0}
@page{size:1080px 1350px;margin:0}
body{background:#444;font-family:Montserrat,system-ui,sans-serif;color:var(--text)}
.slide{width:1080px;height:1350px;position:relative;overflow:hidden;background:var(--bg);page-break-after:always}
.bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 22%}
.bg.fallback{background:radial-gradient(circle at 70% 20%,var(--bg2),var(--bg) 70%)}
.bg.blur{filter:blur(14px) brightness(.55);transform:scale(1.1)}
.bg.blur.dim{filter:blur(22px) brightness(.32)}
.shade-full{position:absolute;inset:0;background:linear-gradient(180deg,rgba(10,22,40,.35),rgba(10,22,40,.75))}
.hl{background:var(--hlBg);color:var(--hlText);padding:0 .16em;border-radius:.08em;-webkit-box-decoration-break:clone;box-decoration-break:clone}
strong{color:var(--accent);font-weight:700}

/* Couverture */
.shade-cover{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.35) 0%,rgba(0,0,0,0) 22%,rgba(0,0,0,0) 45%,rgba(0,0,0,.7) 70%,rgba(0,0,0,.94) 100%)}
.pill{position:absolute;left:84px;top:96px;border:5px solid #fff;border-radius:28px;padding:4px 28px 6px;font-weight:900;font-size:46px;letter-spacing:.01em;background:rgba(8,14,28,.82);text-transform:uppercase}
h1{position:absolute;left:84px;right:84px;bottom:235px;font-weight:800;line-height:1.16;letter-spacing:-.01em;text-shadow:0 2px 18px rgba(0,0,0,.35)}
h1 .hl{text-shadow:none}
.cover-logo{position:absolute;left:0;right:0;bottom:78px;display:flex;justify-content:center}
.logo{display:flex;align-items:center;gap:14px;font-weight:800;letter-spacing:.02em;text-transform:uppercase}
.logo.md{font-size:36px}.logo.sm{font-size:24px}
.logo-mark{display:inline-flex;align-items:center;justify-content:center;border:3px solid #fff;border-radius:8px;font-weight:900;background:var(--hlBg);color:var(--hlText)}
.logo.md .logo-mark{width:58px;height:58px;font-size:26px}.logo.sm .logo-mark{width:40px;height:40px;font-size:18px;border-width:2px}
.logo-img.md{height:64px}.logo-img.sm{height:44px}

/* Slides d'explication */
.top{position:absolute;left:0;right:0;top:0;height:640px;overflow:hidden}
.shade-top{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.1) 0%,rgba(0,0,0,0) 45%,var(--bg) 100%)}
.content{position:absolute;left:84px;right:84px;top:590px;bottom:140px;display:flex;flex-direction:column;justify-content:center;overflow:hidden}
.content>*{flex:none}
.content.centered{top:120px}
.kicker{align-self:flex-start;border:4px solid #fff;border-radius:24px;padding:2px 22px 4px;font-weight:900;font-size:34px;text-transform:uppercase;margin-bottom:30px;background:rgba(8,14,28,.6)}
h2{font-weight:800;line-height:1.16;margin-bottom:28px}
p{font-size:44px;line-height:1.42;font-weight:500;color:#E3E8F0}
.stat{font-weight:900;font-size:200px;line-height:1;color:var(--accent);margin-bottom:22px;letter-spacing:-.02em}
ol{list-style:none;display:flex;flex-direction:column;gap:26px}
li{display:flex;gap:28px;align-items:flex-start;font-size:42px;line-height:1.35;font-weight:500;color:#E3E8F0}
.num{flex:none;width:68px;height:68px;border-radius:50%;background:var(--hlBg);color:var(--hlText);display:flex;align-items:center;justify-content:center;font-weight:900;font-size:32px}
.qmark{font-family:Georgia,serif;font-size:220px;line-height:.55;color:var(--accent);height:110px}
blockquote{font-size:50px;line-height:1.3;font-weight:600;font-style:italic}
.author{margin-top:30px;font-size:32px;color:var(--muted)}
.foot{position:absolute;left:84px;right:84px;bottom:56px;display:flex;justify-content:space-between;align-items:center}
.page{font-size:26px;font-weight:700;color:var(--muted)}

/* CTA */
.shade-cta{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.35),rgba(0,0,0,.55))}
.cta-text{position:absolute;left:70px;right:70px;top:150px;text-align:center}
.cta-title{font-size:68px;font-weight:800;line-height:1.18;margin-bottom:24px}
.cta-sub{font-size:52px;font-weight:400;line-height:1.28;color:#fff}
.cta-sub strong{color:#fff;font-weight:700}
.phone{position:absolute;left:50%;transform:translateX(-50%);top:590px;width:660px;height:900px;border-radius:80px;background:#fff;border:16px solid #2b2b2e;box-shadow:0 30px 80px rgba(0,0,0,.6);color:#111;padding:80px 40px 0;overflow:hidden;zoom:1}
.notch{position:absolute;top:20px;left:50%;transform:translateX(-50%);width:190px;height:50px;border-radius:24px;background:#111}
.status{position:absolute;top:26px;left:50px;right:50px;display:flex;justify-content:space-between;font-size:26px;font-weight:700}
.status span:last-child{visibility:hidden}
.ph-head{display:flex;align-items:center;gap:22px;font-size:34px;margin:18px 0 28px}
.ph-head .chev{font-size:44px;line-height:1}.ph-head .dots{margin-left:auto;font-weight:900}
.ph-profile{display:flex;align-items:center;gap:26px;margin-bottom:18px}
.avatar{width:150px;height:150px;border-radius:50%;background:var(--bg);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;font-size:50px;outline:4px solid #e3c79a;outline-offset:4px;overflow:hidden;flex:none}
.avatar img{width:100%;height:100%;object-fit:cover}
.ph-name{font-weight:700;font-size:32px}.ph-cat{font-size:27px;color:#777;margin-top:4px}
.ph-bio{font-size:26px;line-height:1.45;margin-bottom:22px}
.ph-link{color:#375a9e;margin-top:4px}
.ph-btns{display:flex;gap:14px;font-size:28px;font-weight:700;margin-bottom:24px}
.ph-btns span{flex:1;text-align:center;padding:16px 0;border-radius:16px;background:#efefef}
.ph-btns .follow{background:#0095F6;color:#fff}
.hand{position:absolute;left:180px;top:1200px;font-size:72px}
.ph-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin:0 -40px}
.ph-grid div{aspect-ratio:4/5;background-size:cover;background-position:center 25%}
</style></head><body>${slides}
<script>
// Ajuste la taille du texte pour qu'il tienne dans sa zone (jamais sous le pied de page).
document.querySelectorAll('.content').forEach(c=>{
  const over=()=>c.scrollHeight-c.clientHeight;
  const top=c.parentElement.querySelector('.top');
  // 1) on réduit la photo (jusqu'à 240 px) pour laisser la place au texte
  if(over()>2&&top){const shift=Math.min(240,over()+40);c.style.top=(c.offsetTop-shift)+'px';top.style.height=(top.offsetHeight-shift)+'px';}
  // 2) si ça ne suffit pas, on réduit le texte
  for(let k=0;k<14&&over()>2;k++){
    c.querySelectorAll('h2,p,li,.stat,blockquote').forEach(el=>{el.style.fontSize=(parseFloat(getComputedStyle(el).fontSize)*0.94)+'px'});
  }
});
document.querySelectorAll('h1').forEach(h=>{for(let k=0;k<10&&h.getBoundingClientRect().top<230;k++)h.style.fontSize=(parseFloat(getComputedStyle(h).fontSize)*0.93)+'px'});
// Place la main 👉 à hauteur du bouton « S'abonner ».
document.querySelectorAll('.slide').forEach(sl=>{const p=sl.querySelector('.phone'),b=sl.querySelector('.follow'),h=sl.querySelector('.hand');if(!p||!b||!h)return;
const pr=p.getBoundingClientRect(),br=b.getBoundingClientRect(),sr=sl.getBoundingClientRect();
h.style.top=(br.top-sr.top+br.height/2-48)+'px';h.style.left=(pr.left-sr.left-62)+'px';});
</script>
</body></html>`;
}

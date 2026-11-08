// Template HTML des slides (1080 x 1350, format 4:5 Instagram / LinkedIn).
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// **mot** => mot surligné avec la couleur d'accent
const rich = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<mark>$1</mark>');

function titleSize(t, base) {
  const n = (t || "").length;
  if (n > 90) return base * 0.62;
  if (n > 65) return base * 0.75;
  if (n > 40) return base * 0.88;
  return base;
}

function slideInner(s, brand) {
  const kicker = s.kicker ? `<div class="kicker">${esc(s.kicker)}</div>` : "";
  switch (s.kind) {
    case "cover":
      return `<div class="cover">${kicker}
        <h1 style="font-size:${titleSize(s.title, 104)}px">${rich(s.title)}</h1>
        ${s.body ? `<p class="lead">${rich(s.body)}</p>` : ""}
        <div class="swipe">Swipez <span>→</span></div></div>`;
    case "stat":
      return `${kicker}<div class="stat" style="font-size:${s.stat.length > 7 ? Math.max(110, 230 * 7 / s.stat.length) : 230}px">${esc(s.stat)}</div>
        ${s.title ? `<h2>${rich(s.title)}</h2>` : ""}${s.body ? `<p>${rich(s.body)}</p>` : ""}`;
    case "list":
      return `${kicker}${s.title ? `<h2>${rich(s.title)}</h2>` : ""}
        <ol>${(s.bullets || []).map((b, i) => `<li><span class="num">${i + 1}</span><span>${rich(b)}</span></li>`).join("")}</ol>
        ${s.body ? `<p class="small">${rich(s.body)}</p>` : ""}`;
    case "quote":
      return `${kicker}<div class="qmark">“</div><blockquote>${rich(s.body || s.title)}</blockquote>
        ${s.body && s.title ? `<div class="author">— ${esc(s.title)}</div>` : ""}`;
    case "cta":
      return `<div class="cta"><div class="logo big">${esc(brand.name)}</div>
        <h2>${rich(s.title)}</h2>${s.body ? `<p>${rich(s.body)}</p>` : ""}
        <div class="actions"><span>❤️ Likez</span><span>🔁 Partagez</span><span>📌 Enregistrez</span></div></div>`;
    default:
      return `${kicker}${s.title ? `<h2 style="font-size:${titleSize(s.title, 76)}px">${rich(s.title)}</h2>` : ""}
        ${s.body ? `<p class="${s.title ? "" : "big"}">${rich(s.body)}</p>` : ""}`;
  }
}

export function renderHtml({ carousel, brand, sourceLabel }) {
  const t = brand.theme;
  const n = carousel.slides.length;
  const fonts = [t.font, t.titleFont].filter(Boolean).map((f) => `family=${f.replace(/ /g, "+")}:wght@400;600;800`).join("&");
  const slides = carousel.slides
    .map((s, i) => `<section class="slide k-${s.kind}" id="s${i + 1}">
      <div class="deco"></div>
      <header><div class="logo">${esc(brand.name)}</div><div class="page">${i + 1}/${n}</div></header>
      <main>${slideInner(s, brand)}</main>
      <footer><span>${esc(brand.handle)}</span>${i === 0 && sourceLabel ? `<span class="src">Source : ${esc(sourceLabel)}</span>` : ""}</footer>
      <div class="progress"><div style="width:${((i + 1) / n) * 100}%"></div></div>
    </section>`)
    .join("\n");

  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?${fonts}&display=block" rel="stylesheet">
<style>
:root{--bg:${t.bg};--bg2:${t.bg2};--text:${t.text};--muted:${t.muted};--accent:${t.accent};--accentText:${t.accentText};
--font:'${t.font}',system-ui,sans-serif;--title:'${t.titleFont}','${t.font}',system-ui,sans-serif}
*{box-sizing:border-box;margin:0;padding:0}
@page{size:1080px 1350px;margin:0}
body{background:#777;font-family:var(--font);color:var(--text)}
.slide{width:1080px;height:1350px;position:relative;overflow:hidden;background:linear-gradient(160deg,var(--bg) 0%,var(--bg2) 100%);
  padding:90px 96px 120px;display:flex;flex-direction:column;page-break-after:always}
.deco{position:absolute;right:-180px;top:-180px;width:520px;height:520px;border-radius:50%;border:70px solid var(--accent);opacity:.12}
header{display:flex;justify-content:space-between;align-items:center;font-weight:800;letter-spacing:.02em;position:relative}
.logo{font-family:var(--title);font-size:30px}
.logo.big{font-size:56px;margin-bottom:48px}
.page{font-size:26px;color:var(--muted)}
main{flex:1;display:flex;flex-direction:column;justify-content:center;position:relative}
footer{display:flex;justify-content:space-between;font-size:26px;color:var(--muted);position:relative}
.src{max-width:60%;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.progress{position:absolute;left:0;bottom:0;height:14px;width:100%;background:rgba(127,127,127,.25)}
.progress div{height:100%;background:var(--accent)}
.kicker{display:inline-block;align-self:flex-start;background:var(--accent);color:var(--accentText);font-weight:800;font-size:28px;
  letter-spacing:.08em;padding:12px 24px;border-radius:10px;margin-bottom:40px;text-transform:uppercase}
h1{font-family:var(--title);line-height:1.05;letter-spacing:-.01em}
h2{font-family:var(--title);font-size:68px;line-height:1.1;margin-bottom:36px}
p{font-size:42px;line-height:1.4}
p.big{font-size:54px;line-height:1.35;font-weight:600}
p.lead{margin-top:44px;color:var(--muted);font-size:40px}
p.small{font-size:34px;color:var(--muted);margin-top:30px}
mark{background:none;color:var(--accent)}
.cover{display:flex;flex-direction:column}
.swipe{margin-top:80px;font-size:34px;font-weight:800;color:var(--accent)}
.swipe span{display:inline-block;margin-left:10px}
.stat{font-family:var(--title);font-size:230px;line-height:1;color:var(--accent);margin-bottom:40px;letter-spacing:-.03em}
ol{list-style:none;display:flex;flex-direction:column;gap:34px}
li{display:flex;gap:30px;align-items:flex-start;font-size:42px;line-height:1.3}
.num{flex:none;width:72px;height:72px;border-radius:50%;background:var(--accent);color:var(--accentText);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:36px}
.qmark{font-family:Georgia,serif;font-size:260px;line-height:.6;color:var(--accent);height:130px}
blockquote{font-size:56px;line-height:1.3;font-weight:600;font-style:italic}
.author{margin-top:36px;font-size:34px;color:var(--muted)}
.cta{text-align:center;align-items:center;display:flex;flex-direction:column}
.cta h2{font-size:64px}
.actions{display:flex;gap:24px;margin-top:60px;font-size:32px;font-weight:600}
.actions span{border:3px solid var(--accent);border-radius:999px;padding:16px 28px}
</style></head><body>${slides}</body></html>`;
}

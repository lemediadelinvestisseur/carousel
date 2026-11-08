import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { renderHtml as classic } from "../../templates/carousel.mjs";
import { renderHtml as photo } from "../../templates/photo.mjs";
import { ROOT } from "./store.mjs";

const TEMPLATES = { classic, photo };

async function launch() {
  const opts = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
  return chromium.launch(opts);
}

function withLogo(brand) {
  if (!brand.logo) return brand;
  const file = path.join(ROOT, brand.logo);
  if (!fs.existsSync(file)) return brand;
  const ext = path.extname(file).slice(1).replace("jpg", "jpeg").replace("svg", "svg+xml");
  return { ...brand, logoDataUri: `data:image/${ext};base64,${fs.readFileSync(file).toString("base64")}` };
}

/** Rend chaque slide en PNG (1080x1350) + un PDF (format LinkedIn). Retourne la liste des fichiers. */
export async function renderCarousel({ carousel, brand, outDir, sourceLabel, images = [] }) {
  fs.mkdirSync(outDir, { recursive: true });
  const template = TEMPLATES[brand.template] || classic;
  const html = template({ carousel, brand: withLogo(brand), sourceLabel, images });

  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "networkidle", timeout: 45000 }).catch(() => {});
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => window.__fitDone || null); // ajustement du texte après chargement des polices
    await page.evaluate(() => Promise.all([...document.images].map((i) => (i.complete ? 0 : new Promise((r) => (i.onload = i.onerror = r))))));
    const files = [];
    for (let i = 1; i <= carousel.slides.length; i++) {
      const file = `slide-${String(i).padStart(2, "0")}.jpg`;
      await page.locator(`#s${i}`).screenshot({ path: path.join(outDir, file), type: "jpeg", quality: 90 });
      files.push(file);
    }
    await page.pdf({ path: path.join(outDir, "carousel.pdf"), width: "1080px", height: "1350px", printBackground: true });
    files.push("carousel.pdf");
    return files;
  } finally {
    await browser.close();
  }
}

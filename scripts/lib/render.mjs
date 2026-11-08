import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { renderHtml } from "../../templates/carousel.mjs";

async function launch() {
  const opts = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};
  return chromium.launch(opts);
}

/** Rend chaque slide en PNG (1080x1350) + un PDF (format LinkedIn). Retourne la liste des fichiers. */
export async function renderCarousel({ carousel, brand, outDir, sourceLabel }) {
  fs.mkdirSync(outDir, { recursive: true });
  const html = renderHtml({ carousel, brand, sourceLabel });
  fs.writeFileSync(path.join(outDir, "carousel.html"), html);

  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
    await page.evaluate(() => document.fonts.ready);
    const files = [];
    for (let i = 1; i <= carousel.slides.length; i++) {
      const file = `slide-${String(i).padStart(2, "0")}.png`;
      await page.locator(`#s${i}`).screenshot({ path: path.join(outDir, file) });
      files.push(file);
    }
    await page.pdf({ path: path.join(outDir, "carousel.pdf"), width: "1080px", height: "1350px", printBackground: true });
    files.push("carousel.pdf");
    return files;
  } finally {
    await browser.close();
  }
}

// Régénère les visuels d'exemple (docs/exemples) après une modification du template.
import { renderCarousel } from "./lib/render.mjs";
import { readJson } from "./lib/store.mjs";
const brands = readJson("config/brands.json");
const demo = readJson("templates/demo.json");
for (const [key, brand] of Object.entries(brands)) {
  const carousel = { ...demo, slides: demo.slides.map((s) => (s.kind === "cta" ? { ...s, title: brand.cta, body: brand.handle } : s)) };
  await renderCarousel({ carousel, brand, outDir: `docs/exemples/${key}`, sourceLabel: "Exemple" });
  console.log(`✓ docs/exemples/${key}`);
}

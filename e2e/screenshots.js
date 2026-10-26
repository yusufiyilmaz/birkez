// README için ekran görüntüleri: docs/screenshots/*.png
//   npm run screenshots
import { mkdirSync, writeFileSync } from "node:fs";
import { startSession, waitFor } from "./harness.js";

const OUT = "docs/screenshots";
mkdirSync(OUT, { recursive: true });
const s = await startSession({ port: 8798, debugPort: 9334 });

async function viewport(width, height, dark = false) {
  await s.page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile: width < 500 });
  await s.page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: dark ? "dark" : "light" }] });
}

async function shot(name) {
  await s.evaluate("document.fonts.ready.then(() => true)");
  const { data } = await s.page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(data, "base64"));
  console.log(`✓ ${OUT}/${name}.png`);
}

try {
  await viewport(1000, 820);
  await s.open(`${s.base}/`);
  await s.type("note", "Ev Wi-Fi şifresi: Yilmaz_Ev / Çok$Gizli_2026");
  await shot("1-yaz");

  const link = await s.createNote("Ev Wi-Fi şifresi: Yilmaz_Ev / Çok$Gizli_2026", "kedi123");
  await s.evaluate(`document.activeElement.blur(); getSelection().removeAllRanges()`);
  await shot("2-link");

  await s.open(link);
  await waitFor(() => s.visible("confirm"), "onay ekranı");
  await shot("3-parola");

  await s.type("password", "kedi123");
  await s.click("reveal");
  await waitFor(() => s.visible("shown"), "not ekranı");
  await shot("4-not");

  await s.open(link);
  await waitFor(() => s.visible("gone"), "not yok ekranı");
  await shot("5-yok");

  await viewport(390, 844, true);
  await s.open(`${s.base}/`);
  await shot("6-telefon-karanlik");
} finally {
  await s.close();
}

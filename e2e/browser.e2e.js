// Tarayıcı testleri: gerçek sunucu + gerçek tarayıcıda bir kullanıcının yapacaklarını dener.
//   npm run test:e2e        (tarayıcı yolu farklıysa: CHROME_PATH=... npm run test:e2e)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startSession, waitFor } from "./harness.js";

let s;
before(async () => {
  s = await startSession();
});
after(() => s?.close());

test("not yaz -> link al -> alıcı açar -> not görünür -> ikinci açılışta yoktur", async () => {
  const secret = "Wi-Fi: Yilmaz_Ev / şifre: Çok$Gizli_2026 🔐";
  const link = await s.createNote(secret);
  assert.match(link, new RegExp(`^${s.base}/n/[A-Za-z0-9_-]{22}#[A-Za-z0-9_-]{43}$`));
  assert.equal(await s.evaluate(`document.getElementById("note").value`), "", "açık metin sayfada kalmamalı");

  await s.open(link);
  await waitFor(() => s.visible("confirm"), "onay ekranı");
  assert.equal(await s.evaluate("location.hash"), "", "anahtar adres çubuğundan silinmeli");
  assert.equal(await s.visible("password"), false);

  await s.click("reveal");
  await waitFor(() => s.visible("shown"), "not ekranı");
  assert.equal(await s.text("secret"), secret);

  await s.open(link);
  await waitFor(() => s.visible("gone"), "not yok ekranı");
  assert.equal(await s.text("gone-title"), "Bu not artık yok");
});

test("parolalı not: yanlış parola notu yakmaz, doğru parola açar", async () => {
  const link = await s.createNote("parolalı IBAN TR12 3456", "kedi123");
  assert.equal(await s.visible("password-tip"), true);

  await s.open(link);
  await waitFor(() => s.visible("confirm"), "onay ekranı");
  assert.equal(await s.visible("password"), true);

  await s.type("password", "yanlis");
  await s.click("reveal");
  await waitFor(() => s.visible("error"), "yanlış parola mesajı");
  assert.match(await s.text("error"), /Parola yanlış\. 4 deneme/);

  await s.type("password", "kedi123");
  await s.click("reveal");
  await waitFor(() => s.visible("shown"), "not ekranı");
  assert.equal(await s.text("secret"), "parolalı IBAN TR12 3456");
});

test("anahtarı eksik link notu yakmadan uyarır; tam link aynı sekmede açılır", async () => {
  const link = await s.createNote("eksik link testi");
  await s.open(link.split("#")[0]);
  await waitFor(() => s.visible("gone"), "uyarı ekranı");
  assert.equal(await s.text("gone-title"), "Link eksik");

  await s.open(link); // sadece # kısmı değişiyor: sayfa yine de baştan çalışmalı
  await waitFor(() => s.visible("confirm"), "onay ekranı");
});

test("boş not gönderilemez", async () => {
  await s.open(`${s.base}/`);
  await s.type("note", "   ");
  await s.evaluate(`document.getElementById("create").requestSubmit()`);
  await waitFor(() => s.visible("error"), "hata mesajı");
  assert.equal(await s.visible("done"), false);
});

test("sayfalarda CSP ihlali ya da yakalanmamış JavaScript hatası yok", () => {
  assert.deepEqual(s.problems, []);
});

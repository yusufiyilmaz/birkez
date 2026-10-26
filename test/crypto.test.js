import { test } from "node:test";
import assert from "node:assert/strict";
import { encryptNote, decryptNote, deriveKey, authToken, toBase64Url, fromBase64Url } from "../public/crypto.js";

test("şifrelenen not aynı anahtarla geri çözülür", async () => {
  const note = "Wi-Fi şifresi: Çok$Gizli_2026 🔐";
  const enc = await encryptNote(note);
  assert.equal(await decryptNote(enc), note);
});

test("şifreli veri notun kendisini içermez", async () => {
  const enc = await encryptNote("TR12 3456 7890");
  assert.ok(!enc.ciphertext.includes("TR12"));
});

test("aynı not iki kez şifrelenince farklı sonuç çıkar (her seferinde yeni anahtar ve iv)", async () => {
  const a = await encryptNote("aynı not");
  const b = await encryptNote("aynı not");
  assert.notEqual(a.key, b.key);
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ciphertext, b.ciphertext);
});

test("yanlış anahtarla çözülemez", async () => {
  const enc = await encryptNote("gizli");
  const other = await encryptNote("başka");
  await assert.rejects(decryptNote({ ...enc, key: other.key }), /çözülemedi/);
});

test("şifreli verinin tek harfi değişse bile çözülmez (bütünlük kontrolü)", async () => {
  const enc = await encryptNote("gizli");
  const flipped = enc.ciphertext[0] === "A" ? "B" : "A";
  await assert.rejects(decryptNote({ ...enc, ciphertext: flipped + enc.ciphertext.slice(1) }), /çözülemedi/);
});

test("anahtar linke uygun: 43 karakter, sadece base64url harfleri", async () => {
  const { key } = await encryptNote("x");
  assert.match(key, /^[A-Za-z0-9_-]{43}$/);
});

test("boş ve çok uzun not reddedilir", async () => {
  await assert.rejects(encryptNote("   "), /boş/);
  await assert.rejects(encryptNote("a".repeat(10_001)), /en fazla/);
});

test("parolalı not: link + doğru parola ile çözülür", async () => {
  const enc = await encryptNote("parolalı gizli", "kedi123");
  assert.match(enc.salt, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(await decryptNote({ ...enc, password: "kedi123" }), "parolalı gizli");
});

test("parolalı not: link tek başına ya da yanlış parola yetmez", async () => {
  const enc = await encryptNote("parolalı gizli", "kedi123");
  await assert.rejects(decryptNote({ ...enc, password: "" }), /parolayla korunuyor/);
  await assert.rejects(decryptNote({ ...enc, password: "kedi124" }), /çözülemedi/);
});

test("okuma fişi: aynı anahtar ve parola aynı fişi verir, yanlış parola farklı fiş verir", async () => {
  const enc = await encryptNote("x", "kedi123");
  const right = await authToken(await deriveKey({ key: enc.key, password: "kedi123", salt: enc.salt }));
  const wrong = await authToken(await deriveKey({ key: enc.key, password: "kedi12", salt: enc.salt }));
  assert.equal(right, enc.token);
  assert.notEqual(wrong, enc.token);
});

test("okuma fişi anahtarı ele vermez", async () => {
  const enc = await encryptNote("x");
  assert.notEqual(enc.token, enc.key);
  assert.equal(enc.salt, null);
  assert.equal(await authToken(await deriveKey({ key: enc.key })), enc.token);
});

test("base64url gidiş-dönüş", () => {
  const bytes = Uint8Array.from([0, 255, 62, 63, 250, 1]);
  assert.deepEqual(fromBase64Url(toBase64Url(bytes)), bytes);
});

// Notu tarayıcıda şifreleyen / çözen fonksiyonlar (AES-256-GCM, Web Crypto API).
// Aynı dosya hem tarayıcıda hem Node'da (testler) çalışır.
//
// Anahtar sunucuya hiç gitmez: linkin # kısmında taşınır, tarayıcılar o kısmı sunucuya göndermez.
//
// İsteğe bağlı ek parola: asıl anahtar = link anahtarı XOR PBKDF2(parola). Notu açmak için
// ikisi birden gerekir; link başkasının eline geçse bile parolasız not çözülemez.
//
// Okuma fişi (token): asıl anahtardan türetilir. Sunucu notu sadece doğru fişi getirene verir;
// böylece yanlış parola notu yakmaz ve linkin sadece numarasını bilen biri notu silemez.

const MAX_LENGTH = 10_000; // karakter
const MAX_PASSWORD = 200;
export const PBKDF2_ITERATIONS = 600_000; // OWASP'ın PBKDF2-SHA256 önerisi

// Base64url: linkte sorun çıkarmayan base64 (+ yerine -, / yerine _, = yok)
export function toBase64Url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(text) {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function importAesKey(rawKey, usage) {
  return crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, [usage]);
}

// Paroladan 256 bit üretir. Yavaş olması bilerek: parola tahmini yapan biri her denemede bunu öder.
async function passwordBytes(password, salt) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    base,
    256,
  );
  return new Uint8Array(bits);
}

const xor = (a, b) => a.map((x, i) => x ^ b[i]);

/** Notu açan asıl anahtar: parola yoksa link anahtarının kendisi. */
export async function deriveKey({ key, password = "", salt = null }) {
  const linkKey = fromBase64Url(key);
  if (linkKey.length !== 32) throw new Error("Linkteki anahtar geçersiz.");
  if (!salt) return linkKey;
  if (!password) throw new Error("Bu not parolayla korunuyor.");
  return xor(linkKey, await passwordBytes(password, fromBase64Url(salt)));
}

/** Sunucuya gösterilen okuma fişi. Anahtar ondan geri hesaplanamaz (SHA-256). */
export async function authToken(rawKey) {
  const label = new TextEncoder().encode("birkez-okuma-fisi:");
  const data = new Uint8Array(label.length + rawKey.length);
  data.set(label);
  data.set(rawKey, label.length);
  return toBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", data)));
}

/**
 * Notu şifreler.
 * @returns {{ciphertext, iv, salt, token, key}} hepsi base64url.
 *   ciphertext, iv, salt ve token sunucuya gider; key sadece linkin # kısmına yazılır.
 */
export async function encryptNote(text, password = "") {
  if (!text || !text.trim()) throw new Error("Not boş olamaz.");
  if (text.length > MAX_LENGTH) throw new Error(`Not en fazla ${MAX_LENGTH} karakter olabilir.`);
  if (password.length > MAX_PASSWORD) throw new Error(`Parola en fazla ${MAX_PASSWORD} karakter olabilir.`);

  const linkKey = crypto.getRandomValues(new Uint8Array(32)); // 256 bit, her not için yeni
  const salt = password ? crypto.getRandomValues(new Uint8Array(16)) : null;
  const rawKey = password ? xor(linkKey, await passwordBytes(password, salt)) : linkKey;
  const iv = crypto.getRandomValues(new Uint8Array(12)); // GCM için önerilen 96 bit

  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await importAesKey(rawKey, "encrypt"),
    new TextEncoder().encode(text),
  );

  return {
    ciphertext: toBase64Url(new Uint8Array(encrypted)),
    iv: toBase64Url(iv),
    salt: salt && toBase64Url(salt),
    token: await authToken(rawKey),
    key: toBase64Url(linkKey),
  };
}

/**
 * Şifreli notu çözer. `rawKey` verilirse onu kullanır (deriveKey bir kez çalışsın diye),
 * yoksa key + password + salt'tan hesaplar. Anahtar yanlışsa ya da veri değiştirilmişse
 * hata verir (GCM, verinin bütünlüğünü de doğrular).
 */
export async function decryptNote({ ciphertext, iv, key, password, salt, rawKey }) {
  const cryptoKey = await importAesKey(rawKey || (await deriveKey({ key, password, salt })), "decrypt");
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64Url(iv) },
      cryptoKey,
      fromBase64Url(ciphertext),
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error("Not çözülemedi: anahtar yanlış ya da not değiştirilmiş.");
  }
}

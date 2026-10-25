// Notu tarayıcıda şifreleyen / çözen fonksiyonlar (AES-256-GCM, Web Crypto API).
// Aynı dosya hem tarayıcıda hem Node'da (testler) çalışır.
//
// Anahtar sunucuya hiç gitmez: linkin # kısmında taşınır, tarayıcılar o kısmı sunucuya göndermez.

const MAX_LENGTH = 10_000; // karakter

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

async function importKey(rawKey, usage) {
  return crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, [usage]);
}

/**
 * Notu şifreler.
 * @returns {{ciphertext: string, iv: string, key: string}} hepsi base64url.
 *   ciphertext + iv sunucuya gider, key sadece linkin # kısmına yazılır.
 */
export async function encryptNote(text) {
  if (!text || !text.trim()) throw new Error("Not boş olamaz.");
  if (text.length > MAX_LENGTH) throw new Error(`Not en fazla ${MAX_LENGTH} karakter olabilir.`);

  const rawKey = crypto.getRandomValues(new Uint8Array(32)); // 256 bit, her not için yeni
  const iv = crypto.getRandomValues(new Uint8Array(12)); // GCM için önerilen 96 bit
  const key = await importKey(rawKey, "encrypt");
  const data = new TextEncoder().encode(text);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);

  return {
    ciphertext: toBase64Url(new Uint8Array(encrypted)),
    iv: toBase64Url(iv),
    key: toBase64Url(rawKey),
  };
}

/**
 * Şifreli notu çözer. Anahtar yanlışsa ya da veri değiştirilmişse hata verir
 * (GCM, verinin bütünlüğünü de doğrular).
 */
export async function decryptNote({ ciphertext, iv, key }) {
  const rawKey = fromBase64Url(key);
  if (rawKey.length !== 32) throw new Error("Linkteki anahtar geçersiz.");
  const cryptoKey = await importKey(rawKey, "decrypt");
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

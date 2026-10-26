// birkez sunucusu (Cloudflare Worker + D1).
//
// Sunucu sadece şifreli notu saklar ve bir kez teslim eder. Anahtar linkin # kısmında
// kaldığı için sunucuya hiç gelmez; yani sunucu (ve veritabanını çalan biri) notu okuyamaz.
//
//   POST /api/notes             { ciphertext, iv, ttl, token, salt? } -> 201 { id, expiresAt }
//   GET  /api/notes/:id         not duruyor mu, parolalı mı?          -> 200 { exists, protected, salt }
//   POST /api/notes/:id/read    { token } notu ver ve SİL             -> 200 { ciphertext, iv } | 403 | 404
//   GET  /n/:id                 okuma sayfası (read.html)
//
// Okuma fişi (token) anahtardan türetilir; sunucu sadece SHA-256 özetini saklar. Doğru fişi
// getiremeyen (yanlış parola, eksik link) notu alamaz ve yakamaz; MAX_ATTEMPTS yanlış denemeden
// sonra not güvenlik için silinir.

import { TTL_OPTIONS, MAX_ATTEMPTS } from "./limits.js";

const MAX_CIPHERTEXT = 60_000; // 10.000 karakterlik not (UTF-8 + base64) bunun altında kalır
const ID_RE = /^[A-Za-z0-9_-]{22}$/; // 16 bayt = 128 bit
const IV_RE = /^[A-Za-z0-9_-]{16}$/; // 12 bayt
const SALT_RE = /^[A-Za-z0-9_-]{22}$/; // 16 bayt
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/; // SHA-256 = 32 bayt
const B64URL_RE = /^[A-Za-z0-9_-]+$/;
const GONE = "Bu not yok: daha önce okunmuş ya da süresi dolmuş.";

const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
    "connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Cross-Origin-Opener-Policy": "same-origin",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...SECURITY_HEADERS },
  });
}

const error = (message, status) => json({ error: message }, status);
const nowSeconds = () => Math.floor(Date.now() / 1000);

async function sha256(text) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function readJson(request) {
  try {
    return (await request.json()) || {};
  } catch {
    return null;
  }
}

function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function createNote(request, env) {
  if (!(request.headers.get("Content-Type") || "").includes("application/json")) {
    return error("İstek JSON olmalı.", 415);
  }
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > MAX_CIPHERTEXT + 1000) return error("Not çok büyük.", 413);

  const body = await readJson(request);
  if (!body) return error("Geçersiz JSON.", 400);
  const { ciphertext, iv, ttl, token, salt = null } = body;
  if (typeof ciphertext !== "string" || !B64URL_RE.test(ciphertext) || ciphertext.length > MAX_CIPHERTEXT) {
    return error("Şifreli not geçersiz.", 400);
  }
  if (typeof iv !== "string" || !IV_RE.test(iv)) return error("IV geçersiz.", 400);
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return error("Okuma fişi geçersiz.", 400);
  if (salt !== null && (typeof salt !== "string" || !SALT_RE.test(salt))) return error("Tuz geçersiz.", 400);
  if (!(String(ttl) in TTL_OPTIONS)) return error("Süre 1 saat, 1 gün ya da 7 gün olmalı.", 400);

  const id = newId();
  const created = nowSeconds();
  const expiresAt = created + Number(ttl);
  await env.DB.prepare(
    "INSERT INTO notes (id, ciphertext, iv, created_at, expires_at, auth_hash, salt) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(id, ciphertext, iv, created, expiresAt, await sha256(token), salt)
    .run();
  return json({ id, expiresAt }, 201);
}

async function noteExists(id, env) {
  const row = await env.DB.prepare("SELECT salt FROM notes WHERE id = ? AND expires_at > ?").bind(id, nowSeconds()).first();
  return json({ exists: Boolean(row), protected: Boolean(row?.salt), salt: row?.salt || null });
}

async function readNote(id, request, env) {
  const body = await readJson(request);
  const token = body?.token;
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return error("Okuma fişi eksik.", 400);
  const now = nowSeconds();

  // Okuma ve silme tek sorguda: aynı anda iki istek gelse bile notu sadece biri alır.
  // Fiş tutmazsa satır silinmez, not yanmaz.
  const row = await env.DB.prepare(
    "DELETE FROM notes WHERE id = ? AND expires_at > ? AND auth_hash = ? RETURNING ciphertext, iv",
  )
    .bind(id, now, await sha256(token))
    .first();
  if (row) return json({ ciphertext: row.ciphertext, iv: row.iv });

  // Not var ama fiş yanlış: denemeyi say, sınır aşılırsa notu sil
  const wrong = await env.DB.prepare(
    "UPDATE notes SET attempts = attempts + 1 WHERE id = ? AND expires_at > ? RETURNING attempts",
  )
    .bind(id, now)
    .first();
  if (!wrong) return error(GONE, 404);
  const remaining = MAX_ATTEMPTS - wrong.attempts;
  if (remaining <= 0) {
    await env.DB.prepare("DELETE FROM notes WHERE id = ?").bind(id).run();
    return error("Çok fazla yanlış deneme yapıldı; not güvenlik için silindi.", 404);
  }
  return json({ error: `Parola yanlış. ${remaining} deneme hakkın kaldı.`, remaining }, 403);
}

async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const method = request.method;

  if (pathname === "/api/notes") {
    return method === "POST" ? createNote(request, env) : error("Yöntem desteklenmiyor.", 405);
  }
  const m = pathname.match(/^\/api\/notes\/([^/]+)(\/read)?$/);
  if (m) {
    const [, id, read] = m;
    if (!ID_RE.test(id)) return error(GONE, 404);
    // Okuma POST ile: link önizleme botları ve tarayıcı ön yüklemeleri GET yapar, notu yakamaz.
    if (read) return method === "POST" ? readNote(id, request, env) : error("Yöntem desteklenmiyor.", 405);
    return method === "GET" ? noteExists(id, env) : error("Yöntem desteklenmiyor.", 405);
  }
  if (pathname.startsWith("/api/")) return error("Bulunamadı.", 404);

  if (/^\/n\/[^/]+$/.test(pathname) && env.ASSETS) {
    const page = await env.ASSETS.fetch(new URL("/read.html", request.url));
    if (!page.ok) return error("Bulunamadı.", 404);
    const res = new Response(page.body, page);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
    res.headers.set("Cache-Control", "no-store");
    return res;
  }
  return error("Bulunamadı.", 404);
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (e) {
      console.error(e);
      return error("Sunucu hatası.", 500);
    }
  },

  // Saatte bir: süresi dolmuş, okunmamış notları sil
  async scheduled(event, env) {
    await env.DB.prepare("DELETE FROM notes WHERE expires_at <= ?").bind(nowSeconds()).run();
  },
};

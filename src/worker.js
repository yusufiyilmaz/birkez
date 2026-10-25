// birkez sunucusu (Cloudflare Worker + D1).
//
// Sunucu sadece şifreli notu saklar ve bir kez teslim eder. Anahtar linkin # kısmında
// kaldığı için sunucuya hiç gelmez; yani sunucu (ve veritabanını çalan biri) notu okuyamaz.
//
//   POST /api/notes             { ciphertext, iv, ttl }  -> 201 { id, expiresAt }
//   GET  /api/notes/:id         not hâlâ duruyor mu?      -> 200 { exists }
//   POST /api/notes/:id/read    notu ver ve SİL          -> 200 { ciphertext, iv } | 404
//   GET  /n/:id                 okuma sayfası (read.html)

export const TTL_OPTIONS = { 3600: "1 saat", 86400: "1 gün", 604800: "7 gün" };
const MAX_CIPHERTEXT = 60_000; // 10.000 karakterlik not (UTF-8 + base64) bunun altında kalır
const ID_RE = /^[A-Za-z0-9_-]{22}$/; // 16 bayt = 128 bit
const IV_RE = /^[A-Za-z0-9_-]{16}$/; // 12 bayt
const B64URL_RE = /^[A-Za-z0-9_-]+$/;

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

  let body;
  try {
    body = await request.json();
  } catch {
    return error("Geçersiz JSON.", 400);
  }
  const { ciphertext, iv, ttl } = body || {};
  if (typeof ciphertext !== "string" || !B64URL_RE.test(ciphertext) || ciphertext.length > MAX_CIPHERTEXT) {
    return error("Şifreli not geçersiz.", 400);
  }
  if (typeof iv !== "string" || !IV_RE.test(iv)) return error("IV geçersiz.", 400);
  if (!(String(ttl) in TTL_OPTIONS)) return error("Süre 1 saat, 1 gün ya da 7 gün olmalı.", 400);

  const id = newId();
  const created = nowSeconds();
  const expiresAt = created + Number(ttl);
  await env.DB.prepare("INSERT INTO notes (id, ciphertext, iv, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, ciphertext, iv, created, expiresAt)
    .run();
  return json({ id, expiresAt }, 201);
}

async function noteExists(id, env) {
  const row = await env.DB.prepare("SELECT 1 FROM notes WHERE id = ? AND expires_at > ?").bind(id, nowSeconds()).first();
  return json({ exists: Boolean(row) });
}

async function readNote(id, env) {
  // Okuma ve silme tek sorguda: aynı anda iki istek gelse bile notu sadece biri alır.
  const row = await env.DB.prepare("DELETE FROM notes WHERE id = ? AND expires_at > ? RETURNING ciphertext, iv")
    .bind(id, nowSeconds())
    .first();
  if (!row) return error("Bu not yok: daha önce okunmuş ya da süresi dolmuş.", 404);
  return json({ ciphertext: row.ciphertext, iv: row.iv });
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
    if (!ID_RE.test(id)) return error("Bu not yok: daha önce okunmuş ya da süresi dolmuş.", 404);
    // Okuma POST ile: link önizleme botları ve tarayıcı ön yüklemeleri GET yapar, notu yakamaz.
    if (read) return method === "POST" ? readNote(id, env) : error("Yöntem desteklenmiyor.", 405);
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

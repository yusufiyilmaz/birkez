// Sunucu testleri: Worker kodunu yerel (geçici) bir D1 veritabanıyla çalıştırır.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { getPlatformProxy } from "wrangler";
import worker from "../src/worker.js";
import { MAX_ATTEMPTS } from "../src/limits.js";
import { encryptNote, decryptNote, deriveKey, authToken } from "../public/crypto.js";

let proxy, env;

test("worker.js sadece istek işleyicisi dışa aktarır (yoksa Cloudflare'de açılmaz)", async () => {
  const mod = await import("../src/worker.js");
  assert.deepEqual(Object.keys(mod), ["default"]);
});

before(async () => {
  proxy = await getPlatformProxy({ configPath: "wrangler.jsonc", persist: false });
  env = proxy.env;
  for (const file of readdirSync("migrations").sort()) {
    const sql = readFileSync(`migrations/${file}`, "utf8").replace(/--.*$/gm, "");
    for (const stmt of sql.split(";").map((s) => s.trim()).filter(Boolean)) {
      await env.DB.prepare(stmt).run();
    }
  }
});

after(async () => {
  await proxy?.dispose();
});

const BASE = "http://birkez.test";
// Her istek farklı bir IP'den geliyormuş gibi: testler hız sınırına takılmasın
const randomIp = () => `10.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`;
const call = (path, init = {}) =>
  worker.fetch(new Request(BASE + path, { ...init, headers: { "CF-Connecting-IP": randomIp(), ...init.headers } }), env);
const post = (path, body, headers = { "Content-Type": "application/json" }) =>
  call(path, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });

const payload = (enc, ttl = 3600) => ({ ciphertext: enc.ciphertext, iv: enc.iv, salt: enc.salt, token: enc.token, ttl });
const read = (id, token) => post(`/api/notes/${id}/read`, { token });

async function createNote(text = "test notu", password = "") {
  const enc = await encryptNote(text, password);
  const res = await post("/api/notes", payload(enc));
  return { res, enc, data: await res.json() };
}

test("not kaydedilir, bir kez okunur, ikinci okumada yoktur", async () => {
  const { res, enc, data } = await createNote();
  assert.equal(res.status, 201);
  assert.match(data.id, /^[A-Za-z0-9_-]{22}$/);

  assert.deepEqual(await (await call(`/api/notes/${data.id}`)).json(), { exists: true, protected: false, salt: null });

  assert.equal((await read(data.id, enc.token)).status, 200);
  assert.equal((await read(data.id, enc.token)).status, 404);
  assert.equal((await (await call(`/api/notes/${data.id}`)).json()).exists, false);
});

test("uçtan uca: tarayıcıda şifrele -> sunucu -> tarayıcıda çöz", async () => {
  const secret = "IBAN: TR12 0006 4000 0011 2345 6789 01";
  const { enc, data } = await createNote(secret);
  const stored = await (await read(data.id, enc.token)).json();
  assert.equal(await decryptNote({ ...stored, key: enc.key }), secret);
});

test("uçtan uca parolalı: alıcı linkle ve parolayla fişi hesaplar, notu açar", async () => {
  const { enc, data } = await createNote("parolalı IBAN", "kedi123");
  const info = await (await call(`/api/notes/${data.id}`)).json();
  assert.equal(info.protected, true);

  const rawKey = await deriveKey({ key: enc.key, password: "kedi123", salt: info.salt });
  const stored = await (await read(data.id, await authToken(rawKey))).json();
  assert.equal(await decryptNote({ ...stored, rawKey }), "parolalı IBAN");
});

test("yanlış parola notu yakmaz, kalan hakkı söyler; doğru parola sonra yine açar", async () => {
  const { enc, data } = await createNote("gizli", "kedi123");
  const wrongKey = await deriveKey({ key: enc.key, password: "yanlis", salt: enc.salt });
  const res = await read(data.id, await authToken(wrongKey));
  assert.equal(res.status, 403);
  assert.equal((await res.json()).remaining, MAX_ATTEMPTS - 1);
  assert.equal((await read(data.id, enc.token)).status, 200);
});

test(`${MAX_ATTEMPTS} yanlış denemeden sonra not silinir`, async () => {
  const { enc, data } = await createNote("gizli", "kedi123");
  const wrongToken = await authToken(await deriveKey({ key: enc.key, password: "yanlis", salt: enc.salt }));
  for (let i = 1; i < MAX_ATTEMPTS; i++) assert.equal((await read(data.id, wrongToken)).status, 403);
  assert.equal((await read(data.id, wrongToken)).status, 404);
  assert.equal((await read(data.id, enc.token)).status, 404); // doğru parola da artık geç
});

test("linkin sadece numarasını bilen biri (anahtar yok) notu alamaz", async () => {
  const { enc, data } = await createNote();
  const guess = (await encryptNote("başka")).token;
  assert.equal((await read(data.id, guess)).status, 403);
  assert.equal((await post(`/api/notes/${data.id}/read`, {})).status, 400);
  assert.equal((await read(data.id, enc.token)).status, 200);
});

test("veritabanında notun açık hali, anahtar, parola ve fişin kendisi yoktur", async () => {
  const { enc, data } = await createNote("veritabanında görünmemeli", "kedi123");
  const dump = JSON.stringify(await env.DB.prepare("SELECT * FROM notes WHERE id = ?").bind(data.id).first());
  for (const secret of ["görünmemeli", enc.key, "kedi123", enc.token]) assert.ok(!dump.includes(secret));
});

test("aynı anda üç okuma isteği: notu sadece biri alır", async () => {
  const { enc, data } = await createNote();
  const results = await Promise.all([1, 2, 3].map(() => read(data.id, enc.token)));
  assert.equal(results.filter((r) => r.status === 200).length, 1);
});

test("okuma GET ile yapılamaz (link önizleme botları notu yakamaz)", async () => {
  const { data } = await createNote();
  assert.equal((await call(`/api/notes/${data.id}/read`)).status, 405);
  assert.equal((await (await call(`/api/notes/${data.id}`)).json()).exists, true);
});

test("süresi dolmuş not okunamaz ve temizlikte silinir", async () => {
  const past = Math.floor(Date.now() / 1000) - 10;
  const token = (await encryptNote("x")).token;
  await env.DB.prepare(
    "INSERT INTO notes (id, ciphertext, iv, created_at, expires_at, auth_hash) VALUES ('eskiNotEskiNotEskiNot1', 'AAAA', 'AAAAAAAAAAAAAAAA', ?, ?, 'x')",
  )
    .bind(past - 3600, past)
    .run();
  assert.equal((await read("eskiNotEskiNotEskiNot1", token)).status, 404);

  await worker.scheduled({}, env);
  const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM notes WHERE expires_at <= ?").bind(past + 10).first();
  assert.equal(left.n, 0);
});

test("geçersiz istekler reddedilir", async () => {
  const enc = await encryptNote("x");
  const ok = payload(enc);
  assert.equal((await post("/api/notes", { ...ok, token: undefined })).status, 400);
  assert.equal((await post("/api/notes", { ...ok, salt: "kisa" })).status, 400);
  assert.equal((await post("/api/notes", { ...ok, ttl: 999 })).status, 400);
  assert.equal((await post("/api/notes", { ...ok, iv: "kisa" })).status, 400);
  assert.equal((await post("/api/notes", { ...ok, ciphertext: "<script>" })).status, 400);
  assert.equal((await post("/api/notes", { ...ok, ciphertext: "A".repeat(60_001) })).status, 400);
  assert.equal((await post("/api/notes", "{bozuk")).status, 400);
  assert.equal((await post("/api/notes", ok, { "Content-Type": "text/plain" })).status, 415);
  assert.equal((await call("/api/notes")).status, 405);
  assert.equal((await read("kisa-id", enc.token)).status, 404);
  assert.equal((await read("AAAAAAAAAAAAAAAAAAAAAA", enc.token)).status, 404);
});

test("hız sınırı: aynı IP dakikada 10'dan fazla not oluşturamaz", async () => {
  const enc = await encryptNote("spam");
  const headers = { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.7" };
  const statuses = [];
  for (let i = 0; i < 12; i++) statuses.push((await post("/api/notes", payload(enc), headers)).status);
  assert.deepEqual(statuses.slice(0, 10), Array(10).fill(201));
  assert.deepEqual(statuses.slice(10), [429, 429]);
  // Başka bir IP etkilenmez
  assert.equal((await post("/api/notes", payload(enc))).status, 201);
});

test("API cevaplarında güvenlik başlıkları var ve önbelleğe alınmıyor", async () => {
  const { res } = await createNote();
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  assert.equal(res.headers.get("Referrer-Policy"), "no-referrer");
  assert.match(res.headers.get("Content-Security-Policy"), /frame-ancestors 'none'/);
});

// Sunucu testleri: Worker kodunu yerel (geçici) bir D1 veritabanıyla çalıştırır.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getPlatformProxy } from "wrangler";
import worker from "../src/worker.js";
import { encryptNote, decryptNote } from "../public/crypto.js";

let proxy, env;

before(async () => {
  proxy = await getPlatformProxy({ configPath: "wrangler.jsonc", persist: false });
  env = proxy.env;
  const sql = readFileSync("migrations/0001_notes.sql", "utf8").replace(/--.*$/gm, "");
  for (const stmt of sql.split(";").map((s) => s.trim()).filter(Boolean)) {
    await env.DB.prepare(stmt).run();
  }
});

after(async () => {
  await proxy?.dispose();
});

const BASE = "http://birkez.test";
const call = (path, init = {}) => worker.fetch(new Request(BASE + path, init), env);
const post = (path, body, headers = { "Content-Type": "application/json" }) =>
  call(path, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });

async function createNote(extra = {}) {
  const enc = await encryptNote("test notu");
  const res = await post("/api/notes", { ciphertext: enc.ciphertext, iv: enc.iv, ttl: 3600, ...extra });
  return { res, enc, data: await res.json() };
}

test("not kaydedilir, bir kez okunur, ikinci okumada yoktur", async () => {
  const { res, data } = await createNote();
  assert.equal(res.status, 201);
  assert.match(data.id, /^[A-Za-z0-9_-]{22}$/);

  assert.deepEqual(await (await call(`/api/notes/${data.id}`)).json(), { exists: true });

  const first = await post(`/api/notes/${data.id}/read`, "");
  assert.equal(first.status, 200);
  const second = await post(`/api/notes/${data.id}/read`, "");
  assert.equal(second.status, 404);
  assert.deepEqual(await (await call(`/api/notes/${data.id}`)).json(), { exists: false });
});

test("uçtan uca: tarayıcıda şifrele -> sunucu -> tarayıcıda çöz", async () => {
  const secret = "IBAN: TR12 0006 4000 0011 2345 6789 01";
  const enc = await encryptNote(secret);
  const { id } = await (await post("/api/notes", { ciphertext: enc.ciphertext, iv: enc.iv, ttl: 86400 })).json();
  const stored = await (await post(`/api/notes/${id}/read`, "")).json();
  assert.equal(await decryptNote({ ...stored, key: enc.key }), secret);
});

test("veritabanında notun açık hali ve anahtar yoktur", async () => {
  const enc = await encryptNote("veritabanında görünmemeli");
  const { id } = await (await post("/api/notes", { ciphertext: enc.ciphertext, iv: enc.iv, ttl: 3600 })).json();
  const row = await env.DB.prepare("SELECT * FROM notes WHERE id = ?").bind(id).first();
  const dump = JSON.stringify(row);
  assert.ok(!dump.includes("görünmemeli"));
  assert.ok(!dump.includes(enc.key));
});

test("aynı anda iki okuma isteği: notu sadece biri alır", async () => {
  const { data } = await createNote();
  const results = await Promise.all([1, 2, 3].map(() => post(`/api/notes/${data.id}/read`, "")));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 404, 404]);
});

test("okuma GET ile yapılamaz (link önizleme botları notu yakamaz)", async () => {
  const { data } = await createNote();
  assert.equal((await call(`/api/notes/${data.id}/read`)).status, 405);
  assert.deepEqual(await (await call(`/api/notes/${data.id}`)).json(), { exists: true });
});

test("süresi dolmuş not okunamaz ve temizlikte silinir", async () => {
  const past = Math.floor(Date.now() / 1000) - 10;
  await env.DB.prepare("INSERT INTO notes VALUES ('eskiNotEskiNotEskiNot1', 'AAAA', 'AAAAAAAAAAAAAAAA', ?, ?)")
    .bind(past - 3600, past)
    .run();
  assert.equal((await post("/api/notes/eskiNotEskiNotEskiNot1/read", "")).status, 404);

  await worker.scheduled({}, env);
  const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM notes WHERE expires_at <= ?").bind(past + 10).first();
  assert.equal(left.n, 0);
});

test("geçersiz istekler reddedilir", async () => {
  const enc = await encryptNote("x");
  const ok = { ciphertext: enc.ciphertext, iv: enc.iv, ttl: 3600 };
  assert.equal((await post("/api/notes", { ...ok, ttl: 999 })).status, 400);
  assert.equal((await post("/api/notes", { ...ok, iv: "kisa" })).status, 400);
  assert.equal((await post("/api/notes", { ...ok, ciphertext: "<script>" })).status, 400);
  assert.equal((await post("/api/notes", { ...ok, ciphertext: "A".repeat(60_001) })).status, 400);
  assert.equal((await post("/api/notes", "{bozuk")).status, 400);
  assert.equal((await post("/api/notes", ok, { "Content-Type": "text/plain" })).status, 415);
  assert.equal((await call("/api/notes")).status, 405);
  assert.equal((await post("/api/notes/kisa-id/read", "")).status, 404);
  assert.equal((await post("/api/notes/AAAAAAAAAAAAAAAAAAAAAA/read", "")).status, 404);
});

test("API cevaplarında güvenlik başlıkları var ve önbelleğe alınmıyor", async () => {
  const { res } = await createNote();
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  assert.equal(res.headers.get("Referrer-Policy"), "no-referrer");
  assert.match(res.headers.get("Content-Security-Policy"), /frame-ancestors 'none'/);
});

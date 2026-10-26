// Okuma sayfası: notu ancak "Notu göster"e basılınca alır (alırken sunucu siler) ve tarayıcıda çözer.
// Sunucu notu sadece doğru okuma fişini getirene verir; yanlış parola notu yakmaz.
import { decryptNote, deriveKey, authToken } from "/crypto.js";

const $ = (id) => document.getElementById(id);
const id = location.pathname.split("/").pop();
const key = location.hash.slice(1);
let salt = null;

// Anahtarı adres çubuğundan ve tarayıcı geçmişinden hemen sil (sadece bellekte kalsın)
history.replaceState(null, "", location.pathname);

// Aynı sekmeye linkin tamamı sonradan yapıştırılırsa tarayıcı sayfayı yeniden yüklemez
// (sadece # kısmı değişti sayar); anahtarı okuyabilmek için sayfayı baştan çalıştır.
addEventListener("hashchange", () => location.reload());

function show(section) {
  for (const s of ["loading", "confirm", "shown", "gone"]) $(s).hidden = s !== section;
}

function gone(title, text) {
  if (title) $("gone-title").textContent = title;
  if (text) $("gone-text").textContent = text;
  show("gone");
}

function fail(message) {
  $("error").textContent = message;
  $("error").hidden = false;
  $("reveal").disabled = false;
  $("reveal").textContent = "Notu göster";
}

async function init() {
  if (!key) {
    return gone("Link eksik", "Linkin # işaretinden sonraki kısmı (anahtar) yok. Linkin tamamını kopyaladığından emin ol.");
  }
  try {
    const res = await fetch(`/api/notes/${encodeURIComponent(id)}`);
    const info = await res.json();
    if (!info.exists) return gone();
    salt = info.salt;
    $("password-note").hidden = !info.protected;
    $("password").hidden = !info.protected;
    $("password").required = info.protected;
    show("confirm");
    if (info.protected) $("password").focus();
  } catch {
    gone("Bağlantı sorunu", "Not kontrol edilemedi. İnternet bağlantını kontrol edip sayfayı yenile.");
  }
}

$("reveal-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("error").hidden = true;
  $("reveal").disabled = true;
  $("reveal").textContent = salt ? "Parola kontrol ediliyor..." : "Açılıyor...";

  let rawKey;
  try {
    rawKey = await deriveKey({ key, password: $("password").value, salt });
  } catch (e) {
    if (e.code === "PASSWORD_REQUIRED") return fail("Parolayı yaz.");
    return gone("Link hatalı", "Linkteki anahtar eksik ya da bozuk. Linkin tamamını kopyaladığından emin ol.");
  }

  try {
    const res = await fetch(`/api/notes/${encodeURIComponent(id)}/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: await authToken(rawKey) }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 403) {
      $("password").value = "";
      $("password").focus();
      // Parolasız notta fiş tutmuyorsa link bozuk demektir
      return fail(salt ? data.error : "Linkteki anahtar hatalı. Linkin tamamını kopyaladığından emin ol.");
    }
    if (res.status === 404) return gone(null, data.error);
    if (!res.ok) throw new Error("Not alınamadı. Biraz sonra tekrar dene.");

    try {
      $("secret").textContent = await decryptNote({ ...data, rawKey });
    } catch {
      return gone("Not çözülemedi", "Not alındı ama çözülemedi ve silindi. Gönderenden yeni bir not iste.");
    }
    $("password").value = "";
    show("shown");
  } catch (e) {
    fail(e.message);
  }
});

$("copy").addEventListener("click", async () => {
  await navigator.clipboard.writeText($("secret").textContent);
  $("copy").textContent = "Kopyalandı ✓";
  setTimeout(() => ($("copy").textContent = "Notu kopyala"), 2000);
});

init();

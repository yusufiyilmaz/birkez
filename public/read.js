// Okuma sayfası: notu ancak "Notu göster"e basılınca alır (alırken sunucu siler) ve tarayıcıda çözer.
import { decryptNote } from "/crypto.js";

const $ = (id) => document.getElementById(id);
const id = location.pathname.split("/").pop();
const key = location.hash.slice(1);

// Anahtarı adres çubuğundan ve tarayıcı geçmişinden hemen sil (sadece bellekte kalsın)
history.replaceState(null, "", location.pathname);

function show(section) {
  for (const s of ["loading", "confirm", "shown", "gone"]) $(s).hidden = s !== section;
}

function gone(title, text) {
  if (title) $("gone-title").textContent = title;
  if (text) $("gone-text").textContent = text;
  show("gone");
}

async function init() {
  if (!key) {
    return gone("Link eksik", "Linkin # işaretinden sonraki kısmı (anahtar) yok. Linkin tamamını kopyaladığından emin ol.");
  }
  try {
    const res = await fetch(`/api/notes/${encodeURIComponent(id)}`);
    const { exists } = await res.json();
    if (!exists) return gone();
    show("confirm");
  } catch {
    gone("Bağlantı sorunu", "Not kontrol edilemedi. İnternet bağlantını kontrol edip sayfayı yenile.");
  }
}

$("reveal").addEventListener("click", async () => {
  $("reveal").disabled = true;
  $("reveal").textContent = "Açılıyor...";
  try {
    const res = await fetch(`/api/notes/${encodeURIComponent(id)}/read`, { method: "POST" });
    if (res.status === 404) return gone();
    if (!res.ok) throw new Error("Not alınamadı. Biraz sonra tekrar dene.");
    const stored = await res.json();
    try {
      $("secret").textContent = await decryptNote({ ...stored, key });
    } catch (e) {
      // Not sunucudan alındı ve silindi ama anahtar yanlış: linkte eksik ya da değişmiş bir kısım var
      return gone("Not çözülemedi", "Linkteki anahtar hatalı olduğu için not açılamadı ve silindi. Gönderenden yeni bir not iste.");
    }
    show("shown");
  } catch (e) {
    $("error").textContent = e.message;
    $("error").hidden = false;
    $("reveal").disabled = false;
    $("reveal").textContent = "Notu göster";
  }
});

$("copy").addEventListener("click", async () => {
  await navigator.clipboard.writeText($("secret").textContent);
  $("copy").textContent = "Kopyalandı ✓";
  setTimeout(() => ($("copy").textContent = "Notu kopyala"), 2000);
});

init();

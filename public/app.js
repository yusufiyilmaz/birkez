// Not yazma sayfası: notu tarayıcıda şifreler, sadece şifreli halini sunucuya gönderir.
import { encryptNote } from "/crypto.js";

const $ = (id) => document.getElementById(id);
const TTL_TEXT = { 3600: "1 saat içinde", 86400: "1 gün içinde", 604800: "7 gün içinde" };

$("note").addEventListener("input", () => {
  $("count").textContent = $("note").value.length.toLocaleString("tr-TR");
  $("error").hidden = true;
});

$("use-password").addEventListener("change", () => {
  $("password-box").hidden = !$("use-password").checked;
  if ($("use-password").checked) $("password").focus();
  else $("password").value = "";
});

$("create").addEventListener("submit", async (event) => {
  event.preventDefault();
  const ttl = Number(new FormData($("create")).get("ttl"));
  const password = $("use-password").checked ? $("password").value : "";
  $("error").hidden = true;
  if ($("use-password").checked && !password) {
    $("error").textContent = "Parola kutusu boş. Parola istemiyorsan işareti kaldır.";
    $("error").hidden = false;
    return;
  }
  $("submit").disabled = true;
  $("submit").textContent = "Şifreleniyor...";

  try {
    const { ciphertext, iv, salt, token, key } = await encryptNote($("note").value, password);
    const res = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ciphertext, iv, ttl, token, salt }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Not kaydedilemedi. Biraz sonra tekrar dene.");

    // Anahtar sadece # kısmında: tarayıcılar bu kısmı sunucuya göndermez
    const link = `${location.origin}/n/${data.id}#${key}`;
    $("link").value = link;
    $("whatsapp").href = "https://wa.me/?text=" + encodeURIComponent(`Sana bir gizli not gönderdim, bir kez okunabilir: ${link}`);
    $("expires").textContent = TTL_TEXT[ttl];
    $("password-tip").hidden = !password;
    $("note").value = ""; // açık metni ve parolayı sayfada tutma
    $("password").value = "";
    $("use-password").checked = false;
    $("password-box").hidden = true;
    $("count").textContent = "0";
    $("create").hidden = true;
    $("done").hidden = false;
    $("link").select();
  } catch (e) {
    $("error").textContent = e.message;
    $("error").hidden = false;
  } finally {
    $("submit").disabled = false;
    $("submit").textContent = "Link oluştur";
  }
});

$("copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("link").value);
  } catch {
    $("link").select();
    document.execCommand("copy");
  }
  $("copy").textContent = "Kopyalandı ✓";
  setTimeout(() => ($("copy").textContent = "Linki kopyala"), 2000);
});

$("again").addEventListener("click", () => {
  $("link").value = "";
  $("done").hidden = true;
  $("create").hidden = false;
  $("note").focus();
});

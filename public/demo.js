import { encryptNote, decryptNote } from "/crypto.js";

const $ = (id) => document.getElementById(id);
let last = null;

$("encrypt").addEventListener("click", async () => {
  $("error").hidden = true;
  $("plain").hidden = true;
  try {
    last = await encryptNote($("note").value);
    $("cipher").textContent = last.ciphertext;
    $("key").textContent = "#" + last.key;
    $("out").hidden = false;
  } catch (e) {
    $("error").textContent = e.message;
    $("error").hidden = false;
  }
});

$("decrypt").addEventListener("click", async () => {
  $("plain").textContent = await decryptNote(last);
  $("plain").hidden = false;
});

// Tarayıcı testleri ve ekran görüntüsü betiği için ortak araçlar: gerçek sunucuyu (wrangler dev)
// ve başsız bir Chrome/Edge'i başlatır. Ek paket gerekmez: tarayıcı, Chrome DevTools Protocol
// üzerinden Node'un yerleşik WebSocket'i ile yönetilir.
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const WRANGLER = join("node_modules", "wrangler", "bin", "wrangler.js");

const BROWSERS = [
  process.env.CHROME_PATH,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

function stop(proc) {
  if (!proc || proc.exitCode !== null) return;
  if (process.platform === "win32") {
    try { execFileSync("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { stdio: "ignore" }); } catch {}
  } else {
    proc.kill("SIGTERM");
  }
}

export async function waitFor(check, what, timeout = 30_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const value = await check();
      if (value) return value;
    } catch {}
    await sleep(150);
  }
  throw new Error(`Zaman aşımı: ${what}`);
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let nextId = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method) {
      for (const fn of listeners) fn(msg);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  return { send, on: (fn) => listeners.push(fn), close: () => ws.close() };
}

/**
 * Sunucuyu ve tarayıcıyı başlatır. Dönen nesnedeki yardımcılar sayfada bir kullanıcının
 * yapacaklarını yapar; işin bitince close() çağır.
 */
export async function startSession({ port = 8799, debugPort = 9333 } = {}) {
  const chrome = BROWSERS.find((p) => existsSync(p));
  if (!chrome) throw new Error("Chrome ya da Edge bulunamadı. CHROME_PATH ile yolunu ver.");

  const base = `http://127.0.0.1:${port}`;
  const dataDir = mkdtempSync(join(tmpdir(), "birkez-e2e-db-"));
  const profileDir = mkdtempSync(join(tmpdir(), "birkez-e2e-profil-"));
  const env = { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" };

  execFileSync(process.execPath, [WRANGLER, "d1", "migrations", "apply", "birkez", "--local", "--persist-to", dataDir],
    { env, stdio: "ignore" });
  const server = spawn(process.execPath, [WRANGLER, "dev", "--port", String(port), "--ip", "127.0.0.1", "--persist-to", dataDir],
    { env, stdio: "ignore" });
  let browser;

  const close = async () => {
    page?.close();
    stop(browser);
    stop(server);
    await sleep(500);
    for (const dir of [dataDir, profileDir]) {
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  };

  let page;
  try {
    await waitFor(async () => (await fetch(`${base}/`)).ok, "wrangler dev", 60_000);
    browser = spawn(chrome, [
      "--headless=new", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profileDir}`,
      "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--hide-scrollbars",
      // GitHub'ın Ubuntu 24.04 makineleri Chrome'un sandbox'ını engelliyor; sadece CI'da kapat
      ...(process.env.CI && process.platform === "linux" ? ["--no-sandbox"] : []),
      "about:blank",
    ], { stdio: "ignore" });
    const target = await waitFor(async () => {
      const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      return list.find((t) => t.type === "page");
    }, "tarayıcı");
    page = await connect(target.webSocketDebuggerUrl);
  } catch (e) {
    await close();
    throw e;
  }

  const problems = []; // CSP ihlalleri ve yakalanmamış JS hataları
  page.on(({ method, params }) => {
    if (method === "Runtime.exceptionThrown") problems.push(params.exceptionDetails.exception?.description);
    if (method === "Log.entryAdded" && /Content Security Policy/i.test(params.entry.text)) problems.push(params.entry.text);
  });
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await page.send("Log.enable");

  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await page.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
    return result.value;
  };
  const el = (id) => `document.getElementById(${JSON.stringify(id)})`;

  const s = {
    base,
    page,
    problems,
    close,
    evaluate,
    open: async (url) => {
      await page.send("Page.navigate", { url });
      await waitFor(() => evaluate("document.readyState === 'complete'"), `${url} yüklenmesi`);
    },
    visible: (id) => evaluate(`!${el(id)}.hidden`),
    text: (id) => evaluate(`${el(id)}.textContent`),
    type: (id, value) =>
      evaluate(`(() => { const e = ${el(id)}; e.value = ${JSON.stringify(value)};
        e.dispatchEvent(new Event("input", { bubbles: true })); })()`),
    click: (id) => evaluate(`${el(id)}.click()`),
    async createNote(note, password = "") {
      await s.open(`${base}/`);
      await s.type("note", note);
      if (password) {
        await s.click("use-password");
        await s.type("password", password);
      }
      await s.click("submit");
      await waitFor(() => s.visible("done"), "link ekranı");
      return evaluate(`${el("link")}.value`);
    },
  };
  return s;
}

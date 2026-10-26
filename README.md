# birkez

[![tests](https://github.com/yusufiyilmaz/birkez/actions/workflows/tests.yml/badge.svg)](https://github.com/yusufiyilmaz/birkez/actions/workflows/tests.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**English** | [Türkçe](README.tr.md)

Self-destructing notes that can be read only once. Share passwords, IBANs or Wi-Fi keys without leaving them in your chat history. *("birkez" means "once" in Turkish.)*

> 🚧 Work in progress

## How it works

1. You write a note. Your browser generates a random key and encrypts the note **on your device** (AES-256-GCM).
2. Only the encrypted note reaches the server. You get a link like:
   ```
   https://not.yilmazyusuf.dev/n/Xk3p9Qa2#key
   ```
3. When the recipient clicks "Show note", the encrypted note is fetched from the server and **deleted in the same operation**. The browser decrypts it with the key from the link.

## Security model

- **The server cannot read notes.** The key lives in the part of the link after `#`, which browsers never send to the server. A stolen database contains only ciphertext.
- **Read-once guarantee.** A note is deleted in the same query that reads it (`DELETE ... RETURNING`); even if two people open the link at the same moment, only one of them sees it.
- **Safe from link-preview bots.** When WhatsApp or Telegram fetches the link to build a preview, the note is not burned; it is fetched only after the "Show note" button is pressed.
- **Expiry.** Unread notes are deleted when the chosen time (1 hour / 1 day / 7 days) runs out.
- **Optional extra password.** The real key is the link key XOR a PBKDF2-SHA256 (600,000 rounds) hash of the password, so a leaked link alone cannot open the note. The password never leaves the browser.
- **Wrong passwords don't burn the note.** The browser proves it holds the right key with a read token derived from it; the server stores only the token's SHA-256 and hands the note out only for a matching token. After 5 wrong attempts the note is deleted. This also means someone who knows only the note id (without the # key) cannot burn it.

## Tech stack

- **Browser:** plain HTML/CSS/JS, Web Crypto API (AES-256-GCM, PBKDF2, SHA-256), no third-party scripts, strict CSP
- **Server:** Cloudflare Workers + D1 (SQLite), hourly cron for expired notes
- **Tests:** Node's built-in test runner; server tests run against a real local D1 database

## Run locally

Requires Node.js 22+.

```bash
npm install
npm run db:local   # create the local database tables (once)
npm run dev        # http://localhost:8791
npm test
```

## Roadmap

- [x] Encryption / decryption in the browser
- [x] Server (Cloudflare Workers + D1 database)
- [x] Read page with the "Show note" step
- [x] Expiry and optional extra password
- [x] Tests
- [ ] Deploy: not.yilmazyusuf.dev

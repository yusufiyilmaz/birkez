# birkez

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

## Roadmap

- [x] Encryption / decryption in the browser
- [x] Server (Cloudflare Workers + D1 database)
- [ ] Read page with the "Show note" step
- [ ] Expiry and optional extra password
- [ ] Tests
- [ ] Deploy: not.yilmazyusuf.dev

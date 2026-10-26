# birkez

[![tests](https://github.com/yusufiyilmaz/birkez/actions/workflows/tests.yml/badge.svg)](https://github.com/yusufiyilmaz/birkez/actions/workflows/tests.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[English](README.md) | **Türkçe**

Bir kez okunduktan sonra kendini imha eden notlar. Şifre, IBAN ya da Wi-Fi şifresi gibi bilgileri mesaj geçmişinde iz bırakmadan paylaşmak için.

> 🚧 Yapım aşamasında

## Nasıl çalışır

1. Notu yazarsın. Tarayıcın rastgele bir anahtar üretir ve notu **senin bilgisayarında** şifreler (AES-256-GCM).
2. Sunucuya sadece şifreli hali gider. Sana şöyle bir link verilir:
   ```
   https://not.yilmazyusuf.dev/n/Xk3p9Qa2#anahtar
   ```
3. Linki açan kişi "Notu göster"e basınca şifreli not sunucudan alınır ve **aynı anda silinir**. Tarayıcı, linkteki anahtarla notu çözer.

## Güvenlik modeli

- **Sunucu notu okuyamaz.** Anahtar linkin `#` işaretinden sonraki kısmındadır; tarayıcılar bu kısmı sunucuya hiç göndermez. Veritabanı çalınsa bile elde edilen sadece anlamsız şifreli veridir.
- **Tek okuma garantisi.** Not, okunduğu işlemde silinir (`DELETE ... RETURNING`); iki kişi aynı anda açmaya çalışsa bile sadece biri görür.
- **Link önizleme botlarına karşı korumalı.** WhatsApp ya da Telegram linki önizlemek için açtığında not yanmaz; not ancak "Notu göster" butonuna basılınca alınır.
- **Süre sınırı.** Okunmayan notlar seçilen süre (1 saat / 1 gün / 7 gün) dolunca silinir.
- **İsteğe bağlı ek parola.** Asıl anahtar, link anahtarı ile parolanın PBKDF2-SHA256 (600.000 tur) özetinin XOR'udur; link tek başına başkasının eline geçse bile notu açamaz. Parola tarayıcıdan hiç çıkmaz.
- **Yanlış parola notu yakmaz.** Tarayıcı, doğru anahtara sahip olduğunu anahtardan türetilen bir okuma fişiyle kanıtlar; sunucu fişin sadece SHA-256 özetini saklar ve notu yalnızca tutan fişe verir. 5 yanlış denemeden sonra not silinir. Böylece linkin sadece numarasını bilen biri (# anahtarı olmadan) notu yakamaz.

## Kullanılan teknolojiler

- **Tarayıcı:** Sade HTML/CSS/JS, Web Crypto API (AES-256-GCM, PBKDF2, SHA-256), üçüncü taraf script yok, sıkı CSP
- **Sunucu:** Cloudflare Workers + D1 (SQLite), süresi dolan notlar için saatlik zamanlanmış görev
- **Testler:** Node'un yerleşik test aracı; sunucu testleri gerçek bir yerel D1 veritabanında çalışır

## Kendi bilgisayarında çalıştırma

Node.js 22 veya üstü gerekir.

```bash
npm install
npm run db:local   # yerel veritabanı tablolarını oluştur (bir kez)
npm run dev        # http://localhost:8791
npm test
```

## Yol haritası

- [x] Tarayıcıda şifreleme / çözme
- [x] Sunucu (Cloudflare Workers + D1 veritabanı)
- [x] Okuma sayfası ve "Notu göster" adımı
- [x] Süre sınırı ve isteğe bağlı ek parola
- [x] Testler
- [ ] Yayın: not.yilmazyusuf.dev

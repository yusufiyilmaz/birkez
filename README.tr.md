# birkez

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

## Yol haritası

- [ ] Tarayıcıda şifreleme / çözme
- [ ] Sunucu (Cloudflare Workers + D1 veritabanı)
- [ ] Okuma sayfası ve "Notu göster" adımı
- [ ] Süre sınırı ve isteğe bağlı ek parola
- [ ] Testler
- [ ] Yayın: not.yilmazyusuf.dev

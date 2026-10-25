-- Notlar sadece şifreli halleriyle tutulur; anahtar hiçbir zaman sunucuya gelmez.
CREATE TABLE notes (
  id         TEXT PRIMARY KEY,     -- 128 bit rastgele, tahmin edilemez
  ciphertext TEXT NOT NULL,        -- base64url, AES-256-GCM
  iv         TEXT NOT NULL,        -- base64url, 96 bit
  created_at INTEGER NOT NULL,     -- unix saniye
  expires_at INTEGER NOT NULL      -- bu saatten sonra okunamaz ve temizlenir
);

CREATE INDEX idx_notes_expires_at ON notes (expires_at);

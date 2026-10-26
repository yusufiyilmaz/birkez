-- Okuma fişi ve isteğe bağlı ek parola.
-- auth_hash: okuma fişinin SHA-256'sı. Fişin kendisi değil, özeti saklanır.
-- salt:      parolalı notlarda PBKDF2 tuzu (parolasız notlarda NULL). Parolanın kendisi hiç gelmez.
-- attempts:  yanlış fişle yapılan okuma denemeleri; sınır aşılınca not silinir.
ALTER TABLE notes ADD COLUMN auth_hash TEXT;
ALTER TABLE notes ADD COLUMN salt TEXT;
ALTER TABLE notes ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;

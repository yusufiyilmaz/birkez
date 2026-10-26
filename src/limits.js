// Sabitler ayrı dosyada: Worker'ın ana dosyası (worker.js) sadece istek işleyicisi dışa aktarabilir,
// sayı ya da nesne dışa aktarırsa Cloudflare çalışma ortamı açılmaz.
export const TTL_OPTIONS = { 3600: "1 saat", 86400: "1 gün", 604800: "7 gün" };
export const MAX_ATTEMPTS = 5; // bu kadar yanlış denemeden sonra not silinir

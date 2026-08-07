-- 044 — MOBİL TOKEN İPTAL SAYACI
--
-- ⚠️ BU DOSYA HENÜZ ÇALIŞTIRILMADI. Volkan'ın Supabase SQL editöründe
--    çalıştırması bekleniyor (HAK61 ve Sendigo projelerinde ayrı ayrı).
--
-- NE İŞE YARAR
-- Mobil uygulama çerez kullanamadığı için /api/mobile/* uçları mühürlü token
-- ile çalışıyor (lib/mobile-auth.ts). Token durumsuz olduğu için, verildikten
-- sonra "bunu iptal et" demenin tek yolu sunucuda karşılaştırılacak bir sayaç
-- tutmaktır. Token mühürlenirken o anki token_version içine gömülür; her
-- istekte DB'deki değerle karşılaştırılır. Sayaç artınca o kişinin TÜM mobil
-- token'ları (access + refresh, her cihazda) anında ölür.
--
-- NEDEN AYRI TABLO DEĞİL
-- Oturum tablosu cihaz başına iptal ve denetim izi verirdi, ama büyüyen bir
-- tablo + temizlik politikası + rotasyon kodu getirirdi. Bu filoda kişi başına
-- tek cihaz var ve gerçek senaryolar (işten çıkış, pasife alma, PIN sıfırlama,
-- kayıp telefon) hesap ekseninde iptalle zaten karşılanıyor. Kararın tam
-- karşılaştırması ve bilinçli kabul edilen bedeli (tek cihazdan çıkış diğer
-- cihazları da düşürür) tasarım turunda verildi.
-- İleride cihaz yönetimi gerekirse token'a jti eklenip tablo YANINA konabilir;
-- bu kolon o zaman da geçerli kalır, kırıcı bir değişiklik olmaz.
--
-- SAYACI ARTIRAN DÖRT OLAY (kod tarafında bağlı):
--   • POST /api/mobile/auth/logout        → app/api/mobile/auth/logout/route.ts
--   • PIN değişimi (şoför kendi değiştirir) → app/actions/auth.ts changePinAction
--   • PIN sıfırlama (yönetici)             → app/actions/workers.ts setWorkerPinAction
--   • Aktif/pasif çevirme                  → app/actions/workers.ts toggleActiveAction
--   • İşten çıkarma                        → app/actions/workers.ts terminateWorkerAction
--
-- MIGRATION ÖNCESİ DAVRANIŞ (kod buna göre yazıldı, kırılmaz):
--   /login, /refresh, /me  → TAM ÇALIŞIR, sürüm denetimi atlanır
--   /logout                → 503 mobile_store_missing (sessizce başarılı SAYMAZ)
--   bumpTokenVersion(...)  → sessiz no-op, mevcut yönetici akışları etkilenmez
--
-- RLS: şemanın geri kalanıyla tutarlı olarak KAPALI — bu kolon yalnız
-- service-role istemcisi tarafından okunup yazılır (bkz. 012, 014, 019, 021).

alter table public.workers
  add column if not exists token_version integer not null default 0;

comment on column public.workers.token_version is
  'Mobil token iptal sayacı. Artınca o kişinin tüm mobil token''ları geçersizleşir. Tarayıcı oturum çerezini (hak_session) ETKİLEMEZ.';

-- İndeks GEREKMEZ: kolon her zaman workers.id (birincil anahtar) üzerinden
-- tek satır okunuyor, hiçbir sorguda filtre ya da sıralama anahtarı değil.

notify pgrst, 'reload schema';

-- HAK61 — Migration 070 (SEFER TUR 3 — OTOMATİK KÖPRÜLER)
-- =====================================================================
-- Seferin iki alanı ARTIK ELLE DOLDURULMUYOR:
--   · vardi_at         → araç hedef bölgeye VARDI (zone_visits'ten okunur)
--   · paket_gerceklesen→ o günün vardiyasında girilen teslim sayısı
--
-- Additive + idempotent. `seferler` dışında HİÇBİR tabloya dokunulmaz;
-- zone_visits ve shift_packages YALNIZ OKUNUR. Supabase SQL Editor'da
-- çalıştırın.
--
-- ⚠️ NUMARA: bu dosya Volkan'a "069" olarak verildi ve canlıda O HÂLİYLE
-- çalıştırıldı. Aynı anda diğer zincir de 069'u aldı
-- (069_geofence_category_repair.sql, main'e önce girdi), o yüzden REPO
-- DOSYASI 070'e taşındı. ⚠️ DDL BAYT BAYT AYNI — veritabanında değişen
-- hiçbir şey yok, yalnız kurulum sırası tekilleşti.
-- 067/068 de diğer zincirde. Bu dosya onlardan BAĞIMSIZ; yalnız 066'nın
-- (seferler) ve 064'ün (zone_visits) var olmasını bekler.
--
-- ═══ NEDEN YENİ DURUM DEĞİL, BİLGİ DAMGASI ═══
--
-- "vardi" bir DURUM olsaydı çizgi atandi→kabul→vardi→yolda→tamamlandi olur
-- ve şoförün elle ilerlettiği akışa, ŞOFÖRÜN BASMADIĞI bir adım girerdi.
-- O zaman "şoför yolda'ya basmadan sistem vardi yazdı" gibi bir sıra sorunu
-- doğar, geçiş kuralları (Tur 1 İK2) ikiye bölünürdü. Varış bir OLAY: oldu ya
-- da olmadı. Durum çizgisi Tur 1'deki gibi AYNEN kalıyor.
--
-- ═══ NEDEN DAMGA BİR KEZ DÜŞER ═══
--
-- Araç bölgeye gün içinde üç kez girip çıkabilir (park, ikinci teslim, geri
-- dönüş). "İlk varış" tek ve tekrar etmez; damgayı her ziyarette güncellemek
-- "ne zaman vardı" sorusunun cevabını akşama kaydırırdı. Yazma koşulu
-- `vardi_at is null` — köprü idempotenttir, aynı turda iki kez koşsa da
-- ikinci kez yazmaz.
--
-- ═══ NEDEN zone_visit id'si SAKLANMIYOR ═══
--
-- Sefer bir GÜN birimi ve hedefi TEK bölge; "hangi ziyaret" sorusu
-- (zone_id, vehicle_id, gün) üçlüsüyle zaten cevaplanabiliyor. Bir FK daha
-- eklemek ziyaret silindiğinde damgayı da düşürme/koruma kararı doğururdu —
-- oysa damga bir OLAY kaydı: ziyaret satırı sonradan temizlense bile "o gün
-- vardı" doğru kalmalı.
--
-- ═══ NEDEN paket_gerceklesen AYRI KOLON, time_entries'ten TÜRETME DEĞİL ═══
--
-- Türetseydik her okumada "o günün hangi vardiyası" kuralını yeniden
-- uygulamak gerekirdi ve kural iki yerde yaşardı; kolon, bağlamanın SONUCUNU
-- tek yerde tutuyor.
--
-- ⚠️ DEĞER DONDURULMAZ, TAZELENİR (ilk taslakta tersi yazıyordu — DDL aynı,
-- yorum uygulanan davranışa göre düzeltildi). Yönetici `cargo_count`u
-- sonradan düzeltebiliyor (shift_edit_log); dondursaydık sefer, düzeltilmiş
-- vardiyanın YANLIŞ sayısını taşımaya devam ederdi. Köprü hedef seferi her
-- çağrıda yeniden çözer ve yalnız O seferin değerini günceller; başka hiçbir
-- seferin değeri elle sürülmez (bkz. lib/sefer-bridge.ts).
-- =====================================================================

begin;

alter table public.seferler
  -- Hedef bölgeye VARIŞ anı (zone_visits.started_at'ten kopyalanır).
  -- null = henüz varılmadı ya da hedef bölge tanımsız.
  add column if not exists vardi_at timestamptz,

  -- O günün vardiyasından bağlanan teslim sayısı (time_entries.cargo_count).
  -- null = henüz bağlanmadı; 0 GEÇERLİ bir değerdir ("hiç teslim edilmedi").
  add column if not exists paket_gerceklesen integer
    check (paket_gerceklesen is null or paket_gerceklesen >= 0);

commit;

notify pgrst, 'reload schema';

-- =====================================================================
-- İNDEKS EKLENMEDİ — BİLEREK
--
-- Köprü sorgusu günün seferlerini `tarih` ile okuyor; 066'daki
-- idx_seferler_tarih_worker bunu zaten karşılıyor. Tablo günde ~30 satır
-- büyüyor; `vardi_at is null` için ayrı bir kısmi indeks, kazanmadığı bir
-- yazma maliyeti eklerdi. Tablo büyürse ölçülüp eklenir.
-- =====================================================================
-- ÇALIŞTIRDIKTAN SONRA BEKLENEN HÂL (doğrulama sorgusu):
--
--   select column_name, data_type, is_nullable
--     from information_schema.columns
--    where table_schema='public' and table_name='seferler'
--      and column_name in ('vardi_at','paket_gerceklesen');
--
--   → 2 satır:
--       vardi_at            timestamptz  YES
--       paket_gerceklesen   integer      YES
--
--   select count(*) from public.seferler where vardi_at is not null;  → 0
-- =====================================================================

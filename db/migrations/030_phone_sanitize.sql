-- 030_phone_sanitize.sql
--
-- 23.07.2026 — Meltem Yıldırım ve Hamdi Kurubaş şoför paneline giremiyordu.
-- Sebep: workers.phone alanı Unicode yön işaretleriyle SARILMIŞ kaydedilmişti:
--   U+202A (LEFT-TO-RIGHT EMBEDDING) + "+43..." + U+202C (POP DIRECTIONAL FMT)
-- Numara ekranda doğru görünür, ama eq("phone", "+436505381313") 0 kayıt döner.
-- Bu karakterler numara telefon kişi listesinden / WhatsApp'tan / Excel'den
-- kopyalanıp panele yapıştırıldığında gelir.
--
-- Kod tarafı (lib/phone.ts) artık GİRDİYİ temizliyor, ama tek başına yetmez:
-- DB'deki değerin kendisi kirli olduğu için hiçbir temiz varyant onunla
-- eşleşmiyor. Bu yüzden saklanan veri de temizlenmeli.
--
-- ÖNEMLİ — bu migration numara BİÇİMİNİ değiştirmez. Kayıtların 19/34'ü
-- Avusturya ulusal trunk sıfırını taşıyor ("+430660…"), 15'i taşımıyor
-- ("+43660…"). O farkı burada normalleştirmek, bugün 0'lı yazarak giren
-- şoförleri riske atardı; onu kod tarafı varyant eşleştirmesiyle çözüyoruz.
-- Burada YALNIZCA görünmez karakterler düşürülür.

BEGIN;

-- 1) Önce ne değişeceğini göster (uygulamadan önce çıktıyı oku).
SELECT
  id,
  name,
  phone                                   AS mevcut,
  encode(convert_to(phone, 'UTF8'), 'hex') AS mevcut_hex,
  length(phone)                           AS mevcut_uzunluk,
  regexp_replace(phone, '[^0-9+]', '', 'g') AS temiz,
  length(regexp_replace(phone, '[^0-9+]', '', 'g')) AS temiz_uzunluk
FROM workers
WHERE phone IS DISTINCT FROM regexp_replace(phone, '[^0-9+]', '', 'g')
ORDER BY name;
-- Beklenen: TAM 2 satır — Hamdi Kurubaş ve Meltem Yıldırım.
-- Başka satır çıkarsa DUR ve önce onu incele.

-- 2) Temizlik çakışma yaratıyor mu? (temizlenmiş numara başka kayıtla eşleşir mi)
SELECT regexp_replace(phone, '[^0-9+]', '', 'g') AS temiz,
       count(*)                                   AS kayit,
       string_agg(name, ' | ')                    AS isimler
FROM workers
GROUP BY 1
HAVING count(*) > 1;
-- Beklenen: 0 satır. Satır dönerse UPDATE'i ÇALIŞTIRMA — unique ihlali olur.

-- 3) Asıl düzeltme: rakam ve "+" dışındaki her şeyi at.
UPDATE workers
SET phone = regexp_replace(phone, '[^0-9+]', '', 'g')
WHERE phone IS DISTINCT FROM regexp_replace(phone, '[^0-9+]', '', 'g');
-- Beklenen: UPDATE 2

-- 4) Doğrulama — bu iki sorgu artık kayıt DÖNMELİ.
SELECT name, phone, length(phone) FROM workers WHERE phone = '+4306608110302'; -- Meltem
SELECT name, phone, length(phone) FROM workers WHERE phone = '+436505381313';  -- Hamdi

-- 5) Kirli kayıt kalmadığını doğrula.
SELECT count(*) AS kalan_kirli
FROM workers
WHERE phone ~ '[^0-9+]';
-- Beklenen: 0

COMMIT;

-- ============================================================================
-- 6) NÜKS KORUMASI — bir daha kirli numara yazılamasın.
--    Yukarıdaki COMMIT'ten sonra, kalan_kirli = 0 GÖRÜLDÜKTEN sonra çalıştır.
-- ============================================================================
ALTER TABLE workers
  ADD CONSTRAINT workers_phone_temiz
  CHECK (phone IS NULL OR phone ~ '^\+?[0-9]{6,20}$');

-- ============================================================================
-- 7) İSTEĞE BAĞLI — login_attempts'teki kirli/eski sayaçları temizle.
--    Meltem ve Hamdi'nin başarısız deneme sayaçlarını sıfırlar. Kilit
--    süreleri zaten dolmuş durumda, yani giriş için ŞART DEĞİL; sayaçların
--    yeni denemeleri erken kilitlememesi için önerilir.
-- ============================================================================
DELETE FROM login_attempts
WHERE identifier LIKE '%8110302%'
   OR identifier LIKE '%5381313%'
   OR identifier ~ '[^\x20-\x7E]';

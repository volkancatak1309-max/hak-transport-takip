-- 075_phone_trunk_zero.sql
--
-- 22.08.2026 — workers.phone alanındaki ULUSAL TRUNK SIFIRINI düşürür.
--
-- SORUN. Kayıtların bir kısmı "+4306601113783" biçiminde: Avusturya ülke
-- kodundan (43) sonra bir de ulusal trunk sıfırı var. E.164'te doğrusu
-- "+436601113783". Aynı insan iki farklı metinle duruyor ve bunun iki somut
-- bedeli var:
--   1) wa.me ülke kodundan sonraki fazla sıfırı ÇÖZMEZ. "wa.me/4306601113783"
--      boşa düşer — panelin ve mobilin "WhatsApp'tan yaz" düğmesi o şoförler
--      için sessizce çalışmıyordu.
--   2) workers.phone UNIQUE, ama iki biçim farklı METİN. Aynı şoför iki kez
--      kaydedilebiliyordu (yaratma yolundaki tekillik denetimi tek biçime
--      bakıyordu — 22.08.2026'da kod tarafında da kapatıldı).
--
-- NEDEN 030 YAPMADI. 030_phone_sanitize.sql bu farkı BİLEREK bırakmıştı:
-- o gün varyant eşleştirmesi (lib/phone.ts phoneVariants) yeni kurulmuştu ve
-- veriyi aynı anda oynatmak riskliydi. Bugün o katman canlıda ve ölçüldü —
-- giriş sorgusu hem sıfırlı hem sıfırsız biçimi deniyor, yani bu migration
-- HİÇBİR ŞOFÖRÜN GİRİŞİNİ ETKİLEMEZ. Şoför telefonuna hangi biçimi yazarsa
-- yazsın (0660…, +43660…, +430660…, 0043660…) girebilmeye devam eder.
--
-- KAPSAM. Ulusal trunk sıfırını E.164'te DÜŞÜREN ülkeler:
--   43 AT · 49 DE · 41 CH · 90 TR · 44 GB · 33 FR · 31 NL · 32 BE
-- Liste lib/phone.ts ULKE_TABLOSU'ndaki trunkSifir=true satırlarının aynısıdır.
-- Genel bir "ülke kodundan sonraki sıfırı at" kuralı YAZILMADI: İtalya'da
-- (+39) ve İspanya'da (+34) baştaki sıfır numaranın parçasıdır, atılırsa numara
-- BOZULUR. Tabloda olmayan ülkeye dokunulmaz.
--
-- ŞEMA DOĞRULAMASI (canlıda karşılığı var mı):
--   public.workers            — 001_initial.sql:31 · canlıda 34 satır okundu
--   public.workers.phone      — 001_initial.sql:32 (text not null unique)
--   public.login_attempts     — 012_login_attempts.sql:14 (identifier text pk)
-- Başka tabloda telefon numarası YOK; grep db/migrations ile denetlendi.
-- Bu dosya hiçbir tablo/kolon YARATMAZ, yalnız UPDATE eder.

BEGIN;

-- ── 1) Ne değişecek? Uygulamadan önce çıktıyı oku. ──────────────────────────
SELECT
  name,
  phone                                                                AS mevcut,
  regexp_replace(phone, '^\+(43|49|41|90|44|33|31|32)0', '+\1')        AS yeni,
  length(phone)                                                        AS mevcut_uzunluk
FROM workers
WHERE phone ~ '^\+(43|49|41|90|44|33|31|32)0\d'
ORDER BY name;
-- Beklenen (HAK61, 22.08.2026 ölçümü): TAM 18 satır, hepsi +430… → +43….

-- ── 2) ÇAKIŞMA KAPISI — fail-closed. ────────────────────────────────────────
-- 030'da bu bir SELECT'ti ve "satır dönerse UPDATE'i çalıştırma" notu vardı;
-- yani koruma insanın çıktıyı okumasına bağlıydı. Burada RAISE ile işlemi
-- durduruyoruz: phone UNIQUE olduğu için çakışma zaten UPDATE'i patlatırdı,
-- ama o hata "duplicate key" der ve SEBEBİ söylemez.
DO $$
DECLARE
  n integer;
  ornek text;
BEGIN
  SELECT count(*), coalesce(string_agg(k, ', '), '')
    INTO n, ornek
  FROM (
    SELECT regexp_replace(phone, '^\+(43|49|41|90|44|33|31|32)0', '+\1') AS k
    FROM workers
    GROUP BY 1
    HAVING count(*) > 1
  ) t;

  IF n > 0 THEN
    RAISE EXCEPTION
      'Normalizasyon % numarada cakisma uretir (%). Once bu kayitlari elle '
      'birlestirin; workers.phone UNIQUE oldugu icin UPDATE patlardi.', n, ornek;
  END IF;
END $$;
-- Beklenen (HAK61): hata yok. Aynı denetim 22.08.2026'da canlı veri üzerinde
-- JS ile de koşuldu: 0 çakışma.

-- ── 3) Görünmez karakter süpürmesi (030'un idempotent tekrarı). ─────────────
-- 030'dan sonra yeni bir kirli kayıt yazılmış olabilir; ucuz ve zararsız.
UPDATE workers
SET phone = regexp_replace(phone, '[^0-9+]', '', 'g')
WHERE phone IS DISTINCT FROM regexp_replace(phone, '[^0-9+]', '', 'g');
-- Beklenen (HAK61): UPDATE 0

-- ── 4) Uluslararası önek: "0043…" → "+43…". ────────────────────────────────
-- Trunk adımından ÖNCE gelmeli, aksi hâlde "0043 0660…" biçimi yakalanmaz.
UPDATE workers
SET phone = '+' || substring(phone from 3)
WHERE phone ~ '^00\d';
-- Beklenen (HAK61): UPDATE 0 — canlıdaki 34 kaydın hepsi "+" ile başlıyor.

-- ── 5) ASIL DÜZELTME: ulusal trunk sıfırını at. ────────────────────────────
UPDATE workers
SET phone = regexp_replace(phone, '^\+(43|49|41|90|44|33|31|32)0', '+\1')
WHERE phone ~ '^\+(43|49|41|90|44|33|31|32)0\d';
-- Beklenen (HAK61): UPDATE 18

-- ── 6) Doğrulama: trunk sıfırlı kayıt kalmamalı. ───────────────────────────
SELECT count(*) AS kalan_trunk_sifirli
FROM workers
WHERE phone ~ '^\+(43|49|41|90|44|33|31|32)0\d';
-- Beklenen: 0

-- ── 7) Doğrulama: 030'un CHECK kısıtı hâlâ sağlanıyor mu. ──────────────────
-- workers_phone_temiz: phone ~ '^\+?[0-9]{6,20}$'
SELECT count(*) AS kisitla_uyumsuz
FROM workers
WHERE phone !~ '^\+?[0-9]{6,20}$';
-- Beklenen: 0

-- ── 8) Son dağılım — gözle kontrol. ────────────────────────────────────────
SELECT
  substring(phone from 1 for 3) AS onek,
  count(*)                      AS kayit
FROM workers
GROUP BY 1
ORDER BY 2 DESC;
-- Beklenen (HAK61): "+43" 33 · "+90" 1 — "+430" öneki HİÇ görünmemeli.

COMMIT;

-- ============================================================================
-- 9) login_attempts TEMİZLİĞİ — GEREKMİYOR, bilinçli olarak boş.
--
--    Kilit kimliği `${ip}|${canonicalPhone(phone)}` biçiminde üretiliyor
--    (lib/login-lock.ts:69) — yani ZATEN kanonik. Numaranın DB'deki metni
--    değişse de anahtar değişmez; mevcut sayaçlar ve kilitler tutarlı kalır.
--    030'da bu bölüm gerekliydi, çünkü orada kirli karakterler anahtara da
--    sızmıştı.
-- ============================================================================

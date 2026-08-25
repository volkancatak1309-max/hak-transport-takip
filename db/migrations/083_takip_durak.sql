-- HAK61 / Galzura Fleet — Migration 083 (TAKİP LİNKİ DURAĞA BAĞLANIYOR)
-- =====================================================================
-- Takip linki (079) SEFERE bağlıydı. 12 duraklı bir seferde müşteri kendi
-- durağının değil, aracın SIRADAKİ durağının varış saatini görüyordu — yani
-- yanlış bilgi. Link artık bir DURAĞA bağlanabiliyor. Additive + idempotent;
-- hiçbir satır silinmez, hiçbir kolon düşürülmez. Supabase SQL Editor'da
-- çalıştırın.
--
-- ═══════════════════════════════════════════════════════════════════════
-- ÖLÇÜM ÖNCE — ÜÇ SORU, KAYNAKLI CEVAP (25.08.2026)
-- ═══════════════════════════════════════════════════════════════════════
--
-- 1) SEKTÖR MÜŞTERİ TAKİP SAYFASINDA NE GÖSTERİYOR
--    · ONFLEET (support.onfleet.com — "Customized Recipient Experience"):
--      "Organizations have the option to configure the NUMBER OF STOPS they
--       would like to be displayed to recipients by enabling the option and
--       then entering the number of stops you would like to display. If the
--       setting is unchecked, the number of stops is not shown."
--      Ayrıca: "Dispatchers can choose whether to display the NAMES OF THE
--       DRIVERS on the recipient tracking page" (yani şoför adı KAPALI
--       olabilen bir seçenek — bizde varsayılan kapalı, TAKIP_SOFOR_ADI).
--      ETA için: "you will be able to display an ETA RANGE and add a BUFFER
--       to the ETA shown to recipients" — yani yanlış kesinlik sektörde de
--       bilinçle törpüleniyor.
--    · TRACK-POD (track-pod.com/blog/track-and-trace, /blog/notifications-2-0):
--      müşteri linke tıklayınca "a map with the exact location of their
--      driver" ve "dynamic ETA available for them on the same page" görüyor;
--      bildirim "after the driver left the PREVIOUS stop" tetikleniyor — yani
--      referans nokta KENDİ durağı, seferin tamamı değil.
--    · BRINGG (bringg.com/resources/real-time-delivery-tracking):
--      "the driver's live location" + "estimated arrival times using GPS,
--      traffic data, and DELIVERY PROGRESS", ve sektör pratiği olarak
--      "automated 'next stop' alerts when delivery is ONE STOP AWAY".
--    SONUÇ: "önünüzde N durak var" gerçek bir sektör öğesi ve AÇILIP
--    KAPANABİLİR olmalı. Uyguladık: `TAKIP_SIRA_ESIGI` (varsayılan 10) —
--    eşiğin üstünde sayı GÖSTERİLMEZ ("önünüzde 47 durak" hem cesaret kırıcı
--    hem düşük güvenilirlikte bir tahmindir).
--
-- 2) ETA DURAK EKSENİNE NASIL TAŞINIR
--    Sektör formülü (upperinc.com/blog/delivery-eta, locus.sh guide):
--      "A scheduled ETA is calculated as: distance to stop divided by expected
--       travel speed, PLUS planned service time at the stop, PLUS CUMULATIVE
--       TIME FROM PRIOR STOPS."
--    Ve uyarısı: "Applying a UNIFORM service time estimate, such as 3 minutes
--    per stop, ignores the wide variance ... and is often the LARGEST SOURCE
--    OF ETA ERROR on multi-stop routes."
--    Bizde bu uyarının cevabı ZATEN ŞEMADA: `sefer_duraklari.tahmini_sure_dk`
--    durak başına planlanan süre. ETA zinciri şöyle kuruluyor
--    (lib/takip-eta.ts → `durakEtaHesapla`):
--      araç → S1 → S2 → … → MÜŞTERİNİN DURAĞI
--      her bacak: haversine × yol katsayısı ÷ etkin hız
--      her ARA durak: `tahmini_sure_dk` (yoksa kiracı varsayılanı)
--      müşterinin KENDİ durağının servis süresi SAYILMAZ — sorulan şey VARIŞ.
--    ⚠️ Bu tabloya kolon EKLENMEDİ: hesabın tüm girdileri zaten var
--    (`sefer_duraklari` + `device_telemetry`). Bir "hesaplanmış ETA" kolonu,
--    her telemetri turunda tazelenmesi gereken ikinci bir gerçek olurdu.
--
-- 3) MEVCUT SEFER BAZLI LİNKLER NASIL KORUNUR
--    ÖLÇÜLDÜ (canlı, 25.08.2026): HAK61 ve Sendigo'da `sefer_takip_linkleri`
--    **0 satır** — ne açık ne kapalı tek bir link yok. galzura-demo service
--    anahtarı yok, ölçülemedi.
--    Yani bu bir VERİ taşıma sorunu değil, SÖZLEŞME sorunu. Korunma şekli:
--      · `durak_id` NULLABLE ve `durak_bagli` varsayılanı FALSE → var olan her
--        satır otomatik olarak "sefer bazlı link"tir, hiçbir güncelleme
--        gerekmez.
--      · Okuma yolu (`lib/takip-db.ts`) `durak_bagli=false` satırlarda
--        079'daki kodun AYNISINI çalıştırır; ETA fonksiyonu bile aynı
--        (`etaHesapla` DEĞİŞMEDİ, `durakEtaHesapla` AYRI eklendi).
--
-- ═══ NEDEN İKİ KOLON — `durak_id` YETMİYOR ═══
--
-- Durak SİLİNİRSE ne olmalı? Üç seçenek denendi, üçü de kusurlu:
--   (a) `on delete cascade` → link SATIRI yok olur. Ama 079 linki bir KAYIT
--       sayıyor ("kim üretti, kaç kez açıldı"); müşteriye link gönderdiğimizin
--       izini silmek o duruşa aykırı. Müşteri de "bulunamadı" görür — yani
--       "yanlış kopyaladım" der, oysa link gerçekti.
--   (b) `on delete set null` TEK BAŞINA → link sessizce SEFER BAZLI linke
--       dönüşür ve müşteri BAŞKA BİR MÜŞTERİNİN durağının ETA'sını görmeye
--       başlar. Sessiz ve yanlış: kabul edilemez.
--   (c) `on delete restrict` → yönetici durağı silemez. Link 2 saatte ölüyor;
--       meşru bir işlemi geçici bir kayıt yüzünden bloklamak yanlış.
-- Seçilen: `set null` + AYRI bir `durak_bagli` bayrağı. Üçlü ayrım netleşiyor:
--   durak_bagli=false                 → SEFER bazlı link (079 davranışı)
--   durak_bagli=true,  durak_id dolu  → DURAK bazlı link
--   durak_bagli=true,  durak_id NULL  → durağı silinmiş link → LİNK KAPANDI
-- Üçüncü hâlde müşteri dürüst bir "bu takip sona erdi" cümlesi görür ve link
-- KAYDI yerinde kalır.
--
-- ⚠️ Uygulama katmanı ayrıca durağı silmeden ÖNCE linklerini İPTAL EDİYOR
-- (app/actions/duraklar.ts): normal yolda müşteri "gönderen linki kapattı"
-- görür, ki en doğru cümle odur. (c) hâli yalnız ham SQL ile silinirse oluşur.
--
-- ═══ NEDEN DÖRDÜNCÜ ÖLÜM YOLU TABLOYA YAZILMIYOR ═══
--
-- Link dört yoldan ölür: (a) süre doldu, (b) yönetici iptal etti, (c) SEFER
-- kapandı, (d) DURAK kapandı (tamamlandi/atlandi). 079 (c) için bayrak
-- koymamıştı — durum zaten `seferler.durum`da. (d) için de koyulmuyor: durum
-- `sefer_duraklari.durum`da ve okuma anında bakılıyor. Bayrak, durak kapanınca
-- N linki güncelleyen ikinci bir yazma yolu doğurur ve iki gerçek sessizce
-- ayrışırdı.
--
-- ═══ RLS ═══
-- Kapalı — 079 ile aynı. Yalnız service-role okur/yazar.
-- =====================================================================

begin;

/**
 * DURAK BAĞI.
 *
 * `on delete set null` — gerekçesi başlıktaki üç seçenek karşılaştırmasında.
 * Sefer silinince link zaten 079'un `on delete cascade`ıyla gidiyor; bu FK
 * yalnız DURAK ekseni için.
 */
alter table public.sefer_takip_linkleri
  add column if not exists durak_id uuid references public.sefer_duraklari(id) on delete set null;

/**
 * "BU LİNK BİR DURAĞA BAĞLIYDI" — kalıcı işaret.
 *
 * `durak_id` NULL'a düştüğünde (durak silindi) linkin NE OLDUĞUNU söyleyen tek
 * şey bu. Varsayılan `false`: mevcut satırların hepsi sefer bazlıdır ve
 * taşımaya gerek yoktur (§3 ölçümü — canlıda zaten 0 satır).
 */
alter table public.sefer_takip_linkleri
  add column if not exists durak_bagli boolean not null default false;

/**
 * TUTARLILIK: `durak_id` doluysa `durak_bagli` da DOLU olmalı.
 *
 * Tersi serbest (bagli=true + id=null → durağı silinmiş link). Kısıt olmadan
 * "durak bağlı ama bayrak false" gibi anlamsız bir satır yazılabilirdi ve
 * okuma yolu onu sefer bazlı sanardı — yani sessizce yanlış ETA.
 *
 * `do $$ … $$` sarmalı: `add constraint if not exists` PostgreSQL'de YOK,
 * dosya ikinci kez çalıştığında düşmesin.
 */
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.sefer_takip_linkleri'::regclass
       and conname = 'sefer_takip_durak_butun'
  ) then
    alter table public.sefer_takip_linkleri
      add constraint sefer_takip_durak_butun
      check (durak_id is null or durak_bagli);
  end if;
end $$;

/**
 * "BU DURAĞIN LİNKLERİ" — iki çağrı noktası:
 *   · panel durak satırında link listesi,
 *   · durak silinmeden önce linkleri iptal etme (uygulama katmanı).
 * Kısmi indeks: sefer bazlı linkler (çoğunluk) indekse hiç girmez.
 */
create index if not exists sefer_takip_durak_idx
  on public.sefer_takip_linkleri (durak_id)
  where durak_id is not null;

comment on column public.sefer_takip_linkleri.durak_id is
  'Linkin bağlı olduğu durak (083). NULL + durak_bagli=false → sefer bazlı link (079 davranışı). NULL + durak_bagli=true → durağı silinmiş, link KAPANMIŞ sayılır.';
comment on column public.sefer_takip_linkleri.durak_bagli is
  'Bu link bir DURAĞA bağlı olarak üretildi mi. durak_id NULL''a düştüğünde (durak silindi) linkin ne olduğunu söyleyen tek işaret — bkz. migration 083 başlığı.';

commit;

notify pgrst, 'reload schema';

-- =====================================================================
-- ÇALIŞTIRDIKTAN SONRA BEKLENEN HÂL (ayrı çalıştırın)
--
--   select count(*) from information_schema.columns
--    where table_schema='public' and table_name='sefer_takip_linkleri'
--      and column_name in ('durak_id','durak_bagli');            → 2
--
--   select count(*) from pg_constraint
--    where conrelid='public.sefer_takip_linkleri'::regclass
--      and conname='sefer_takip_durak_butun';                    → 1
--
--   select count(*) from pg_indexes
--    where schemaname='public' and indexname='sefer_takip_durak_idx';  → 1
--
--   -- MEVCUT LİNKLER BOZULMADI: hepsi sefer bazlı olarak kaldı.
--   select count(*) filter (where durak_bagli) as durak_bazli,
--          count(*) filter (where not durak_bagli) as sefer_bazli
--     from public.sefer_takip_linkleri;
--   → HAK61: 0 / 0 · Sendigo: 0 / 0  (ölçüldü 25.08.2026 — hiç link yok)
--
--   -- Tutarlılık kısıtı GERÇEKTEN çalışıyor mu (satır YAZMADAN sınama):
--   --   insert … (durak_id, durak_bagli) values ('<durak>', false);
--   --   → HATA: sefer_takip_durak_butun
--
-- ⚠️ 083 UYGULANMAZSA: takip linki 079 davranışını sürdürür (sefer bazlı) ve
-- durak bazlı link üretimi KAPALI kalır. Panel "bu kurulumda kapalı" der;
-- girişsiz sayfa aynen çalışır. Aynı kademeli düşüş 056/058/077/078/079/080/
-- 082'de de var.
--
-- ⚠️ ÖN KOŞUL: 079 (sefer_takip_linkleri) ve 082 (sefer_duraklari). İkisi de
-- yoksa bu dosya FK'yi kuramaz ve okunur bir hatayla durur.
-- =====================================================================

-- HAK61 / Galzura Fleet — Migration 090 (HAM TELEMETRİ SAKLAMA POLİTİKASI)
-- =====================================================================
-- Ham GPS izi için 90 GÜNLÜK saklama. Additive + idempotent.
-- Supabase SQL Editor'da çalıştırın.
--
-- ═══════════════════════════════════════════════════════════════════════
-- ÖLÇÜM 1 — BUGÜN POLİTİKA YOK (HAK61 canlı, 26.08.2026)
-- ═══════════════════════════════════════════════════════════════════════
--
--   device_telemetry : 1.611.074 satır · en eski kayıt 13.07.2026 = 44 gün
--
-- 44 gün CNIL'in 2 aylık çıtasının altında ama bu bir POLİTİKA değil, bir
-- TESADÜF: entegrasyon o gün başladı. Hiçbir mekanizma bu sayının 400 güne
-- çıkmasını engellemiyor. Migration 054 (purge_old_telemetry) YALNIZ
-- galzura-demo'da kurulu ve 14 gün tutuyor; gerçek kiracıda HİÇ YOK.
--
-- ═══════════════════════════════════════════════════════════════════════
-- 🔴 ÖLÇÜM 2 — GÜNLÜK ÖZET YANLIŞ SAYI ÜRETİYOR, AYLIK ÜRETMİYOR
-- ═══════════════════════════════════════════════════════════════════════
--
-- Canlıda ayrı bir oturumun bıraktığı `daily_vehicle_metrics` tablosu var
-- (20 satır · TEK gün 22.08.2026 · 20/30 araç · tek seferlik, yazan cron
-- yok, okuyan kod yok). Şekli GÜN başına tek satır: odometre başı/sonu,
-- yakıt başı/sonu.
--
-- Bu şeklin yeterli olup olmadığını ÖLÇTÜM. buildFuelReport'un 28 günlük
-- gerçek cevabı 2.602,6 L. Aynı pencere parçalara bölünüp toplandığında:
--
--     parça |  toplam L | sapma
--     ------+-----------+-------
--        1g |    3009,9 | +15,6%   ← GÜNLÜK ÖZET
--        2g |    2986,0 | +14,7%
--        7g |    2714,0 |  +4,3%
--       14g |    2591,9 |  -0,4%
--       28g |    2602,5 |  -0,0%   ← AYLIK ÖZET
--
-- (14 günlük ikinci ölçüm: gerçek 1.194,98 L, günlük toplam 1.540,1 L = +%28,9)
--
-- SEBEP: yakıt motoru (027 + 052) ardışık okuma DİZİSİ üzerinde çalışıyor —
-- 30 satırlık de-glitch penceresi, 15 dakikalık seri birleştirme, dolum
-- tespiti. Gün sınırı bu diziyi kesiyor: gece yarısını aşan dolum iki kez
-- sayılıyor, kenar okumaları süzgeçten kaçıyor.
--
-- 🔑 KARAR: ÖZET KATMANI **AYLIK**. `daily_vehicle_metrics` bu iş için
-- KULLANILMIYOR ve bu migration ona DOKUNMUYOR (başka bir oturumun işi).
--
-- ═══════════════════════════════════════════════════════════════════════
-- 🔴 ÖLÇÜM 3 — 10 YÜZEYDEN 7'Sİ SESSİZCE YANLIŞ SAYI ÜRETİRDİ
-- ═══════════════════════════════════════════════════════════════════════
--
--   doğru çalışır : Mevzuat motoru · Bölge ziyaretleri (zone_visits KALICI)
--   boşalır       : Rota geçmişi (KURTARILAMAZ — özet tablosunda lat/lon yok)
--   sessizce yanlış: Yakıt · Maliyet(€/km) · CO₂ · Sefer kârlılığı ·
--                    Güvenlik skoru(payda) · Haftalık aksiyon(K3 sessiz_arac) ·
--                    Sessiz cihaz alarmı
--
-- VE EN KÖTÜSÜ BUGÜN DE VAR: veri OLMAYAN bir pencerede (01.03→01.04.2026)
-- ölçtüm —
--     buildFuelReport → available:true · totalConsumedLiters:0 · 29 araç
--     buildCostReport → totalEur:0 · fuelEur:0
--     co2Panosu       → kg:null · 29 plaka "ölçülemedi"   ✅ DOĞRU olan bu
--
-- Yani yakıt/maliyet raporu ölçülmemiş bir dönemi "0 L · 0,00 €" diye
-- basıyor. Silme açılırsa bu kusur GERÇEK VERİYİ uydurma sıfıra çeviren bir
-- makineye dönüşür. Bu yüzden ürün tarafında "kapsam dışı pencere"
-- sözleşmesi silmeden ÖNCE kurulmalıdır.
--
-- ═══════════════════════════════════════════════════════════════════════
-- ⚠️ BU MIGRATION HİÇBİR SATIR SİLMEZ
-- ═══════════════════════════════════════════════════════════════════════
--
-- `tenant_saklama.silme_acik` varsayılanı **false**. Migration tabloları ve
-- fonksiyonları kurar; silme, bir insan ayarı açana kadar BAŞLAMAZ. Cron
-- kaydı kurulsa bile kapalı ayarda 200 döner ve "kapali" der.
--
-- ═══ RLS ═══
-- Kapalı — şemanın geri kalanıyla tutarlı. Yalnız service-role yazar.
-- =====================================================================

begin;

-- ═════════════════════ 1 · KİRACI SAKLAMA AYARI ════════════════════════

create table if not exists public.tenant_saklama (
  -- 076/089'daki desen: tek satır, sabit anahtar.
  id text primary key default 'singleton' check (id = 'singleton'),

  /**
   * HAM İZ SAKLAMA SÜRESİ (gün). VARSAYILAN 90.
   *
   * Neden 90 (gerekçe docs/SAKLAMA-POLITIKASI.md'de tam metin):
   *   · CMR Md. 32 — uluslararası taşımada 1 yıllık zamanaşımı; teslimat
   *     anlaşmazlığı tipik olarak ilk haftalarda çıkar, çeyrek yıl payı
   *     operasyonel olarak yeterli.
   *   · CNIL ham konum için 2 ay diyor — 90 gün bunun üstünde, bu yüzden
   *     GEREKÇE yazılı olmak zorunda (bkz. belge).
   *   · İtalya (Garante, 01/2025) 180 günü cezalandırdı — 50.000 €.
   *   · Almanya 400 ve 150 günü orantısız buldu.
   * 90 gün bu bandın ALT yarısında ve türetilmiş kayıtlar ayrıca yaşıyor.
   *
   * ALT SINIR 30: daha kısası ürünün kendi 30 günlük varsayılan pencerelerini
   * (CO₂ panosu, kârlılık) kırar — yani ayar ekranın altını oyamaz.
   * ÜST SINIR 400: Almanya'nın açıkça orantısız bulduğu sayı; ürün onu
   * yazdırmaz.
   */
  ham_gun integer not null default 90
    check (ham_gun between 30 and 400),

  /**
   * 🔴 SİLME ANAHTARI — VARSAYILAN KAPALI.
   *
   * Fail-closed: mekanizma kurulu olsa, cron kaydı girilmiş olsa bile
   * kapalıyken TEK SATIR silinmez. Açmak bilinçli bir insan eylemidir ve
   * `updated_by` ile ize düşer.
   *
   * Ayrıca kod tarafında ikinci bir kapı var: özeti YAZILMAMIŞ bir ay
   * silinemez (bkz. §3 vehicle_month_metrics ve lib/saklama-db.ts).
   */
  silme_acik boolean not null default false,

  /**
   * 90 GÜNÜN ÜSTÜ İÇİN YAZILI GEREKÇE.
   *
   * ⚠️ NULL = gerekçe yok. Kod, ham_gun > 90 iken gerekçe boşsa ayarı
   * REDDEDER. Denetimde sorulacak ilk soru "neden bu kadar uzun" olacak;
   * cevabı ürünün içinde durmalı, birinin hafızasında değil.
   */
  gerekce text,

  updated_at timestamptz not null default now(),
  updated_by uuid references public.workers(id) on delete set null
);

comment on table public.tenant_saklama is
  'Ham telemetri saklama ayarı (090). Varsayılan 90 gün, silme KAPALI. 90 günün üstü yazılı gerekçe ister; alt sınır 30 (ürünün kendi pencerelerini kırmasın), üst sınır 400 (Almanya orantısız buldu).';

comment on column public.tenant_saklama.silme_acik is
  'FAIL-CLOSED silme anahtarı. false iken cron çalışsa bile hiçbir satır silinmez.';

insert into public.tenant_saklama (id) values ('singleton') on conflict (id) do nothing;

-- ═════════════════════ 2 · CİHAZ ÖMÜR İZİ ══════════════════════════════

/**
 * ARACIN İLK/SON TELEMETRİ ANI — ham satırlar silinse de yaşar.
 *
 * NEDEN: haftalık aksiyon kuralı K3 "sessiz araç" ve yönetici panosundaki
 * "sessiz cihaz" alarmı, aracın SON ham satırının yaşına bakıyor. 90 günden
 * uzun susmuş bir aracın tüm satırları silinince `son_kayit` NULL döner ve
 * araç uyarı listesinden SESSİZCE DÜŞER — yani en çok ilgilenilmesi gereken
 * araç görünmez olur. Tam tersi bir sonuç.
 *
 * Bu tablo o iki sayıyı ham akıştan BAĞIMSIZ tutar. Tek satır/araç.
 */
create table if not exists public.vehicle_telemetry_lifetime (
  vehicle_id uuid primary key references public.vehicles(id) on delete cascade,
  ilk_kayit timestamptz,
  son_kayit timestamptz,
  toplam_satir bigint,
  guncellendi_at timestamptz not null default now()
);

comment on table public.vehicle_telemetry_lifetime is
  'Aracın ilk/son telemetri anı (090). Ham satırlar silinince "sessiz araç" uyarısının kaybolmaması için ham akıştan bağımsız tutulur.';

-- ═════════════════════ 3 · AYLIK ÖZET ══════════════════════════════════

/**
 * AYLIK ARAÇ ÖZETİ — ham iz silindikten sonra raporun tek kaynağı.
 *
 * ⚠️ GRANÜLERLİK NEDEN AY: yukarıdaki ÖLÇÜM 2. Günlük özet yakıtı %15,6-28,9
 * şişiriyor çünkü yakıt motoru ardışık okuma DİZİSİ üzerinde çalışıyor ve
 * gün sınırı diziyi kesiyor. Aylık parça sapması %0,0.
 *
 * 🔑 DEĞERLER NASIL ÜRETİLİR: raporun KENDİ motoru ayın tamamı için TEK
 * pencere olarak çağrılır ve çıktısı olduğu gibi yazılır. Yani özet,
 * raporun kendi cevabının dondurulmuş hâlidir — ikinci bir hesap değil.
 * İkinci bir hesap yazmak, özetin raporla çelişmesine giden en kısa yol
 * olurdu (aynı ders lib/co2-db.ts ve mobil Analiz ucunda da yazılı).
 *
 * ⚠️ NE KURTARMAZ — dürüst liste:
 *   · ROTA GEÇMİŞİ. lat/lon burada YOK ve olamaz: bir ayın konum dizisini
 *     saklamak "ham izi sakla" demenin başka yolu olurdu. Rota, saklama
 *     süresi dolduğunda GERÇEKTEN kaybolur ve ekran bunu SÖYLER.
 *   · GÜN/SAAT KIRILIMI. Ay içi bir pencere (ör. 3-17 Mayıs) özetten
 *     üretilemez. Ekran "ay granülerliğinde" der, sayı uydurmaz.
 *   · VARDİYA EKSENİ. Şoför km'si vardiya penceresinden çıkıyor; onun
 *     dondurulması ayrı (bkz. §4 time_entries.km_dondu).
 */
create table if not exists public.vehicle_month_metrics (
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,

  -- Ayın İLK GÜNÜ (date). check ile zorlanıyor: yanlış granülerlikte satır
  -- yazılırsa tablo sessizce gün-bazlı olur ve ÖLÇÜM 2'deki hata geri gelir.
  ay date not null check (ay = date_trunc('month', ay)::date),

  -- ── km (odometre açıklığı) ────────────────────────────────────────────
  km numeric(12,2),
  odometre_ilk numeric(12,2),
  odometre_son numeric(12,2),

  -- ── yakıt (raporun kendi çıktısı, ayın tamamı tek pencere) ────────────
  litre numeric(12,2),
  yuzde_tuketim numeric(10,2),
  dolum_sayisi integer,
  dolum_yuzde numeric(10,2),
  dusus_sayisi integer,
  dusus_yuzde numeric(10,2),
  l_100km numeric(10,2),

  -- ── güvenilirlik (ölçülemedi ≠ 0 için ŞART) ───────────────────────────
  ornek_sayisi bigint,
  yakit_ornek_sayisi bigint,
  yakit_sifir_okuma bigint,
  ilk_kayit timestamptz,
  son_kayit timestamptz,
  /**
   * ⚠️ ÖLÇÜLEMEDİYSE SEBEBİ. NULL = ölçüldü.
   * 'cihaz_yok' · 'yetersiz_okuma' · 'sensor_arizali' · 'odometre_yok'
   * Bu kolon olmadan özet tablosu "0 L" ile "ölçülemedi"yi ayıramaz ve
   * ürünün en temel kuralı kırılır.
   */
  olculemedi_sebep text,

  -- ── köken ─────────────────────────────────────────────────────────────
  hesaplandi_at timestamptz not null default now(),
  -- Motor değişirse eski özetler hangi sürümle üretildiğini taşısın.
  hesap_surumu text not null default '090.1',
  -- Bu ayın ham satırları silindi mi? Silinmişse özet YENİDEN ÜRETİLEMEZ.
  ham_silindi_at timestamptz,

  primary key (vehicle_id, ay)
);

comment on table public.vehicle_month_metrics is
  'Aylık araç özeti (090) — ham iz silindikten sonraki tek kaynak. Granülerlik AY: günlük parçalama yakıtı %15,6-28,9 şişiriyor (ölçüldü), aylık parçanın sapması %0,0. Değerler raporun KENDİ motorundan, ayın tamamı tek pencere olarak alınır.';

comment on column public.vehicle_month_metrics.olculemedi_sebep is
  'NULL = ölçüldü. Dolu = bu araç/ay ölçülemedi ve SEBEBİ bu. "0" ile "bilinmiyor" bu kolonla ayrılır.';

comment on column public.vehicle_month_metrics.ham_silindi_at is
  'Bu ayın ham satırlarının silindiği an. Doluysa özet YENİDEN ÜRETİLEMEZ — üzerine yazılmasın.';

create index if not exists idx_vmm_ay on public.vehicle_month_metrics (ay desc);

-- ═════════════════════ 4 · VARDİYA KM DONDURMA ═════════════════════════

/**
 * VARDİYANIN KM ÖLÇÜM YARGISI — ham silinmeden ÖNCE dondurulur.
 *
 * NEDEN: lib/km-quality.ts iki kapıyla "bu vardiyanın km'si gerçekten 0 mı,
 * yoksa ölçülemedi mi" diye soruyor ve İKİNCİ KAPI ham telemetriye bakıyor
 * (vardiya penceresinde speed_kmh >= 5 okuma var mı). Ham silinince kapı
 * her sıfır-farklı vardiyayı "ölçülemedi"ye çevirir — sessizce, geriye
 * dönük ve KULLANICI SEÇİMLİ aralıktaki Excel/PDF çıktısına kadar.
 *
 * ⚠️ SIRA ŞARTI: bu kolon, silmenin İLK KOŞUSUNDAN ÖNCE doldurulmalıdır.
 * Sonra doldurulursa ham zaten gitmiş olur ve backfill her satıra sessizce
 * "ölçülemedi" yazar — düzeltmek istediği hatayı kalıcılaştırır.
 * Kod bu sırayı zorluyor: özet/dondurma tamamlanmamışsa silme reddedilir.
 */
alter table public.time_entries
  add column if not exists km_dondu boolean;

alter table public.time_entries
  add column if not exists km_dondu_at timestamptz;

comment on column public.time_entries.km_dondu is
  'Ham silinmeden önce dondurulmuş km ölçüm yargısı (090). true = km ölçüldü, false = ölçülemedi, NULL = henüz dondurulmadı. lib/km-quality.ts ham yerine bunu okur.';

-- ═════════════════════ 5 · SİLME FONKSİYONLARI ═════════════════════════

/**
 * device_telemetry parça silme — 054'ün genelleştirilmiş hâli.
 *
 * 054 ile FARKLAR:
 *   · varsayılan p_days 14 → 90 (demo çağrısı p_days'i AÇIKÇA veriyor,
 *     yani galzura-demo'nun 14 günü DEĞİŞMEZ)
 *   · alt sınır 7'de KALDI — demo'yu kırmamak için bilinçli
 *
 * ctid ile parça silme: tek `delete ... where recorded_at < x` 1,6 milyon
 * satırda statement timeout yer ve HİÇBİR ŞEY silinmez.
 */
create or replace function public.purge_old_telemetry(
  p_days int default 90,
  p_limit int default 20000
)
returns bigint
language plpgsql
volatile
as $$
declare
  v_cutoff timestamptz;
  v_deleted bigint;
begin
  v_cutoff := now() - make_interval(days => greatest(coalesce(p_days, 90), 7));

  with victims as (
    select ctid
    from public.device_telemetry
    where recorded_at < v_cutoff
    order by recorded_at
    limit greatest(coalesce(p_limit, 20000), 1)
  )
  delete from public.device_telemetry dt
  using victims v
  where dt.ctid = v.ctid;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

/**
 * driver_locations parça silme — telefon GPS'inin kalıntısı.
 *
 * NOT: konum/rota tek kaynağı 019ae24'ten beri FMC003; driver_locations
 * artık YAZILMIYOR ama tablo duruyor ve içindeki geçmiş konum verisi
 * aynı hukuki kategoride. Saklama politikası onu da kapsar.
 *
 * ⚠️ ŞEMA CANLIDA DOĞRULANDI (26.08.2026): kolonlar
 *   id · worker_id · time_entry_id · latitude · longitude · accuracy · recorded_at
 * Zaman kolonu `recorded_at` (device_telemetry ile aynı ad) — `created_at`
 * bu tabloda YOK. Yine de AYRI fonksiyon: tek fonksiyona tablo adı
 * parametresi geçirmek (dinamik SQL) silme yüzeyini genişletirdi ve
 * "hangi tablo silinecek" kararını çağırana bırakırdı.
 *
 * Bugünkü hacim ihmal edilebilir (~81 satır) — fonksiyon miktar için değil,
 * POLİTİKA BÜTÜNLÜĞÜ için var: konum verisi hangi tabloda durursa dursun
 * aynı süreye tabidir.
 */
create or replace function public.purge_old_driver_locations(
  p_days int default 90,
  p_limit int default 20000
)
returns bigint
language plpgsql
volatile
as $$
declare
  v_cutoff timestamptz;
  v_deleted bigint;
begin
  v_cutoff := now() - make_interval(days => greatest(coalesce(p_days, 90), 7));

  with victims as (
    select ctid
    from public.driver_locations
    where recorded_at < v_cutoff
    order by recorded_at
    limit greatest(coalesce(p_limit, 20000), 1)
  )
  delete from public.driver_locations dl
  using victims v
  where dl.ctid = v.ctid;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

/**
 * ÖZET ÜRETİMİ İÇİN AYLIK UÇ DEĞERLER — tek turda, araç × ay.
 *
 * Yakıt/tüketim raporun kendi motorundan alınıyor (uygulama katmanı);
 * burada YALNIZ odometre açıklığı ve sayım/uç bilgileri var, çünkü bunlar
 * saf SQL'de doğru ve ucuz. İkisini karıştırmamak bilinçli.
 */
create or replace function public.telemetry_month_spans(
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  vehicle_id uuid,
  ay date,
  ornek_sayisi bigint,
  ilk_kayit timestamptz,
  son_kayit timestamptz,
  odometre_ilk numeric,
  odometre_son numeric,
  yakit_ornek_sayisi bigint,
  yakit_sifir_okuma bigint
)
language sql
stable
as $$
  select
    dt.vehicle_id,
    date_trunc('month', dt.recorded_at)::date as ay,
    count(*)                                   as ornek_sayisi,
    min(dt.recorded_at)                        as ilk_kayit,
    max(dt.recorded_at)                        as son_kayit,
    min(dt.odometer_km) filter (where dt.odometer_km is not null)::numeric as odometre_ilk,
    max(dt.odometer_km) filter (where dt.odometer_km is not null)::numeric as odometre_son,
    count(*) filter (where dt.fuel_level_pct is not null)                  as yakit_ornek_sayisi,
    count(*) filter (where dt.fuel_level_pct = 0)                          as yakit_sifir_okuma
  from public.device_telemetry dt
  where dt.recorded_at >= p_from
    and dt.recorded_at <  p_to
  group by 1, 2
$$;

/**
 * CİHAZ ÖMÜR İZİNİ TAZELE — ham silinmeden ÖNCE çağrılır.
 *
 * `greatest`/`least` ile birleştirme: ham kısmen silinmiş olsa bile daha
 * eski bir `ilk_kayit` KAYBEDİLMEZ, daha yeni bir `son_kayit` GERİ GİTMEZ.
 * Yani fonksiyon defalarca çalıştırılabilir ve her koşuda doğrudur.
 */
create or replace function public.refresh_telemetry_lifetime()
returns bigint
language plpgsql
volatile
as $$
declare
  v_rows bigint;
begin
  insert into public.vehicle_telemetry_lifetime (vehicle_id, ilk_kayit, son_kayit, toplam_satir, guncellendi_at)
  select dt.vehicle_id, min(dt.recorded_at), max(dt.recorded_at), count(*), now()
  from public.device_telemetry dt
  group by dt.vehicle_id
  on conflict (vehicle_id) do update set
    ilk_kayit      = least(public.vehicle_telemetry_lifetime.ilk_kayit, excluded.ilk_kayit),
    son_kayit      = greatest(public.vehicle_telemetry_lifetime.son_kayit, excluded.son_kayit),
    toplam_satir   = excluded.toplam_satir,
    guncellendi_at = now();

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

commit;

notify pgrst, 'reload schema';

-- =====================================================================
-- ÇALIŞTIRDIKTAN SONRA BEKLENEN HÂL (doğrulama sorguları):
--
--   select * from public.tenant_saklama;
--   → 1 satır: singleton · ham_gun=90 · silme_acik=FALSE · gerekce=null
--
--   select count(*) from public.vehicle_month_metrics;
--   → 0   (özet henüz üretilmedi; cron ya da /admin/saklama üretir)
--
--   select count(*) from public.vehicle_telemetry_lifetime;
--   → 0   (ilk refresh_telemetry_lifetime() çağrısında dolar)
--
--   select count(*) from public.time_entries where km_dondu is not null;
--   → 0   (dondurma ilk koşuda yapılır)
--
--   select proname from pg_proc where proname in
--     ('purge_old_telemetry','purge_old_driver_locations',
--      'telemetry_month_spans','refresh_telemetry_lifetime');
--   → 4 satır
--
-- MEVCUT VERİYE ETKİSİ: **SIFIR SATIR SİLİNİR.** Bu migration yalnız tablo
-- ve fonksiyon kurar; `silme_acik` false olduğu için cron kaydı girilse
-- bile silme başlamaz. galzura-demo'nun 14 günlük temizliği de değişmez
-- (çağrı p_days'i açıkça veriyor).
-- =====================================================================

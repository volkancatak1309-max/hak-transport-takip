-- HAK61 / Galzura Fleet — Migration 090 (SAKLAMA: UYARI + ELLE SİLME)
-- =====================================================================
-- Additive + idempotent. Supabase SQL Editor'da çalıştırın.
--
-- ═══════════════════════════════════════════════════════════════════════
-- 🔴 BU MIGRATION HİÇBİR OTOMATİK SİLME KURMAZ
-- ═══════════════════════════════════════════════════════════════════════
--
-- Sistem **yalnız hesaplar ve UYARIR**. Silmeye bir insan karar verir,
-- /admin/saklama ekranından, aralığı kendisi seçerek, çift onayla.
--
-- Neden: saklama süresi ve silme kararı **veri sorumlusunun** (müşterinin)
-- kararıdır; Galzura veri İŞLEYENDİR. Ürünün bir kiracının verisini kendi
-- takvimine göre silmesi, işleyenin sorumlu yerine karar vermesi olurdu.
-- Gece koşan iş "şu kadar satırınız eşiği geçti" der ve durur.
--
-- Bu yüzden burada `silme_acik` diye bir anahtar YOK, gün sayısına göre
-- silen bir fonksiyon YOK. Silme fonksiyonları ARALIK alır ve yalnız
-- ekrandan, denetim izi yazılarak çağrılır.
--
-- ═══════════════════════════════════════════════════════════════════════
-- 🔴 EŞİK DEĞERLERİ BU MIGRATION'DA UYDURULMUYOR
-- ═══════════════════════════════════════════════════════════════════════
--
-- `saklama_esikleri` tablosu KURULUR ama **BOŞ BIRAKILIR**. Yasal eşikler
-- ayrı bir araştırma turuyla, kaynak linki ve doğrulanma tarihiyle
-- doldurulacak. Uydurma bir gün sayısı DACH müşterisine giderse sorumluluk
-- doğar; ürün "eşik doğrulanmadı" demeyi, yanlış bir sayı demeye tercih eder.
--
-- ═══════════════════════════════════════════════════════════════════════
-- ÖLÇÜM 1 — BUGÜN POLİTİKA YOK (HAK61 canlı, 26.08.2026)
-- ═══════════════════════════════════════════════════════════════════════
--
--   device_telemetry : 1.611.074 satır · en eski kayıt 13.07.2026 = 44 gün
--
-- 44 gün bir POLİTİKA değil bir TESADÜF: entegrasyon o gün başladı. Hiçbir
-- mekanizma bu sayının 400 güne çıkmasını engellemiyor ve kimse haberdar
-- olmuyor. Bu migration'ın asıl işi **görünürlük**.
--
-- ═══════════════════════════════════════════════════════════════════════
-- 🔴 ÖLÇÜM 2 — GÜNLÜK ÖZET YANLIŞ SAYI ÜRETİYOR, AYLIK ÜRETMİYOR
-- ═══════════════════════════════════════════════════════════════════════
--
-- buildFuelReport'un 28 günlük gerçek cevabı 2.602,6 L. Aynı pencere
-- parçalara bölünüp toplandığında (HAK61 canlı):
--
--     parça |  toplam L | sapma
--     ------+-----------+-------
--        1g |    3009,9 | +15,6%   ← GÜNLÜK ÖZET
--        7g |    2714,0 |  +4,3%
--       28g |    2602,5 |  -0,0%   ← AYLIK ÖZET
--
-- (14 günlük ikinci ölçüm: gerçek 1.194,98 L, günlük toplam 1.540,1 L = +%28,9)
--
-- SEBEP: yakıt motoru (027 + 052) ardışık okuma DİZİSİ üzerinde çalışıyor —
-- 30 satırlık de-glitch penceresi, 15 dakikalık seri birleştirme. Gün sınırı
-- diziyi kesiyor; gece yarısını aşan dolum iki kez sayılıyor.
--
-- 🔑 KARAR: ÖZET **AYLIK**. Canlıdaki `daily_vehicle_metrics` (20 satır, TEK
-- gün, yazan/okuyan kod yok) bu iş için YANLIŞ ŞEKİL; bu migration ona
-- DOKUNMUYOR.
--
-- ═══════════════════════════════════════════════════════════════════════
-- 🔴 ÖLÇÜM 3 — SİLME HANGİ YÜZEYİ BOZAR
-- ═══════════════════════════════════════════════════════════════════════
--
--   doğru çalışır : Mevzuat motoru · Bölge ziyaretleri (zone_visits KALICI)
--   boşalır       : Rota geçmişi (KURTARILAMAZ — özette lat/lon yok, bilinçli)
--   sessizce yanlış: Yakıt · Maliyet · CO₂ · Kârlılık · Skor(payda) ·
--                    Haftalık K3 sessiz_arac · Sessiz cihaz alarmı
--
-- Bu yüzden ELLE silme bile ön koşulsuz değildir: aylık özet yazılmadan,
-- vardiya km yargısı dondurulmadan ve cihaz ömür izi çıkarılmadan bir aralık
-- silinemez (bkz. lib/saklama.ts silmeKapisi).
--
-- ═══ RLS ═══
-- Kapalı — şemanın geri kalanıyla tutarlı. Yalnız service-role yazar.
-- =====================================================================

begin;

-- ═════════════════════ 1 · KİRACI UYARI AYARI ══════════════════════════

create table if not exists public.tenant_saklama (
  -- 076/089'daki desen: tek satır, sabit anahtar.
  id text primary key default 'singleton' check (id = 'singleton'),

  /**
   * UYARI EŞİĞİ (gün) — kiracının kendi hedefi.
   *
   * ⚠️ ADI BİLİNÇLİ `uyari_gun`, `saklama_gun` DEĞİL: bu sayı hiçbir şey
   * silmez. "Bu kadar günü geçen ham satırınız var" uyarısının çıpasıdır.
   * Silme kararı ve zamanı veri sorumlusundadır.
   *
   * Varsayılan 90: CNIL'in ham konum için söylediği 2 ayın bir ay üstü,
   * cezalandırılmış 180 günün yarısı (İtalya/Garante 01/2025, 50.000 €),
   * Almanya'nın orantısız bulduğu 150 ve 400 günün çok altı. Tam gerekçe
   * docs/SAKLAMA-POLITIKASI.md'de.
   *
   * ⚠️ Bu 90, `saklama_esikleri`ndeki YASAL çıpa DEĞİLDİR. Yasal çıpa ayrı
   * tabloda durur ve bugün BOŞTUR (bkz. §3).
   */
  uyari_gun integer not null default 90
    check (uyari_gun between 1 and 3650),

  /**
   * HANGİ ÜLKENİN YASAL ÇIPASI GÖSTERİLSİN.
   *
   * `saklama_esikleri` içinde bu ülkeye ait satır yoksa ekran "yasal çıpa
   * doğrulanmadı" der ve HİÇBİR SAYI göstermez. Varsayılan 'AT' bir
   * ÖLÇÜ değil, bir ARAMA ANAHTARIDIR — dağıtım Avusturya'da.
   */
  ulke_kodu text not null default 'AT' check (ulke_kodu ~ '^[A-Z]{2}$'),

  /** Kiracının uyarı eşiğini neden böyle seçtiği. Serbest metin. */
  gerekce text,

  updated_at timestamptz not null default now(),
  updated_by uuid references public.workers(id) on delete set null
);

comment on table public.tenant_saklama is
  'Saklama UYARI ayarı (090). uyari_gun hiçbir şey SİLMEZ — uyarının çıpasıdır. Silme kararı veri sorumlusunda (müşteri); Galzura veri işleyendir.';

comment on column public.tenant_saklama.uyari_gun is
  'Uyarı eşiği (gün). SİLMEZ. Yasal çıpa ayrı tabloda (saklama_esikleri) ve bugün BOŞ.';

insert into public.tenant_saklama (id) values ('singleton') on conflict (id) do nothing;

-- ═════════════════════ 2 · VERİ KATEGORİLERİ ═══════════════════════════

/**
 * HER TABLO/KOLON ÜÇ KATEGORİDEN BİRİNE DÜŞER.
 *
 *   'kisisel'       → uyarı çıkar, ELLE silinebilir
 *   'arac'          → serbest, uyarı çıkmaz
 *   'yasal_zorunlu' → SİLİNEMEZ; arayüz silme seçeneğini GÖSTERMEZ
 *
 * ═══ HUKUKİ DAYANAK — AYRIM "ARAÇ MI ŞOFÖR MÜ" DEĞİL ═══
 *
 * GPS izi hukuken ŞOFÖRÜN kişisel verisidir, aracın değil. Aracın firmaya
 * ait olması bunu DEĞİŞTİRMEZ. Doğru soru "o an araçta kim vardı": bir konum
 * dizisi, o dizideki kişinin nerede olduğunu, ne zaman durduğunu, ne kadar
 * çalıştığını anlatır. Bu yüzden `device_telemetry` 'arac' değil 'kisisel'.
 *
 * ⚠️ ARAYÜZ BU TABLOYU OKUR. 'yasal_zorunlu' bir satır için silme düğmesi
 * render EDİLMEZ — "silme denendi ve reddedildi" değil, "seçenek hiç yok".
 * Reddetmek bir hatadır ve hata mesajı okunmayabilir; göstermemek bir
 * tasarımdır.
 */
create table if not exists public.veri_kategorileri (
  tablo_adi text not null,
  -- NULL = tablonun TAMAMI. Dolu = yalnız o kolon.
  kolon_adi text,
  kategori text not null check (kategori in ('kisisel', 'arac', 'yasal_zorunlu')),
  /** Bu sınıflandırmanın NEDEN böyle olduğu. Boş bırakılamaz. */
  gerekce text not null,
  guncellendi_at timestamptz not null default now()
);

comment on table public.veri_kategorileri is
  'Veri kategorilendirmesi (090): kisisel | arac | yasal_zorunlu. Arayüz bunu okur; yasal_zorunlu satır için silme seçeneği RENDER EDİLMEZ.';

-- Tablo geneli satırlarda kolon NULL olduğu için basit UNIQUE yetmez.
create unique index if not exists uq_veri_kategorileri
  on public.veri_kategorileri (tablo_adi, coalesce(kolon_adi, '*'));

/**
 * BAŞLANGIÇ SINIFLANDIRMASI.
 *
 * ⚠️ Bunlar YASAL EŞİK DEĞİL, ürünün kendi sınıflandırmasıdır ve gerekçesi
 * her satırda yazılı. Yasal SÜRELER bu tabloda DEĞİL, `saklama_esikleri`nde
 * ve orası bugün BOŞ.
 */
insert into public.veri_kategorileri (tablo_adi, kolon_adi, kategori, gerekce) values
  ('device_telemetry', null, 'kisisel',
   'GPS izi hukuken ŞOFÖRÜN kişisel verisi; aracın firmaya ait olması bunu değiştirmez. Belirleyici soru: o an araçta kim vardı.'),
  ('driver_locations', null, 'kisisel',
   'Telefon GPS kalıntısı. Artık yazılmıyor ama içindeki geçmiş konum aynı hukuki kategoride.'),
  ('idle_episodes', null, 'kisisel',
   'Rölanti epizodu bir konum+süre kaydı; hangi şoförün nerede ne kadar beklediğini anlatır.'),
  ('zone_visits', null, 'kisisel',
   'Bölge ziyareti = kimin nerede olduğu. Ham izden TÜRETİLMİŞ ama aynı bilgiyi taşır.'),
  ('vehicles', null, 'arac',
   'Plaka, filo, yakıt türü, sayaç — araca ait teknik künye. Kişi belirtmez.'),
  ('vehicle_month_metrics', null, 'arac',
   'Aylık ARAÇ toplamı (090). Kişi ekseni yok, gün/saat kırılımı yok; kimin nerede olduğunu anlatmaz.'),
  ('vehicle_telemetry_lifetime', null, 'arac',
   'Aracın ilk/son telemetri ANI — cihazın yaşadığına dair iki damga. Konum içermez.'),
  ('time_entries', null, 'yasal_zorunlu',
   'AZG/ArbZG çalışma süresi kaydı. İş müfettişliğinin okuduğu belge; saklama süresi iş hukukunun konusudur, bu ekranın değil.'),
  ('teslimat_kanitlari', null, 'yasal_zorunlu',
   'ePOD teslimat kanıtı — HK080 tetikleyicisiyle DEĞİŞMEZ. CMR anlaşmazlığında kanıt olan kayıt budur.'),
  ('shift_edit_log', null, 'yasal_zorunlu',
   'Vardiya düzeltme denetim izi (087). Denetim izinin silinebilmesi, izin kendisini anlamsız kılar.'),
  ('security_log', null, 'yasal_zorunlu',
   'Oturum/eylem izi (045). Aynı gerekçe: iz silinebiliyorsa iz değildir.')
on conflict (tablo_adi, coalesce(kolon_adi, '*')) do nothing;

-- ═════════════════════ 3 · ÜLKE BAZLI YASAL EŞİKLER ════════════════════

/**
 * 🔴 BU TABLO BİLEREK BOŞ KURULUR.
 *
 * Yasal eşikler ayrı bir araştırma turuyla, HER SATIR İÇİN kaynak linki ve
 * doğrulanma tarihiyle doldurulacak. Uydurma bir gün sayısı DACH müşterisine
 * giderse sorumluluk doğar.
 *
 * `esik_gun` NULL olabilir ve bu bir EKSİKLİK DEĞİL, bir BEYANDIR:
 * "bu ülke/veri türü için doğrulanmış bir çıpamız yok". Arayüz bu durumda
 * hiçbir sayı göstermez, "yasal çıpa doğrulanmadı" der.
 *
 * ⚠️ `dogrulanma_tarihi` olmadan bir satır anlamsızdır: mevzuat değişir ve
 * "ne zaman bakıldı" sorusu denetimde sorulur. Bu yüzden esik_gun doluysa
 * dayanak, kaynak ve tarih de dolu olmak ZORUNDA (CHECK ile).
 */
create table if not exists public.saklama_esikleri (
  ulke_kodu text not null check (ulke_kodu ~ '^[A-Z]{2}$'),
  /** 'ham_konum' · 'calisma_suresi' · 'teslimat_kaniti' … serbest sözlük. */
  veri_turu text not null,

  /** ⚠️ NULL = DOĞRULANMIŞ ÇIPA YOK. 0 değil, boş değil — bilinmiyor. */
  esik_gun integer check (esik_gun is null or esik_gun >= 0),

  yasal_dayanak text,
  kaynak_url text,
  dogrulanma_tarihi date,

  primary key (ulke_kodu, veri_turu),

  /**
   * Bir sayı yazıldıysa nereden geldiği de yazılmak ZORUNDA. Kaynaksız bir
   * eşik, uydurma bir eşiktir.
   */
  constraint saklama_esikleri_kaynakli check (
    esik_gun is null
    or (yasal_dayanak is not null and kaynak_url is not null and dogrulanma_tarihi is not null)
  )
);

comment on table public.saklama_esikleri is
  'Ülke bazlı yasal saklama çıpaları (090). BİLEREK BOŞ KURULUR — eşikler ayrı bir araştırma turuyla kaynaklı doldurulacak. esik_gun NULL = doğrulanmış çıpa YOK.';

comment on column public.saklama_esikleri.esik_gun is
  'NULL = doğrulanmış çıpa yok (0 DEĞİL). Doluysa yasal_dayanak + kaynak_url + dogrulanma_tarihi de zorunlu (CHECK).';

-- ⚠️ SATIR EKLENMİYOR. Bu boşluk bilinçlidir.

-- ═════════════════════ 4 · ELLE SİLME DENETİM İZİ ══════════════════════

/**
 * HER ELLE SİLME BURAYA YAZILIR — silmeden ÖNCE.
 *
 * Kim, ne zaman, hangi tablo, hangi aralık, kaç satır, hangi sebeple.
 * Sebep zorunlu: "neden sildiniz" sorusunun cevabı ürünün içinde durmalı,
 * birinin hafızasında değil.
 *
 * ⚠️ Bu tablo `veri_kategorileri`nde 'yasal_zorunlu' — kendisi silinemez.
 */
create table if not exists public.saklama_silme_izi (
  id uuid primary key default gen_random_uuid(),
  silen_worker_id uuid references public.workers(id) on delete set null,
  silindi_at timestamptz not null default now(),
  tablo_adi text not null,
  kategori text not null,
  aralik_bas timestamptz not null,
  aralik_bit timestamptz not null,
  satir_sayisi bigint not null,
  sebep text not null check (length(btrim(sebep)) >= 10),
  /** Kullanıcının elle yazdığı onay metni — çift onayın ikinci ayağı. */
  onay_metni text not null,
  check (aralik_bit > aralik_bas)
);

comment on table public.saklama_silme_izi is
  'Elle silme denetim izi (090). Her silme ÖNCE buraya yazılır: kim, ne zaman, hangi aralık, kaç satır, hangi sebeple. Kendisi yasal_zorunlu — silinemez.';

create index if not exists idx_saklama_silme_izi_zaman
  on public.saklama_silme_izi (silindi_at desc);

insert into public.veri_kategorileri (tablo_adi, kolon_adi, kategori, gerekce) values
  ('saklama_silme_izi', null, 'yasal_zorunlu',
   'Silme denetim izinin kendisi. Silinebiliyorsa iz değildir.')
on conflict (tablo_adi, coalesce(kolon_adi, '*')) do nothing;

-- ═════════════════════ 5 · CİHAZ ÖMÜR İZİ ══════════════════════════════

/**
 * ARACIN İLK/SON TELEMETRİ ANI — ham satırlar silinse de yaşar.
 *
 * NEDEN: haftalık aksiyon kuralı K3 "sessiz araç" ve panodaki "sessiz cihaz"
 * alarmı, aracın SON ham satırının yaşına bakıyor. Uzun süredir susmuş bir
 * aracın tüm satırları silinince `son_kayit` NULL döner ve araç uyarı
 * listesinden SESSİZCE DÜŞER — en çok ilgilenilmesi gereken araç görünmez
 * olur. Tam tersi bir sonuç.
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

-- ═════════════════════ 6 · AYLIK ÖZET ══════════════════════════════════

/**
 * AYLIK ARAÇ ÖZETİ — ham iz silindikten sonra raporun tek kaynağı.
 *
 * ⚠️ GRANÜLERLİK NEDEN AY: yukarıdaki ÖLÇÜM 2. Günlük özet yakıtı
 * %15,6-28,9 şişiriyor; aylık parçanın sapması %0,0.
 *
 * 🔑 DEĞERLER NASIL ÜRETİLİR: raporun KENDİ motoru ayın tamamı için TEK
 * pencere olarak çağrılır ve çıktısı olduğu gibi yazılır. Özet, raporun
 * kendi cevabının dondurulmuş hâlidir — ikinci bir hesap değil.
 *
 * ⚠️ NE KURTARMAZ — dürüst liste:
 *   · ROTA GEÇMİŞİ. lat/lon burada YOK ve olamaz: bir ayın konum dizisini
 *     saklamak "ham izi sakla" demenin başka yolu olurdu.
 *   · GÜN/SAAT KIRILIMI. Ay içi bir pencere özetten üretilemez.
 *   · VARDİYA EKSENİ. Şoför km'si için ayrı dondurma var (§7).
 *
 * 🔑 Bu tablo `veri_kategorileri`nde 'arac': kişi ekseni ve gün kırılımı
 * olmadığı için kimin nerede olduğunu anlatmaz.
 */
create table if not exists public.vehicle_month_metrics (
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,

  -- Ayın İLK GÜNÜ. check ile zorlanıyor: yanlış granülerlikte satır yazılırsa
  -- tablo sessizce gün-bazlı olur ve ÖLÇÜM 2'deki hata geri gelir.
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
   * Bu kolon olmadan özet "0 L" ile "ölçülemedi"yi ayıramaz.
   */
  olculemedi_sebep text,

  hesaplandi_at timestamptz not null default now(),
  hesap_surumu text not null default '090.1',
  /** Bu ayın ham satırları silindi mi? Silinmişse özet YENİDEN ÜRETİLEMEZ. */
  ham_silindi_at timestamptz,

  primary key (vehicle_id, ay)
);

comment on table public.vehicle_month_metrics is
  'Aylık araç özeti (090) — ham iz silindikten sonraki tek kaynak. Granülerlik AY: günlük parçalama yakıtı %15,6-28,9 şişiriyor (ölçüldü), aylık parçanın sapması %0,0.';

comment on column public.vehicle_month_metrics.olculemedi_sebep is
  'NULL = ölçüldü. Dolu = bu araç/ay ölçülemedi ve SEBEBİ bu. "0" ile "bilinmiyor" bu kolonla ayrılır.';

comment on column public.vehicle_month_metrics.ham_silindi_at is
  'Bu ayın ham satırlarının silindiği an. Doluysa özet YENİDEN ÜRETİLEMEZ — üzerine yazılmasın.';

create index if not exists idx_vmm_ay on public.vehicle_month_metrics (ay desc);

-- ═════════════════════ 7 · VARDİYA KM DONDURMA ═════════════════════════

/**
 * VARDİYANIN KM ÖLÇÜM YARGISI — ham silinmeden ÖNCE dondurulur.
 *
 * NEDEN: lib/km-quality.ts iki kapıyla "bu vardiyanın km'si gerçekten 0 mı,
 * yoksa ölçülemedi mi" diye soruyor ve İKİNCİ KAPI ham telemetriye bakıyor
 * (vardiya penceresinde speed_kmh >= 5 okuma var mı). Ham silinince kapı her
 * sıfır-farklı vardiyayı "ölçülemedi"ye çevirir — sessizce, geriye dönük ve
 * KULLANICI SEÇİMLİ aralıktaki Excel/PDF çıktısına kadar.
 *
 * ⚠️ SIRA ŞARTI: bu kolon, silmeden ÖNCE doldurulmalıdır. Sonra doldurulursa
 * ham zaten gitmiş olur ve backfill her satıra sessizce "ölçülemedi" yazar —
 * düzeltmek istediği hatayı kalıcılaştırır. Kod bu sırayı zorluyor: aralıkta
 * dondurulmamış vardiya varsa silme REDDEDİLİR.
 */
alter table public.time_entries
  add column if not exists km_dondu boolean;

alter table public.time_entries
  add column if not exists km_dondu_at timestamptz;

comment on column public.time_entries.km_dondu is
  'Ham silinmeden önce dondurulmuş km ölçüm yargısı (090). true = ölçüldü, false = ölçülemedi, NULL = henüz dondurulmadı.';

-- ═════════════════════ 8 · ZAMAN İNDEKSİ ═══════════════════════════════

/**
 * BRIN — "kaç satırım eşiği geçti" sorusunun ucuz cevabı.
 *
 * ÖLÇÜLDÜ (26.08.2026): `recorded_at` üzerinde ÖNDE GELEN kolonlu indeks yok
 * (var olanlar `(vehicle_id, recorded_at)` ya da kısmi). 1,6 milyon satırda
 * `count(*) where recorded_at < x` ifade zaman aşımına (8 sn) takıldı.
 *
 * BRIN seçildi çünkü `recorded_at` append-only ve fiziksel sırayla neredeyse
 * birebir artıyor — btree'nin onda biri yer kaplar ve aralık taraması için
 * yeterli. Uyarı sayacı ve aralık silme ikisi de bunu kullanır.
 */
create index if not exists idx_device_telemetry_recorded_brin
  on public.device_telemetry using brin (recorded_at);

create index if not exists idx_driver_locations_recorded_brin
  on public.driver_locations using brin (recorded_at);

-- ═════════════════════ 9 · UYARI SAYACI ════════════════════════════════

/**
 * EŞİĞİ GEÇEN SATIR SAYISI — tablo tablo.
 *
 * Gece koşan iş bunu çağırır ve UYARI üretir. HİÇBİR ŞEY SİLMEZ.
 *
 * En eski kayıt da dönüyor: uyarı "kaç satır" demenin yanında "ne kadar
 * eski" de demeli; 1.000 satır 91 günlük ise başka, 400 günlük ise başka bir
 * cümledir.
 */
create or replace function public.saklama_eski_satirlar(p_kesim timestamptz)
returns table (
  tablo_adi text,
  satir_sayisi bigint,
  en_eski timestamptz
)
language sql
stable
as $$
  select 'device_telemetry'::text, count(*), min(recorded_at)
  from public.device_telemetry where recorded_at < p_kesim
  union all
  select 'driver_locations'::text, count(*), min(recorded_at)
  from public.driver_locations where recorded_at < p_kesim
$$;

-- ═════════════════════ 10 · ARALIK SİLME ═══════════════════════════════

/**
 * 🔴 ARALIK ALIR, GÜN SAYISI ALMAZ — VE BU BİLİNÇLİ.
 *
 * "Şu kadar günden eskiyi sil" imzası, çağıranın takvimine göre çalışan bir
 * otomatik temizliği DAVET EDER. Bu üründe silme kararı veri sorumlusunun
 * ve her silme bir İNSAN SEÇİMİDİR: hangi hafta, hangi ay, hangi iki tarih
 * arası. Fonksiyon o seçimi birebir uygular, kendi başına bir "eski" tanımı
 * üretmez.
 *
 * ⚠️ Ön koşullar (özet yazıldı mı, km donduruldu mu, kategori silinebilir mi,
 * çift onay verildi mi) UYGULAMA katmanında (lib/saklama-db.ts). Burada
 * zorlanmıyor çünkü SQL katmanı "kim onayladı"yı bilemez; iki yerde iki
 * yarım kapı olmasındansa tek yerde tam kapı olsun.
 *
 * ctid ile parça silme: tek `delete` 1,6 milyon satırda ifade zaman aşımı
 * yer ve HİÇBİR ŞEY silinmez (054'ün dersi).
 */
create or replace function public.purge_telemetry_range(
  p_from timestamptz,
  p_to timestamptz,
  p_limit int default 20000
)
returns bigint
language plpgsql
volatile
as $$
declare
  v_deleted bigint;
begin
  if p_from is null or p_to is null or p_to <= p_from then
    raise exception 'gecersiz_aralik: p_from=% p_to=%', p_from, p_to;
  end if;

  with victims as (
    select ctid
    from public.device_telemetry
    where recorded_at >= p_from
      and recorded_at <  p_to
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
 * driver_locations ikizi.
 *
 * ⚠️ ŞEMA CANLIDA DOĞRULANDI (26.08.2026): zaman kolonu `recorded_at`
 * (`created_at` bu tabloda YOK). Yine de AYRI fonksiyon: tek fonksiyona
 * tablo adı parametresi geçirmek (dinamik SQL) silme yüzeyini genişletirdi
 * ve "hangi tablo silinecek" kararını çağırana bırakırdı.
 *
 * Bugünkü hacim ihmal edilebilir (~81 satır) — fonksiyon miktar için değil,
 * POLİTİKA BÜTÜNLÜĞÜ için var: konum verisi hangi tabloda durursa dursun
 * aynı kategoridedir.
 */
create or replace function public.purge_driver_locations_range(
  p_from timestamptz,
  p_to timestamptz,
  p_limit int default 20000
)
returns bigint
language plpgsql
volatile
as $$
declare
  v_deleted bigint;
begin
  if p_from is null or p_to is null or p_to <= p_from then
    raise exception 'gecersiz_aralik: p_from=% p_to=%', p_from, p_to;
  end if;

  with victims as (
    select ctid
    from public.driver_locations
    where recorded_at >= p_from
      and recorded_at <  p_to
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

-- ═════════════════════ 11 · ÖZET YARDIMCILARI ══════════════════════════

/**
 * AYLIK UÇ DEĞERLER — özet üretiminin SQL ayağı.
 *
 * Yakıt/tüketim raporun kendi motorundan alınıyor (uygulama katmanı); burada
 * YALNIZ odometre açıklığı ve sayım/uç bilgileri var, çünkü bunlar saf
 * SQL'de doğru ve ucuz. İkisini karıştırmamak bilinçli.
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
 * CİHAZ ÖMÜR İZİNİ TAZELE — silmeden ÖNCE çağrılır.
 *
 * `greatest`/`least` ile birleştirme: ham kısmen silinmiş olsa bile daha eski
 * bir `ilk_kayit` KAYBEDİLMEZ, daha yeni bir `son_kayit` GERİ GİTMEZ. Yani
 * fonksiyon defalarca çalıştırılabilir ve her koşuda doğrudur.
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
--   → 1 satır: singleton · uyari_gun=90 · ulke_kodu='AT' · gerekce=null
--     ⚠️ `silme_acik` diye bir kolon YOK — otomatik silme YOK.
--
--   select count(*) from public.saklama_esikleri;
--   → 0        ⚠️ BİLEREK BOŞ. Yasal eşikler ayrı araştırma turuyla gelecek.
--
--   select kategori, count(*) from public.veri_kategorileri group by 1;
--   → arac 3 · kisisel 4 · yasal_zorunlu 5
--
--   select count(*) from public.saklama_silme_izi;
--   → 0        (elle silme yapılmadı)
--
--   select proname from pg_proc where proname in
--     ('purge_telemetry_range','purge_driver_locations_range',
--      'saklama_eski_satirlar','telemetry_month_spans',
--      'refresh_telemetry_lifetime');
--   → 5 satır
--     ⚠️ `purge_old_telemetry` LİSTEDE YOK ve olmamalı — o 054'ün
--        (galzura-demo) fonksiyonu, bu migration ona DOKUNMAZ.
--
-- MEVCUT VERİYE ETKİSİ: **SIFIR SATIR SİLİNİR.** Bu migration tablo, indeks
-- ve fonksiyon kurar. Silen tek yol /admin/saklama ekranıdır ve her çağrı
-- saklama_silme_izi'ne yazılır.
-- =====================================================================

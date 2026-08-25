-- HAK61 / Galzura Fleet — Migration 088 (ŞOFÖR ÖDÜL VE LİDERLİK)
-- =====================================================================
-- Güvenlik skoru motoru VAR ve çalışıyor. Eksik olan: şoförün kendi durumunu
-- görmesi, sıralama, rozet ve DÖNEM GEÇMİŞİ. Additive + idempotent; mevcut
-- hiçbir tabloya dokunulmaz. Supabase SQL Editor'da çalıştırın.
--
-- ⚠️ 060 (device_config_epochs) uygulanmış olmalı — rozetlerin kalibrasyon
-- sınırını bilmesi buna bağlı.
--
-- ═══════════════════════════════════════════════════════════════════════
-- ÖLÇÜM 1 — SKOR MOTORU BUGÜN NE VERİYOR (HAK61 canlı, 25.08.2026)
-- ═══════════════════════════════════════════════════════════════════════
--
-- Eksenler: overspeeding 25 · jamming 25 · harsh_braking 12 ·
-- harsh_cornering 12 · idling 5 · harsh_acceleration 3. Ceza km ile
-- normalize ediliyor (K=500). Skor 0–100 YA DA **null**.
--
-- KAPSAMA (son 30 gün): kadro 28 · **skorlanan 17** · skorsuz 11
--   ortalama 47,0 · en yüksek 92 (Resul Demir) · en düşük 14
--   80+ olan: 2 · 60–79: 3 · <60: 12
--   skorsuzluk sebebi: kapsama_dusuk 8 · km_yetersiz 3
--
-- ═══════════════════════════════════════════════════════════════════════
-- 🔴 ÖLÇÜM 2 — HAFTALIK ROZET YAPISAL OLARAK KAZANILAMAZ
-- ═══════════════════════════════════════════════════════════════════════
--
-- Görev "4 hafta üst üste 80+ skor" rozetini istedi. HAFTALIK pencereler
-- canlıda ölçüldü:
--
--     hafta -0   kadro 22 · SKORLANAN 4  · 80+ olan 0
--     hafta -1   kadro 20 · SKORLANAN 3  · 80+ olan 0
--     hafta -2   kadro 22 · SKORLANAN 3  · 80+ olan 0
--     hafta -3   kadro 23 · SKORLANAN 3  · 80+ olan 0
--
-- Yani 7 günlük pencerede şoförlerin **%14–18'i** km kapsama kapısını
-- geçebiliyor ve son dört haftada **hiç kimse** haftalık 80+ almadı.
-- "4 hafta üst üste 80+" rozeti kimsenin kazanamayacağı bir rozettir; böyle
-- bir rozet motivasyon değil, alay üretir.
--
-- 30 GÜNLÜK pencerede aynı ölçüm: **17/28 skorlanıyor**, 2 kişi 80+.
--
-- KARAR: rozetler **AYLIK (30 gün)** pencerede hesaplanır. Bu tablo da o
-- yüzden dönem başına bir satır tutar.
--
-- ═══════════════════════════════════════════════════════════════════════
-- 🔴 ÖLÇÜM 3 — KALİBRASYON SINIRI: SORUN AĞIRLIKTA DEĞİL, CİHAZDA
-- ═══════════════════════════════════════════════════════════════════════
--
-- Görev "eşik 40→20, ağırlık 12→3 değişti, rozet farklı kalibrasyonlu
-- haftaları karşılaştırmamalı" dedi. Ölçüm bunu İKİYE ayırıyor:
--
--   AĞIRLIK/EŞİK DEĞİŞİMİ (kodda, 13.08.2026) → **SORUN DEĞİL**.
--   Skor geçmişi HİÇBİR YERDE SAKLANMIYOR (aranan tabloların hepsi yok:
--   surucu_skorlari · driver_scores · skor_gecmisi). Her skor istek anında
--   BUGÜNKÜ ağırlıklarla yeniden hesaplanıyor. Geçmiş bir ayı bugün
--   hesaplarsanız bugünkü cetvelle ölçülür — yani kod tarafı kendi içinde
--   tutarlı.
--
--   CİHAZ EŞİĞİ DEĞİŞİMİ (Teltonika setparam, 22–23.07.2026) → **SORUN**.
--   O tarihte hızlanma 2.2→3.3, fren 2.5→3.3, aşırı hız 120→131 km/s
--   yapıldı ve HAM OLAY sayısı değişti. Bu, yeniden hesapla düzelmez:
--   olayın kendisi farklı bir cetvelle üretilmiş.
--
-- Repo bu sınırı zaten tutuyor: `device_config_epochs` + `lib/config-epoch.ts`.
-- CANLI: en son epok **2026-07-23**.
--
-- SONUÇ: bir dönem snapshot'ı, hesaplandığı andaki epok damgasını TAŞIR
-- (`epok_at`). Rozet motoru yalnız AYNI epoktan sonra başlayan dönemleri
-- karşılaştırır. Bugün temiz dönem sayısı **1** — "3 ay üst üste" rozeti
-- henüz kazanılamaz ve ekran bunu SÖYLER, sessizce boş bırakmaz.
--
-- ═══════════════════════════════════════════════════════════════════════
-- ÖLÇÜM 4 — SKORSUZ ŞOFÖR: SIFIR DEĞİL, SEBEP
-- ═══════════════════════════════════════════════════════════════════════
--
-- Motor zaten `scoreGate` üretiyor: `km_yetersiz` · `kapsama_dusuk` ·
-- `vardiya_yok`. Snapshot bunu saklar; liderlik tablosu skorsuz şoförü
-- SIRALAMAYA SOKMAZ, ayrı bir bölümde sebebiyle gösterir.
--
-- ═══════════════════════════════════════════════════════════════════════
-- ÖLÇÜM 5 — SEKTÖR (kaynak gösterildi, bkz. docs/SOFOR-ODUL.md)
-- ═══════════════════════════════════════════════════════════════════════
--
-- Motive **Driver Rewards** (27.05.2026, Vision 26): kural + puan sistemi,
-- gerçek zamanlı rozet ve liderlik tablosu, hediye kartı/para dönüşümü.
-- Samsara **Positive Recognition**: iyi davranış SERİLERİNİ (streak) ve
-- kilometre taşlarını otomatik yakalayıp şoför uygulamasında gösteriyor.
--
-- Ortak mekanik: SERİ + KİLOMETRE TAŞI + ROZET + SIRALAMA. Ödül/para
-- dönüşümü BU TURDA YOK — muhasebe ve bordro bağı ayrı bir iştir.
--
-- ═══════════════════════════════════════════════════════════════════════
-- 🔴 İSİM GÖRÜNÜRLÜĞÜ — VARSAYILAN KAPALI (DACH)
-- ═══════════════════════════════════════════════════════════════════════
--
-- Almanya'da § 87 Abs. 1 Nr. 6 BetrVG: çalışanın davranışını veya
-- performansını izlemeye ELVERİŞLİ teknik düzenek işletme kurulunun ORTAK
-- KARARINA tabidir. İçtihat ölçütü işverenin niyeti değil, düzeneğin
-- NESNEL ELVERİŞLİLİĞİ. İsimli bir liderlik tablosu tam olarak budur.
--
-- Bu yüzden `isim_gorunur` varsayılanı **false**: şoför kendi sırasını ve
-- skorunu görür, diğerleri "Şoför #4" olarak görünür. İsimleri açmak
-- kiracının bilinçli kararıdır (ve DE'de işletme kurulu onayı gerektirir).
--
-- ═══ RLS ═══
-- Kapalı — şemanın geri kalanıyla tutarlı. Yalnız service-role yazar.
-- =====================================================================

begin;

-- ═════════════════════════ KİRACI AYARI ════════════════════════════════

create table if not exists public.tenant_odul (
  id text primary key default 'singleton' check (id = 'singleton'),

  /**
   * LİDERLİK TABLOSUNDA İSİM GÖRÜNÜR MÜ — VARSAYILAN HAYIR.
   *
   * Gerekçe yukarıda (§ 87 Abs. 1 Nr. 6 BetrVG · AT DSG). Kapalıyken şoför
   * KENDİ adını ve sırasını görür, başkaları takma sırayla listelenir.
   */
  isim_gorunur boolean not null default false,

  /** Rozet katmanı açık mı — kapalıysa hiç rozet hesaplanmaz/gösterilmez. */
  rozet_acik boolean not null default true,

  updated_at timestamptz not null default now(),
  updated_by uuid references public.workers(id) on delete set null
);

comment on table public.tenant_odul is
  'Ödül/liderlik kiracı ayarı (088). isim_gorunur VARSAYILAN FALSE: isimli sıralama § 87 Abs. 1 Nr. 6 BetrVG anlamında performans izlemeye elverişli bir düzenektir.';

insert into public.tenant_odul (id) values ('singleton') on conflict (id) do nothing;

-- ═══════════════════ DÖNEM SKOR ANLIK GÖRÜNTÜSÜ ═══════════════════════

create table if not exists public.sofor_skor_donem (
  id uuid primary key default gen_random_uuid(),

  worker_id uuid not null references public.workers(id) on delete cascade,

  /** Dönemin İLK günü (30 günlük pencerenin başı, Viyana günü). */
  donem_bas date not null,
  /** Dönemin SON günü — dahil. */
  donem_bit date not null,

  /**
   * SKOR — 0..100 YA DA NULL. null = yeterli veri yok; `kapi` sebebi söyler.
   * ⚠️ 0 YAZMAK YASAK: "hiç sürmemiş" ile "kötü sürmüş" aynı sayıya düşerdi.
   */
  skor integer check (skor is null or (skor >= 0 and skor <= 100)),

  /**
   * SKOR NEDEN YOK — motorun kendi ürettiği kapı adı (lib/reports.ts).
   * `skor` doluysa null.
   */
  kapi text check (kapi is null or kapi in ('km_yetersiz', 'kapsama_dusuk', 'vardiya_yok')),

  olay_sayisi integer not null default 0 check (olay_sayisi >= 0),
  /** Skorun paydası — ölçülen km. null = ölçülemedi (0 km sürdü DEĞİL). */
  km numeric(10,1),
  /** O şoför için hesaplanan km eşiği — kapı nerede duruyordu. */
  esik_km numeric(10,1),

  /**
   * 🔴 KALİBRASYON DAMGASI — ROZETİN TEMELİ.
   *
   * Bu dönem hesaplanırken yürürlükte olan CİHAZ EŞİĞİ değişiminin anı
   * (`device_config_epochs`in en sonu). Rozet motoru yalnız AYNI damgayı
   * taşıyan dönemleri karşılaştırır: 22–23.07.2026'da cihaz eşikleri
   * gevşetildi ve ham olay sayısı yarıya indi; o sınırın iki yakasındaki
   * skorlar aynı cetvelle ölçülmemiştir.
   *
   * null = hiç epok kaydı yok (yeni kurulum) — o zaman tüm dönemler aynı
   * kabul edilir, çünkü karşılaştırmayı bozan bir olay yaşanmamıştır.
   */
  epok_at timestamptz,

  /** Dönem epok sınırından ÖNCE başlıyor mu — karışık veri uyarısı. */
  epok_oncesi boolean not null default false,

  hesaplandi_at timestamptz not null default now()
);

comment on table public.sofor_skor_donem is
  'Dönemsel skor anlık görüntüsü (088). Skor geçmişi HİÇBİR YERDE saklanmıyordu; rozet "üst üste N dönem" diyebilmek için bu tabloya ihtiyaç duyar. Her satır hesaplandığı kalibrasyon damgasını taşır.';

/**
 * DÖNEM BAŞINA TEK SATIR. İkinci hesaplama aynı satırı GÜNCELLER
 * (upsert), yenisini yazmaz — aksi hâlde "üst üste 3 dönem" sayımı
 * tekrarlanan satırlarla şişerdi.
 */
create unique index if not exists sofor_skor_donem_tekil
  on public.sofor_skor_donem (worker_id, donem_bas);

create index if not exists idx_skor_donem_bas
  on public.sofor_skor_donem (donem_bas desc, skor desc nulls last);

-- ═════════════════════════ ROZETLER ════════════════════════════════════

create table if not exists public.sofor_rozetleri (
  id uuid primary key default gen_random_uuid(),

  worker_id uuid not null references public.workers(id) on delete cascade,

  /**
   * ROZET KODU. CHECK YOK — rozet kuralları KODDA yaşıyor (lib/odul.ts) ve
   * yeni bir rozet eklemek migration gerektirmemeli. 084 ve 086'da aynı
   * karar `kural` kolonu için verilmişti.
   */
  rozet text not null,

  /** Rozetin kazanıldığı dönemin başı — tekillik anahtarının parçası. */
  donem_bas date not null,

  /**
   * KANIT — hangi sayıdan çıktı. Rozet açıklanabilir olmalı: şoför
   * "neden bu rozeti aldım" sorusunu ekranda cevaplayabilmeli.
   */
  kanit jsonb not null default '{}'::jsonb,

  kazanildi_at timestamptz not null default now()
);

comment on table public.sofor_rozetleri is
  'Kazanılmış rozetler (088). Rozet SİLİNMEZ: kazanıldığı dönemin gerçeğidir. Sonraki dönemde skor düşse de geçmiş rozet durur.';

/** Aynı rozet aynı dönem için İKİ KEZ verilemez. */
create unique index if not exists sofor_rozet_tekil
  on public.sofor_rozetleri (worker_id, rozet, donem_bas);

create index if not exists idx_rozet_worker
  on public.sofor_rozetleri (worker_id, kazanildi_at desc);

commit;

notify pgrst, 'reload schema';

-- =====================================================================
-- ÇALIŞTIRDIKTAN SONRA BEKLENEN HÂL (doğrulama sorguları):
--
--   select * from public.tenant_odul;
--   → 1 satır: singleton · isim_gorunur=false · rozet_acik=true
--
--   select count(*) from public.sofor_skor_donem;   → 0
--   select count(*) from public.sofor_rozetleri;    → 0
--
--   select indexname from pg_indexes
--    where tablename in ('sofor_skor_donem','sofor_rozetleri')
--    order by indexname;
--   → idx_rozet_worker, idx_skor_donem_bas, sofor_rozet_tekil,
--     sofor_rozetleri_pkey, sofor_skor_donem_pkey, sofor_skor_donem_tekil
--
-- MEVCUT VERİYE ETKİSİ: sıfır. Üç YENİ tablo; skor motoru, AZG raporu ve
-- performans raporu bunları hiç okumaz.
-- =====================================================================

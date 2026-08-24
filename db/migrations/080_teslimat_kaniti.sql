-- HAK61 / Galzura Fleet — Migration 080 (TESLİMAT KANITI · ePOD)
-- =====================================================================
-- Şoför teslimatta kanıt bırakır: imza, fotoğraf, not, alıcı adı. Kayıt sefere
-- bağlanır; yönetici panelden görür; anlaşmazlıkta delil olur. Additive +
-- idempotent; mevcut hiçbir tabloya DOKUNULMAZ. Supabase SQL Editor'da
-- çalıştırın.
--
-- ═══ NEDEN shift_photos'A EKLENMEDİ ═══
--
-- ÖLÇÜLDÜ (25.08.2026): `shift_photos` VARDİYA fotoğrafıdır — `time_entry_id`e
-- bağlı, "şoför vardiya sırasında bir şey fotoğrafladı" demek. Teslimat kanıtı
-- ise TESLİMATA bağlı olmak zorunda: "hangi seferin hangi durağında, kime,
-- hangi imzayla". İkisini aynı tabloda tutsaydık "şu teslimatın kanıtı hangi
-- satırlar" sorusu türetilemezdi (vardiya boyunca çekilmiş onlarca fotoğrafın
-- içinden hangisi delil?). Ayrıca kanıtın DEĞİŞMEZ olması gerekiyor, vardiya
-- fotoğrafının böyle bir yükümlülüğü yok.
--
-- ═══ NEDEN İKİ TABLO ═══
--
-- `teslimatlar` = OLAY (kim, ne zaman, nerede, kime, imza).
-- `teslimat_fotograflari` = o olaya ait 0..N görüntü. Görev "birden fazla
-- olabilir" diyor; fotoğrafı kolona koymak (foto1, foto2…) tavanı şemaya
-- gömmek olurdu.
--
-- ═══ ÇOK DURAKLI TESLİMAT — BUGÜN TEK, YARIN N ═══
--
-- ÖLÇÜLDÜ: `seferler` bugün TEK hedefli (`zone_id` tek kolon) ve canlıdaki
-- seferlerin hiçbirinde hedef bile dolu değil. Ama dünya pazarında çok duraklı
-- tur standarttır (Onfleet/Track-POD/Bringg üçü de durak listesiyle çalışır).
--
-- Model buna göre kuruldu: kanıt SEFERE değil, seferin BİR DURAĞINA bağlanıyor
-- (`durak_no`). Bugün her seferde tek satır olur (`durak_no = 1`); durak listesi
-- eklendiği gün aynı tablo N satır taşır ve HİÇBİR ŞEMA DEĞİŞİKLİĞİ gerekmez.
-- Tersini yapıp kanıtı sefere 1-1 bağlasaydık, çok duraklı tura geçiş bu
-- tablonun yeniden yazılması demekti.
--
-- ⚠️ `unique (sefer_id, durak_no)`: aynı durağın iki kanıtı olamaz. Yeniden
-- teslim denemesi YENİ BİR DURAK numarasıdır — üzerine yazmak, ilk denemenin
-- delilini yok etmek olurdu.
--
-- ═══ İMZA: VEKTÖR BİRİNCİL, RASTER YEDEK ═══
--
-- İmza `imza_svg` metin kolonunda SVG yol verisi olarak duruyor. Ölçü: tipik
-- bir imza 2-6 KB yol verisi; aynı imzanın PNG'si 20-80 KB VE bir Storage
-- nesnesi + imzalı URL + silme sorumluluğu demek. Vektör ayrıca ölçeklenir
-- (mahkemeye giden PDF'te bulanıklaşmaz) ve veritabanı yedeğinin İÇİNDE
-- taşınır — Storage ayrı yedeklenir, kanıtın yarısının başka yerde olması
-- kötü bir bölünmedir.
--
-- `imza_yol` yalnız YEDEK yol: imzayı yol verisi olarak üretemeyen bir istemci
-- (ör. hazır bir imza bileşeni yalnız PNG veriyorsa) raster yükleyebilsin.
-- İkisi birden dolu olamaz — hangisinin gerçek olduğu belirsiz kalırdı.
--
-- ═══ FOTOĞRAF NEREDE ═══
--
-- Mevcut düzenle AYNI: özel (public=false) Supabase Storage kovası, 5 MB tavan,
-- görüntü MIME'ları; okuma kısa ömürlü imzalı URL ile (lib/storage.ts).
-- Kova BURADA yaratılıyor — 007 ve 020 de kovalarını kendi migration'ında
-- yaratıyor, aynı desen.
--
-- ⚠️ SAKLAMA SÜRESİ: kanıt SİLİNMEZ. Telemetri temizliği (054) buraya
-- UYGULANMAZ; bir teslimat delili, faturanın ömrü kadar yaşamalı (AT: § 132
-- BAO, yedi yıl). Maliyet küçük: 1600px/q0.85 JPEG ≈ 250 KB; günde 30 teslimat
-- × 2 fotoğraf ≈ 15 MB/gün ≈ 5,5 GB/yıl.
--
-- ═══ DEĞİŞMEZLİK — KANITIN TEK GERÇEK ÖZELLİĞİ ═══
--
-- Sonradan düzenlenebilen bir kayıt delil değildir. `teslimat_degismez`
-- tetikleyicisi bu tablodaki HER GÜNCELLEMEYİ reddeder; tek istisna İPTAL
-- (`iptal_at` / `iptal_sebep` / `iptal_eden`). Yani kanıt yazıldıktan sonra
-- yeniden yazılamaz, yalnız GEÇERSİZ İLAN EDİLEBİLİR ve o da sebebiyle
-- kayıtlıdır. Gerçek ePOD ürünleri de böyle çalışır: düzeltme, eski kaydın
-- üzerine değil YANINA yazılır.
--
-- ═══ RLS ═══
-- Kapalı — şemanın geri kalanıyla tutarlı. Yalnız service-role yazar; yetki
-- uygulama katmanında (şoför yalnız KENDİ seferine kanıt bırakır).
-- =====================================================================

begin;

-- ── 1) TESLİMAT OLAYI ───────────────────────────────────────────────
create table if not exists public.teslimatlar (
  id uuid primary key default gen_random_uuid(),

  -- Hangi sefer. Sefer silinirse kanıt da gider: seferi olmayan bir teslimat
  -- kanıtının bağlamı yoktur.
  sefer_id uuid not null references public.seferler(id) on delete cascade,

  /**
   * Seferin KAÇINCI durağı. Bugün her seferde tek teslimat var ve bu 1'dir;
   * durak listesi geldiğinde aynı tablo N satır taşır.
   */
  durak_no smallint not null default 1 check (durak_no between 1 and 999),

  -- Kanıtı bırakan şoför.
  -- ⚠️ `on delete restrict` BİLEREK: kanıt taşıyan bir personel kaydını
  -- silmek, delili sessizce yok etmektir. Silme girişimi HATA vermeli ve
  -- insan karar vermeli. (Depoda personel zaten silinmez, pasifleştirilir.)
  worker_id uuid not null references public.workers(id) on delete restrict,

  -- Hangi bölgeye teslim edildi (varsa). Bölge silinirse kanıt kalır.
  zone_id uuid references public.geofences(id) on delete set null,

  -- Teslim alan kişi. Opsiyonel: kapıya bırakma (safe drop) da bir teslimattır.
  alici_ad text check (alici_ad is null or length(btrim(alici_ad)) between 1 and 80),

  notlar text check (notlar is null or length(notlar) <= 500),

  -- İMZA — vektör birincil (başlık bloğundaki gerekçe).
  imza_svg text check (imza_svg is null or length(imza_svg) between 8 and 200000),
  -- İmza RASTER yedek yolu (Storage). Vektör üretemeyen istemci için.
  imza_yol text,

  /**
   * KANITIN DEĞERİ BURADA: an ve yer.
   * `teslim_at` sunucu saatinden yazılır — istemci saatine güvenilmez, telefon
   * saati elle değiştirilebilir ve delilin zamanı tartışmaya açık olamaz.
   */
  teslim_at timestamptz not null default now(),
  latitude double precision check (latitude is null or latitude between -90 and 90),
  longitude double precision check (longitude is null or longitude between -180 and 180),
  konum_dogruluk_m double precision check (konum_dogruluk_m is null or konum_dogruluk_m >= 0),

  -- İPTAL — tek meşru "değişiklik". Kanıt silinmez, geçersiz ilan edilir.
  iptal_at timestamptz,
  iptal_sebep text check (iptal_sebep is null or length(btrim(iptal_sebep)) between 3 and 300),
  iptal_eden uuid references public.workers(id) on delete set null,

  created_at timestamptz not null default now(),

  -- Aynı durağın iki kanıtı olamaz (başlık bloğu).
  constraint teslimat_durak_uq unique (sefer_id, durak_no),

  -- İmzanın iki biçimi birden olamaz: hangisi gerçek belirsiz kalırdı.
  constraint teslimat_imza_tek_bicim
    check (imza_svg is null or imza_yol is null),

  -- İptal edildiyse sebebi de vardır. Sebepsiz iptal, iz bırakmayan bir
  -- geri alma olurdu.
  constraint teslimat_iptal_butun
    check ((iptal_at is null and iptal_sebep is null) or (iptal_at is not null and iptal_sebep is not null))
);

-- Yöneticinin sorusu: "bu seferin kanıtı".
create index if not exists teslimat_sefer_idx on public.teslimatlar (sefer_id);
-- Şoför ekseni ve tarih taraması ("dün ne teslim ettim").
create index if not exists teslimat_worker_zaman_idx
  on public.teslimatlar (worker_id, teslim_at desc);

-- ── 2) TESLİMAT FOTOĞRAFLARI ────────────────────────────────────────
create table if not exists public.teslimat_fotograflari (
  id uuid primary key default gen_random_uuid(),

  -- Fotoğraf teslimata aittir; teslimat giderse fotoğrafın anlamı kalmaz.
  teslimat_id uuid not null references public.teslimatlar(id) on delete cascade,

  -- Storage yolu: {workerId}/{yyyy}/{mm}/{uuid}.{ext} (lib/storage.ts deseni).
  storage_path text not null check (length(btrim(storage_path)) > 0),

  -- Fotoğrafın KENDİ anı ve yeri — teslimat damgasından farklı olabilir
  -- (kapıda çekildi, imza arabada alındı).
  taken_at timestamptz not null default now(),
  latitude double precision check (latitude is null or latitude between -90 and 90),
  longitude double precision check (longitude is null or longitude between -180 and 180),
  konum_dogruluk_m double precision check (konum_dogruluk_m is null or konum_dogruluk_m >= 0),

  created_at timestamptz not null default now(),

  -- Aynı dosya iki kez bağlanamaz (çift yükleme kazası).
  constraint teslimat_foto_yol_uq unique (storage_path)
);

create index if not exists teslimat_foto_teslimat_idx
  on public.teslimat_fotograflari (teslimat_id);

-- ── 3) DEĞİŞMEZLİK TETİKLEYİCİSİ ────────────────────────────────────
-- Kanıt yazıldıktan sonra YENİDEN YAZILAMAZ. Tek istisna iptal alanları.
create or replace function public.teslimat_degismez()
returns trigger
language plpgsql
as $$
begin
  if
    new.sefer_id          is distinct from old.sefer_id          or
    new.durak_no          is distinct from old.durak_no          or
    new.worker_id         is distinct from old.worker_id         or
    new.zone_id           is distinct from old.zone_id           or
    new.alici_ad          is distinct from old.alici_ad          or
    new.notlar            is distinct from old.notlar            or
    new.imza_svg          is distinct from old.imza_svg          or
    new.imza_yol          is distinct from old.imza_yol          or
    new.teslim_at         is distinct from old.teslim_at         or
    new.latitude          is distinct from old.latitude          or
    new.longitude         is distinct from old.longitude         or
    new.konum_dogruluk_m  is distinct from old.konum_dogruluk_m  or
    new.created_at        is distinct from old.created_at
  then
    raise exception
      'teslimat kaniti DEGISTIRILEMEZ (id=%). Yalnizca iptal alanlari guncellenebilir; duzeltme icin YENI bir durak kaydi acin.',
      old.id
      using errcode = 'HK080';
  end if;
  return new;
end
$$;

drop trigger if exists trg_teslimat_degismez on public.teslimatlar;
create trigger trg_teslimat_degismez
  before update on public.teslimatlar
  for each row execute function public.teslimat_degismez();

-- Fotoğraf satırı da değişmez: yolu değiştirmek, kanıtı başka bir görüntüyle
-- takas etmek olurdu. (Silme AYRI bir yetki sorunudur ve uygulama kapatır.)
create or replace function public.teslimat_foto_degismez()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'teslimat fotografi DEGISTIRILEMEZ (id=%).', old.id
    using errcode = 'HK080';
end
$$;

drop trigger if exists trg_teslimat_foto_degismez on public.teslimat_fotograflari;
create trigger trg_teslimat_foto_degismez
  before update on public.teslimat_fotograflari
  for each row execute function public.teslimat_foto_degismez();

-- ── 4) STORAGE KOVASI ───────────────────────────────────────────────
-- Diğer dört kovayla AYNI desen: özel, 5 MB, yalnız görüntü.
-- ⚠️ Bu satır Supabase'e özgüdür (storage şeması). Düz PostgreSQL'de
-- `storage.buckets` yoktur; kurulum dosyası bunu zaten böyle taşıyor.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'teslimat-kaniti', 'teslimat-kaniti', false, 5242880,
  array['image/jpeg','image/png','image/webp','image/heic']
)
on conflict (id) do nothing;

comment on table public.teslimatlar is
  'Teslimat kanıtı (ePOD, 080): imza + not + alıcı + an/yer damgası. DEĞİŞMEZ — yalnız iptal edilebilir. Kanıt seferin BİR DURAĞINA bağlıdır (durak_no), bugün tek durak.';
comment on table public.teslimat_fotograflari is
  'Teslimat kanıtı fotoğrafları (080). Özel kova: teslimat-kaniti. Satır DEĞİŞMEZ.';
comment on column public.teslimatlar.imza_svg is
  'İmza, SVG yol verisi (vektör). Birincil biçim: ~2-6 KB, ölçeklenir, DB yedeğinin içinde taşınır.';
comment on column public.teslimatlar.teslim_at is
  'Teslim anı — SUNUCU saatinden yazılır. İstemci saati elle değiştirilebilir; delilin zamanı tartışmaya açık olamaz.';

commit;

notify pgrst, 'reload schema';

-- ── DOĞRULAMA (ayrı çalıştırın) ───────────────────────────────────────
-- select count(*) from public.teslimatlar;             → 0 beklenir
-- select count(*) from public.teslimat_fotograflari;   → 0 beklenir
-- select id, public from storage.buckets where id = 'teslimat-kaniti';
--
-- Değişmezliği sınamak (satır varken):
--   update public.teslimatlar set notlar = 'x' where id = '<id>';
--   → HATA HK080 "teslimat kaniti DEGISTIRILEMEZ"
--   update public.teslimatlar set iptal_at = now(), iptal_sebep = 'yanlis adres'
--    where id = '<id>';   → GEÇER
--
-- ⚠️ 080 UYGULANMAZSA: teslimat kanıtı özelliği KAPALI kalır; panel ve şoför
-- ekranı normal çalışır, kanıt bölümü "bu kurulumda kapalı" der (aynı kademeli
-- düşüş 056/058/077/078/079'da da var).

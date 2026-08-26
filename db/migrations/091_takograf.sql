-- HAK61 / Galzura Fleet — Migration 091 (TAKOGRAF: .ddd ARŞİVİ VE HAM VERİ)
-- =====================================================================
-- Additive + idempotent. Supabase SQL Editor'da çalıştırın.
-- ⚠️ 090 (saklama politikası) ÖNCE çalıştırılmış olmalı — bu migration
--    `veri_kategorileri` tablosuna satır ekliyor.
--
-- ═══════════════════════════════════════════════════════════════════════
-- 🔴 ÜRÜNÜN SATIŞ VAADİ: DOSYA ARŞİVİ
-- ═══════════════════════════════════════════════════════════════════════
--
-- Müşteri bugün .ddd dosyalarını kendi bilgisayarında bir klasörde tutuyor.
-- Bu ürün o işi devralıyor: dosya Supabase Storage'da KALICI durur, denetimde
-- oradan indirilir, indirilen bayt bayt ORİJİNALDİR.
--
-- Bunun şemadaki üç karşılığı:
--   1. Dosya satırı DEĞİŞMEZ (HK091 tetikleyicisi, 080 deseni)
--   2. `depo_yolu` ve `sha256` UPDATE ile DEĞİŞTİRİLEMEZ
--   3. Ayrıştırma başarısız olsa bile satır ve dosya DURUR —
--      `ayristirma_durumu='basarisiz'` yazılır, kayıt silinmez
--
-- ═══════════════════════════════════════════════════════════════════════
-- ÖLÇÜMLER (kaynak: docs/TAKOGRAF-OLCUM.md, docs/TAKOGRAF-SERVIS.md)
-- ═══════════════════════════════════════════════════════════════════════
--
--   Gerçek dosya boyutları  : kart 10,4-34,9 KB · araç ünitesi 96-155 KB
--   Ayrıştırma (saf)        : 0,5-5,5 ms
--   Uçtan uca (HTTP, sunucu): kart 53-62 ms · VU 121-144 ms
--   → SENKRON ayrıştırma. Kuyruk gereksiz.
--
--   Bir VU dosyası 3.430 faaliyet satırı üretiyor (365 günlükte ≈13.000).
--   ⚠️ Satır yazım süresi HENÜZ ÖLÇÜLMEDİ; `ayristirma_durumu` kolonu bu
--   yüzden şemada duruyor — ölçüm ters çıkarsa asenkrona geçiş bir kod
--   değişikliği olur, migration değil.
--
--   DETAILED_SPEED bloğu ayrıştırılmıyor: dosyanın %93,5'i ama ayrıştırma
--   SÜRESİNE katkısı yok; kazanç JSON yükünde (2,15 MB → 131 KB).
--   ⚠️ Dosya yine de TAM saklanıyor — atlanan yalnız ayrıştırma.
--
-- ═══ RLS ═══
-- Kapalı — şemanın geri kalanıyla tutarlı. Yalnız service-role yazar.
-- =====================================================================

begin;

-- ═════════════════════ 1 · DOSYA KÜNYESİ ═══════════════════════════════

create table if not exists public.takograf_dosyalari (
  id uuid primary key default gen_random_uuid(),

  /**
   * DOSYA TÜRÜ.
   *   'kart' — sürücü kartı (son 28 gün, şoförün kendi verisi)
   *   'vu'   — araç ünitesi (son 365 gün, o araçta kimin sürdüğü)
   *
   * ⚠️ İKİSİ AYNI TABLODA, bilinçli: ikisi de aynı soruyu cevaplıyor —
   * "kim, ne zaman, ne yaptı". Ayrı tablo her ekranı ve her sorguyu ikiye
   * katlardı. Fark bu kolonda ve dolu olan alanlarda görünür.
   */
  tur text not null check (tur in ('kart', 'vu')),

  -- ── ARŞİV (satış vaadinin kendisi) ────────────────────────────────────
  depo_yolu text not null,
  dosya_adi text not null,
  bayt integer not null check (bayt > 0),

  /**
   * 🔑 AYNI DOSYA İKİ KEZ YÜKLENEMEZ.
   *
   * İkinci yükleme reddedilir ve ekran "bu dosya {tarih}'te {kişi}
   * tarafından zaten yüklendi" der. Sessizce kabul etmek faaliyet
   * satırlarını ikiye katlar ve her raporu bozar.
   */
  sha256 text not null unique check (length(sha256) = 64),

  nesil text check (nesil in ('GEN1', 'GEN2', 'GEN2_V2', 'KARMA', 'BILINMIYOR')),

  -- ── DOĞRULAMA (mühür) ─────────────────────────────────────────────────
  /**
   * ⚠️ ÜÇ DEĞER, ÜÇÜ DE FARKLI ŞEY:
   *   'dogrulandi'     — denendi, TUTTU
   *   'dogrulanamadi'  — denendi, TUTMADI ya da sertifika bulunamadı
   *   'denenmedi'      — hiç denenmedi (servis erişilemedi vb.)
   *
   * "Doğrulanamadı" ile "doğrulanmadı" AYNI ŞEY DEĞİLDİR; ekran da bu
   * ayrımı korur. Varsayılan 'denenmedi': henüz bir şey söylemedik.
   *
   * ⚠️ ÖLÇÜLDÜ (26.08.2026): kütüphane doğrulamayı bir DURUM olarak
   * döndürmüyor, HATA fırlatıyor. Servis o hatayı yakalayıp bu üç değerden
   * birine çeviriyor ve metnini `muhur_sebep`e yazıyor.
   */
  muhur_durumu text not null default 'denenmedi'
    check (muhur_durumu in ('dogrulandi', 'dogrulanamadi', 'denenmedi')),
  muhur_sebep text,

  -- ── AYRIŞTIRMA ────────────────────────────────────────────────────────
  /**
   * 🔴 'basarisiz' DOSYANIN SİLİNECEĞİ ANLAMINA GELMEZ.
   *
   * Dosya kanunen saklanması gereken belgenin kendisidir; bizim
   * ayrıştırıcımızın onu okuyamaması, müşterinin yasal kaydını yok etmek
   * için sebep değildir. `ayristirici_surum` saklandığı için ayrıştırıcı
   * güncellenince YENİDEN DENENEBİLİR.
   *
   * 'bekliyor' — servis erişilemedi, sonra denenecek
   */
  ayristirma_durumu text not null default 'bekliyor'
    check (ayristirma_durumu in ('bekliyor', 'tamam', 'basarisiz')),
  ayristirma_hata text,
  ayristirici_surum text,

  -- ── KÜNYE (ayrıştırmadan gelir; çözülemezse NULL) ─────────────────────
  kart_no text,
  arac_vin text,
  arac_plaka text,

  /**
   * TÜRETİLMİŞ BAĞ — çözülebilirse.
   *
   * ⚠️ NULL bir hata değil: yüklenen dosya sistemde kayıtlı olmayan bir
   * şoföre/araca ait olabilir (yeni işe giren, satılan araç). Ekran o zaman
   * ham kart numarasını / VIN'i gösterir, uydurma bir eşleşme yapmaz.
   */
  worker_id uuid references public.workers(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,

  donem_bas timestamptz,
  donem_bit timestamptz,

  -- ── İZ ────────────────────────────────────────────────────────────────
  yukleyen_worker_id uuid references public.workers(id) on delete set null,
  yuklendi_at timestamptz not null default now(),
  guncellendi_at timestamptz not null default now()
);

comment on table public.takograf_dosyalari is
  'Takograf .ddd arşivi (091). Dosya Storage''da KALICI durur; ayrıştırılamasa bile SİLİNMEZ. Satır DEĞİŞMEZ (HK091): depo_yolu, sha256, bayt, tur, yuklendi_at güncellenemez.';
comment on column public.takograf_dosyalari.sha256 is
  'Dosyanın SHA-256''sı. UNIQUE: aynı dosya iki kez yüklenemez, ikincisi reddedilir.';
comment on column public.takograf_dosyalari.muhur_durumu is
  'dogrulandi | dogrulanamadi | denenmedi. "Doğrulanamadı" (denendi, tutmadı) ile "denenmedi" AYNI ŞEY DEĞİLDİR.';
comment on column public.takograf_dosyalari.ayristirma_durumu is
  'bekliyor | tamam | basarisiz. "basarisiz" dosyanın silineceği anlamına GELMEZ — dosya durur, ayrıştırıcı güncellenince yeniden denenir.';

create index if not exists idx_takograf_dosya_zaman
  on public.takograf_dosyalari (yuklendi_at desc);
create index if not exists idx_takograf_dosya_donem
  on public.takograf_dosyalari (donem_bas, donem_bit);
create index if not exists idx_takograf_dosya_worker
  on public.takograf_dosyalari (worker_id) where worker_id is not null;
create index if not exists idx_takograf_dosya_vehicle
  on public.takograf_dosyalari (vehicle_id) where vehicle_id is not null;

-- ═════════════════════ 2 · DEĞİŞMEZLİK (HK091) ═════════════════════════

/**
 * 080'deki `teslimat_degismez` deseninin aynısı.
 *
 * Sonradan düzenlenebilen bir kayıt delil değildir. Arşivin değeri, içindeki
 * dosyanın yüklendiği gibi durduğuna güvenilebilmesinden gelir.
 *
 * DEĞİŞTİRİLEBİLEN alanlar (ayrıştırma sonradan tamamlanabilir / yeniden
 * denenebilir, eşleşme elle düzeltilebilir):
 *   muhur_*, ayristirma_*, kart_no, arac_*, worker_id, vehicle_id,
 *   donem_*, nesil, guncellendi_at
 *
 * DOKUNULAMAYAN alanlar: id, tur, depo_yolu, dosya_adi, bayt, sha256,
 *   yukleyen_worker_id, yuklendi_at
 */
create or replace function public.takograf_dosya_degismez()
returns trigger
language plpgsql
as $$
begin
  if new.id is distinct from old.id
     or new.tur is distinct from old.tur
     or new.depo_yolu is distinct from old.depo_yolu
     or new.dosya_adi is distinct from old.dosya_adi
     or new.bayt is distinct from old.bayt
     or new.sha256 is distinct from old.sha256
     or new.yukleyen_worker_id is distinct from old.yukleyen_worker_id
     or new.yuklendi_at is distinct from old.yuklendi_at
  then
    raise exception
      'takograf dosya kimligi degistirilemez (091): arsivin degeri dosyanin yuklendigi gibi durmasindan gelir'
      using errcode = 'HK091';
  end if;
  new.guncellendi_at := now();
  return new;
end;
$$;

drop trigger if exists trg_takograf_dosya_degismez on public.takograf_dosyalari;
create trigger trg_takograf_dosya_degismez
  before update on public.takograf_dosyalari
  for each row execute function public.takograf_dosya_degismez();

/**
 * SİLME ENGELİ.
 *
 * Arşiv sözü "dosya durur" demek. Satırı silmek dosyayı yetim bırakır ve
 * müşterinin denetimde indireceği kaydı yok eder.
 *
 * ⚠️ 090'ın elle silme aracı bu tabloya HİÇ GELMEZ: `veri_kategorileri`nde
 * 'yasal_zorunlu' olduğu için silme seçicisinde <option> olarak
 * üretilmiyor. Bu tetikleyici SON savunma.
 */
create or replace function public.takograf_dosya_silinemez()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'takograf dosyasi silinemez (091): arsiv urunun satis vaadi; denetimde bu kayittan indirilecek'
    using errcode = 'HK091';
end;
$$;

drop trigger if exists trg_takograf_dosya_silinemez on public.takograf_dosyalari;
create trigger trg_takograf_dosya_silinemez
  before delete on public.takograf_dosyalari
  for each row execute function public.takograf_dosya_silinemez();

-- ═════════════════════ 3 · HAM FAALİYET SATIRLARI ══════════════════════

create table if not exists public.takograf_faaliyetleri (
  id uuid primary key default gen_random_uuid(),

  /**
   * ⚠️ CASCADE ama dosya zaten SİLİNEMİYOR (§2). Cascade yalnız
   * "yeniden ayrıştır" akışında satırları temizlemek için: önce faaliyetler
   * silinir, sonra yenileri yazılır. Dosya satırı yerinde kalır.
   */
  dosya_id uuid not null references public.takograf_dosyalari(id) on delete cascade,

  kart_no text,
  worker_id uuid references public.workers(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,

  gun date,
  baslangic timestamptz,
  bitis timestamptz,
  sure_dk integer check (sure_dk is null or sure_dk >= 0),

  /**
   * AB 561/2006'nın dört faaliyeti. Kod değeri ÇEVRİLMEZ; ekran çevirir.
   *   surus — Lenkzeit / Driving
   *   is    — Andere Arbeiten / Other work
   *   hazir — Bereitschaft / Availability
   *   mola  — Ruhezeit / Rest
   */
  faaliyet text check (faaliyet in ('surus', 'is', 'hazir', 'mola', 'bilinmiyor')),
  slot text check (slot is null or slot in ('surucu', 'yardimci')),
  kaynak_nesil text,

  /** Dosya içindeki sıra — satır numarası oluğu ve kararlı sıralama için. */
  sira integer not null default 0
);

comment on table public.takograf_faaliyetleri is
  'Takograf ham faaliyet satırları (091). Her satır KAYNAK DOSYASINI taşır (dosya_id): çakışan dönemler BİRLEŞTİRİLMEZ, kart ve araç ünitesi aynı olayı iki yandan anlatır ve bu bir çapraz doğrulama fırsatıdır.';

create index if not exists idx_takograf_faaliyet_dosya
  on public.takograf_faaliyetleri (dosya_id, sira);
create index if not exists idx_takograf_faaliyet_zaman
  on public.takograf_faaliyetleri (baslangic);
create index if not exists idx_takograf_faaliyet_worker
  on public.takograf_faaliyetleri (worker_id, gun) where worker_id is not null;

-- ═════════════════════ 4 · OLAY VE ARIZALAR ════════════════════════════

/**
 * Olayın süresi ve öznesi faaliyetten FARKLI; tek tabloya sıkıştırmak
 * 085'te müşteriyi araç/şoför eksenine sıkıştırma hatasının aynısı olurdu.
 */
create table if not exists public.takograf_olaylari (
  id uuid primary key default gen_random_uuid(),
  dosya_id uuid not null references public.takograf_dosyalari(id) on delete cascade,
  tur text,
  bas timestamptz,
  bit timestamptz,
  ciddiyet text,
  arac_plaka text,
  sira integer not null default 0
);

comment on table public.takograf_olaylari is
  'Takograf olay ve arıza kayıtları (091): kart çıkarma, güç kesintisi, hız aşımı. Manipülasyon denetiminin baktığı yer.';

create index if not exists idx_takograf_olay_dosya
  on public.takograf_olaylari (dosya_id, sira);

-- ═════════════════════ 5 · VERİ KATEGORİLERİ (090) ═════════════════════

/**
 * ⚠️ ÜÇÜ DE 'yasal_zorunlu' → 090'ın elle silme ekranı bu tablolar için
 * silme seçeneğini RENDER ETMEZ. Reddetmek bir hatadır ve hata mesajı
 * okunmayabilir; göstermemek bir tasarımdır.
 *
 * ⚠️ 090'ın ZAMAN KÖRLÜĞÜ bu fazda ÇÖZÜLMÜYOR (Volkan kararı):
 * 'yasal_zorunlu' bugün "hiç silinmez" demek; takograf ise "AT'de 24 ay,
 * DE'de 1 yıl silinemez — SONRA silinmelidir" ve Almanya'da silme bir
 * ZORUNLULUKTUR (izleyen yılın 31 Mart'ı). Model bunu henüz ifade edemiyor.
 * Not düşülmüştür; çözüm ayrı bir turun işi.
 */
insert into public.veri_kategorileri (tablo_adi, kolon_adi, kategori, gerekce) values
  ('takograf_dosyalari', null, 'yasal_zorunlu',
   'Takograf indirmesi kanunla emredilen kayittir (AT § 17b AZG 24 ay, DE 1 yil, AB tabani 165/2014 Md. 33(2)). Mufettisin okudugu birincil belge ve urunun arsiv vaadi: dosya silinmez, denetimde buradan indirilir.'),
  ('takograf_faaliyetleri', null, 'yasal_zorunlu',
   'Dosyadan turetilmis ama ayni hukuki kaydin icerigi: kim, ne zaman, ne kadar surdu. Surucunun kisisel verisi olmakla birlikte saklanmasi emredilmistir.'),
  ('takograf_olaylari', null, 'yasal_zorunlu',
   'Kart cikarma, guc kesintisi ve hiz asimi kayitlari manipulasyon denetiminin konusudur; silinebilir olmasi denetimi anlamsiz kilar.')
on conflict (tablo_adi, coalesce(kolon_adi, '*')) do nothing;

-- ═════════════════════ 6 · STORAGE KOVASI ══════════════════════════════

/**
 * Diğer altı kovayla AYNI desen: özel, 5 MB.
 *
 * ⚠️ 5 MB cömert: ÖLÇÜLEN en büyük gerçek dosya 155 KB (araç ünitesi,
 * Gen2v2, 100 blok). 33 kat pay bırakıyor.
 *
 * ⚠️ `.ddd`'nin tescilli bir MIME türü YOK; `application/octet-stream`
 * kullanılıyor. Tarayıcı bazı sistemlerde boş tür gönderebildiği için
 * boş dize de kabul ediliyor — gerçek denetim uzantı + boyut + servisin
 * "okuyamadım" cevabı.
 *
 * ⚠️ Bu satır Supabase'e özgüdür (storage şeması). Düz PostgreSQL'de
 * `storage.buckets` yoktur; kurulum dosyası bunu zaten böyle taşıyor.
 */
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'takograf', 'takograf', false, 5242880,
  array['application/octet-stream', 'application/x-tachograph', '']
)
on conflict (id) do nothing;

commit;

notify pgrst, 'reload schema';

-- =====================================================================
-- ÇALIŞTIRDIKTAN SONRA BEKLENEN HÂL (ayrı çalıştırın):
--
--   select count(*) from public.takograf_dosyalari;      → 0
--   select count(*) from public.takograf_faaliyetleri;   → 0
--   select count(*) from public.takograf_olaylari;       → 0
--
--   select kategori, count(*) from public.veri_kategorileri group by kategori;
--   → arac 3 · kisisel 4 · yasal_zorunlu 8   (090'daki 5 + bu migration'daki 3)
--
--   select id, public, file_size_limit from storage.buckets where id='takograf';
--   → takograf | false | 5242880
--
--   select tgname from pg_trigger where tgrelid='public.takograf_dosyalari'::regclass;
--   → trg_takograf_dosya_degismez · trg_takograf_dosya_silinemez
--
-- MEVCUT VERİYE ETKİSİ: SIFIR. Yalnız yeni tablo/indeks/tetikleyici/kova
-- kurulur; hiçbir mevcut satır okunmaz ya da değiştirilmez.
-- =====================================================================

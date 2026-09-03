-- 098 — YÜKLEME HIZ SINIRI (kişi başına dakikada N dosya).
--
-- ═══ NEDEN GEREKLİ ═══
--
-- Dosya yükleme, mobil API'nin bant genişliği ve DEPOLAMA harcayan ilk
-- ucudur. Kardeş yazma uçlarında hız sınırı yok ve orada bedeli sınırlı: bir
-- satır fazla yazılır. Burada bedeli birikimli — 5 MB'lık dosyalar Storage'a
-- yığılır, saklama politikası onları temizlemez (090 yalnız device_telemetry
-- ve driver_locations kapsıyor) ve fatura sessizce büyür.
--
-- ═══ NEDEN AYRI TABLO, login_attempts DEĞİL ═══
--
-- `login_attempts` KİMLİK DOĞRULAMA sayacıdır: anahtarı `ip|telefon`, amacı
-- çevrimiçi PIN tahminini durdurmak ve satırları kimlik doğrulandığında
-- SİLİNİR (lib/auth-core.ts clearFailures). Yükleme sayacını oraya koymak,
-- başarılı bir girişin yükleme kotasını sıfırlaması demekti — iki farklı
-- olguyu tek satırda toplamak.
--
-- Burada anahtar KİŞİ (`worker_id`), çünkü kota kişiye ait: aynı şoför iki
-- cihazdan yüklese de tek kotadan harcar. IP anahtarı yanlış olurdu — saha
-- ekibi aynı depo Wi-Fi'sinden çıkıyor.
--
-- ═══ SABİT PENCERE (fixed window), KAYAN DEĞİL ═══
--
-- `pencere_basi` + 60 sn içindeki her yükleme sayacı artırır; pencere
-- dolduğunda sayaç sıfırlanır. Kayan pencere daha adil olurdu ama her
-- yüklemenin zaman damgasını saklamayı gerektirir (satır başına N kayıt).
-- Sabit pencerenin bilinen kusuru sınır etkisidir: pencere sonunda 10 +
-- pencere başında 10 = 2 saniyede 20 yükleme. Kabul edildi — bu bir GÜVENLİK
-- sınırı değil, bir MALİYET frenidir; 20 dosya da 200 dosya değildir.
--
-- ⚠️ YARIŞ DURUMU BİLİNÇLİ AÇIK: iki eşzamanlı yükleme aynı sayacı okuyup
-- yazabilir ve biri kaybolur. Atomik `sayac = sayac + 1` için RPC gerekirdi;
-- yaklaşık bir fren için bu karmaşıklık haklı değil. Kaybolan artış tavanı
-- 10'dan 11'e çıkarır, 100'e değil.

begin;

create table if not exists public.upload_rate (
  -- Kişi silinirse kotası da gider; kotanın kişisiz anlamı yok.
  worker_id uuid primary key references public.workers(id) on delete cascade,

  -- Bu pencerenin başlangıcı. now() - pencere_basi > 60 sn ise sayaç sıfırlanır.
  pencere_basi timestamptz not null default now(),

  -- Pencere içinde yapılan yükleme sayısı.
  sayac integer not null default 0 check (sayac >= 0),

  updated_at timestamptz not null default now()
);

comment on table public.upload_rate is
  'Dosya yükleme hız sınırı (098): kişi başına sabit pencerede yükleme sayacı. Tek yazan lib/upload-core.ts.';
comment on column public.upload_rate.pencere_basi is
  'Sabit pencerenin başlangıcı; pencere dolunca sayaç sıfırlanır.';

-- Bakım taraması: eski pencereleri toplu silmek için (satır başına anahtarlı
-- okuma zaten primary key'den geliyor, bu indeks TEMİZLİK içindir).
create index if not exists upload_rate_pencere_idx
  on public.upload_rate (pencere_basi);

commit;

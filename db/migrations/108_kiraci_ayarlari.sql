-- HAK61 / Galzura Fleet — Migration 108 (KİRACI AYARLARI: ÖLÇÜ BİRİMİ + SAAT DİLİMİ)
-- ✅ ÇALIŞTIRILDI 19.09.2026 — ÜÇ KİRACI (HAK61 · Sendigo · galzura-demo)
--    Doğrulama sonucu: tablo 1 / satır 0 (üçünde de) — yani tablo yaratıldı,
--    kiracı henüz ayar girmedi ve zincir env/kod varsayılanından besleniyor.
-- =====================================================================
-- Ölçü birimi (metric|imperial) ve saat dilimi kiracının kendi ayarı olsun:
-- panelden ve mobilden değiştirilebilsin, deploy gerektirmesin. Additive +
-- idempotent; mevcut hiçbir tabloya DOKUNULMAZ. Supabase SQL Editor'da
-- çalıştırın.
--
-- ⚠️ NUMARA NEDEN 108, 106 DEĞİL
-- 106 ve 107 numaraları `db/migrations/_beklemede/` altında ZATEN KULLANIMDA
-- (106_yakit_son_toplama, 107_yakit_sifir_sayimi — yazıldı, henüz hiçbir
-- kiracıda koşmadı). Aynı numaradan iki dosya, o ikisi devreye alındığı gün
-- kurulum SQL'inde sıra çakışması üretirdi. Bu yüzden sıradaki boş numara
-- alındı; 106/107 beklemedeki yakıt işine ayrılmış durumda.
--
-- ═══ NEDEN TABLO, NEDEN ENV DEĞİL (076'nın kararının aynısı) ═══
--
-- Saat dilimi bugüne kadar YALNIZ env'deydi (NEXT_PUBLIC_TENANT_TZ) ve ölçü
-- birimi diye bir kavram hiç yoktu. Env modeli tek müşterili bir kurulumda
-- çalışır; dünya pazarında üç şey birden bozulur:
--
--   1. Env değiştirmek DEPLOY gerektirir. Müşteri saat dilimini düzeltmek için
--      bizden yeni bir dağıtım isteyemez.
--   2. Env'i yalnız BİZ yazabiliriz (Vercel proje ayarları).
--   3. "Bu firma Europe/Istanbul'da çalışıyor" cümlesi bir AYAR değil, o
--      müşteriye ait bir VERİDİR. Verinin yeri veritabanı.
--
-- Env KALDIRILMADI, rolü DEĞİŞTİ: artık yalnız VARSAYILAN sağlıyor. Öncelik
-- sırası kodda tek yerde (lib/tenant-settings.ts):
--        tablo satırı (bu tablo)  >  env  >  koddaki varsayılan
--
-- ⚠️ `NEXT_PUBLIC_TENANT_TZ` KALDIRILAMAZ ve kaldırılmadı: o değer İSTEMCİ
-- paketine derleme anında gömülüyor (lib/format.ts 65 dosyadan, 20'si istemci
-- bileşeni olmak üzere içe aktarılıyor). Tarayıcıda senkron bir sınır
-- fonksiyonunu asenkron bir DB okuması besleyemez. Tablo SUNUCU tarafını
-- yönetir; istemci bir sonraki dağıtıma kadar derleme sabitini kullanır.
--
-- ═══ NEDEN PARA BİRİMİ YOK ═══
--
-- EUR SABİT ve bu migration ona DOKUNMUYOR. Para birimini ayar yapmak, kur
-- dönüşümü + geçmiş kayıtların hangi kurla yazıldığı sorusunu açar; ikisi de
-- bu turun işi değil ve yarım yapılırsa rapor sessizce yanlış toplar.
--
-- ═══ NEDEN TEK SATIR (singleton) ═══
--
-- 076'daki gerekçenin aynısı: bu mimaride her kiracının KENDİ veritabanı var
-- (lib/brand.ts REGISTRY: hak61 / sendigo / galzura-demo ayrı Supabase
-- projeleri). "Kiracı" ayrımı satır düzeyinde DEĞİL, veritabanı düzeyinde. Bir
-- `tenant_id` kolonu hiçbir zaman ikinci değeri almayacak bir eksen doğururdu
-- ve o eksen unutulan bir WHERE ile sessiz bir sızıntı kapısına dönerdi.
--
-- Tekilliği CHECK garanti eder: `id` yalnız 'singleton' olabilir.
--
-- ═══ NEDEN unit_system NOT NULL, timezone NULL'LANABİLİR ═══
--
-- İkisi FARKLI sorular:
--   · `unit_system` — ürünün bir davranışı ve varsayılanı BİZİM kararımız
--     ('metric', bugüne kadarki tek davranış). NOT NULL + default, çünkü
--     "girilmedi" ile "metric" arasında pratik bir fark yok.
--   · `timezone`    — NULL = "kiracı girmedi, env/kod varsayılanı geçerli".
--     Burada ayrım GERÇEK: env'de `NEXT_PUBLIC_TENANT_TZ` tanımlıysa o kazanır
--     ve ekran bunu "env'den geliyor" diye göstermek zorunda. NOT NULL yapıp
--     'Europe/Vienna' yazsaydık, satır bir kez oluştuğunda env kademesi
--     SESSİZCE ölürdü.
--
-- ═══ RLS ═══
-- Kapalı — şemanın geri kalanıyla tutarlı (grant modeli). Tabloya yalnız
-- service-role istemcisi yazar; yetki uygulama kodunda (requireAdmin /
-- requireMobileAdmin).
-- =====================================================================

begin;

create table if not exists public.tenant_settings (
  -- Tekillik kilidi: tek satır, adı sabit.
  id text primary key default 'singleton'
    check (id = 'singleton'),

  -- ── ÖLÇÜ BİRİMİ ─────────────────────────────────────────────────────
  -- 'metric'   → km · L · L/100km · °C   (bugünkü tek davranış)
  -- 'imperial' → mi · gal · mpg · °F
  -- CHECK iki değerle sınırlı: üçüncü bir dize yazılırsa uygulama onu
  -- tanımaz ve sessizce metric'e düşerdi — sessiz düşüş yerine yazma hatası.
  unit_system text not null default 'metric'
    check (unit_system in ('metric', 'imperial')),

  -- ── SAAT DİLİMİ ─────────────────────────────────────────────────────
  -- IANA adı, ör. 'Europe/Vienna' · 'Europe/Istanbul'. NULL = girilmedi →
  -- env (NEXT_PUBLIC_TENANT_TZ) → kod varsayılanı ('Europe/Vienna').
  --
  -- ⚠️ CHECK'te LİSTE YOK ve olmamalı: geçerli IANA kümesi tzdata ile
  -- değişiyor; veritabanına gömülen bir liste ilk güncellemede bayatlar ve
  -- meşru bir dilimi reddeder. Doğrulama uygulama katmanında `Intl` ile
  -- yapılıyor (lib/tz.ts ianaGecerliMi) — çalışma zamanının kendi tzdata'sı.
  -- Buradaki tek şart: boş dize olmasın.
  timezone text
    check (timezone is null or length(btrim(timezone)) > 0),

  -- ── İZ ──────────────────────────────────────────────────────────────
  -- Saat dilimi GÜN SINIRINI değiştiriyor: bir vardiyanın hangi güne
  -- sayıldığı, AZG raporunun hangi güne düştüğü buna bağlı. "Bu ayarı kim,
  -- ne zaman değiştirdi" sorusu altı ay sonra sorulacak.
  -- Hesap silinirse ayar KALIR (set null): değer firmanın, kişinin değil.
  updated_at timestamptz not null default now(),
  updated_by uuid references public.workers(id) on delete set null
);

comment on table public.tenant_settings is
  'Kiracı ayarları (108): ölçü birimi + saat dilimi. Tek satır: id=''singleton''. timezone NULL = girilmedi, env/kod varsayılanı kullanılır. Para birimi EUR sabittir ve burada tutulmaz.';

comment on column public.tenant_settings.unit_system is
  'metric | imperial. Varsayılan metric — ürünün bugüne kadarki tek davranışı.';

comment on column public.tenant_settings.timezone is
  'IANA saat dilimi adı. NULL = kiracı girmedi; NEXT_PUBLIC_TENANT_TZ, o da yoksa Europe/Vienna geçerli. Gün sınırını ve AZG gün atfını belirler.';

commit;

-- ── DOĞRULAMA (ayrı çalıştırın) ───────────────────────────────────────
-- select * from public.tenant_settings;
--   → 0 satır beklenir: tablo yaratıldı ama kiracı henüz ayar girmedi, yani
--     birim 'metric' (varsayılan) ve saat dilimi env/kod zincirinden gelir.
--     Panel ilk kaydetmede satırı kendisi oluşturur (upsert).

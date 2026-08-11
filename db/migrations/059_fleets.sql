-- 059_fleets.sql — İSİMLİ FİLOLAR (kiracı başına en fazla 5)
--
-- ⚠️⚠️ BU DOSYA HENÜZ ÇALIŞTIRILMADI. Claude ÇALIŞTIRMAZ — Volkan Supabase SQL
-- Editor'da elle çalıştırır. Çalıştırılana kadar:
--   · GET  /api/mobile/fleets            ÇALIŞIR (filolar vehicles.fleet'ten türetilir)
--   · POST /api/mobile/fleets/[id]/atamalar ÇALIŞIR (yazdığı kolon bugün var)
--   · POST /api/mobile/fleets  ve  PATCH /api/mobile/fleets/[id]  →  503 tablo_yok
-- Yani okuma ve taşıma bugün canlı; YENİ FİLO ve YENİDEN ADLANDIRMA bu DDL'i bekler.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  ÖNCE ÖLÇÜLDÜ (canlı HAK61, 11.08.2026)
-- ═══════════════════════════════════════════════════════════════════════════
--  · Ayrı bir `fleets` tablosu YOK (PGRST205 ile doğrulandı).
--  · Filo üyeliği İKİ metin kolonunda yaşıyor:
--      vehicles.fleet        — not null, default 'mavi', check in ('bordo','mavi')   [023]
--      workers.managed_fleet — nullable,                 check in ('bordo','mavi')   [029]
--    İkincisi ÜYELİK DEĞİL ŞEFLİK ("bu kişi o filonun şefi").
--  · Şoförün filosu HİÇBİR YERDE TUTULMUYOR; türetiliyor:
--      vehicles.fleet → vehicles.assigned_worker_id  (lib/fleet-scope.ts)
--  · Kiracı kolonu YOK ve OLMAMALI: her müşteri AYRI bir Supabase veritabanı
--    (db/install/sendigo-full.sql, galzura-full.sql "boş veritabanı" denetimiyle
--    başlıyor). Kiracı kimliği env'de (NEXT_PUBLIC_TENANT), satırda değil.
--    Bu yüzden "kiracı başına 5 filo" = BU VERİTABANINDA 5 SATIR.
--  · Dağılım: 30 araç (10 bordo / 20 mavi, 1'i test aracı) · 34 personel
--    (3 filo şefi: 1 bordo, 2 mavi).
--
-- ═══════════════════════════════════════════════════════════════════════════
--  NEDEN fleet_id DEĞİL, KOD KÖPRÜSÜ
-- ═══════════════════════════════════════════════════════════════════════════
--  `vehicles.fleet` metni 60+ dosyada, iki CHECK kısıtında, FLEET_STYLE renk
--  eşlemesinde, ACTIVE_FLEETS env'inde ve İKİ BAŞKA KİRACININ kurulum SQL'inde
--  geçiyor. Onu `fleet_id uuid` ile değiştirmek, tek turda o yüzeylerin hepsini
--  yeniden yazmak ve 059'u çalıştırmamış kiracıları kırmak demekti.
--
--  Bunun yerine ÜYELİK OLDUĞU YERDE KALIYOR (`vehicles.fleet` = filo KODU) ve
--  bu tablo yalnız üç şey ekliyor: AD · SIRA · O KODUN VAR OLMASI.
--  Sonuç: mevcut 'bordo'/'mavi' verisi tek satır bile değişmeden korunur —
--  aşağıda araç/personel tablolarına DOKUNAN tek ifade CHECK→FK dönüşümüdür,
--  hiçbir UPDATE yok.
--
--  KAZANÇ: izin verilen filo kümesi artık KOD DEĞİL VERİ. 023'ün CHECK'i
--  üçüncü filoyu imkânsız kılıyordu; FK, kümeyi `fleets` satırlarına bağlar.
--  Referans bütünlüğü de CHECK'ten güçlü: olmayan filoya araç yazılamaz ve
--  içinde aracı olan filo SİLİNEMEZ (on delete restrict) — "silme yok, yoksa
--  içindekiler öksüz kalır" kararı böylece şemayla da güvenceye alınmış olur.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  NEDEN AYRI BİR uuid `id` YOK
-- ═══════════════════════════════════════════════════════════════════════════
--  Filonun kimliği ZATEN 30 araç satırında metin olarak duruyor. Yanına bir
--  uuid koymak aynı şeye İKİNCİ bir kimlik verirdi ve veri yine metin olanı
--  kullanmaya devam ederdi: uçlar hangisini kabul edecek, istemci hangisini
--  saklayacak? Üstelik tablo YOKKEN (bugün) uuid diye bir şey hiç yok, yani
--  uçların migration öncesi ve sonrası kimliği FARKLI olurdu.
--  Bir kimlik: `code`. URL'deki `[id]` segmenti de odur (/api/mobile/fleets/mavi).
--
-- ═══════════════════════════════════════════════════════════════════════════
--  NEDEN `name` NULL OLABİLİYOR
-- ═══════════════════════════════════════════════════════════════════════════
--  Bugün filo adı i18n sözlüğünden geliyor ("Bordo Filo" / "Bordo-Flotte") ve
--  kiracı env'iyle ezilebiliyor (NEXT_PUBLIC_FLEET_*_LABEL, lib/tenant.ts).
--  Tohumda Türkçe adı YAZSAYDIK, Almanca kurulumda 059 çalıştığı an ad sessizce
--  Türkçeye dönerdi. NULL = "kiracı henüz ad vermedi" → görünen ad bugünkü
--  kaynaktan gelir. PATCH ad yazar, boş ad tekrar NULL'a döndürür.
--  Bu yüzden 059 çalıştırıldığında GÖRÜNEN HİÇBİR AD DEĞİŞMEZ.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  NEDEN TAVAN ŞEMADA (check 1..5), UYGULAMADA DEĞİL
-- ═══════════════════════════════════════════════════════════════════════════
--  "En fazla 5" satır SAYISINA ait bir kural; CHECK satır sayamaz. Uygulamada
--  say-sonra-yaz yapılırsa iki yönetici aynı anda 6. filoyu açabilir.
--  `sort_order` 1..5 aralığında ve BENZERSİZ olduğu için tavan YAPISALDIR:
--  beşten fazla satır fiziksel olarak sığmaz, yarışın kaybedeni 23505 alır.
--  Sıra aynı zamanda "N. Filo" varsayılan adının N'i ve listenin kararlı sırası.
--  DEFERRABLE: ileride bir yeniden sıralama ucu yazılırsa iki filonun sırası
--  TEK transaction içinde takas edilebilsin (yoksa geçici çakışma engellerdi).
--  Tavanı değiştirmek isteyen bu CHECK'i VE lib/fleets.ts:FILO_TAVANI'nı birlikte
--  değiştirir; scripts/check-filo-yonetimi.mjs ikisinin ayrışmasını yakalar.
--
--  Ad uzunluğu sınırı BİLEREK ŞEMADA DEĞİL: o bir ÜRÜN kararı ve her fikir
--  değişikliğinde migration istemesin (056'daki ARIZA_ACIKLAMA_MAX ile aynı gerekçe).
--
-- ═══════════════════════════════════════════════════════════════════════════
--  GERİYE DÖNÜK ETKİ
-- ═══════════════════════════════════════════════════════════════════════════
--  Yeni tablo + iki kısıt dönüşümü. Hiçbir satır güncellenmiyor, hiçbir kolon
--  düşmüyor, hiçbir mevcut sorgu değişmiyor: 'bordo'/'mavi' yazan/okuyan her
--  kod aynen çalışmaya devam eder (FK o iki kodu kabul eder, çünkü tohumda var).
--  Bu tablosu olmayan kurulumda (Sendigo/galzura-demo) uçlar `tablo_yok` DER —
--  sessizce "filo yok" gibi görünmez.
--
--  Gizlilik: bu dosyada plaka/isim/e-posta YOK.

-- ── 1 · FİLO TANIMLARI ─────────────────────────────────────────────────────
create table if not exists public.fleets (
  -- Kimlik = kod. vehicles.fleet ve workers.managed_fleet bunu tutuyor.
  code       text primary key,
  -- NULL = kiracı ad vermedi; görünen ad i18n/env'den gelir (yukarıdaki not).
  name       text,
  -- 1..5 · benzersiz → tavan YAPISAL. Aynı zamanda kararlı liste sırası.
  sort_order smallint not null check (sort_order between 1 and 5),
  created_at timestamptz not null default now(),
  constraint fleets_sort_order_key unique (sort_order) deferrable initially deferred
);

comment on table public.fleets is
  'İsimli filolar (en fazla 5). Üyelik BURADA DEĞİL: araç vehicles.fleet=code ile bağlı, personel araçtan türetilir (lib/fleet-scope.ts).';
comment on column public.fleets.name is
  'NULL ise görünen ad i18n/env''den gelir (lib/vehicle-ui.ts fleetLabel). Yeniden adlandırma bunu yazar.';

-- ── 2 · TOHUM — MEVCUT VERİYİ KORUR ────────────────────────────────────────
-- Ad BİLEREK NULL (yukarıdaki gerekçe). Sıra bugünkü arayüz sırası:
-- FLEET_STYLE ve ACTIVE_FLEETS varsayılanı ikisinde de bordo önce geliyor.
insert into public.fleets (code, name, sort_order) values
  ('bordo', null, 1),
  ('mavi',  null, 2)
on conflict (code) do nothing;

-- ── 3 · CHECK → FK · İZİN VERİLEN KÜME ARTIK VERİ ──────────────────────────
-- Kısıt adları 023/029'da AÇIKÇA VERİLMEDİ, yani PostgreSQL'in ürettiği ada
-- (vehicles_fleet_check / workers_managed_fleet_check) güvenmek zorunda
-- kalırdık — kurulumdan kuruluma değişebilir. Onun yerine 'bordo' geçen CHECK
-- kısıtları ADIYLA DEĞİL TANIMIYLA bulunup düşürülüyor. İdempotent: ikinci
-- çalıştırmada düşürecek bir şey bulamaz ve sessizce geçer.
do $fleet_check$
declare c record;
begin
  for c in
    select conrelid::regclass::text as tbl, conname
      from pg_constraint
     where contype = 'c'
       and conrelid in ('public.vehicles'::regclass, 'public.workers'::regclass)
       and pg_get_constraintdef(oid) ilike '%bordo%'
  loop
    execute format('alter table %s drop constraint %I', c.tbl, c.conname);
    raise notice 'düşürüldü: % on %', c.conname, c.tbl;
  end loop;
end
$fleet_check$;

-- Araç → filo. RESTRICT: içinde aracı olan filo silinemez (öksüz araç olmaz).
-- CASCADE (update): bir kodun kendisi değiştirilirse araçlar birlikte taşınır.
do $fk_vehicles$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'vehicles_fleet_fkey'
      and conrelid = 'public.vehicles'::regclass
  ) then
    alter table public.vehicles
      add constraint vehicles_fleet_fkey foreign key (fleet)
      references public.fleets(code) on update cascade on delete restrict;
  end if;
end
$fk_vehicles$;

-- Şeflik → filo. NULL serbest (herkes şef değil); FK NULL'ı zaten denetlemez.
do $fk_workers$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'workers_managed_fleet_fkey'
      and conrelid = 'public.workers'::regclass
  ) then
    alter table public.workers
      add constraint workers_managed_fleet_fkey foreign key (managed_fleet)
      references public.fleets(code) on update cascade on delete restrict;
  end if;
end
$fk_workers$;

-- ── 4 · İNDEKS ─────────────────────────────────────────────────────────────
-- FK'nin referans veren tarafı indekssizdi. Filo başına araç sayımı ve
-- ileride bir filo silme denemesi bu indeksi kullanır.
create index if not exists idx_vehicles_fleet on public.vehicles (fleet);

-- Servis-rol istemcisi dışında erişim yok (projedeki diğer tablolarla aynı).
alter table public.fleets disable row level security;

-- PostgREST şema önbelleğini yenile (yeni tablo hemen görünür olsun).
notify pgrst, 'reload schema';

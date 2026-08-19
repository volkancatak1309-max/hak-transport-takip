-- HAK61 — Migration 063 (BÖLGE GÖRSEL KATEGORİSİ)
-- =====================================================================
-- Mobil Bölgeler ekranının kategori rozeti. Additive + idempotent.
-- ⚠️ 015 (geofences) ve 034 (purpose) uygulanmış olmalı. Arşiv kolonu
-- (archived_at) ayrı bir migration'la zaten canlıda.
--
-- ═══ NEDEN `purpose` GENİŞLETİLMİYOR DA YENİ KOLON AÇILIYOR ═══
--
-- `purpose` bugün İKİ işi birden yapıyor: görsel rozet VE davranış anahtarı.
-- purpose='depot' olan bölge şunları sürüyor:
--   (a) otomatik vardiya başlatma tetiği   lib/auto-shift.ts
--   (b) manuel başlatmada depo kilidi      app/actions/shift.ts
--   (c) vardiya başlangıç anını türetir    app/actions/shift.ts
--   (d) şoför panelinde öneri/kilit rozeti app/panel/page.tsx
--   (e) KURAL değerlendirmesinden muafiyet app/admin/araclar/[id]/page.tsx
--
-- `purpose`u 'customer','restricted','custom' ile genişletseydik, mobilde bir
-- bölgenin kategorisini depot→customer çevirmek bu BEŞ davranışı birden
-- sessizce kapatırdı. Büyüklüğü ölçüldü (18.08.2026, HAK61): son 30 günde
-- 511 vardiyanın 346'sı (%68) depo tetiğiyle açılmış ve canlıda yalnız 2 depo
-- bölgesi var — tek bir açılır menü seçimi filonun üçte iki vardiya kaydını
-- durdurabilirdi, hata mesajı olmadan.
--
-- Bu yüzden eksenler AYRI:
--   category = GÖRSEL kategori (mobil/panel rozeti) — motor OKUMAZ
--   purpose  = DAVRANIŞ anahtarı — CHECK'i DEĞİŞMEZ, motor kodu değişmez
-- =====================================================================

begin;

alter table public.geofences
  add column if not exists category text not null default 'custom';

-- Kısıt ayrı: kolon zaten varsa da kısıt garanti altına alınsın.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'geofences_category_check'
  ) then
    alter table public.geofences
      add constraint geofences_category_check
      check (category in ('depot','customer','restricted','custom'));
  end if;
end $$;

-- Geriye dönük doldurma: davranış anahtarı görsel kategoriye yansısın.
-- Yalnız varsayılanda kalmış satırlara dokunur (elle değiştirilmiş satır
-- ezilmez) — migration tekrar çalıştırılabilir kalsın diye.
update public.geofences
   set category = 'depot'
 where purpose = 'depot' and category = 'custom';

-- Varsayılan liste ve motor okumaları "arşivde değil" filtresiyle çalışır.
create index if not exists idx_geofences_not_archived
  on public.geofences (active)
  where archived_at is null;

commit;

notify pgrst, 'reload schema';

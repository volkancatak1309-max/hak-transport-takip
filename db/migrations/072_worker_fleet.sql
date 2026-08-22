-- 072_worker_fleet.sql — ŞOFÖRÜN FİLO BAĞLILIĞI (araçtan bağımsız)
--
-- ⚠️ BU DDL HENÜZ ÇALIŞTIRILMADI. Volkan Supabase'de çalıştıracak.
--    071'den BAĞIMSIZ — sırası önemli değil, ikisi ayrı konu.
--
-- ── HANGİ ARIZAYI KAPATIYOR ────────────────────────────────────────────────
-- Filo şefinin kapsamı bugüne kadar YALNIZ `vehicles.assigned_worker_id`'den
-- türüyordu (lib/fleet-scope.ts getFleetScope). Sessiz sonucu: aracı atanmamış
-- şoför HİÇBİR şefin kapsamına girmiyor. Şefi onu göremiyor, izin talebini
-- onaylayamıyor, raporunda bulamıyor, mesaj atamıyor.
--
-- CANLIDA ÖLÇÜLDÜ (HAK61, 22.08.2026): 28 şoförün 2'si bu durumdaydı ve
-- BİRİ O AN AÇIK VARDİYADAYDI, son kullandığı araç bordo filosundandı.
-- Delik teorik değildi — o gün ısırıyordu.
--
-- ── NEDEN YENİ KOLON ───────────────────────────────────────────────────────
-- Şoföru filoya bağlayan bir alan YOKTU; "araç = kimlik" HAK61'in tesadüfi
-- durumuydu, tasarım kararı değil. Dünya ölçeğinde araçsız şoför kuraldır:
-- havuz filosu, yeni işe giren, aracı serviste olan, yalnız römork çeken.
--
-- Kolaycı alternatif — "araçsız şoför TÜM şeflere görünsün" — reddedildi:
-- o kişinin vardiyası, km'si ve olayı İKİ filonun raporunda birden sayılırdı.
-- Bağlılık AÇIKÇA tutulmalı.
--
-- ── GERİYE DÖNÜK ETKİ: SIFIR ───────────────────────────────────────────────
-- Aşağıdaki geri dolgu kolonu MEVCUT araç atamasından türetiyor. Yani atanmış
-- 26 şoför için kapsam BİREBİR AYNI kalır (aynı kişi hem araç yolundan hem
-- kolon yolundan gelir, küme değişmez). Değişen tek şey araçsızların artık
-- görünmesi.
--
-- Kod bu migration OLMADAN da çalışır: kolon yoksa sorgu hata verir ve kapsam
-- bugünkü hâliyle devam eder (lib/fleet-scope.ts, missing-column dalı).

begin;

-- Alan adı `vehicles.fleet` ile AYNI ve aynı kısıtı taşıyor: iki tabloda iki
-- farklı filo sözlüğü olamaz. NULL = bağlılık bilinmiyor.
alter table public.workers
  add column if not exists fleet text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'workers_fleet_check'
  ) then
    alter table public.workers
      add constraint workers_fleet_check
      check (fleet is null or fleet in ('bordo', 'mavi'));
  end if;
end $$;

-- ── GERİ DOLGU 1: mevcut araç ataması ──────────────────────────────────────
-- Bugün kapsamda olan herkes kolonda da aynı filoya düşer → davranış aynı.
update public.workers w
set    fleet = v.fleet
from   public.vehicles v
where  v.assigned_worker_id = w.id
  and  v.is_test is not true
  and  w.is_test is not true      -- test hesabina gercek filo YAZILMAZ
  and  v.fleet in ('bordo', 'mavi')
  and  w.fleet is null;           -- yeniden kosulabilir: dolu satiri ezmez

-- ── GERİ DOLGU 2: aracı yoksa SON KULLANDIĞI aracın filosu ─────────────────
-- Araçsız şoförün bağlılığı tahmin edilmiyor, GEÇMİŞTEN OKUNUYOR: en son
-- hangi filonun aracıyla vardiya açtıysa o filoya bağlanır. HAK61 ölçümünde
-- bu, açık vardiyadaki şoförü doğru filoya (bordo) koyuyor.
-- Hiç vardiyası olmayanda NULL kalır — uydurmuyoruz.
update public.workers w
set    fleet = son.fleet
from (
  select distinct on (t.worker_id)
         t.worker_id, v.fleet
  from   public.time_entries t
  join   public.vehicles v on v.id = t.vehicle_id
  where  v.fleet in ('bordo', 'mavi')
    and  v.is_test is not true
  order  by t.worker_id, t.started_at desc
) son
where son.worker_id = w.id
  and w.fleet is null
  and w.is_test is not true;

-- Şefin kapsam sorgusu: fleet + is_active + test dışı.
create index if not exists idx_workers_fleet
  on public.workers (fleet)
  where fleet is not null;

comment on column public.workers.fleet is
  'Soforun filo bagliligi — ARACTAN BAGIMSIZ. Araci atanmamis sofor de '
  'sefin kapsaminda kalsin diye (22.08.2026 olcumu: 2/28 sofor kapsam '
  'disiydi, biri acik vardiyadaydi). NULL = baglilik bilinmiyor.';

commit;

-- ── ÇALIŞTIRDIKTAN SONRA — DOĞRULAMA SORGUSU ───────────────────────────────
-- Beklenen: bordo 9→10, mavi 19→19, NULL kalan 1 (hic vardiyasi olmayan kisi).
--
--   select coalesce(fleet, '(NULL)') as filo, count(*)
--   from public.workers
--   where is_active and is_test is not true
--     and (is_admin = false or counts_as_driver = true)
--   group by 1 order by 1;
--
-- NULL kalan varsa: o kisiye panelden filo atanmali. NULL sofor hicbir sefin
-- kapsaminda DEGILDIR — bu bilincli: uydurma bir filoya koymak, verisini
-- yanlis filonun raporuna yazmak olurdu.

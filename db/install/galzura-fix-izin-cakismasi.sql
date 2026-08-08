-- GALZURA DEMO — ÇELİŞKİLİ İZİN KAYDINI DÜZELT
-- =====================================================================
-- Demoda bir izin kaydı, aynı kişinin AÇIK VARDİYALARIYLA çakışıyor:
-- kişi hem "yıllık izinde" hem o günlerde direksiyonda görünüyor. Vardiyalar
-- gerçek telemetriye dayanıyor (araç hareket etmiş), yani yanlış olan izin
-- kaydı — vardiya değil.
--
-- ── KAYIT NEREDEN GELDİ ─────────────────────────────────────────────
-- Tohumdan DEĞİL: galzura-full.sql worker_leaves TABLOSUNU yaratıyor ama tek
-- satır yazmıyor (0 insert), galzura-seed.sql de yazmıyor. Yani kayıt kurulum
-- sonrası panelden girilmiş. Aşağıdaki ilk sorgu bunu leave_edit_log'dan
-- doğruluyor: iz varsa panelden, yoksa doğrudan SQL ile girilmiş.
--
-- ── NEDEN SİLMİYORUZ, İLERİ KAYDIRIYORUZ ────────────────────────────
-- İki seçenek vardı:
--   (a) kaydı sil
--   (b) tarihi geleceğe kaydır, süreyi koru
--
-- (b) seçildi. Gerekçe: çelişkiyi yaratan şey kaydın VARLIĞI değil, geçmişe
-- düşmesi. 10 günlük bir yıllık izin bloğu, Avusturya ağustosunda takvimin en
-- gerçekçi kalemi — silmek demoyu fakirleştirir ve geriye yalnız kısa kayıtlar
-- kalır. İleri kaydırmak çelişkiyi tamamen kaldırır (gelecekte vardiya yok),
-- süreyi ve niyeti korur, gerekirse geri alınabilir.
--
-- Başlangıç PAZARTESİYE oturtuluyor: yıllık izin hafta başında başlar; ortada
-- bir günde başlayan 10 günlük blok takvimde yamuk durur.
--
-- ── DEĞİŞİKLİK İZ BIRAKIR ───────────────────────────────────────────
-- SQL'le yapılan düzeltme normalde hiçbir yerde görünmez. Bu betik
-- leave_edit_log'a da yazıyor, böylece düzeltme güvenlik ekranındaki birleşik
-- zaman çizgisinde görünür — "bu tarih neden değişti" sorusu cevapsız kalmaz.
--
-- Tekrar çalıştırılabilir: çelişki kalmadıysa hiçbir satıra dokunmaz.
-- =====================================================================

begin;

-- ── KAPI ─────────────────────────────────────────────────────────────
do $$
declare yabanci int; toplam int;
begin
  select count(*) into toplam from public.vehicles where not coalesce(is_test,false);
  select count(*) into yabanci from public.vehicles
   where plate not like 'W-GF-%' and not coalesce(is_test,false);
  if toplam = 0 or yabanci > 0 then
    raise exception 'DURDURULDU: bu veritabanı GALZURA DEMO değil (% test dışı araçtan %''si yabancı).',
      toplam, yabanci;
  end if;
end $$;

-- ── 1) TEŞHİS: kayıt panelden mi, SQL'le mi girildi ──────────────────
do $$
declare r record;
begin
  raise notice '── ÇELİŞKİLİ İZİN KAYITLARI ──';
  for r in
    select l.id, w.name, l.leave_type, l.start_date, l.end_date,
           (select count(*) from public.time_entries t
             where t.worker_id = l.worker_id
               and (t.started_at at time zone 'Europe/Vienna')::date
                   between l.start_date and l.end_date) as cakisan,
           exists (select 1 from public.leave_edit_log e where e.leave_id = l.id) as izi_var
    from public.worker_leaves l
    join public.workers w on w.id = l.worker_id
    where exists (
      select 1 from public.time_entries t
      where t.worker_id = l.worker_id
        and (t.started_at at time zone 'Europe/Vienna')::date
            between l.start_date and l.end_date)
  loop
    raise notice '  % · % · %→% · çakışan vardiya: % · kaynak: %',
      r.name, r.leave_type, r.start_date, r.end_date, r.cakisan,
      case when r.izi_var then 'panel (iz var)' else 'doğrudan SQL (iz yok)' end;
  end loop;
end $$;

-- ── 2) DÜZELTME: ileri kaydır, süreyi koru ───────────────────────────
-- Yeni başlangıç: bugünden sonraki İKİNCİ pazartesi (en az 2 gün ileride).
with hedef as (
  select
    l.id,
    l.start_date as eski_bas,
    l.end_date   as eski_bit,
    (l.end_date - l.start_date) as sure,
    -- Bugünden sonraki pazartesi + 7 gün → rahat bir tampon.
    ((now() at time zone 'Europe/Vienna')::date
      + (8 - extract(isodow from (now() at time zone 'Europe/Vienna')::date))::int
      + 7) as yeni_bas
  from public.worker_leaves l
  where exists (
    select 1 from public.time_entries t
    where t.worker_id = l.worker_id
      and (t.started_at at time zone 'Europe/Vienna')::date
          between l.start_date and l.end_date)
),
guncel as (
  update public.worker_leaves l
     set start_date = h.yeni_bas,
         end_date   = h.yeni_bas + h.sure,
         note       = coalesce(l.note || ' · ', '')
                      || 'Tarih düzeltildi (vardiya çakışması)',
         updated_at = now()
    from hedef h
   where l.id = h.id
   returning l.id, h.eski_bas, h.eski_bit, l.start_date, l.end_date
)
-- ── 3) DEĞİŞİKLİK İZİ ────────────────────────────────────────────────
insert into public.leave_edit_log (leave_id, changed_by, action, field, old_value, new_value)
select g.id, (select id from public.workers where is_admin order by name limit 1),
       'update', 'start_date', g.eski_bas::text, g.start_date::text
from guncel g
union all
select g.id, (select id from public.workers where is_admin order by name limit 1),
       'update', 'end_date', g.eski_bit::text, g.end_date::text
from guncel g;

-- ── 4) DENETİM ───────────────────────────────────────────────────────
do $$
declare kalan int; toplam int;
begin
  select count(*) into toplam from public.worker_leaves;
  select count(*) into kalan
  from public.worker_leaves l
  where exists (
    select 1 from public.time_entries t
    where t.worker_id = l.worker_id
      and (t.started_at at time zone 'Europe/Vienna')::date
          between l.start_date and l.end_date);

  raise notice '─────────────────────────────────────────────';
  raise notice 'İZİN KAYDI            : %', toplam;
  raise notice 'KALAN ÇELİŞKİ         : %  (0 olmalı)', kalan;
  raise notice '─────────────────────────────────────────────';

  if kalan > 0 then
    raise exception 'ÇELİŞKİ SÜRÜYOR (% kayıt) — işlem geri alındı', kalan;
  end if;
end $$;

commit;

select w.name as "kişi", l.leave_type as "tür", l.status as "durum",
       l.start_date as "başlangıç", l.end_date as "bitiş", l.note as "not"
from public.worker_leaves l
join public.workers w on w.id = l.worker_id
order by l.start_date;

-- =====================================================================
--  ALTERNATİF — kaydı silmek isterseniz (yukarıdaki güncelleme YERİNE):
--
--    delete from public.worker_leaves l
--     where exists (
--       select 1 from public.time_entries t
--        where t.worker_id = l.worker_id
--          and (t.started_at at time zone 'Europe/Vienna')::date
--              between l.start_date and l.end_date);
--
--  Önerilmez: takvimdeki tek uzun yıllık izin bloğu gider ve geriye yalnız
--  kısa kayıtlar kalır. Çelişkiyi yaratan kaydın varlığı değil, tarihiydi.
-- =====================================================================

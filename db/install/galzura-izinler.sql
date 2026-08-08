-- GALZURA DEMO — İZİN ÜRETİCİ
-- =====================================================================
-- İzin takvimini gerçekçi kayıtlarla doldurur.
--
-- ── EN ÖNEMLİ KURAL: YÖN ────────────────────────────────────────────
-- İzin, "o gün çalışmadı" demektir. Demoda son 7 günün vardiyaları GERÇEK
-- telemetriye dayanıyor: araç hareket etmiş, şoför mesai açmış. O günlere
-- izin yazmak ekranda apaçık bir çelişki üretir — aynı kişi hem izinli hem
-- direksiyonda görünür.
--
-- Bu yüzden üretim İKİ YÖNE AYRILDI:
--
--   GEÇMİŞ (son 7 gün)  → yalnız HASTALIK, yalnız VARDİYASI OLMAYAN güne.
--                         Boşluk yoksa hiçbir şey yazılmaz. Kendi kendini
--                         sınırlar; zorlamaz.
--   GELECEK (21 gün)    → yıllık izin ve bekleyen talepler. Gelecekte vardiya
--                         yok, dolayısıyla çelişecek bir şey de yok.
--
-- Takvim ekranının işi zaten ileriye bakmak: "kim ne zaman izinli olacak".
-- Geçmişi doldurmaya çalışmak, olmayan bir soruyu cevaplamak olurdu.
--
-- ── HACİM NEREDEN GELİYOR ───────────────────────────────────────────
-- Avusturya: yıllık izin 25 iş günü (5 hafta), yılda ~250 iş günü → herhangi
-- bir anda kadronun ~%10'u izinli. Hastalık ortalaması ~13 gün/yıl → ~%5.
-- 29 şoför için üç haftalık pencerede 4-6 kişi yıllık izinde olması normal.
-- Ağustos Avusturya'da izin sezonu; bu sayı gerçekçi, hatta muhafazakâr.
--
-- Onay akışını göstermek için 2 kayıt BEKLEYEN (pending) bırakılır — takvimde
-- silik görünür, patron onayıyla tam renge döner.
--
-- ── TEKRAR ÇALIŞTIRILABİLİR ─────────────────────────────────────────
-- Kişinin ÖRTÜŞEN bir izni varsa o kişi atlanır. İkinci koşu yeni satır
-- yazmaz, elle girilmiş izinleri de ezmez.
--
-- ⚠️ Yalnız GALZURA DEMO veritabanında. Kapı, test kayıtlarını hariç tutarak
--    plakaları denetler (bkz. galzura-seferler.sql'deki aynı kapı).
-- =====================================================================

begin;

-- ── KAPI: YANLIŞ VERİTABANI ──────────────────────────────────────────
do $$
declare
  toplam int;
  yabanci int;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='vehicles' and column_name='is_test'
  ) then
    raise exception 'DURDURULDU: vehicles.is_test kolonu yok — migration 028 çalıştırılmamış.';
  end if;

  select count(*) into toplam
    from public.vehicles where not coalesce(is_test,false);
  if toplam = 0 then
    raise exception 'DURDURULDU: test dışı araç yok. Yanlış veritabanı olabilir.';
  end if;

  select count(*) into yabanci
    from public.vehicles
   where plate not like 'W-GF-%' and not coalesce(is_test,false);
  if yabanci > 0 then
    raise exception
      'DURDURULDU: bu veritabanı GALZURA DEMO değil. Test dışı % araçtan % adedinin plakası W-GF- ile başlamıyor.',
      toplam, yabanci;
  end if;

  if not exists (select 1 from information_schema.tables
                 where table_schema='public' and table_name='worker_leaves') then
    raise exception 'DURDURULDU: worker_leaves tablosu yok — migration 031 çalıştırılmamış.';
  end if;

  raise notice 'Kapı geçildi: % test dışı araç.', toplam;
end $$;

with
-- Yönetici ve test hesapları şoför değildir (lib/driver-scope.ts kuralı).
haric as (
  select id from public.workers where is_admin and not coalesce(counts_as_driver,false)
  union select id from public.workers where coalesce(is_test,false)
),
patron as (
  select id from public.workers where is_admin order by name limit 1
),
-- Aktif şoförler, DETERMİNİSTİK sırayla. random() kullanılmıyor: betik iki kez
-- çalışırsa aynı kişiler aynı izinleri almalı, yoksa "dün gösterdiğim takvim"
-- bir daha aynı olmaz.
sofor as (
  select w.id, w.name,
    row_number() over (
      order by (('x'||substr(md5(w.id::text||'izin'),1,8))::bit(32)::int & 2147483647)
    ) as sira,
    (('x'||substr(md5(w.id::text||'gun'),1,8))::bit(32)::int & 2147483647) as h
  from public.workers w
  where w.is_active
    and w.id not in (select id from haric)
    -- Örtüşen izni olan kişi atlanır (tekrar çalıştırma koruması).
    and not exists (
      select 1 from public.worker_leaves l
      where l.worker_id = w.id
        and l.end_date   >= (now() at time zone 'Europe/Vienna')::date - 7
        and l.start_date <= (now() at time zone 'Europe/Vienna')::date + 21
    )
),
bugun as (select (now() at time zone 'Europe/Vienna')::date as g),

-- ── A) GELECEK: YILLIK İZİN (onaylı) — 4 kişi ────────────────────────
yillik as (
  select s.id, s.name, s.h,
    (select g from bugun) + (2 + (s.h % 16))            as bas,
    (2 + (s.h % 16)) + (4 + ((s.h/13) % 6))             as bit_ofset
  from sofor s where s.sira between 1 and 4
),
-- ── B) GELECEK: BEKLEYEN TALEP — 2 kişi ──────────────────────────────
bekleyen as (
  select s.id, s.name, s.h,
    (select g from bugun) + (5 + (s.h % 12))            as bas,
    (5 + (s.h % 12)) + (2 + ((s.h/7) % 3))              as bit_ofset
  from sofor s where s.sira between 5 and 6
),
-- ── C) GEÇMİŞ: HASTALIK — YALNIZ VARDİYASIZ GÜNE ─────────────────────
-- Son 7 günün hafta içi günleri × şoför; vardiyası OLMAYAN çiftler aday.
-- Boşluk yoksa bu blok BOŞ döner ve hiçbir şey yazılmaz.
gunler as (
  select ((select g from bugun) - i)::date as gun
  from generate_series(1,7) i
),
bos_slot as (
  select s.id, s.name, g.gun,
    row_number() over (
      order by (('x'||substr(md5(s.id::text||g.gun::text),1,8))::bit(32)::int & 2147483647)
    ) as sira
  from sofor s
  cross join gunler g
  where extract(isodow from g.gun) between 1 and 5      -- hafta içi
    and not exists (
      select 1 from public.time_entries t
      where t.worker_id = s.id
        and (t.started_at at time zone 'Europe/Vienna')::date = g.gun
    )
),
hastalik as (
  select id, name, gun from bos_slot where sira <= 2    -- en fazla 2 kayıt
)
insert into public.worker_leaves
  (worker_id, leave_type, start_date, end_date, status, note,
   created_by, approved_by, decided_at, created_at)
-- A) Yıllık izin — onaylı
select y.id, 'jahresurlaub', y.bas,
       (select g from bugun) + y.bit_ofset, 'approved',
       null, (select id from patron), (select id from patron),
       now() - interval '3 days', now() - interval '3 days'
from yillik y
union all
-- B) Bekleyen talep — onay akışını göstermek için
select b.id, 'jahresurlaub', b.bas,
       (select g from bugun) + b.bit_ofset, 'pending',
       'Talep şef tarafından açıldı, onay bekliyor',
       (select id from patron), null, null, now() - interval '1 day'
from bekleyen b
union all
-- C) Hastalık — geçmişte, YALNIZ vardiyasız güne, tek günlük
select h.id, 'krankenstand', h.gun, h.gun, 'approved',
       'Hastalık bildirimi', (select id from patron), (select id from patron),
       h.gun::timestamp at time zone 'Europe/Vienna',
       h.gun::timestamp at time zone 'Europe/Vienna'
from hastalik h;

-- ── DENETİM ──────────────────────────────────────────────────────────
do $$
declare
  n_toplam int;
  n_bekleyen int;
  celiski int;
begin
  select count(*) into n_toplam from public.worker_leaves;
  select count(*) into n_bekleyen from public.worker_leaves where status='pending';

  -- ÇELİŞKİ: aynı kişi aynı gün hem izinli hem vardiyada mı? (0 olmalı)
  select count(*) into celiski
  from public.worker_leaves l
  join public.time_entries t on t.worker_id = l.worker_id
  where (t.started_at at time zone 'Europe/Vienna')::date between l.start_date and l.end_date;

  raise notice '─────────────────────────────────────────────';
  raise notice 'TOPLAM İZİN KAYDI     : %', n_toplam;
  raise notice 'BEKLEYEN TALEP        : %', n_bekleyen;
  raise notice 'ÇELİŞKİ (izinli+vardiyada) : %  (0 olmalı)', celiski;
  raise notice '─────────────────────────────────────────────';

  if celiski > 0 then
    raise exception 'ÇELİŞKİLİ İZİN ÜRETİLDİ — işlem geri alındı (% kayıt)', celiski;
  end if;
end $$;

commit;

select leave_type as "tür", status as "durum", count(*) as "kayıt",
       min(start_date) as "ilk", max(end_date) as "son"
from public.worker_leaves
group by rollup (leave_type, status)
order by 1 nulls last, 2 nulls last;

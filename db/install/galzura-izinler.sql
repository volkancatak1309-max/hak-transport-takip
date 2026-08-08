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
-- İki katman: kişinin ÖRTÜŞEN bir izni varsa o kişi atlanır, VE pencerede
-- hedeflenen sayıya ulaşılmışsa hiç kimseye yazılmaz (bkz. KOTA). İkinci koşu
-- 0 satır yazar; elle girilmiş kayıtlar ne ezilir ne de sayılmaz sayılır.
--
-- ── DENETİM YALNIZ KENDİ İŞİNE BAKAR ────────────────────────────────
-- Yazılan satırlar geçici bir tabloda işaretlenir; çelişki denetimi yalnız
-- onları sınar. Tabloda önceden duran çelişkili kayıtlar UYARI olarak listelenir
-- ama işlemi düşürmez — betik onları yazmadı, geri alması da anlamsız olurdu.
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

-- ⚠️ Bu koşuda yazılan satırlar burada işaretlenir. Denetim YALNIZ buraya
-- bakar. İlk sürümde denetim tüm worker_leaves tablosunu tarıyordu ve betiğin
-- hiç dokunmadığı eski bir kayıt yüzünden kendi ürettiği satırları da geri
-- alıyordu. `on commit drop` → işlem bitince kendiliğinden gider.
create temp table _yeni_izin (
  id         uuid primary key,
  worker_id  uuid not null,
  start_date date not null,
  end_date   date not null
) on commit drop;

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

-- ── KOTA: PENCEREDE ZATEN NE VAR ─────────────────────────────────────
-- Hedef, pencerede ~4 onaylı + 2 bekleyen + 2 hastalık kaydı OLMASI. Kaç tane
-- YAZILACAĞI, hâlihazırda kaç tane olduğuna bağlı. Sabit sayı yazmak ikinci
-- koşuda takvimi ikiye katlıyordu: "örtüşen izni olan atlanır" kuralı yalnız
-- KİŞİYİ atlar, sıradaki kişiye yeni izin yazmayı engellemez. Ölçüldü: 8 satır
-- yazıldıktan sonra ikinci koşu 6 satır daha yazıyordu.
mevcut as (
  select
    count(*) filter (where l.status = 'approved' and l.leave_type <> 'krankenstand'
                       and l.end_date >= (select g from bugun))   as onayli,
    count(*) filter (where l.status = 'pending')                  as bekleyen,
    count(*) filter (where l.leave_type = 'krankenstand'
                       and l.start_date < (select g from bugun))  as hasta
  from public.worker_leaves l
  where l.end_date   >= (select g from bugun) - 7
    and l.start_date <= (select g from bugun) + 21
),
kota as (
  select greatest(0, 4 - (select onayli   from mevcut)) as n_yillik,
         greatest(0, 2 - (select bekleyen from mevcut)) as n_bekleyen,
         greatest(0, 2 - (select hasta    from mevcut)) as n_hasta
),

-- ── A) GELECEK: YILLIK İZİN (onaylı) — en çok 4 kişi ─────────────────
yillik as (
  select s.id, s.name, s.h,
    (select g from bugun) + (2 + (s.h % 16))            as bas,
    (2 + (s.h % 16)) + (4 + ((s.h/13) % 6))             as bit_ofset
  from sofor s
  where s.sira between 1 and (select n_yillik from kota)
),
-- ── B) GELECEK: BEKLEYEN TALEP — en çok 2 kişi ───────────────────────
-- Dilim sabit (5-6): kota küçülse bile aynı kişiler aynı rolü alır.
bekleyen as (
  select s.id, s.name, s.h,
    (select g from bugun) + (5 + (s.h % 12))            as bas,
    (5 + (s.h % 12)) + (2 + ((s.h/7) % 3))              as bit_ofset
  from sofor s
  where s.sira between 5 and 4 + (select n_bekleyen from kota)
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
  select id, name, gun from bos_slot
  where sira <= (select n_hasta from kota)              -- en fazla 2 kayıt
),
-- INSERT ... RETURNING → _yeni_izin. Yazılan satırların kimliği burada kalır.
ins as (
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
  from hastalik h
  returning id, worker_id, start_date, end_date
)
insert into _yeni_izin (id, worker_id, start_date, end_date)
select id, worker_id, start_date, end_date from ins;

-- ── DENETİM ──────────────────────────────────────────────────────────
-- İki ayrı soru, iki ayrı sonuç:
--
--   BU KOŞU  → betiğin yazdığı satırlarda çelişki var mı?  Varsa HATA, geri al.
--              Betik kendi ürettiği kusurdan sorumludur.
--   MEVCUT   → tabloda önceden duran satırlarda çelişki var mı?  Varsa UYARI.
--              Betik onları yazmadı, düzeltmek de onun işi değil; sessiz
--              kalmak yanlış olurdu, işlemi düşürmek de.
--
-- Sayım KAYIT eksenli (`exists`), satır çifti değil. Eski sürüm worker_leaves
-- ile time_entries'i join'liyordu: 5 günlük tek bir izin, o günlerdeki 3
-- vardiyayla eşleşince "3 çelişki" görünüyordu. Çelişkili izin sayısı 1'di.
do $$
declare
  n_yeni int;
  n_toplam int;
  n_bekleyen int;
  celiski_yeni int;
  celiski_eski int;
  r record;
begin
  select count(*) into n_yeni    from _yeni_izin;
  select count(*) into n_toplam  from public.worker_leaves;
  select count(*) into n_bekleyen from public.worker_leaves where status='pending';

  -- A) BU KOŞU: yazdığımız izinlerden kaçı bir vardiyayla çakışıyor?
  select count(*) into celiski_yeni
  from _yeni_izin y
  where exists (
    select 1 from public.time_entries t
    where t.worker_id = y.worker_id
      and (t.started_at at time zone 'Europe/Vienna')::date
          between y.start_date and y.end_date);

  -- B) MEVCUT VERİ: önceden duran kayıtlardan kaçı çakışıyor?
  select count(*) into celiski_eski
  from public.worker_leaves l
  where not exists (select 1 from _yeni_izin y where y.id = l.id)
    and exists (
      select 1 from public.time_entries t
      where t.worker_id = l.worker_id
        and (t.started_at at time zone 'Europe/Vienna')::date
            between l.start_date and l.end_date);

  raise notice '─────────────────────────────────────────────';
  raise notice 'BU KOŞUDA YAZILAN     : %', n_yeni;
  raise notice 'TOPLAM İZİN KAYDI     : %', n_toplam;
  raise notice 'BEKLEYEN TALEP        : %', n_bekleyen;
  raise notice 'ÇELİŞKİ — bu koşu     : %  (0 olmalı)', celiski_yeni;
  raise notice 'ÇELİŞKİ — mevcut veri : %  (uyarı, işlemi düşürmez)', celiski_eski;
  raise notice '─────────────────────────────────────────────';

  if celiski_eski > 0 then
    raise warning 'MEVCUT VERİDE % çelişkili izin kaydı var (bu betik yazmadı):', celiski_eski;
    for r in
      select w.name, l.leave_type, l.start_date, l.end_date,
             (select count(*) from public.time_entries t
               where t.worker_id = l.worker_id
                 and (t.started_at at time zone 'Europe/Vienna')::date
                     between l.start_date and l.end_date) as cakisan
      from public.worker_leaves l
      join public.workers w on w.id = l.worker_id
      where not exists (select 1 from _yeni_izin y where y.id = l.id)
        and exists (
          select 1 from public.time_entries t
          where t.worker_id = l.worker_id
            and (t.started_at at time zone 'Europe/Vienna')::date
                between l.start_date and l.end_date)
      order by l.start_date
    loop
      raise warning '  % · % · %→% · çakışan vardiya: %',
        r.name, r.leave_type, r.start_date, r.end_date, r.cakisan;
    end loop;
    raise warning '  Düzeltmek için: db/install/galzura-fix-izin-cakismasi.sql';
  end if;

  if celiski_yeni > 0 then
    raise exception 'ÇELİŞKİLİ İZİN ÜRETİLDİ — işlem geri alındı (% kayıt)', celiski_yeni;
  end if;
end $$;

commit;

select leave_type as "tür", status as "durum", count(*) as "kayıt",
       min(start_date) as "ilk", max(end_date) as "son"
from public.worker_leaves
group by rollup (leave_type, status)
order by 1 nulls last, 2 nulls last;

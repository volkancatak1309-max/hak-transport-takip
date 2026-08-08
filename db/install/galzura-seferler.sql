-- GALZURA DEMO — SEFER ÜRETİCİ
-- =====================================================================
-- assignments tablosunu, DEMONUN KENDİ GERÇEK VARDİYALARINDAN türetilmiş
-- seferlerle doldurur. Uydurma satır YOK: her sefer, o gün gerçekten çalışmış
-- bir şoföre ve o gün gerçekten telemetri üretmiş bir araca dayanır.
--
-- ── NEDEN VARDİYADAN TÜRETİYORUZ ─────────────────────────────────────
-- Rastgele sefer üretmek ekranı doldurur ama ilk soruda çöker: "bu şoför o
-- gün çalışmış mı?" Sefer 14:00'te başlıyor ama vardiya 10:25'te kapanmışsa
-- müşteri bunu görür. Bu yüzden kaynak time_entries, filtre telemetri.
--
-- ── ÜRETİM KURALLARI ─────────────────────────────────────────────────
--  • Kaynak: son 7 günün time_entries kayıtları, (şoför, gün) çifti başına
--    1 ya da 2 sefer.
--  • O gün o şoförün ATANMIŞ ARACI hiç fix üretmemişse çift ATLANIR.
--  • scheduled_at / started_at / completed_at vardiya penceresinin İÇİNDE
--    ve sıralı.
--  • status zamandan TÜRER (aşağıda), elle atanmaz.
--  • ~%6 iptal, cancel_reason dolu.
--  • Dört kategori de kullanılır; paket sayısı kategoriye uyar.
--  • 2-4 durak, Vorarlberg/Tirol şehirleri. GERÇEK MÜŞTERİ ADRESİ YOK.
--
-- ── RASTGELELİK NEDEN DETERMİNİSTİK ──────────────────────────────────
-- Değerler random() ile değil, md5(şoför||gün) karmasından türüyor. Sebep:
-- betik iki kez çalıştırıldığında (ya da bir kısmı silinip yeniden
-- üretildiğinde) AYNI seferler doğsun. random() kullansaydık her koşuda başka
-- bir demo çıkardı ve "dün gösterdiğim ekran" bir daha aynı olmazdı.
--
-- ── TEKRAR ÇALIŞTIRILABİLİR ──────────────────────────────────────────
-- assignments'ta doğal bir tekil anahtar YOK ve bu betik DDL eklemiyor, bu
-- yüzden ON CONFLICT kullanılamıyor. Bunun yerine: o (şoför, gün) çiftinde
-- ZATEN sefer varsa çift tümüyle atlanır. Yani ikinci koşu hiçbir şey yazmaz,
-- elle eklenmiş seferleri de EZMEZ.
--
-- ⚠️ ÇALIŞTIRMADAN ÖNCE: yalnız GALZURA DEMO veritabanında. Aşağıdaki kapı
--    plakaları denetliyor ve başka bir kurulumda exception ile durur.
--    (Ölçüldü 08.08.2026: HAK61'de 30 aracın 0'ı, Sendigo'da 5 aracın 0'ı
--     W-GF- ile başlıyor — yani kapı gerçekten kapatıyor.)
--    Test kayıtları (is_test) kapının DIŞINDA — bkz. kapı bloğundaki not.
-- =====================================================================

begin;

-- ── KAPI: YANLIŞ VERİTABANI ──────────────────────────────────────────
--
-- ⚠️ TEST KAYITLARI KAPININ DIŞINDA. İlk sürüm bunu atlamıştı ve DOĞRU
--    veritabanında durdu: galzura-full.sql kendi test aracını (is_test=true,
--    plaka TEST-001) üretiyor ve o plaka doğal olarak W-GF- ile başlamıyor.
--    Kapı "demo dışı araç" ararken kendi test kaydını yabancı sandı.
--
--    Eleme PLAKA ADIYLA değil `is_test` BAYRAĞIYLA yapılıyor: db/install/
--    galzura-seed.sql aynı kapıyı `plate <> 'TEST-001'` ile çözmüş, o bugün
--    çalışıyor ama ikinci bir test aracı başka bir plakayla eklendiği gün
--    aynı yanlış-pozitife düşer. Bayrak, kaydın ne OLDUĞUNU söyler; ad yalnız
--    bugünkü tek örneği tanır.
do $$
declare
  toplam int;
  yabanci int;
  sofor int;
begin
  -- Kolon yoksa hata anlaşılır olsun: yoksa "column is_test does not exist"
  -- diye ham bir mesajla durur ve sebebi aramak gerekir.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'vehicles' and column_name = 'is_test'
  ) then
    raise exception 'DURDURULDU: vehicles.is_test kolonu yok — migration 028 çalıştırılmamış.';
  end if;

  select count(*) into toplam
    from public.vehicles where not coalesce(is_test, false);
  if toplam = 0 then
    raise exception 'DURDURULDU: test dışı araç yok. Yanlış veritabanı olabilir.';
  end if;

  select count(*) into yabanci
    from public.vehicles
   where plate not like 'W-GF-%'
     and not coalesce(is_test, false);
  if yabanci > 0 then
    raise exception
      -- ⚠️ Biçim dizesinde %% KULLANILMAZ: PL/pgSQL'de %% literal yüzde işareti
      -- demektir, yer tutucu saymaz — iki argüman verip tek yer bırakmak
      -- "too many parameters specified for RAISE" ile betiği kapıda patlatırdı.
      'DURDURULDU: bu veritabanı GALZURA DEMO değil. Test dışı % araçtan % adedinin plakası W-GF- ile başlamıyor.',
      toplam, yabanci;
  end if;

  select count(*) into sofor
    from public.workers where is_active and not coalesce(is_test, false);
  if sofor = 0 then
    raise exception 'DURDURULDU: test dışı aktif çalışan yok.';
  end if;

  raise notice 'Kapı geçildi: % test dışı araç (hepsi W-GF-), % aktif şoför.', toplam, sofor;
end $$;

-- ── ÜRETİM ───────────────────────────────────────────────────────────
with
-- Yönetici ve test hesapları ŞOFÖR DEĞİLDİR (lib/driver-scope.ts kuralı).
haric as (
  select id from public.workers where is_admin and not coalesce(counts_as_driver, false)
  union
  select id from public.workers where coalesce(is_test, false)
),
-- Seferi kim planlamış görünsün: yöneticilerden ilki.
planlayan as (
  select id from public.workers where is_admin order by name limit 1
),
-- Şoför → atanmış araç. TEK KAYNAK vehicles.assigned_worker_id.
-- TEST ARACI HARİÇ: test aracına sefer yazmak, ekranı demo kalabalığıyla
-- doldurur ve test hesabının gizlendiği her yüzeyde "sahipsiz sefer" bırakır.
arac as (
  select assigned_worker_id as worker_id, id as vehicle_id
  from public.vehicles
  where assigned_worker_id is not null
    and not coalesce(is_test, false)
),
-- Son 7 günün vardiyaları + Viyana günü + pencere.
vardiya as (
  select
    t.worker_id,
    (t.started_at at time zone 'Europe/Vienna')::date as gun,
    t.started_at as bas,
    coalesce(t.ended_at, now()) as bit,
    (t.ended_at is null) as acik
  from public.time_entries t
  where t.started_at >= now() - interval '7 days'
    and t.worker_id not in (select id from haric)
    -- Sıfır/ters pencere sefer taşıyamaz.
    and coalesce(t.ended_at, now()) > t.started_at + interval '30 minutes'
),
-- Aynı gün birden çok vardiya varsa EN UZUNU alınır: seferi en geniş
-- pencereye koymak, saatlerin dışarı taşma riskini en aza indirir.
gunluk as (
  select distinct on (v.worker_id, v.gun)
    v.worker_id, v.gun, v.bas, v.bit, v.acik
  from vardiya v
  order by v.worker_id, v.gun, (v.bit - v.bas) desc
),
-- ARAÇ HAREKET ETTİ Mİ — etmediyse çift düşer (tutarsız satır olmasın).
uygun as (
  select g.*, a.vehicle_id
  from gunluk g
  join arac a on a.worker_id = g.worker_id
  where exists (
    select 1 from public.device_telemetry dt
    where dt.vehicle_id = a.vehicle_id
      and dt.recorded_at >= (g.gun::timestamp at time zone 'Europe/Vienna')
      and dt.recorded_at <  ((g.gun + 1)::timestamp at time zone 'Europe/Vienna')
  )
  -- TEKRAR ÇALIŞTIRMA KORUMASI: bu çiftte sefer varsa hiç dokunma.
  and not exists (
    select 1 from public.assignments x
    where x.worker_id = g.worker_id
      and (x.scheduled_at at time zone 'Europe/Vienna')::date = g.gun
  )
),
-- Deterministik karma: (şoför, gün) → 31 bitlik sayı.
tohumlu as (
  select u.*,
    -- İşaret biti maskeleniyor, abs() DEĞİL: abs(-2147483648) taşar
    -- (bit(32)::int bu değeri üretebilir, 4 milyarda bir ama üretir).
    ((('x' || substr(md5(u.worker_id::text || u.gun::text), 1, 8))::bit(32)::int)
       & 2147483647) as h
  from uygun u
),
-- Çift başına 1 ya da 2 sefer; her biri pencerenin kendi dilimine oturur.
dilimli as (
  select
    t.*,
    (1 + (t.h % 2)) as adet,
    i as sira
  from tohumlu t
  cross join lateral generate_series(1, 1 + (t.h % 2)) as i
),
sabit as (
  select
    array['Feldkirch','Dornbirn','Bludenz','Bregenz','Innsbruck',
          'Hohenems','Götzis','Rankweil','Lustenau','Wolfurt']::text[] as sehir,
    array['lieferung','abholung','kurier','verteilung']::text[] as kategori,
    array['Araç arızası — sefer ertelendi',
          'Müşteri teslim almadı',
          'Hava koşulları (kar) — güzergâh kapalı',
          'Yükleme hazır değildi',
          'Şoför hastalandı — devir alındı']::text[] as iptal_sebep,
    array['Depoya dönüşte yakıt alındı',
          'Teslimat kapıda imzalandı',
          'İkinci durakta bekleme oldu',
          'Palet sayısı tutanakla teyit edildi']::text[] as not_metin
),
-- Zaman iskeleti: dilim penceresi ve içindeki üç an.
zamanli as (
  select
    d.*,
    s.sehir, s.kategori, s.iptal_sebep, s.not_metin,
    -- Karmayı sefer sırasıyla ayrıştır ki aynı gündeki iki sefer aynı olmasın.
    (d.h / (d.sira * 7 + 1)) as h2,
    -- ⚠️ double precision, numeric DEĞİL: Postgres'te `interval * numeric`
    -- operatörü YOK, yalnız `interval * double precision` var.
    d.bas + ((d.bit - d.bas) * ((d.sira - 1)::double precision / d.adet)) as dilim_bas,
    d.bas + ((d.bit - d.bas) * (d.sira::double precision / d.adet))       as dilim_bit
  from dilimli d cross join sabit s
),
hesapli as (
  select
    z.*,
    (z.dilim_bit - z.dilim_bas) as dilim_sure,
    -- Bugün mü? Viyana gününe göre.
    (z.gun = (now() at time zone 'Europe/Vienna')::date) as bugun,
    -- ~%6 iptal.
    ((z.h2 % 100) < 6) as iptal
  from zamanli z
),
son as (
  select
    h.worker_id,
    h.vehicle_id,
    h.gun,
    h.iptal,
    h.acik,
    h.bugun,
    h.kategori[1 + (h.h2 % 4)] as kategori,
    -- Sefer anları: planlanan → başlangıç → bitiş, hepsi dilimin içinde.
    (h.dilim_bas + h.dilim_sure * 0.10::double precision) as t_plan,
    (h.dilim_bas + h.dilim_sure * 0.20::double precision) as t_bas,
    (h.dilim_bas + h.dilim_sure * 0.85::double precision) as t_bit,
    h.sehir, h.iptal_sebep, h.not_metin,
    h.h2,
    (2 + (h.h2 % 3)) as durak_adedi
  from hesapli h
)
insert into public.assignments (
  worker_id, scheduled_at, started_at, completed_at, cancelled_at,
  stops, category, package_count, notes, status, cancel_reason,
  assignment_notified_at, created_by, created_at
)
select
  s.worker_id,
  s.t_plan,
  -- İptalde başlama/bitiş YOK; iptal edilen sefer hiç başlamamıştır.
  case when s.iptal then null
       when s.bugun and s.acik and s.t_plan > now() then null
       else s.t_bas end,
  case when s.iptal then null
       when s.bugun and s.acik then null
       else s.t_bit end,
  case when s.iptal then s.t_plan - interval '25 minutes' else null end,

  -- DURAKLAR: ilk "Çıkış", son "Varış", aradakiler "Ara durak".
  (
    select jsonb_agg(
      jsonb_build_object(
        'label', case when i = 1 then 'Çıkış'
                      when i = s.durak_adedi then 'Varış'
                      else 'Ara durak' end,
        'address', s.sehir[1 + ((s.h2 + i * 3) % 10)] || ' — ' ||
                   case when i = 1 then 'depo'
                        when i = s.durak_adedi then 'teslim noktası'
                        else 'aktarma' end
      ) order by i
    )
    from generate_series(1, s.durak_adedi) as i
  ),

  s.kategori,

  -- PAKET SAYISI kategoriye uyar: kurye tek parça taşır, dağıtım yüzlerce.
  case s.kategori
    when 'kurier'     then 1 + (s.h2 % 3)
    when 'abholung'   then 5 + (s.h2 % 21)
    when 'lieferung'  then 15 + (s.h2 % 46)
    else                   60 + (s.h2 % 81)
  end,

  -- NOT: yaklaşık %40'ında dolu. Hepsinde dolu olsaydı gerçek dışı görünürdü.
  case when (s.h2 % 10) < 4 then s.not_metin[1 + (s.h2 % 4)] else null end,

  -- DURUM ZAMANDAN TÜRER, elle atanmaz:
  --   iptal            → cancelled
  --   geçmiş gün       → completed
  --   bugün + kapanmış → completed
  --   bugün + açık     → planlanan saat geçtiyse started, geçmediyse assigned
  case
    when s.iptal then 'cancelled'
    when not s.bugun then 'completed'
    when not s.acik then 'completed'
    when s.t_plan <= now() then 'started'
    else 'assigned'
  end,

  case when s.iptal then s.iptal_sebep[1 + (s.h2 % 5)] else null end,

  -- Telegram: demo verisi için bildirim GÖNDERİLMİŞ sayılır. null bırakmak,
  -- ileride bir toplu bildirim işi yazılırsa 150 mesajın birden gitmesine
  -- kapı açardı.
  s.t_plan - interval '2 hours',

  (select id from planlayan),
  -- Planlama seferden önce yapılır; kayıt tarihi bir gün öncesi.
  s.t_plan - interval '1 day'
from son s;

-- ── DENETİM ──────────────────────────────────────────────────────────
do $$
declare
  n_toplam int;
  n_bugun int;
  pencere_disi int;
  vardiyasiz int;
  telemetrisiz int;
  test_kaydi int;
begin
  select count(*) into n_toplam from public.assignments;

  -- 1) Sefer anları vardiya penceresinin dışında mı? (0 olmalı)
  select count(*) into pencere_disi
  from public.assignments a
  join public.time_entries t
    on t.worker_id = a.worker_id
   and (t.started_at at time zone 'Europe/Vienna')::date
       = (a.scheduled_at at time zone 'Europe/Vienna')::date
  where a.scheduled_at < t.started_at
     or a.scheduled_at > coalesce(t.ended_at, now());

  -- 2) O gün hiç vardiyası olmayan şoföre sefer yazılmış mı? (0 olmalı)
  select count(*) into vardiyasiz
  from public.assignments a
  where not exists (
    select 1 from public.time_entries t
    where t.worker_id = a.worker_id
      and (t.started_at at time zone 'Europe/Vienna')::date
          = (a.scheduled_at at time zone 'Europe/Vienna')::date
  );

  -- 3) Aracı o gün hiç fix üretmemiş sefer var mı? (0 olmalı)
  -- NOT: join, aracı OLMAYAN şoförün satırlarını düşürür. Üretici zaten
  -- yalnız aracı olan şoföre yazdığı için bu denetim tam kapsıyor; elle
  -- eklenmiş araçsız bir sefer varsa burada görünmez (kasıtlı, o bir üretici
  -- hatası değil).
  select count(*) into telemetrisiz
  from public.assignments a
  join public.vehicles v on v.assigned_worker_id = a.worker_id
  where not exists (
    select 1 from public.device_telemetry dt
    where dt.vehicle_id = v.id
      and dt.recorded_at >= ((a.scheduled_at at time zone 'Europe/Vienna')::date::timestamp
                             at time zone 'Europe/Vienna')
      and dt.recorded_at <  (((a.scheduled_at at time zone 'Europe/Vienna')::date + 1)::timestamp
                             at time zone 'Europe/Vienna')
  );

  -- 4) Test hesabına sefer yazılmış mı? (0 olmalı) — kapı bunu eliyor ama
  -- denetim varsayıma değil ölçüme dayanmalı.
  select count(*) into test_kaydi
  from public.assignments a
  join public.workers w on w.id = a.worker_id
  where coalesce(w.is_test, false);

  select count(*) into n_bugun from public.assignments
  where (scheduled_at at time zone 'Europe/Vienna')::date
        = (now() at time zone 'Europe/Vienna')::date;

  raise notice '─────────────────────────────────────────────';
  raise notice 'TOPLAM SEFER          : %', n_toplam;
  raise notice 'BUGÜNE AİT            : %', n_bugun;
  raise notice 'TUTARSIZ — pencere dışı  : %  (0 olmalı)', pencere_disi;
  raise notice 'TUTARSIZ — vardiyasız    : %  (0 olmalı)', vardiyasiz;
  raise notice 'TUTARSIZ — telemetrisiz  : %  (0 olmalı)', telemetrisiz;
  raise notice 'TUTARSIZ — test hesabı   : %  (0 olmalı)', test_kaydi;
  raise notice '─────────────────────────────────────────────';

  if pencere_disi > 0 or vardiyasiz > 0 or telemetrisiz > 0 or test_kaydi > 0 then
    raise exception
      'TUTARSIZ SATIR ÜRETİLDİ — işlem geri alındı (pencere:% vardiya:% telemetri:% test:%)',
      pencere_disi, vardiyasiz, telemetrisiz, test_kaydi;
  end if;
end $$;

commit;

-- ── SONUÇ TABLOSU ────────────────────────────────────────────────────
-- Supabase SQL Editor yalnız SON sorgunun çıktısını gösterir; ayrıntılı
-- denetim yukarıdaki NOTICE satırlarında.
select
  status                                   as "durum",
  count(*)                                 as "sefer",
  count(distinct worker_id)                as "şoför",
  min((scheduled_at at time zone 'Europe/Vienna')::date) as "ilk gün",
  max((scheduled_at at time zone 'Europe/Vienna')::date) as "son gün",
  round(avg(package_count))                as "ort. paket"
from public.assignments
group by rollup (status)
order by status nulls last;

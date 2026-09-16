-- 099_filo_tasima_izi.sql — FİLO TAŞIMA İZİ + GERİ ALMA
--
-- ⚠️ BU DDL VOLKAN TARAFINDAN 16.09.2026'DA SUPABASE'DE ÇALIŞTIRILDI ve ÜÇ
-- KİRACIDA DA (HAK61 · Sendigo · galzura-demo) UYGULANMIŞ durumdadır. Bu dosya
-- deponun ŞEMA KAYDIDIR — yeni bir kurulum migration listesini buradan
-- yürütecek. Claude tarafından çalıştırılmadı.
--
-- ── UYGULANDIKTAN SONRA CANLIDA ÖLÇÜLDÜ (16.09.2026) ──────────────────────
-- PostgREST pg_catalog'a erişemediği için varlık ADIYLA değil DAVRANIŞLA
-- ölçüldü: tablo okuması HTTP kodu, kolon yanıt alanında, fonksiyonlar
-- PostgREST OpenAPI'sindeki /rpc/ yollarında arandı.
--
--   kiracı         tablo  updated_at  /rpc/filo_*  iz satırı  araç dağılımı
--   HAK61           200      VAR          2            0      bordo 9 · mavi 21
--   Sendigo         200      VAR          2            0      mavi 5
--   galzura-demo    200      VAR          2            0      mavi 30
--
-- `updated_at` damgalı araç: HAK61 0 · Sendigo 0 · galzura-demo 2 (aşağıdaki
-- uçtan uca koşumun iki deneği). Geriye dönük doldurma YOK — damga yalnız
-- gerçekten güncellenen satırda var, kalan 28+30+5 araçta NULL.
--
-- ── UÇTAN UCA KANIT (galzura-demo, 16.09.2026, 41/41 iddia) ───────────────
-- `npm run verify:filo-tasima-izi` — uçları çağırır, sonunda TEMİZLER:
--   · taşıma       2 araç tek batch · iz 2 satır · mavi 30 → mavi 28 + bordo 2
--   · geçmiş       hedef filoda yön "geldi", kaynak filoda "gitti"; limit 9999
--                  sessizce 200'e indirildi ve uygulanan limit söylendi
--   · geri alma    araçlar eski filoda (mavi 30) · iz SİLİNMEDİ · undone_at doldu
--   · ikinci kez   409 zaten_geri_alindi · bilinmeyen batch 404 · şekli bozuk
--                  kimlik de 404 (22P02 ile 503'e DÜŞMEDİ)
--   · atlandı dalı araya uç DIŞINDAN elle taşıma sokuldu → 1 geri alındı,
--                  1 ATLANDI, araya giren karar EZİLMEDİ, iz satırı açık kaldı
--   · temizlik     iz satırları silindi (kalan 0), araçlar başlangıç filosunda
--
-- ── UYGULAMADAN ÖNCE GERÇEK POSTGRES'TE DOĞRULANDI (52 iddia) ─────────────
-- PGlite 0.5.8 / PostgreSQL 18.3 üzerinde: 099 iki kez koştu (idempotent),
-- kısıtlar tuttu, araç/kişi silinince iz yaşadı. En önemlisi ARIZA
-- ENJEKSİYONU: iz yazması tetikleyiciyle zorla düşürüldü ve araç TAŞINMADI —
-- `updated_at` damgası da geri sarıldı, iz tablosu boş kaldı. Aşağıdaki "iz,
-- güncellemenin şartıdır" iddiası VARSAYILMADI, ÖLÇÜLDÜ.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  ÖNCE ÖLÇÜLDÜ (canlı, 16.09.2026)
-- ═══════════════════════════════════════════════════════════════════════════
--  · Taşımanın izi HİÇBİR YERDE yok. `moveToFleet` doğrudan
--    `update vehicles set fleet = …` atıyor; ne önceki filo, ne taşıyan kişi,
--    ne de an kaydediliyor.
--  · `vehicles` tablosunda `updated_at` KOLONU YOK (ölçüldü — kolonlar:
--    id plate make model year status assigned_worker_id inspection_due
--    insurance_due notes created_at flespi_device_id imei vin fleet
--    tank_capacity_l is_test auto_start_enabled device_model fuel_type).
--    Yani "en azından ne zaman değişti" bile sorulamıyor.
--  · Panelin araç formu `auditChange` ile `audit_log`a yazıyor AMA o tablo
--    HAK61'de YOK (HTTP 404 ölçüldü; demo ve Sendigo'da var) ve `audit()`
--    hatayı yutuyor. Dolayısıyla asıl canlı müşteride filo değişikliğinin izi
--    İKİ yolda da tutulmuyor.
--  · Dağılım: 30 araç — bordo 9 / mavi 21 (HAK61, 16.09.2026).
--
-- ═══════════════════════════════════════════════════════════════════════════
--  NEDEN AYRI TABLO, audit_log DEĞİL
-- ═══════════════════════════════════════════════════════════════════════════
--  `audit_log` (045) üç kiracının yalnız ikisinde var ve `SECURITY_LAYER_ENABLED`
--  kapalıyken hiç yazmıyor; üstelik `audit()` hatayı BİLEREK yutuyor ("iz
--  yazılamadı — eylem yine de tamamlanır"). Geri alma o izin üstüne kurulamaz:
--  geri alınacak kaydın VAR OLDUĞUNDAN emin olmayan bir geri alma düğmesi,
--  olmayan bir söz verir. Bu tablo koşulsuz yazılır ve yazılamazsa TAŞIMA DA
--  OLMAZ (aşağıdaki fonksiyon tek ifadede ikisini birden yapar).
--
--  İkinci sebep: `audit_log.meta` serbest jsonb. Geri alma "hangi araç hangi
--  filodan geldi" sorusunu ŞEMADAN sormak zorunda — jsonb içinde arama yapan
--  bir geri alma, alan adı değiştiği gün sessizce boş döner.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  KİRACI KOLONU YOK ve OLMAMALI
-- ═══════════════════════════════════════════════════════════════════════════
--  Her müşteri AYRI bir Supabase veritabanı; kiracı kimliği env'de
--  (NEXT_PUBLIC_TENANT), satırda değil. 059/074/076 ile aynı karar — bir
--  `tenant_id` kolonu, izolasyonu veritabanı düzeyinden satır düzeyine
--  indirmek olurdu.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  NEDEN RPC (fonksiyon), İKİ AYRI PostgREST ÇAĞRISI DEĞİL
-- ═══════════════════════════════════════════════════════════════════════════
--  PostgREST'te her istek kendi işlemidir. "Önce güncelle, sonra iz yaz"
--  deseydik ve ikincisi düşseydi, araç TAŞINMIŞ ama izi OLMAYAN bir durumda
--  kalırdı — ve geri alma tam da o araçta çalışmazdı. En çok ihtiyaç duyulan
--  anda sessizce eksik olan bir güvenlik ağı, ağ değildir.
--
--  Fonksiyon gövdesi TEK işlemdir: iz yazılamazsa güncelleme de geri sarılır.
--  Bu, "best-effort iz" ile "güvenilir geri alma" arasındaki farkın ta kendisi.
--
-- ═══════════════════════════════════════════════════════════════════════════
--  RLS YOK — GRANT MODELİ
-- ═══════════════════════════════════════════════════════════════════════════
--  Projedeki diğer tablolarla aynı: erişim service-role anahtarıyla, satır
--  düzeyi politika ile değil. Yeni bir politika eklemek, bu tabloyu
--  kardeşlerinden farklı bir güvenlik modeline sokardı.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1 · İZ TABLOSU
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.fleet_move_log (
  id uuid primary key default gen_random_uuid(),

  -- TEK DOKUNUŞ = TEK batch_id. Geri alma "o aracı" değil "o kararı" geri alır;
  -- 5 aracı birlikte taşıyıp tek tek geri almak zorunda kalmak, taşımayı bir
  -- karar sayan uç sözleşmesiyle çelişirdi.
  batch_id uuid not null,

  -- ⚠️ FK YOK — BİLEREK. Araç silinirse izi HAYATTA KALMALI: "o araç hangi
  -- filodaydı" sorusunun cevabı, aracın kendisinden uzun yaşar. Aynı karar
  -- leave_edit_log.leave_id'de yazılı (031).
  vehicle_id uuid not null,

  -- Taşımadan ÖNCEKİ ve SONRAKİ filo kodu. FK yok: `fleets` satırı ileride
  -- silinse bile iz okunabilir kalmalı (kod metni zaten 30 araç satırında
  -- yaşıyor, 059'un kod köprüsü kararı).
  from_fleet text not null,
  to_fleet   text not null,
  -- Aynı filoya taşıma iz üretmez; üretseydi "değişmeyen şey" iz kalabalığı
  -- yapar ve geri alma listesi anlamsız satırlarla dolardı.
  constraint fleet_move_log_farkli_filo check (from_fleet is distinct from to_fleet),

  -- Kişi silinirse iz DURUR, yalnız atfı düşer (leave_edit_log.changed_by ile
  -- aynı kalıp). İzin kendisini silmek, silinen kişinin yaptıklarını da
  -- silmek olurdu.
  moved_by uuid references public.workers(id) on delete set null,
  moved_at timestamptz not null default now(),

  -- Geri alındıysa DAMGA. Satır SİLİNMEZ: geri almanın kendisi de bir olaydır
  -- ve "hiç olmamış" gibi göstermek izin amacına aykırı.
  undone_at timestamptz,
  undone_by uuid references public.workers(id) on delete set null,

  -- Damganın yarısı olamaz: geri alan kişi yazılıysa an da yazılı olmalı.
  constraint fleet_move_log_geri_alma_butun
    check (undone_by is null or undone_at is not null)
);

comment on table public.fleet_move_log is
  'Filo tasima izi (099): her tasinan arac icin bir satir, tek dokunus tek batch_id. Tek yazan public.filo_tasi / public.filo_tasima_geri_al.';
comment on column public.fleet_move_log.batch_id is
  'Tek tasima dokunusunun kimligi. Geri alma bu kimlikle calisir - arac tek tek degil, karar butun olarak geri alinir.';
comment on column public.fleet_move_log.vehicle_id is
  'FK YOK (bilerek): arac silinse de izi kalir.';
comment on column public.fleet_move_log.undone_at is
  'Geri alma damgasi. null = hala yururlukte. Satir asla silinmez.';

-- Geri alma erişimi: batch_id ile tek okuma.
create index if not exists fleet_move_log_batch_idx
  on public.fleet_move_log (batch_id);

-- Araç ekseninde geçmiş: "bu araç hangi filolarda dolaştı", en yeniden eskiye.
create index if not exists fleet_move_log_vehicle_idx
  on public.fleet_move_log (vehicle_id, moved_at desc);

-- ⚠️ FİLO EKSENİNDE İNDEKS YOK — bilinçli. Geçmiş ucu
-- `from_fleet = X or to_fleet = X` süzüyor ve bu bir OR; tek kolonlu indeks
-- onu kurtarmaz, iki kısmi indeks ise bu boyuttaki tabloda kazançtan çok
-- bakım yükü olur. 30 araçlık bir filoda yıllık iz birkaç yüz satır: sıralı
-- tarama ölçülebilir bir maliyet üretmez. Tablo on bin satırı geçerse
-- (moved_at desc) indeksi ilk bakılacak yerdir.

-- ─────────────────────────────────────────────────────────────────────────────
-- 2 · vehicles.updated_at
-- ─────────────────────────────────────────────────────────────────────────────
-- ⚠️ DEFAULT YOK ve NULL SERBEST — bilerek. `not null default now()` deseydik
-- 30 mevcut araç satırı "az önce güncellendi" damgası alırdı; oysa hiçbiri
-- güncellenmedi. Uydurulmuş bir zaman damgası, boş bir kolondan kötüdür:
-- ilkine güvenilir, ikincisi "bilinmiyor" der. NULL = bu satır 099'dan beri
-- hiç güncellenmedi.
alter table public.vehicles
  add column if not exists updated_at timestamptz;

comment on column public.vehicles.updated_at is
  'Son guncelleme ani (099). NULL = 099dan bu yana guncellenmedi - geriye donuk doldurulmadi, uydurma damga yazilmadi.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3 · TAŞIMA — güncelleme + iz TEK İŞLEMDE
-- ─────────────────────────────────────────────────────────────────────────────
-- Dönüş: gerçekten TAŞINAN araçlar. Hiçbir araç taşınmadıysa SIFIR satır döner
-- ve çağıran `batchId`yi null yapar — boş bir taşımaya kimlik vermek, geri
-- alınacak hiçbir şeyi olmayan bir "geri al" düğmesi üretirdi.
create or replace function public.filo_tasi(
  p_kod text,
  p_arac_ids uuid[],
  p_by uuid
)
returns table (batch_id uuid, vehicle_id uuid, plate text, from_fleet text)
language plpgsql
as $fn$
declare
  v_batch uuid := gen_random_uuid();
begin
  return query
  -- Taşınmaya ADAY olanlar: istenen kimlikler içinde ve HEDEFTE OLMAYANLAR.
  -- Zaten hedefte olan araç güncellemenin dışında kalır; "değişen" gerçekten
  -- değişen olsun (uçtaki `zatenOrada` sözleşmesi buradan geliyor).
  with hedef as (
    select v.id, v.plate, v.fleet as eski
      from public.vehicles v
     where v.id = any(p_arac_ids)
       and v.fleet is distinct from p_kod
  ),
  tasinan as (
    update public.vehicles v
       set fleet = p_kod,
           updated_at = now()
      from hedef h
     where v.id = h.id
       -- Yarış koruması: araya giren işlem aracı başka filoya almışsa atla.
       and v.fleet = h.eski
    returning v.id
  ),
  -- ⚠️ İZ, GÜNCELLEMENİN YAN ETKİSİ DEĞİL ŞARTIDIR. Bu ifade düşerse (kısıt
  -- ihlali, disk, tablo kilidi) TÜM ifade geri sarılır ve araç taşınmamış olur.
  -- Aşağıdaki son select `iz`i okuduğu için bu CTE'nin çalışması garanti.
  iz as (
    insert into public.fleet_move_log
           (batch_id, vehicle_id, from_fleet, to_fleet, moved_by)
    select v_batch, h.id, h.eski, p_kod, p_by
      from hedef h
      join tasinan t on t.id = h.id
    returning fleet_move_log.vehicle_id as iz_vehicle_id
  )
  select v_batch, h.id, h.plate, h.eski
    from hedef h
    join iz i on i.iz_vehicle_id = h.id;
end
$fn$;

comment on function public.filo_tasi(text, uuid[], uuid) is
  'Araclari hedef filoya tasir ve HER tasinan arac icin fleet_move_log satiri yazar - tek islem. Iz yazilamazsa tasima da geri sarilir. YALNIZ vehicles.fleet ve vehicles.updated_at yazilir; sofor atamasi kolonuna DOKUNULMAZ.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4 · GERİ ALMA
-- ─────────────────────────────────────────────────────────────────────────────
-- Dönüş sözleşmesi iki türlüdür ve `durum` hangisi olduğunu söyler:
--   · 'yok'                → bu batch hiç yok            (uç: 404)
--   · 'zaten_geri_alindi'  → batch var, açık satır yok   (uç: 409)
--   · 'geri_alindi' / 'atlandi' satırları → iş yapıldı   (uç: 200)
-- İlk ikisi TEK satır döner, araç alanları null'dır.
--
-- ⚠️ NEDEN "HEPSİ ATLANDI" 409 DEĞİL: batch'te açık satır varsa geri alma
-- DENENDİ ve sonucu satır satır söyleniyor. 409 "bu istek anlamsız" demektir;
-- oysa burada istek anlamlıydı, dünya değişmişti. İkisini aynı koda toplamak
-- istemciye "tekrar deneme" ile "araç elden gitti"yi ayırt ettirmezdi.
create or replace function public.filo_tasima_geri_al(
  p_batch uuid,
  p_by uuid
)
returns table (
  durum text,
  vehicle_id uuid,
  plate text,
  -- Geri alındıysa: aracın DÖNDÜĞÜ filo. Atlandıysa: dönmesi gereken filo.
  hedef_filo text,
  -- Geri alındıysa: terk edilen filo. Atlandıysa: aracın ŞU ANDA bulunduğu filo.
  mevcut_filo text
)
language plpgsql
as $fn$
declare
  v_toplam integer;
  v_acik integer;
begin
  select count(*), count(*) filter (where l.undone_at is null)
    into v_toplam, v_acik
    from public.fleet_move_log l
   where l.batch_id = p_batch;

  if v_toplam = 0 then
    return query select 'yok'::text, null::uuid, null::text, null::text, null::text;
    return;
  end if;

  if v_acik = 0 then
    return query select 'zaten_geri_alindi'::text, null::uuid, null::text, null::text, null::text;
    return;
  end if;

  return query
  with acik as (
    -- LEFT JOIN: araç silinmiş olabilir. O satır geri alınamaz ama GÖRÜNMELİ —
    -- sessizce düşseydi yanıt "hepsi geri alındı" derdi.
    select l.id as log_id, l.vehicle_id as arac_id, l.from_fleet, l.to_fleet,
           v.plate, v.fleet as mevcut
      from public.fleet_move_log l
      left join public.vehicles v on v.id = l.vehicle_id
     where l.batch_id = p_batch
       and l.undone_at is null
  ),
  -- Yalnız HÂLÂ taşındığı yerde duran araç geri alınır. Araya manuel bir
  -- taşıma girdiyse o araç ATLANIR: geri alma, sonraki kararı ezmemeli.
  uygun as (
    select * from acik where mevcut is not distinct from to_fleet
  ),
  geri as (
    update public.vehicles v
       set fleet = u.from_fleet,
           updated_at = now()
      from uygun u
     where v.id = u.arac_id
       and v.fleet = u.to_fleet
    returning v.id as geri_id
  ),
  damga as (
    update public.fleet_move_log l
       set undone_at = now(),
           undone_by = p_by
      from geri g
     where l.batch_id = p_batch
       and l.vehicle_id = g.geri_id
       and l.undone_at is null
    returning l.vehicle_id as damga_id
  )
  select 'geri_alindi'::text, u.arac_id, u.plate, u.from_fleet, u.to_fleet
    from uygun u
    join damga d on d.damga_id = u.arac_id
  union all
  select 'atlandi'::text, a.arac_id, a.plate, a.from_fleet, a.mevcut
    from acik a
   where a.mevcut is distinct from a.to_fleet;
end
$fn$;

comment on function public.filo_tasima_geri_al(uuid, uuid) is
  'Bir tasima dokunusunu geri alir: araclari from_fleet e dondurur, iz satirina undone damgasi basar. Arac bu arada baska filoya tasinmissa ATLANIR ve yanitta soylenir. Satir SILINMEZ.';

-- Yeni tablo ve iki fonksiyon PostgREST'te hemen görünsün (yoksa ilk çağrı
-- PGRST202 alır ve uç "099 çalışmamış" der).
notify pgrst, 'reload schema';

commit;

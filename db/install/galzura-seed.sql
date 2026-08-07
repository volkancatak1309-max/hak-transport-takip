-- ═══════════════════════════════════════════════════════════════════════════
--  GALZURA FLEET — DEMO TOHUMLAMA (kimlik maskeli)
--  29 araç · 29 takma şoför · 2 depo bölgesi · 3 yönetici
-- ═══════════════════════════════════════════════════════════════════════════
--
--  NE YAPAR
--  Şema kurulmuş BOŞ galzura-demo veritabanına demo kadrosunu yazar.
--  Supabase → SQL Editor → hepsini yapıştır → Run.
--
--  ⚠️  YALNIZ galzura-demo'DA ÇALIŞTIRIN. HAK61 ya da Sendigo'da ASLA.
--      İlk blok bunu denetler ve yanlış veritabanında kendini durdurur.
--
--  KİMLİK KURALI
--    • Plakalar TAKMA: W-GF-101 … W-GF-129 (Viyana serisi).
--    • flespi_device_id + IMEI GERÇEK — telemetri bağı bunlara dayanıyor.
--    • VIN KOPYALANMAZ (null). Cihaz VIN bildirdiği için koddaki kapı da
--      şart: lib/tenant.ts → VIN_BACKFILL_ENABLED, galzura-demo'da false.
--      O kapı olmadan ilk sync turunda gerçek VIN buraya düşer.
--    • Marka/model/yıl/tank GERÇEK — kimlik taşımıyorlar.
--    • Şoför adları/telefonları TAMAMEN UYDURMA. Gerçek personel verisi
--      bu dosyaya hiç girmedi. Adres/ehliyet/doğum tarihi BOŞ.
--
--  HEPSİ YA DA HİÇBİRİ — tek transaction. Bir ifade patlarsa hiçbir şey
--  uygulanmaz. Tekrar çalıştırmak güvenli (on conflict do nothing).
--
--  ÇALIŞTIRDIKTAN SONRA
--    select count(*) from public.vehicles where plate like 'W-GF-%';  -- 29
--    select count(*) from public.workers  where employee_number::int between 1001 and 1029;  -- 29
--    select count(*) from public.vehicles where vin is not null;      -- 0
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── GÜVENLİK KAPISI ────────────────────────────────────────────────────────
-- Bu dosya GERÇEK cihaz kimlikleri taşıyor. Yanlış veritabanında çalışırsa
-- o müşterinin filosunu takma plakalarla kirletir. HAK61/Sendigo'nun kendi
-- plaka desenleri (DO-*, W-GF- dışı) varsa DURUR.
do $guard$
declare
  v_yabanci int;
begin
  select count(*) into v_yabanci
    from public.vehicles
   where plate not like 'W-GF-%' and plate <> 'TEST-001';
  if v_yabanci > 0 then
    raise exception
      'DURDURULDU: bu veritabaninda demo disi % arac var. Bu dosya YALNIZ galzura-demo icindir.',
      v_yabanci;
  end if;
end
$guard$;

-- ── 1) YÖNETİCİLER ────────────────────────────────────────────────────────
-- PIN = 123456 (bcrypt, her hesapta ayrı tuz). must_change_pin=true →
-- ilk girişte panel yeni PIN ister. is_admin=true, şoför sayılmazlar.
insert into public.workers
  (name, phone, pin_hash, is_admin, is_active, must_change_pin, employee_number, is_test)
values
  ('Furkan Bayram', '+905439121886', '$2b$10$NSoHTpr5yaII7bXS43XTBuLcTKzicRT6QgOKKshEpmACMPN4LJHoS', true, true, true, '0101', false),
  ('Volkan Çatak', '+905535910471', '$2b$10$mwRz4Cax4PUGdBEk2u5iAOrkDAIMV68SQUQ9CC6mwAGCDrEQV7rCi', true, true, true, '0102', false),
  ('Gökhan Çatak', '+436608130379', '$2b$10$hPC9QyeBq8tk5TgGKQyK2uWDcz5avZtOezD6lK9.FzHUG9NfvhnFO', true, true, true, '0103', false)
-- Hesap zaten varsa (npm run bootstrap:admin ile açılmışsa) DOKUNMA:
-- PIN'ini 123456'ya geri çevirmek, kurulmuş bir hesabı zayıflatmak olurdu.
on conflict (phone) do nothing;

-- ── 2) 29 TAKMA ŞOFÖR ─────────────────────────────────────────────────────
-- Adlar ve telefonlar UYDURMA. +43 660 000 00XX sahte serisi — Drei (0660)
-- bloğunda gerçek bir aboneye denk gelmeyecek biçimde sıfır dolgulu.
-- address / license_no / license_expiry / birth_date BİLEREK NULL.
insert into public.workers
  (name, phone, pin_hash, is_admin, is_active, must_change_pin, employee_number, is_test,
   address, license_no, license_expiry, birth_date)
values
  ('Max Huber', '+436600000001', '$2b$10$L29q77vT8u6wrZOXe/OqdO9OxpMtLi64VLQChFnw8ty.6VP.fQGnq', false, true, true, '1001', false, null, null, null, null),
  ('Stefan Gruber', '+436600000002', '$2b$10$Zcz19JyN6D6Ezphxt0UNGeVsdqlmbSGtvEZpJFhWqPMnVPPrysQgq', false, true, true, '1002', false, null, null, null, null),
  ('Thomas Wagner', '+436600000003', '$2b$10$mBviL8YG7BXjha7DAq77R.C54jQ/DoFU5eOoaBwc3LTlNw/GvM10C', false, true, true, '1003', false, null, null, null, null),
  ('Andreas Bauer', '+436600000004', '$2b$10$qiInUdEGAGWFmShVMqYfuOrzS4R/vp/oQsLbD5HMfSeYV6Nv6bsIW', false, true, true, '1004', false, null, null, null, null),
  ('Michael Steiner', '+436600000005', '$2b$10$7MDg8yq0w6gW6lVZqNW7JeuLWfq9OS9RVQx8HmOrSlJ7ZFXdoNfie', false, true, true, '1005', false, null, null, null, null),
  ('Christian Mayer', '+436600000006', '$2b$10$VqzR59b0bJH76nVdXct.uO4GUnKRWafWagxVCmUjTez82bsnsaIHC', false, true, true, '1006', false, null, null, null, null),
  ('Markus Berger', '+436600000007', '$2b$10$6UzLdZX0l2dxfC/bBxqFZ..vfTRh4O83fLcnhgzWfnoiSFlsGVzym', false, true, true, '1007', false, null, null, null, null),
  ('Daniel Hofer', '+436600000008', '$2b$10$L38QrKXcQRU5hxWh/ztH6ePcw8QZCT1hYNN5gU647ZPBfa5efQXj6', false, true, true, '1008', false, null, null, null, null),
  ('Patrick Moser', '+436600000009', '$2b$10$8kC8OI.9xSEK3nrKf6W.QuOv1e5xQEazmWrF/NQ5E/RFUaO9cKd3i', false, true, true, '1009', false, null, null, null, null),
  ('Lukas Leitner', '+436600000010', '$2b$10$HQwk9ZIdLNzlLFH8CAQ3n.znD5hRoONBO6ggLaZHkxDRGHmKqbaTa', false, true, true, '1010', false, null, null, null, null),
  ('Florian Fuchs', '+436600000011', '$2b$10$IYTewKpFn2tERqHHPQi3T.zt2ffxq5WfkQCozOKMyOEtafqHOr.7K', false, true, true, '1011', false, null, null, null, null),
  ('Manuel Reiter', '+436600000012', '$2b$10$AqG/XoM.ukvtQhNQq28ZYuIzGefQhSJKTMBs9BAnCvWWeeZJvwJfC', false, true, true, '1012', false, null, null, null, null),
  ('Bernhard Winkler', '+436600000013', '$2b$10$GwXjl9OlbAMRmLuBSNT42.8QFnMKQpYywJUVtlBR.RV9i.gCjj0BW', false, true, true, '1013', false, null, null, null, null),
  ('Christoph Aigner', '+436600000014', '$2b$10$Dg6U9SEI2eg215CY4KWmZ.UKFnSqW4YAP23DJKoKvfbfINGoBA.kO', false, true, true, '1014', false, null, null, null, null),
  ('Alexander Brunner', '+436600000015', '$2b$10$VWTCzT0YjoY43ikksRoFX.tm01EC7ZO7USJH5H7dldvvefcE5895G', false, true, true, '1015', false, null, null, null, null),
  ('Dominik Egger', '+436600000016', '$2b$10$yATGs2TqGdaniLXcV.VWFOJUlG1zddvL8VncF9zaraK3JKOyH4qs2', false, true, true, '1016', false, null, null, null, null),
  ('Fabian Haas', '+436600000017', '$2b$10$bx3Og5eUTJz9C8g364bPKu9ZnUnXeWz4gM.w1BCFV6ZGnQZ.GsK0u', false, true, true, '1017', false, null, null, null, null),
  ('Gerald Koller', '+436600000018', '$2b$10$C/fUpqAcL90eulUW0D3Pv.7M26Vy0DnO5upioCnhy5tb18ie1m17O', false, true, true, '1018', false, null, null, null, null),
  ('Harald Lang', '+436600000019', '$2b$10$EviftW43zwM6ppWpN5L5D.t15gb/wbsYg3IvVodDuYQx/Y7tJ7bc.', false, true, true, '1019', false, null, null, null, null),
  ('Jakob Pichler', '+436600000020', '$2b$10$XmZL/zLwmi/m8owI07CgpuMRVouGwsZQz1V2Ea/CtyJMFOk/prkKy', false, true, true, '1020', false, null, null, null, null),
  ('Julian Schmid', '+436600000021', '$2b$10$vROfx6CTfYkdnI2qArEjheqvKmfN1TepDh1xB0UNXqiZTM7drBX82', false, true, true, '1021', false, null, null, null, null),
  ('Kevin Wallner', '+436600000022', '$2b$10$ITlDN4Sv6p99fr0OrVlbvOwy4PCj.0zJFDBCDee/CxyadyMB88Upy', false, true, true, '1022', false, null, null, null, null),
  ('Martin Ebner', '+436600000023', '$2b$10$WXauRLCMeVGnUpVozRFpcuRFt9E3XmiUzxjHMFI.lqvZz/.aAjoIC', false, true, true, '1023', false, null, null, null, null),
  ('Matthias Fischer', '+436600000024', '$2b$10$QSMqCl0DeFGa3R51Laj9k.HyL3SzHsljE8f2kNwMXk6HVxu5Cub9i', false, true, true, '1024', false, null, null, null, null),
  ('Nikolaus Graf', '+436600000025', '$2b$10$ZjtZ3iOanj7sASf.HjyVO.NMjc2MFJi7l2IhU/eV9gfqkCq4kA0E2', false, true, true, '1025', false, null, null, null, null),
  ('Oliver Hackl', '+436600000026', '$2b$10$tXIRxPKMn1c7zK6J7gvz4eBtNNoF7JgCgq5RD5tN4Tmx9q3uk4ObK', false, true, true, '1026', false, null, null, null, null),
  ('Philipp Jäger', '+436600000027', '$2b$10$jwpsmeRxagecgT3q3hQtF.BGI7.qYDekBBJ8C44Sfr7/5cYIx.4Sy', false, true, true, '1027', false, null, null, null, null),
  ('Rene Kaufmann', '+436600000028', '$2b$10$utuTqEn1nBWXr61VeA9hc.L2DPLmO5rSpmkaguGtB/dKAA36jRVxS', false, true, true, '1028', false, null, null, null, null),
  ('Simon Lechner', '+436600000029', '$2b$10$VBVdUS0WdhvRDDtLJMb3xOpIxA3cZ4BAaypQ/QQrfv3Wl5K8BPHHW', false, true, true, '1029', false, null, null, null, null)
on conflict (phone) do nothing;

-- ── 3) 29 ARAÇ ────────────────────────────────────────────────────────────
-- flespi_device_id ve imei GERÇEK: telemetri hattı bunlara bakıyor.
-- vin BİLEREK null. fleet='mavi' (tek filo; arayüzde "Filo" olarak görünür,
-- migration 023 CHECK yalnız bordo/mavi kabul ettiği için kod adı değişmez).
-- assigned_worker_id 1:1 — otomatik vardiya motoru vardiyayı bu şoföre açar.
insert into public.vehicles
  (plate, make, model, year, tank_capacity_l, flespi_device_id, imei, vin, fleet, status, is_test)
values
  ('W-GF-101', 'Fiat', 'Ducato', 2024, 80, 8552615, '862272085549196', null, 'mavi', 'active', false),
  ('W-GF-102', 'Fiat', 'Ducato', null, 70, 8564325, '860848080823918', null, 'mavi', 'active', false),
  ('W-GF-103', 'Mercedes', 'Sprinter', 2021, 60, 8564334, '862272089073573', null, 'mavi', 'active', false),
  ('W-GF-104', 'VW', 'Crafter', 2020, 70, 8552610, '862272087017929', null, 'mavi', 'active', false),
  ('W-GF-105', 'VW', 'Crafter', null, 70, 8564330, '862272089073417', null, 'mavi', 'active', false),
  ('W-GF-106', 'Mercedes', 'Sprinter', null, 60, 8564335, '862272089073466', null, 'mavi', 'active', false),
  ('W-GF-107', 'Mercedes', 'Sprinter 311 CDI', 2022, 71, 8564332, '862272089073532', null, 'mavi', 'active', false),
  ('W-GF-108', 'Mercedes', 'Sprinter', null, 60, 8564321, '862272086740224', null, 'mavi', 'active', false),
  ('W-GF-109', 'Fiat', 'Ducato', null, 80, 8552507, '862272087017705', null, 'mavi', 'active', false),
  ('W-GF-110', 'Fiat', 'Ducato', 2022, 80, 8552572, '862272087018638', null, 'mavi', 'active', false),
  ('W-GF-111', 'Mercedes', 'Sprinter', null, 60, 8564333, '862272087018646', null, 'mavi', 'active', false),
  ('W-GF-112', 'Fiat', 'Ducato', null, 80, 8564324, '862272085823799', null, 'mavi', 'active', false),
  ('W-GF-113', 'Mercedes', 'Sprinter 315', 2022, 75, 8564322, '862272085341859', null, 'mavi', 'active', false),
  ('W-GF-114', 'Mercedes', 'Sprinter', null, 70, 8564336, '862272084798638', null, 'mavi', 'active', false),
  ('W-GF-115', 'Fiat', 'Ducato', null, 80, 8552612, '862272088073996', null, 'mavi', 'active', false),
  ('W-GF-116', 'Mercedes', 'Sprinter', null, 60, 8564331, '862272088074077', null, 'mavi', 'active', false),
  ('W-GF-117', 'VW', 'Crafter', 2021, 65, 8552603, '862272087017994', null, 'mavi', 'active', false),
  ('W-GF-118', 'Fiat', 'Ducato', null, 80, 8594443, '862272085691246', null, 'mavi', 'active', false),
  ('W-GF-119', 'VW', 'Crafter', null, 75, 8552517, '862272087038487', null, 'mavi', 'active', false),
  ('W-GF-120', 'VW', 'Crafter', null, 80, 8594444, '862272085695551', null, 'mavi', 'active', false),
  ('W-GF-121', 'Mercedes', 'Sprinter', null, 65, 8564323, '862272086816818', null, 'mavi', 'active', false),
  ('W-GF-122', 'Renault', 'Trafic', 2022, 60, 8552560, '862272087018208', null, 'mavi', 'active', false),
  ('W-GF-123', 'Fiat', 'Ducato', 2024, 75, 8564326, '862272086740935', null, 'mavi', 'active', false),
  ('W-GF-124', 'Fiat', 'Ducato', null, 80, 8564329, '862272086799741', null, 'mavi', 'active', false),
  ('W-GF-125', 'Fiat', 'Ducato', 2023, 80, 8564327, '862272088074069', null, 'mavi', 'active', false),
  ('W-GF-126', 'Fiat', 'Ducato', null, 80, 8594808, '862272085549204', null, 'mavi', 'active', false),
  ('W-GF-127', 'VW', 'Crafter', 2018, 70, 8553837, '862272084798661', null, 'mavi', 'active', false),
  ('W-GF-128', 'Fiat', 'Ducato', 2021, 80, 8549498, '862272086797612', null, 'mavi', 'active', false),
  ('W-GF-129', 'Mercedes', 'Sprinter', null, 60, 8564320, '862272085549683', null, 'mavi', 'active', false)
on conflict (plate) do nothing;

-- ── 4) ARAÇ ↔ ŞOFÖR 1:1 EŞLEME ────────────────────────────────────────────
-- Tek kaynak vehicles.assigned_worker_id; workers.plate onun TÜRETİLMİŞ
-- aynasıdır ve ikisi birlikte yazılır (bkz. şoför-araç eşleşmesi kuralı).
update public.vehicles v set assigned_worker_id = w.id
  from public.workers w where w.phone = '+436600000001' and v.plate = 'W-GF-101';
update public.vehicles v set assigned_worker_id = w.id
  from public.workers w where w.phone = '+436600000002' and v.plate = 'W-GF-102';
update public.vehicles v set assigned_worker_id = w.id
  from public.workers w where w.phone = '+436600000003' and v.plate = 'W-GF-103';
update public.vehicles v set assigned_worker_id = w.id
  from public.workers w where w.phone = '+436600000004' and v.plate = 'W-GF-104';
update public.vehicles v set assigned_worker_id = w.id
  from public.workers w where w.phone = '+436600000005' and v.plate = 'W-GF-105';
update public.vehicles v set assigned_worker_id = w.id
  from public.workers w where w.phone = '+436600000006' and v.plate = 'W-GF-106';
update public.vehicles v set assigned_worker_id = w.id
  from public.workers w where w.phone = '+436600000007' and v.plate = 'W-GF-107';
update public.vehicles v set assigned_worker_id = w.id
  from public.workers w where w.phone = '+436600000008' and v.plate = 'W-GF-108';
update public.vehicles v set assigned_worker_id = w.id
  from public.workers w where w.phone = '+436600000009' and v.plate = 'W-GF-109';
update public.vehicles v set assigned_worker_id = w.id
  from public.workers w where w.phone = '+436600000010' and v.plate = 'W-GF-110';
update public.vehicles v set assigned_worker_id = w.id
  from public.workers w where w.phone = '+436600000011' and v.plate = 'W-GF-111';
update public.vehicles v set assigned_worker_id = w.id
  from public.workers w where w.phone = '+436600000012' and v.plate = 'W-GF-112';
update public.vehicles v set assigned_worker_id = w.id
  from public.workers w where w.phone = '+436600000013' and v.plate = 'W-GF-113';
update public.vehicles v set assigned_worker_id = w.id
  from public.workers w where w.phone = '+436600000014' and v.plate = 'W-GF-114';
update public.vehicles v set assigned_worker_id = w.id
  from public.workers w where w.phone = '+436600000015' and v.plate = 'W-GF-115';
update public.vehicles v set assigned_worker_id = w.id
  from public.workers w where w.phone = '+436600000016' and v.plate = 'W-GF-116';
update public.vehicles v set assigned_worker_id = w.id
  from public.workers w where w.phone = '+436600000017' and v.plate = 'W-GF-117';
update public.vehicles v set assigned_worker_id = w.id
  from public.workers w where w.phone = '+436600000018' and v.plate = 'W-GF-118';
update public.vehicles v set assigned_worker_id = w.id
  from public.workers w where w.phone = '+436600000019' and v.plate = 'W-GF-119';
update public.vehicles v set assigned_worker_id = w.id
  from public.workers w where w.phone = '+436600000020' and v.plate = 'W-GF-120';
update public.vehicles v set assigned_worker_id = w.id
  from public.workers w where w.phone = '+436600000021' and v.plate = 'W-GF-121';
update public.vehicles v set assigned_worker_id = w.id
  from public.workers w where w.phone = '+436600000022' and v.plate = 'W-GF-122';
update public.vehicles v set assigned_worker_id = w.id
  from public.workers w where w.phone = '+436600000023' and v.plate = 'W-GF-123';
update public.vehicles v set assigned_worker_id = w.id
  from public.workers w where w.phone = '+436600000024' and v.plate = 'W-GF-124';
update public.vehicles v set assigned_worker_id = w.id
  from public.workers w where w.phone = '+436600000025' and v.plate = 'W-GF-125';
update public.vehicles v set assigned_worker_id = w.id
  from public.workers w where w.phone = '+436600000026' and v.plate = 'W-GF-126';
update public.vehicles v set assigned_worker_id = w.id
  from public.workers w where w.phone = '+436600000027' and v.plate = 'W-GF-127';
update public.vehicles v set assigned_worker_id = w.id
  from public.workers w where w.phone = '+436600000028' and v.plate = 'W-GF-128';
update public.vehicles v set assigned_worker_id = w.id
  from public.workers w where w.phone = '+436600000029' and v.plate = 'W-GF-129';

update public.workers w set plate = v.plate
  from public.vehicles v where v.assigned_worker_id = w.id;

-- ── 5) DEPO BÖLGELERİ ─────────────────────────────────────────────────────
-- SHIFT_START_TRIGGER=first_ignition depo bölgesi İSTEMEZ, ama
-- SHIFT_AUTO_END=depot_idle İSTER: bu iki daire olmadan vardiya yalnız
-- gece-yarısı emniyetiyle, ertesi gün kapanırdı (lib/auto-shift.ts:633-641).
-- Koordinatlar gerçek depo konumlarıdır — kimlik değil, coğrafya.
-- geofences'ta ad için unique kısıt YOK → tekrar çalıştırma ikizlerdi.
-- İki daire üst üste binseydi araç ikisinde birden "depoda" sayılırdı;
-- zararsız ama kirli. Bu yüzden koşullu ekleniyor.
insert into public.geofences
  (name, type, center_lat, center_lng, radius_m, rule_kind, active, purpose)
select * from (values
  ('Depo — Nord', 'circle', 47.45576::double precision, 9.74036::double precision, 500::double precision, 'allowed_only', true, 'depot'),
  ('Depo — Süd',  'circle', 47.304602::double precision, 9.616189::double precision, 500::double precision, 'allowed_only', true, 'depot')
) as yeni(name, type, center_lat, center_lng, radius_m, rule_kind, active, purpose)
where not exists (
  select 1 from public.geofences g
   where g.purpose = 'depot' and g.center_lat = yeni.center_lat and g.center_lng = yeni.center_lng
);

-- ── 6) DENETİM ────────────────────────────────────────────────────────────
-- Beklenen sayılar tutmazsa transaction geri alınır: yarım kadro kalmaz.
do $son$
declare
  v_arac int; v_sofor int; v_atama int; v_vin int; v_depo int; v_yonetici int;
begin
  select count(*) into v_arac from public.vehicles where plate like 'W-GF-%';
  select count(*) into v_sofor from public.workers where phone like '+43660000%';
  select count(*) into v_atama from public.vehicles where plate like 'W-GF-%' and assigned_worker_id is not null;
  select count(*) into v_vin from public.vehicles where vin is not null;
  select count(*) into v_depo from public.geofences where purpose = 'depot';
  select count(*) into v_yonetici from public.workers where is_admin;
  if v_arac <> 29 then raise exception 'Arac sayisi 29 degil: %', v_arac; end if;
  if v_sofor <> 29 then raise exception 'Sofor sayisi 29 degil: %', v_sofor; end if;
  if v_atama <> 29 then raise exception 'Atanmamis arac var: sadece % atandi', v_atama; end if;
  if v_vin <> 0 then raise exception 'VIN SIZINTISI: % aracta vin dolu', v_vin; end if;
  if v_depo <> 2 then raise exception 'Depo bolgesi 2 degil: %', v_depo; end if;
  if v_yonetici < 3 then raise exception 'Yonetici sayisi 3ten az: %', v_yonetici; end if;
  raise notice 'OK — % arac, % sofor, % atama, % depo, % yonetici, VIN sizintisi yok.',
    v_arac, v_sofor, v_atama, v_depo, v_yonetici;
end
$son$;

commit;

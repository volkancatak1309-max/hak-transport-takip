-- HAK61 — DEMO SEED: 20 vehicles + 20 drivers, linked, with a few live shifts
-- so the status colours light up (sevkiyatta / molada / boşta / bakımda).
--
-- SAFE & RE-RUNNABLE: re-running first deletes the previous demo data, then
-- re-inserts. To remove the demo entirely, run db/seed/009_unseed_vehicles.sql.
--
-- Demo markers (used for cleanup):
--   • workers.phone LIKE '+43677%'   (reserved demo phone range)
--   • vehicles.notes = 'seed-demo'
--
-- Run in the Supabase SQL Editor. Requires migration 009 to be applied first.

create extension if not exists pgcrypto;

begin;

-- ── 0) Clean any previous demo run ──────────────────────────────────────────
delete from public.time_entries
  where worker_id in (select id from public.workers where phone like '+43677%');
delete from public.vehicles where notes = 'seed-demo';
delete from public.workers where phone like '+43677%';

-- ── 1) 20 demo drivers (PIN 1234 for all; phones in the +43677 demo range) ──
insert into public.workers (name, phone, pin_hash, is_admin, is_active) values
  ('Ahmet Demir',        '+436770000001', crypt('1234', gen_salt('bf')), false, true),
  ('Mehmet Yıldız',      '+436770000002', crypt('1234', gen_salt('bf')), false, true),
  ('Mustafa Kaya',       '+436770000003', crypt('1234', gen_salt('bf')), false, true),
  ('Hasan Çelik',        '+436770000004', crypt('1234', gen_salt('bf')), false, true),
  ('Hüseyin Şahin',      '+436770000005', crypt('1234', gen_salt('bf')), false, true),
  ('İbrahim Aydın',      '+436770000006', crypt('1234', gen_salt('bf')), false, true),
  ('Ali Yılmaz',         '+436770000007', crypt('1234', gen_salt('bf')), false, true),
  ('Osman Arslan',       '+436770000008', crypt('1234', gen_salt('bf')), false, true),
  ('Ramazan Doğan',      '+436770000009', crypt('1234', gen_salt('bf')), false, true),
  ('Yusuf Koç',          '+436770000010', crypt('1234', gen_salt('bf')), false, true),
  ('Emre Öztürk',        '+436770000011', crypt('1234', gen_salt('bf')), false, true),
  ('Burak Aksoy',        '+436770000012', crypt('1234', gen_salt('bf')), false, true),
  ('Serkan Polat',       '+436770000013', crypt('1234', gen_salt('bf')), false, true),
  ('Kerem Erdoğan',      '+436770000014', crypt('1234', gen_salt('bf')), false, true),
  ('Murat Şimşek',       '+436770000015', crypt('1234', gen_salt('bf')), false, true),
  ('Tolga Yıldırım',     '+436770000016', crypt('1234', gen_salt('bf')), false, true),
  ('Cem Aslan',          '+436770000017', crypt('1234', gen_salt('bf')), false, true),
  ('Onur Kılıç',         '+436770000018', crypt('1234', gen_salt('bf')), false, true),
  ('Volkan Taş',         '+436770000019', crypt('1234', gen_salt('bf')), false, true),
  ('Deniz Acar',         '+436770000020', crypt('1234', gen_salt('bf')), false, true);

-- ── 2) 20 demo vehicles, each linked to a driver (rn 1..20 → same order) ─────
with dw as (
  select id, row_number() over (order by phone) rn
  from public.workers where phone like '+43677%'
),
vd as (
  select * from (values
    ( 1, 'W-2841KT', 'Mercedes-Benz', 'Sprinter',   2021, 'active',      date '2026-09-15', date '2026-12-31'),
    ( 2, 'W-1573LM', 'Volkswagen',    'Crafter',    2020, 'active',      date '2026-07-20', date '2026-11-30'),
    ( 3, 'W-9024PN', 'Ford',          'Transit',    2019, 'active',      date '2026-08-01', null),
    ( 4, 'W-4416RS', 'Mercedes-Benz', 'Vito',       2022, 'active',      date '2027-02-10', date '2027-01-15'),
    ( 5, 'W-6680TV', 'Fiat',          'Ducato',     2018, 'active',      null,              date '2026-10-31'),
    ( 6, 'W-3192WX', 'Renault',       'Master',     2021, 'active',      date '2026-11-05', date '2026-12-01'),
    ( 7, 'W-7755YZ', 'Iveco',         'Daily',      2020, 'active',      date '2026-06-30', null),
    ( 8, 'W-2208AB', 'Mercedes-Benz', 'Sprinter',   2023, 'active',      date '2027-05-20', date '2027-03-31'),
    ( 9, 'W-5031CD', 'Volkswagen',    'Transporter',2019, 'active',      null,              null),
    (10, 'W-8847EF', 'Ford',          'Transit',    2022, 'active',      date '2027-01-12', date '2026-12-31'),
    (11, 'W-1129GH', 'Peugeot',       'Boxer',      2020, 'active',      date '2026-09-28', date '2026-11-15'),
    (12, 'W-6614IJ', 'Mercedes-Benz', 'Vito',       2021, 'active',      date '2026-10-10', null),
    (13, 'W-3370KL', 'Renault',       'Trafic',     2018, 'active',      null,              date '2026-09-30'),
    (14, 'W-9902MN', 'Iveco',         'Daily',      2022, 'active',      date '2027-03-01', date '2027-02-28'),
    (15, 'W-4458OP', 'Volkswagen',    'Crafter',    2023, 'active',      date '2027-04-18', date '2027-01-31'),
    (16, 'W-7723QR', 'Fiat',          'Ducato',     2020, 'active',      date '2026-08-22', null),
    (17, 'W-2095ST', 'Mercedes-Benz', 'Sprinter',   2019, 'active',      date '2026-07-05', date '2026-10-15'),
    (18, 'W-5546UV', 'Ford',          'Transit',    2021, 'active',      null,              date '2026-12-20'),
    (19, 'W-8810WX', 'Renault',       'Master',     2017, 'maintenance', date '2026-05-30', date '2026-09-10'),
    (20, 'W-1267YZ', 'Peugeot',       'Boxer',      2018, 'maintenance', null,              null)
  ) as t(rn, plate, make, model, year, status, insp, ins)
)
insert into public.vehicles (plate, make, model, year, status, assigned_worker_id, inspection_due, insurance_due, notes)
select vd.plate, vd.make, vd.model, vd.year, vd.status, dw.id, vd.insp, vd.ins, 'seed-demo'
from vd join dw on dw.rn = vd.rn;

-- ── 3) Live shifts to light up the status colours ───────────────────────────
-- 3a) SEVKİYATTA (blue): active shift, not on break → 6 vehicles
insert into public.time_entries
  (worker_id, vehicle_id, started_at, start_km, break_minutes, start_package_count, cargo_count, plate)
select v.assigned_worker_id, v.id,
       now() - (interval '1 hour' * (2 + (row_number() over (order by v.plate)))),
       100000 + (row_number() over (order by v.plate)) * 1500,
       0, 8 + (row_number() over (order by v.plate)), 8 + (row_number() over (order by v.plate)), v.plate
from public.vehicles v
where v.notes = 'seed-demo'
  and v.plate in ('W-2841KT','W-1573LM','W-9024PN','W-4416RS','W-6680TV','W-3192WX');

-- 3b) MOLADA (claret): active shift currently on break → 3 vehicles
insert into public.time_entries
  (worker_id, vehicle_id, started_at, start_km, break_minutes, break_started_at, start_package_count, cargo_count, plate)
select v.assigned_worker_id, v.id,
       now() - interval '5 hours',
       100000 + (row_number() over (order by v.plate)) * 2000,
       30, now() - interval '18 minutes',
       10, 10, v.plate
from public.vehicles v
where v.notes = 'seed-demo'
  and v.plate in ('W-7755YZ','W-2208AB','W-5031CD');

-- (the other active-base vehicles stay BOŞTA/amber; the 2 maintenance ones are BAKIMDA/gray)

-- 3c) A few completed shifts yesterday → "Son Hareketler" history on detail pages
insert into public.time_entries
  (worker_id, vehicle_id, started_at, ended_at, start_km, end_km, break_minutes, start_package_count, cargo_count, plate)
select v.assigned_worker_id, v.id,
       (now() - interval '1 day') - interval '8 hours',
       (now() - interval '1 day') - interval '1 hour',
       98000 + (row_number() over (order by v.plate)) * 1200,
       98000 + (row_number() over (order by v.plate)) * 1200 + 180,
       45, 9, 9, v.plate
from public.vehicles v
where v.notes = 'seed-demo'
  and v.plate in ('W-2841KT','W-1573LM','W-9024PN','W-8847EF','W-1129GH');

commit;

-- Quick check:
--   select v.plate, v.status, w.name as assigned, count(t.id) filter (where t.ended_at is null) as active_shifts
--   from public.vehicles v
--   left join public.workers w on w.id = v.assigned_worker_id
--   left join public.time_entries t on t.vehicle_id = v.id
--   where v.notes='seed-demo' group by v.plate, v.status, w.name order by v.plate;

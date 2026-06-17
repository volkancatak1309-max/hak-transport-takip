-- HAK61 — OPTIONAL DEMO: a fake GPS track for one active demo shift TODAY so the
-- Route History / Replay screen has something to play. Requires the 009 seed to
-- have been run (it provides the active shift on vehicle W-2841KT).
--
-- Re-runnable: clears the demo track first. Removed by 009_unseed_vehicles.sql
-- (which deletes all demo-driver locations).
--
-- Run in the Supabase SQL Editor.

begin;

-- Clear any prior demo track (demo drivers only).
delete from public.driver_locations
  where worker_id in (select id from public.workers where phone like '+43677%');

-- ~80 points drifting across Vienna, spread from the shift start until now.
with s as (
  select t.id as time_entry_id, t.worker_id, t.started_at
  from public.time_entries t
  join public.vehicles v on v.id = t.vehicle_id
  where v.notes = 'seed-demo'
    and v.plate = 'W-2841KT'
    and t.ended_at is null
  order by t.started_at desc
  limit 1
)
insert into public.driver_locations (worker_id, time_entry_id, latitude, longitude, accuracy, recorded_at)
select
  s.worker_id,
  s.time_entry_id,
  48.2082 + (g * 0.00085) + 0.0026 * sin(g / 3.0),
  16.3738 + (g * 0.00120) + 0.0032 * cos(g / 2.5),
  8,
  s.started_at + ((now() - s.started_at) * (g::float / 80.0))
from s, generate_series(0, 80) as g;

commit;

-- After running, open the vehicle (W-2841KT) → "Rota Geçmişi", or
-- /admin/araclar/<id>/rota — press Oynat.

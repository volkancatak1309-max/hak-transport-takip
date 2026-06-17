-- HAK61 — Remove ALL demo vehicle/driver seed data. Safe to run anytime.
-- Targets only the demo markers, so real data is untouched:
--   • workers.phone LIKE '+43677%'
--   • vehicles.notes = 'seed-demo'

begin;

-- Shifts of demo drivers (covers active + history; FK on vehicle is ON DELETE SET NULL anyway)
delete from public.time_entries
  where worker_id in (select id from public.workers where phone like '+43677%');

-- Demo vehicles
delete from public.vehicles where notes = 'seed-demo';

-- Demo drivers
delete from public.workers where phone like '+43677%';

commit;

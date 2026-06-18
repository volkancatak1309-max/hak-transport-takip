-- HAK Transport — one-off maintenance: close "ghost" shifts
-- A ghost shift is one left open (ended_at IS NULL) far longer than a real work
-- day — usually a test record or a driver who forgot to end. These inflate
-- "drivers in field" and produce nonsense AZG values.
--
-- USAGE (Supabase SQL Editor):
--   1. Run STEP 1 (read-only) and review the list.
--   2. Copy the ids you actually want to close into STEP 2 and run it.
-- NEVER deletes data — only sets ended_at (and notes it as auto-closed).

-- ── STEP 1 — list ghost candidates (open > 14h). Review before closing. ──────
select
  te.id,
  w.name                                                        as sofor,
  te.started_at                                                 as baslangic,
  round(extract(epoch from (now() - te.started_at)) / 3600, 1)  as acik_saat,
  te.plate                                                      as plaka,
  (select max(dl.recorded_at)
     from driver_locations dl
    where dl.time_entry_id = te.id)                             as son_konum
from time_entries te
left join workers w on w.id = te.worker_id
where te.ended_at is null
  and te.started_at < now() - interval '14 hours'
order by te.started_at asc;

-- ── STEP 2 — close ONLY the reviewed ids. ends at last location, else +9h. ──
-- Replace the id list before running.
-- update time_entries te
-- set
--   ended_at = coalesce(
--     (select max(dl.recorded_at) from driver_locations dl where dl.time_entry_id = te.id),
--     te.started_at + interval '9 hours'
--   ),
--   notes = coalesce(nullif(te.notes, ''), '')
--           || case when coalesce(te.notes, '') = '' then '' else ' ' end
--           || '[oto-kapatildi: hayalet vardiya]',
--   updated_at = now()
-- where te.id in ('<id-1>', '<id-2>', '<id-3>')
--   and te.ended_at is null;

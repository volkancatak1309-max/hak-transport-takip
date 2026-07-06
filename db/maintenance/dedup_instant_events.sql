-- HAK Transport — one-off maintenance: eski tekrar eden anlık olay kayıtlarını sil
-- Uygulamaya 60 sn cooldown eklenmeden ÖNCE biriken tekrarlar için: aynı araç +
-- aynı anlık olay türünde (crash / harsh_*), korunan son kayıttan 60 sn içinde
-- gelen tekrarlar silinir — her patlamanın İLK kaydı kalır. Kural, uygulamadaki
-- yeni cooldown mantığıyla birebir aynıdır (lib/telemetry.ts). Durum-tipi
-- olaylara (idling/overspeeding/…) dokunmaz; onların 5 dk cooldown'u zaten vardı.
--
-- USAGE (Supabase SQL Editor):
--   1. Run STEP 1 (read-only) and review what would be deleted.
--   2. If the list looks right, run STEP 2 (uncomment first).

-- ── STEP 1 — silinecek adayları listele (salt okuma). ───────────────────────
with recursive ev as (
  select
    id, vehicle_id, event_type, occurred_at,
    row_number() over (
      partition by vehicle_id, event_type
      order by occurred_at, id
    ) as rn
  from public.vehicle_events
  where event_type in ('crash', 'harsh_braking', 'harsh_acceleration', 'harsh_cornering')
),
walk as (
  -- her (araç, tür) grubunun ilk kaydı her zaman kalır
  select id, vehicle_id, event_type, occurred_at, rn,
         occurred_at as kept_at, true as keep
  from ev
  where rn = 1
  union all
  select e.id, e.vehicle_id, e.event_type, e.occurred_at, e.rn,
         case when e.occurred_at >= w.kept_at + interval '60 seconds'
              then e.occurred_at else w.kept_at end,
         e.occurred_at >= w.kept_at + interval '60 seconds'
  from ev e
  join walk w
    on w.vehicle_id = e.vehicle_id
   and w.event_type = e.event_type
   and e.rn = w.rn + 1
)
select
  v.plate                     as plaka,
  w.event_type                as olay,
  w.occurred_at               as zaman,
  w.kept_at                   as korunan_kayit
from walk w
join public.vehicles v on v.id = w.vehicle_id
where w.keep = false
order by v.plate, w.event_type, w.occurred_at;

-- ── STEP 2 — SİL (önce STEP 1'i incele, sonra yorumları kaldırıp çalıştır). ──
-- with recursive ev as (
--   select
--     id, vehicle_id, event_type, occurred_at,
--     row_number() over (
--       partition by vehicle_id, event_type
--       order by occurred_at, id
--     ) as rn
--   from public.vehicle_events
--   where event_type in ('crash', 'harsh_braking', 'harsh_acceleration', 'harsh_cornering')
-- ),
-- walk as (
--   select id, vehicle_id, event_type, occurred_at, rn,
--          occurred_at as kept_at, true as keep
--   from ev
--   where rn = 1
--   union all
--   select e.id, e.vehicle_id, e.event_type, e.occurred_at, e.rn,
--          case when e.occurred_at >= w.kept_at + interval '60 seconds'
--               then e.occurred_at else w.kept_at end,
--          e.occurred_at >= w.kept_at + interval '60 seconds'
--   from ev e
--   join walk w
--     on w.vehicle_id = e.vehicle_id
--    and w.event_type = e.event_type
--    and e.rn = w.rn + 1
-- )
-- delete from public.vehicle_events ve
-- using walk w
-- where ve.id = w.id
--   and w.keep = false;

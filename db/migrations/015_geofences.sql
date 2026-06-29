-- HAK61 — Migration 015
-- Geofence zones for GPS region-violation detection (computeGeofenceEvents).
-- Vehicle-centric and ADDITIVE: no existing auth / shift / GPS / telemetry flow
-- changes. Circle zones only for now (polygon can be added later as a new `type`
-- + a vertices column). Run in Supabase SQL Editor BEFORE deploying.

create table if not exists public.geofences (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- 'circle' only for now; the check keeps the column honest for future 'polygon'.
  type text not null default 'circle' check (type in ('circle')),
  -- Circle geometry (metres). Latitude/longitude are the centre.
  center_lat double precision not null check (center_lat between -90 and 90),
  center_lng double precision not null check (center_lng between -180 and 180),
  radius_m double precision not null check (radius_m > 0),
  -- 'forbidden'    → entering the zone is a violation.
  -- 'allowed_only' → leaving the zone is a violation (must stay inside).
  rule_kind text not null default 'forbidden' check (rule_kind in ('forbidden', 'allowed_only')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Active zones are read on every vehicle-detail load; tiny table, simple index.
create index if not exists idx_geofences_active on public.geofences(active);

-- NOTE: RLS stays OFF (consistent with the rest of the schema); this table is
-- written only by the service-role client inside the geofence admin actions and
-- read by server components.

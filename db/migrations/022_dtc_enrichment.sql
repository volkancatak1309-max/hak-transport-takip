-- HAK61 — Migration 022
-- DTC zenginleştirme: arızanın İLK görüldüğü andaki araç km'si.
--
-- Fully ADDITIVE + idempotent: tek nullable kolon; mevcut kolon / indeks / akış
-- değişmez. saveDtc yeni bir aktif arıza satırı açarken aracın o anki
-- odometer_km değerini buraya yazar; UI "X gündür aktif · o günden beri Y km"
-- rozetini (güncel odometer − first_seen_odometer_km) bundan türetir. Cihaz o
-- an km raporlamadıysa NULL kalır ve UI "—" gösterir. Eski (migration 021
-- öncesi/sonrası) satırlar NULL kalır — geriye dönük doldurma YOK, çünkü ilk
-- görülme anındaki km artık bilinemez.
-- Run in Supabase SQL Editor BEFORE deploying this version.

alter table public.vehicle_dtc
  add column if not exists first_seen_odometer_km double precision;

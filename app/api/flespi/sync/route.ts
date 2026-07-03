import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { flespiAuthorized } from "@/lib/flespi-auth";
import { fetchDeviceMessages } from "@/lib/flespi";
import { lastRecordedAt, saveTelemetry, saveVehicleEvents } from "@/lib/telemetry";

// Service-role Supabase + outbound flespi fetch → must run on Node, never edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// First sync for a device with no prior rows: look back this far so we don't
// pull the device's entire stored history.
const FIRST_WINDOW_MS = 60 * 60 * 1000; // 1 h

/**
 * flespi → device_telemetry sync. Polls every vehicle that has a flespi_device_id,
 * pulls messages since that vehicle's last stored point, and upserts them.
 * Meant to be hit by an external scheduler (cron-job.org / GitHub Actions /
 * Vercel cron) every ~30–60 s, mirroring the shift-watchdog cron.
 *
 * Phone GPS (driver_locations / recordLocation) is NOT involved here.
 *
 * Auth: requires FLESPI_SYNC_SECRET, accepted as `?secret=` (external cron) or
 * `Authorization: Bearer <secret>` (Vercel cron). Comparison is timing-safe.
 * The auth check is shared with /api/flespi/ingest via lib/flespi-auth.
 */
type VehRow = { id: string; plate: string; flespi_device_id: number };

async function runSync() {
  const { data } = await supabaseAdmin
    .from("vehicles")
    .select("id, plate, flespi_device_id")
    .not("flespi_device_id", "is", null);
  const vehicles = (data ?? []) as VehRow[];

  const perVehicle: {
    plate: string;
    device: number;
    fetched: number;
    saved: number;
    events?: number;
    error?: string;
  }[] = [];
  let totalSaved = 0;

  for (const v of vehicles) {
    try {
      const last = await lastRecordedAt(v.id);
      // Inclusive at the exact last timestamp (sub-second precision kept): the
      // single boundary message is re-fetched but dropped by the upsert, so no
      // point is ever skipped between polls.
      const sinceTs = last
        ? new Date(last).getTime() / 1000
        : (Date.now() - FIRST_WINDOW_MS) / 1000;

      const { points, events } = await fetchDeviceMessages(
        v.flespi_device_id,
        sinceTs
      );
      const saved = await saveTelemetry(v.id, points);
      totalSaved += saved;
      // Olay kaydı GPS akışını ASLA düşürmesin (örn. migration 018 henüz
      // çalıştırılmadıysa): kendi try/catch'i var, hata sadece loglanır.
      let savedEvents = 0;
      if (events.length > 0) {
        try {
          savedEvents = await saveVehicleEvents(v.id, events);
        } catch (err) {
          console.error(
            `[flespi/sync] ${v.plate}: vehicle_events yazılamadı:`,
            err instanceof Error ? err.message : err
          );
        }
      }
      perVehicle.push({
        plate: v.plate,
        device: v.flespi_device_id,
        fetched: points.length,
        saved,
        events: savedEvents,
      });
    } catch (e) {
      perVehicle.push({
        plate: v.plate,
        device: v.flespi_device_id,
        fetched: 0,
        saved: 0,
        error: e instanceof Error ? e.message : "error",
      });
    }
  }

  return { ok: true, vehicles: vehicles.length, totalSaved, perVehicle };
}

export async function GET(req: NextRequest) {
  if (!flespiAuthorized(req)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  try {
    return NextResponse.json(await runSync());
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "error" },
      { status: 500 }
    );
  }
}

// Allow POST too (some schedulers default to POST).
export async function POST(req: NextRequest) {
  return GET(req);
}

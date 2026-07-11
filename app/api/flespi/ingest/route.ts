import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { flespiAuthorized } from "@/lib/flespi-auth";
import {
  extractEvents,
  normalize,
  type FlespiEvent,
  type FlespiPoint,
} from "@/lib/flespi";
import { saveTelemetry, saveVehicleEvents } from "@/lib/telemetry";
import { processAutoShifts } from "@/lib/auto-shift";

// Service-role Supabase + JSON body parsing → must run on Node, never edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * flespi HTTP Stream → device_telemetry PUSH ingest.
 *
 * flespi POSTs a JSON ARRAY of flat dotted-key messages, each carrying "ident"
 * (the device IMEI) plus the raw telemetry, e.g.:
 *   { "ident":"864022089572837", "position.latitude":48.2, "position.longitude":16.37,
 *     "position.speed":42, "position.direction":90, "engine.ignition.status":true,
 *     "timestamp":1751280000 }
 * We match "ident" → vehicles.imei, normalize each message with the SAME
 * lib/flespi normalize() (so the field mapping + RTC/null guards stay identical
 * to the REST pull), group by vehicle, and upsert via saveTelemetry.
 *
 * flespi expects HTTP 200 for every delivery: a 500 makes it RE-SEND the same
 * batch forever. So the data path returns 200 for PERMANENT/data errors (bad
 * body, unmatched IMEI — logged, never thrown to a 500). The ONE exception is a
 * transient DB error resolving idents → vehicles: that returns 500 on purpose so
 * flespi re-delivers once the DB recovers, instead of losing the batch as a
 * silent "all unmatched" 200. An unauthenticated caller is rejected up front (401).
 *
 * flespi delivers from the IP range 185.213.2.0/24 — an IP whitelist is OPTIONAL;
 * the shared FLESPI_SYNC_SECRET (?secret= or Authorization: Bearer) is enough.
 *
 * Auth: same FLESPI_SYNC_SECRET as /api/flespi/sync (flespiAuthorized).
 */

type Msg = Record<string, unknown>;
type VehImei = { id: string; imei: string; flespi_device_id: number | null };

export async function POST(req: NextRequest) {
  if (!flespiAuthorized(req)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let received = 0;
  let saved = 0;
  let unmatched = 0;

  try {
    const body = (await req.json().catch(() => null)) as unknown;
    // flespi posts an array; tolerate a single object too.
    const messages: Msg[] = Array.isArray(body)
      ? (body as Msg[])
      : body && typeof body === "object"
        ? [body as Msg]
        : [];
    received = messages.length;

    // Group messages by their "ident" (IMEI). Messages with no ident are unmatched.
    const byIdent = new Map<string, Msg[]>();
    for (const m of messages) {
      const ident = m["ident"];
      if (typeof ident !== "string" || !ident) {
        unmatched++;
        continue;
      }
      const arr = byIdent.get(ident);
      if (arr) arr.push(m);
      else byIdent.set(ident, [m]);
    }

    if (byIdent.size > 0) {
      // Resolve every ident → vehicle in one query.
      const idents = [...byIdent.keys()];
      const { data: vData, error: vErr } = await supabaseAdmin
        .from("vehicles")
        .select("id, imei, flespi_device_id")
        .in("imei", idents);
      if (vErr) {
        // Transient DB error: without this guard every message would be counted
        // "unmatched" and silently lost behind a 200. Return 500 so flespi
        // RE-DELIVERS the batch once the DB recovers (the always-200 rule only
        // guards against re-delivery loops on PERMANENT/data errors).
        console.error(
          "[flespi/ingest] vehicles sorgusu başarısız:",
          vErr.message
        );
        return NextResponse.json(
          { ok: false, received, saved, unmatched, error: "vehicles query failed" },
          { status: 500 }
        );
      }
      const byImei = new Map(
        ((vData ?? []) as VehImei[]).map((v) => [v.imei, v])
      );

      const touchedVehicleIds: string[] = [];
      for (const [ident, msgs] of byIdent) {
        const vehicle = byImei.get(ident);
        if (!vehicle) {
          console.warn(
            `[flespi/ingest] eşleşmeyen IMEI: ${ident} (${msgs.length} mesaj düşürüldü)`
          );
          unmatched += msgs.length;
          continue;
        }
        // device_telemetry.flespi_device_id is NOT NULL: use the vehicle's flespi
        // device id when set, else the numeric IMEI (both fit a bigint).
        const deviceId = vehicle.flespi_device_id ?? Number(ident);
        if (!Number.isFinite(deviceId)) {
          console.warn(
            `[flespi/ingest] geçersiz device id (IMEI ${ident}): ${msgs.length} mesaj düşürüldü`
          );
          unmatched += msgs.length;
          continue;
        }
        const points: FlespiPoint[] = [];
        const events: FlespiEvent[] = [];
        for (const m of msgs) {
          const p = normalize(deviceId, m);
          if (p) points.push(p);
          events.push(...extractEvents(m));
        }
        saved += await saveTelemetry(vehicle.id, points);
        touchedVehicleIds.push(vehicle.id);
        // Olay kaydı GPS akışını ASLA düşürmesin (örn. migration 018 henüz
        // çalıştırılmadıysa): kendi try/catch'i var, hata sadece loglanır.
        if (events.length > 0) {
          try {
            await saveVehicleEvents(vehicle.id, events);
          } catch (err) {
            console.error(
              "[flespi/ingest] vehicle_events yazılamadı:",
              err instanceof Error ? err.message : err
            );
          }
        }
      }

      // Otomatik vardiya (İş 1): yalnız bu batch'te veri gelen araçlar
      // değerlendirilir; tam tarama /api/flespi/sync'te. processAutoShifts
      // asla throw etmez — 200-kuralını bozamaz.
      if (touchedVehicleIds.length > 0) {
        await processAutoShifts(touchedVehicleIds);
      }
    }

    return NextResponse.json({ ok: true, received, saved, unmatched });
  } catch (e) {
    // NEVER return 500 here: that makes flespi re-deliver the same batch forever.
    console.error(
      "[flespi/ingest] error:",
      e instanceof Error ? e.message : e
    );
    return NextResponse.json(
      {
        ok: false,
        received,
        saved,
        unmatched,
        error: e instanceof Error ? e.message : "error",
      },
      { status: 200 }
    );
  }
}

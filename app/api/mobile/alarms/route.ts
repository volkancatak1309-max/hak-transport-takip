import type { NextRequest } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import {
  listEventsInRange,
  listIdleEpisodesInRange,
  IDLE_TRIGGER_S,
} from "@/lib/telemetry";
import { listVehiclesWithStatus } from "@/lib/vehicles";
import { parsePage, pageInfo, parseRange } from "@/lib/mobile-list";
import { eventTone } from "@/lib/event-ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/alarms — alarm listesi.
 *
 * KAPI: requireMobileAdmin ↔ /admin/alarmlar sayfasının requireAdmin()'i.
 * (Panel o sayfada filo kapsamı UYGULAMIYOR — mobil de uygulamıyor; parite.)
 *
 * ── 1000 SATIR TUZAĞI ─────────────────────────────────────────────────────
 * Ham `.limit()`/`.range()` YAZILMIYOR. listEventsInRange ve
 * listIdleEpisodesInRange içeride `fetchAllRows` ile 1000'lik sayfalarla
 * sonuna kadar okuyor (lib/supabase.ts) — panelin kullandığı yöntemin aynısı.
 * Sayfalama bu tam kümenin ÜZERİNDE yapılıyor, yani `total` gerçek sayı;
 * PostgREST'in sessiz kesmesi devreye girmiyor.
 *
 * ── BİRLEŞTİRME ───────────────────────────────────────────────────────────
 * Nokta-olaylar (vehicle_events) + rölanti EPİZODLARI (idle_episodes) tek
 * listede. Epizod → satır dönüşümü ve süre formülü
 * (span + IDLE_TRIGGER_S) app/admin/alarmlar/page.tsx:143-160 ile BİREBİR aynı;
 * sabit oradan değil kaynağından (lib/telemetry.ts) okunuyor.
 */
export async function GET(req: NextRequest) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const page = parsePage(url);
  const range = parseRange(url);
  const turFiltre = url.searchParams.get("tur");

  const [events, episodes, vehicles] = await Promise.all([
    listEventsInRange(range.start.toISOString(), range.end.toISOString()),
    listIdleEpisodesInRange(range.start.toISOString(), range.end.toISOString()),
    listVehiclesWithStatus(),
  ]);

  // Şoför adı araç künyesinden türetilir — panelin yaptığının aynısı
  // (geçmişe dönük kusuru da aynı: olay anındaki şoför değil, BUGÜNKÜ araç şoförü).
  const driverByVehicle = new Map(vehicles.map((v) => [v.id, v.driver_name]));

  type Row = {
    id: string;
    vehicle_id: string;
    event_type: string;
    event_value: number | null;
    latitude: number | null;
    longitude: number | null;
    speed_kmh: number | null;
    occurred_at: string;
    plate: string | null;
    duration_ms?: number;
    ongoing?: boolean;
  };

  const idleRows: Row[] = episodes.map((e) => {
    const startMs = new Date(e.started_at).getTime();
    const endMs = new Date(e.ended_at ?? e.last_seen_at).getTime();
    return {
      id: e.id,
      vehicle_id: e.vehicle_id,
      event_type: "idling",
      event_value: null,
      latitude: e.latitude,
      longitude: e.longitude,
      speed_kmh: 0,
      occurred_at: e.started_at,
      plate: e.plate,
      duration_ms: Math.max(0, endMs - startMs) + IDLE_TRIGGER_S * 1000,
      ongoing: e.ended_at === null,
    };
  });

  let rows: Row[] = [...(events as unknown as Row[]), ...idleRows].sort((a, b) =>
    b.occurred_at.localeCompare(a.occurred_at)
  );
  if (turFiltre) {
    const set = new Set(turFiltre.split(",").map((s) => s.trim()).filter(Boolean));
    rows = rows.filter((r) => set.has(r.event_type));
  }

  const slice = rows.slice(page.offset, page.offset + page.limit);

  // Tür kırılımı TAM küme üzerinden — sayfa değişince rakam oynamasın.
  const turDagilim: Record<string, number> = {};
  for (const r of rows) turDagilim[r.event_type] = (turDagilim[r.event_type] ?? 0) + 1;

  return Response.json({
    ok: true,
    aralik: { start: range.start.toISOString(), end: range.end.toISOString() },
    page: pageInfo(page, rows.length),
    turDagilim,
    alarmlar: slice.map((r) => ({
      id: r.id,
      tur: r.event_type,
      siddet: eventTone(r.event_type),
      aracId: r.vehicle_id,
      plaka: r.plate,
      sofor: driverByVehicle.get(r.vehicle_id) ?? null,
      an: r.occurred_at,
      deger: r.event_value,
      hizKmh: r.speed_kmh,
      konum:
        r.latitude != null && r.longitude != null
          ? { lat: r.latitude, lng: r.longitude }
          : null,
      sureMs: r.duration_ms ?? null,
      devamEdiyor: r.ongoing ?? false,
    })),
  });
}

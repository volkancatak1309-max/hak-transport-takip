import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { safeEqual } from "@/lib/secure-compare";
import { DEMO_BACKFILL_ENABLED } from "@/lib/tenant";
import { backfillVehicle, type VehicleBackfill } from "@/lib/backfill";

// Service-role Supabase + dışa flespi çağrısı → Node, asla edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Sayfalı çekim 29 aracı tarıyor; varsayılan süre yetmez.
export const maxDuration = 300;

/**
 * GET|POST /api/flespi/backfill — GEÇMİŞ DOLGUSU (yalnız demo).
 *
 * Canlı `/api/flespi/sync` imleci DAİMA ileri götürür (lastRecordedAt → from),
 * yani geçmiş asla dolmaz. Bu uç pencereyi açıkça alır, `fetchDeviceMessages`ı
 * sayfalayarak MAX_PER_POLL kırpmasını aşar ve TARİHSEL MOD ile yazar
 * (lib/backfill.ts — cooldown/imleç/bugün kapıları orada atlanır, DTC yazılmaz).
 *
 * Parametreler:
 *   from   ISO tarih ya da YYYY-MM-DD   (zorunlu)
 *   to     ISO tarih ya da YYYY-MM-DD   (isteğe bağlı, varsayılan: şimdi)
 *   plate  tek araç (isteğe bağlı — kabul turu için)
 *   dryRun 1 → hiçbir şey yazmaz, yalnız kaç mesaj geleceğini raporlar
 *
 * Kimlik: CRON_SECRET, `?secret=` ya da `Authorization: Bearer <secret>`.
 */

/** Pencere üst sınırı — kazara "tüm zamanlar" çekilip fatura şişmesin. */
const MAX_WINDOW_DAYS = 31;

function authorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const qs = req.nextUrl.searchParams.get("secret");
  if (safeEqual(qs, expected)) return true;
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return safeEqual(auth.slice(7), expected);
  return false;
}

function parseAt(raw: string | null): number | null {
  if (!raw) return null;
  const s = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00.000Z` : raw;
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? t : null;
}

async function run(req: NextRequest) {
  // ── 1) KİRACI KİLİDİ — HER ŞEYDEN ÖNCE, FAIL-CLOSED ──────────────────────
  // Sırdan, parametreden ve istek gövdesinden ÖNCE. Bu uç üç canlı korumayı
  // (olay cooldown'u, rölanti imleci, vardiyanın bugün-kapsamı) bilerek atlıyor;
  // HAK61 ya da Sendigo'da çalıştırılması geçmiş vardiya ve alarmları üretilmiş
  // kayıtlarla kirletirdi. Bayrak env'den DEĞİL kurulum kodundan türer
  // (lib/tenant.ts), yani yanlış bir env satırıyla açılamaz.
  if (!DEMO_BACKFILL_ENABLED) {
    return NextResponse.json(
      { ok: false, error: "tenant_locked", hint: "Bu uç yalnız demo kurulumunda açıktır." },
      { status: 403 }
    );
  }

  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const fromMs = parseAt(sp.get("from"));
  const toMs = parseAt(sp.get("to")) ?? Date.now();
  if (fromMs === null) {
    return NextResponse.json(
      { ok: false, error: "bad_range", hint: "from zorunlu (ISO ya da YYYY-MM-DD)" },
      { status: 400 }
    );
  }
  if (toMs <= fromMs) {
    return NextResponse.json({ ok: false, error: "bad_range", hint: "to > from olmalı" }, { status: 400 });
  }
  const gunler = (toMs - fromMs) / 86_400_000;
  if (gunler > MAX_WINDOW_DAYS) {
    return NextResponse.json(
      { ok: false, error: "window_too_large", maxDays: MAX_WINDOW_DAYS, requestedDays: Math.round(gunler) },
      { status: 400 }
    );
  }

  const dryRun = sp.get("dryRun") === "1";
  const plate = sp.get("plate");

  // test-visible: YAZMA yolu — dolgunun telemetri çekeceği cihazlı araçlar.
  // /api/flespi/sync:44'teki sorgunun birebir eşi ve gerekçesi de aynı: test
  // aracının flespi_device_id'si NULL olduğu için aşağıdaki `.not(... is null)`
  // onu zaten eliyor. Ayrıca eleme koymak, ileride gerçek bir araç test
  // işaretlenirse o aracın geçmişini sessizce eksik doldururdu.
  let q = supabaseAdmin
    .from("vehicles")
    .select("id, plate, flespi_device_id, assigned_worker_id")
    .not("flespi_device_id", "is", null);
  if (plate) q = q.eq("plate", plate);
  const { data, error } = await q;
  if (error) {
    return NextResponse.json(
      { ok: false, error: `vehicles query failed: ${error.message}` },
      { status: 500 }
    );
  }
  const vehicles = (data ?? []) as {
    id: string; plate: string; flespi_device_id: number; assigned_worker_id: string | null;
  }[];

  const perVehicle: VehicleBackfill[] = [];
  for (const v of vehicles) {
    try {
      perVehicle.push(await backfillVehicle(v, fromMs, toMs, dryRun));
    } catch (e) {
      perVehicle.push({
        plate: v.plate, fetched: 0, telemetry: 0, events: 0, idle: 0, shifts: 0, pages: 0,
        error: e instanceof Error ? e.message : "error",
      });
    }
  }

  const t = (k: keyof VehicleBackfill) =>
    perVehicle.reduce((a, r) => a + (typeof r[k] === "number" ? (r[k] as number) : 0), 0);

  return NextResponse.json({
    ok: true,
    dryRun,
    from: new Date(fromMs).toISOString(),
    to: new Date(toMs).toISOString(),
    vehicles: vehicles.length,
    totals: {
      fetched: t("fetched"),
      telemetry: t("telemetry"),
      events: t("events"),
      idle: t("idle"),
      shifts: t("shifts"),
      pages: t("pages"),
    },
    // DTC bilerek yok — lib/backfill.ts dosya başındaki nota bakın.
    dtc: "atlandı (tarihsel anlık görüntü bugünkü listeyi bozardı)",
    perVehicle,
  });
}

export async function GET(req: NextRequest) {
  try {
    return await run(req);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "error" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}

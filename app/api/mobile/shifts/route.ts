import type { NextRequest } from "next/server";
import { verifyMobileRequest, mobileError } from "@/lib/mobile-auth";
import { getManagedFleet, getFleetScope, onlyFleet, UNRESTRICTED } from "@/lib/fleet-scope";
import { getTestScope, withoutTestRows } from "@/lib/test-data";
import { getDriverScope, onlyDrivers } from "@/lib/driver-scope";
import { supabaseAdmin } from "@/lib/supabase";
import { parsePage, pageInfo, parseYmdRange } from "@/lib/mobile-list";
import { workedMs, kmDiff } from "@/lib/format";
import { markKmMeasured } from "@/lib/km-quality";
import type { TimeEntry } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/shifts — vardiya listesi.
 *
 * ── YETKİ, PANELLE BİREBİR ────────────────────────────────────────────────
 *   patron    → tüm vardiyalar            (app/admin/page.tsx arşivi)
 *   filo şefi → yalnız kendi filosu       (onlyFleet, aynı sayfadaki kapsam)
 *   şoför     → YALNIZ KENDİ vardiyaları  (app/panel/gecmis/page.tsx deseni)
 * Şoför için `worker` filtresi yok sayılır; sunucu kimliği zorlar, istemcinin
 * gönderdiği worker_id'ye güvenilmez.
 *
 * ── ELEMELER, PANELLE AYNI ────────────────────────────────────────────────
 * Yönetici/şef yolunda üç eleme birden: test verisi (withoutTestRows), şoför
 * ekseni (onlyDrivers) ve filo (onlyFleet) — app/admin/page.tsx:105-130 ile
 * aynı üçlü. Şoför kendi kaydını görürken eleme uygulanmaz (anahtarlı okuma;
 * test hesabı kendi geçmişini görebilmeli — lib/test-data.ts'in kuralı).
 *
 * ── 1000 SATIR ────────────────────────────────────────────────────────────
 * `count: "exact"` + `.range(offset, offset+limit-1)` — /panel/gecmis'in
 * kullandığı desenin aynısı. Sayfa boyu tavanı 200 olduğu için tek sorgu
 * PostgREST'in 1000 satırlık sayfa sınırına hiç dayanmaz; `total` sunucudan
 * gelen gerçek sayıdır, kesilmiş bir dizinin uzunluğu değil.
 *
 * `sureMs` ve `km` TÜRETİLMEZ, panelin tek kaynak fonksiyonlarıyla hesaplanır:
 * workedMs() ve kmDiff() (lib/format.ts).
 */
export async function GET(req: NextRequest) {
  const auth = await verifyMobileRequest(req);
  if (!auth.ok) return mobileError(auth.status, auth.code);

  const url = new URL(req.url);
  const page = parsePage(url);
  const { start, end } = parseYmdRange(
    url.searchParams.get("from"),
    url.searchParams.get("to")
  );
  const durum = url.searchParams.get("durum"); // "acik" | "kapali"

  const isAdmin = auth.worker.is_admin;
  const fleet = isAdmin ? null : await getManagedFleet(auth.worker.id);
  const isChief = !isAdmin && fleet !== null;
  const isDriverOnly = !isAdmin && !isChief;

  let q;
  if (isDriverOnly) {
    // ŞOFÖR YOLU — anahtarlı okuma: yalnız kendi kaydı, sunucu zorlar.
    // Eleme UYGULANMAZ: test hesabı da kendi geçmişini görebilmeli
    // (lib/test-data.ts: "şoför paneli anahtarlı okur, oraya filtre konmaz").
    q = supabaseAdmin
      .from("time_entries")
      .select("*", { count: "exact" })
      .eq("worker_id", auth.worker.id)
      .order("started_at", { ascending: false })
      .order("id");
  } else {
    // YÖNETİCİ / ŞEF YOLU — panelin arşiviyle aynı üçlü eleme.
    // test-filtered: withoutTestRows — app/admin/page.tsx arşiviyle aynı boğaz.
    const testScope = await getTestScope();
    q = withoutTestRows(
      supabaseAdmin
        .from("time_entries")
        .select("*", { count: "exact" })
        .order("started_at", { ascending: false })
        .order("id"),
      "worker_id",
      testScope.workerIds
    );
    // driver-scoped: yönetici hesaplarının vardiyaları toplamları şişirmesin.
    q = onlyDrivers(q, "worker_id", await getDriverScope());
    const fleetScope = isChief ? await getFleetScope(fleet) : UNRESTRICTED;
    // fleet-scoped: şef yalnız kendi filosunu görür.
    q = onlyFleet(q, "worker_id", fleetScope.workerIds, fleetScope);

    const workerFilter = url.searchParams.get("worker");
    if (workerFilter) q = q.eq("worker_id", workerFilter);
  }

  if (start) q = q.gte("started_at", start.toISOString());
  if (end) q = q.lte("started_at", end.toISOString());
  if (durum === "acik") q = q.is("ended_at", null);
  else if (durum === "kapali") q = q.not("ended_at", "is", null);

  const { data, count, error } = await q.range(
    page.offset,
    page.offset + page.limit - 1
  );
  if (error) return mobileError(503, "db_error");

  // km_measured: cihazı sessiz vardiyada `km` alanı null döner (0 DEĞİL) —
  // uç sözleşmesi zaten `number | null` (bkz. lib/km-quality.ts).
  const rows = await markKmMeasured((data ?? []) as TimeEntry[]);

  return Response.json({
    ok: true,
    kapsam: { rol: isAdmin ? "admin" : isChief ? "fleet_chief" : "driver", fleet },
    page: pageInfo(page, count ?? rows.length),
    vardiyalar: rows.map((e) => ({
      id: e.id,
      soforId: e.worker_id,
      // `aracId` (10.08.2026): vardiya detayındaki alarm/yakıt/rota'nın ÜÇÜNÜN
      // de ön koşulu. Listede bugüne dek yalnız `plaka` vardı ve plaka bir
      // araç kimliği DEĞİL (araç kaydı silinip yeniden açılırsa da, iki
      // kurulumda aynı plaka olursa da eşleşme yanlış kurulurdu).
      aracId: e.vehicle_id,
      plaka: e.plate,
      baslangic: e.started_at,
      bitis: e.ended_at,
      acik: e.ended_at === null,
      sureMs: workedMs(e),
      molaDk: e.break_minutes ?? 0,
      baslangicKm: e.start_km,
      bitisKm: e.end_km,
      km: kmDiff(e),
      paketAlinan: e.start_package_count,
      paketTeslim: e.cargo_count,
      paketTeslimEdilemeyen: e.undelivered_count,
      onayDurumu: e.confirmation_status,
      bitisSebebi: e.end_reason,
      otomatikBasladi: e.auto_started,
      ozetImzaAni: e.summary_confirmed_at,
      notlar: e.notes,
    })),
  });
}

import type { NextRequest } from "next/server";
import { requireMobileFleetView } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { onlyFleet } from "@/lib/fleet-scope";
import { getTestScope, withoutTestRows } from "@/lib/test-data";
import { getDriverScope, onlyDrivers } from "@/lib/driver-scope";
import { getOwnerScope, withoutOwner } from "@/lib/owner-scope";
import { LEAVES_ENABLED } from "@/lib/features";
import { LEAVE_COLS, todayYmdVienna, type LeaveRow } from "@/lib/leaves";
import { LEAVE_TYPES, leaveTypeLabel } from "@/lib/leave-types";
import { DEFAULT_LOCALE } from "@/i18n/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/leaves?ay=YYYY-MM — bir ayın izin takvimi.
 *
 * İzin için bugüne dek HİÇ REST ucu yoktu: panel sayfası (/admin/izinler)
 * server component içinden doğrudan Supabase'e sorup ızgarayı çiziyordu,
 * mobilde ise yalnız panonun "onay bekleyen" bloğu vardı (yalnız `pending`,
 * yalnız patron, ay parametresi yok). Bu uç ayın TAMAMINI verir.
 *
 * KAPI: requireMobileFleetView ↔ sayfanın requireFleetView()'i — patron hepsini,
 * filo şefi yalnız kendi filosunu, şoför 403. Şefin kapsamı çözülemezse
 * getFleetScope FAIL-CLOSED boş küme döner (kısıtsıza DÜŞMEZ).
 *
 * ELEMELER PANELLE BİREBİR — dördü birden, aynı sırayla ve aynı eksende:
 * withoutTestRows + onlyDrivers + withoutOwner + onlyFleet. Eleme İZNİ ALAN
 * kişinin (`worker_id`) üstünde; onaylayan yönetici `approved_by`/`created_by`
 * alanlarında yaşar ve ELENMEZ.
 *
 * `rejected` GÖNDERİLMEZ — ızgaranın kuralı (panel `.neq("status","rejected")`).
 * Reddedilen kayıt silinmez, arşivde durur; ama takvimde çizilmez.
 *
 * `pending` GÖNDERİLİR — ekran onu SİLİK çizmeli (panelde dolgu %14 ↔ %26).
 * Durum alanı taşınıyor, karar ekranın.
 *
 * TÜR SÖZLÜĞÜ UÇTAN GELİR (`turler[]`): mobilde bugün yalnız etiket var,
 * `short`/`tone`/`pattern` yok. Sözlüğü app'e kopyalamak, yeni bir izin türü
 * eklendiğinde mobil sürüm çıkana kadar takvimi eksik bırakırdı. Tek kaynak
 * lib/leave-types.ts — hem panel hem bu uç oradan okur.
 *
 * TAVAN YOK: aylık ızgara ~30 kişi × birkaç izin; canlıda toplam izin sayısı
 * iki haneli. PostgREST'in 1000 satır tavanına yaklaşan bir küme değil.
 */
function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, "0")}` };
}

export async function GET(req: NextRequest) {
  const guard = await requireMobileFleetView(req);
  if (!guard.ok) return guard.response;
  // Modül bayrağı kapalıysa panelde sayfa /admin'e atıyor; uçta 404 (yüzey yok).
  if (!LEAVES_ENABLED) return mobileError(404, "not_found");

  const { fleetScope, isChief, fleet } = guard.actor;
  const url = new URL(req.url);
  const ayParam = url.searchParams.get("ay") ?? "";
  const ay = /^\d{4}-\d{2}$/.test(ayParam) ? ayParam : todayYmdVienna().slice(0, 7);
  const { start, end } = monthBounds(ay);

  const scope = await getTestScope();
  const driverScope = await getDriverScope();
  const ownerScope = await getOwnerScope(guard.actor.worker.id);

  const [activeRes, formerRes, leavesRes] = await Promise.all([
    // Aktif kadro — ızgaranın satırları.
    onlyFleet(
      withoutOwner(
        onlyDrivers(
          withoutTestRows(
            supabaseAdmin
              .from("workers")
              .select("id, name")
              .eq("is_active", true)
              .order("name"),
            "id",
            scope.workerIds
          ),
          "id",
          driverScope
        ),
        "id",
        ownerScope
      ),
      "id",
      fleetScope.workerIds,
      fleetScope
    ),
    // Ayrılan ama görüntülenen ayı KESEN personel (çıkışı ay başından sonra).
    // Best-effort: 032 uygulanmamışsa error → boş; aktif kadro yine gelir.
    onlyFleet(
      withoutOwner(
        onlyDrivers(
          withoutTestRows(
            supabaseAdmin
              .from("workers")
              .select("id, name, terminated_at")
              .not("terminated_at", "is", null)
              .gte("terminated_at", start)
              .order("name"),
            "id",
            scope.workerIds
          ),
          "id",
          driverScope
        ),
        "id",
        ownerScope
      ),
      "id",
      fleetScope.workerIds,
      fleetScope
    ),
    // Ayı KESEN izinler (aralık modeli: başlangıç ≤ ay sonu ve bitiş ≥ ay başı).
    onlyDrivers(
      onlyFleet(
        withoutTestRows(
          supabaseAdmin
            .from("worker_leaves")
            .select(LEAVE_COLS)
            .neq("status", "rejected")
            .lte("start_date", end)
            .gte("end_date", start)
            .order("start_date"),
          "worker_id",
          scope.workerIds
        ),
        "worker_id",
        fleetScope.workerIds,
        fleetScope
      ),
      "worker_id",
      driverScope
    ),
  ]);

  const active = ((activeRes.data ?? []) as { id: string; name: string }[]).map((w) => ({
    id: w.id,
    ad: w.name,
    ayrildi: false,
    ayrilmaAni: null as string | null,
  }));
  const former = (
    (formerRes.data ?? []) as { id: string; name: string; terminated_at: string | null }[]
  ).map((w) => ({ id: w.id, ad: w.name, ayrildi: true, ayrilmaAni: w.terminated_at }));
  const kisiler = [...active, ...former].sort((a, b) => a.ad.localeCompare(b.ad));

  const rows = (leavesRes.data ?? []) as LeaveRow[];
  // İzin kaydı kapsam dışı bir kişiye aitse (ör. yönetici kendine izin yazmış)
  // satır ızgarada yer bulamaz. Sessizce düşürülür — `kisiler` ızgaranın tek
  // ekseni; sahipsiz izin çizilecek satır bulamazdı.
  const kisiIds = new Set(kisiler.map((k) => k.id));
  const izinler = rows
    .filter((l) => kisiIds.has(l.worker_id))
    .map((l) => ({
      id: l.id,
      personelId: l.worker_id,
      tur: l.leave_type,
      baslangic: l.start_date,
      bitis: l.end_date,
      durum: l.status,
      not: l.note,
    }));

  return Response.json({
    ok: true,
    kapsam: { rol: isChief ? "fleet_chief" : "admin", fleet },
    ay,
    aralik: { baslangic: start, bitis: end },
    kisiler,
    izinler,
    turler: LEAVE_TYPES.map((t) => ({
      anahtar: t.key,
      kisaKod: t.short,
      // Etiket dili: mobilde `hak_locale` çerezi yok → kurulum varsayılanı
      // (lib/mobile-labels.ts ile aynı gerekçe, aynı kaynak fonksiyon).
      etiket: leaveTypeLabel(t, DEFAULT_LOCALE),
      ton: t.tone,
      desen: t.pattern,
      ucretli: t.paid,
      yaygin: t.common,
      uzunSureli: t.longTerm ?? false,
    })),
  });
}

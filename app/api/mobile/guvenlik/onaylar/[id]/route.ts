import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { requireMobileOwner } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { katmanDurumu, katmanKapaliYanit, kapilarKapaliYanit } from "@/lib/mobile-guvenlik";
import { onayKarari, type OnayTablosu } from "@/lib/guvenlik-eylem";
import { ACCESS_GATES_ENABLED } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KARARLAR = ["onay", "ret"] as const;

/**
 * POST /api/mobile/guvenlik/onaylar/[id] — Gövde: `{ karar: "onay" | "ret" }`
 *
 * `approveDeviceAction` / `approveCountryAction`ın (panel) mobil ikizi ve AYNI
 * çekirdeği çağırıyor (`onayKarari`).
 *
 * ═══ TÜR OTOMATİK ÇÖZÜLÜYOR — İSTEMCİ TAŞIMAK ZORUNDA DEĞİL ═══
 * Cihaz ve ülke onayları AYRI tablolarda ama ikisinin de anahtarı uuid. İstemci
 * `tur` göndermek zorunda kalsaydı listeyi ve kararı ayrı ayrı eşlemesi
 * gerekirdi; burada iki anahtarlı okuma yapılıp satır nerede bulunursa oradan
 * karara bağlanıyor. `tur` gövdede İSTEĞE BAĞLI olarak kabul edilir (bir okuma
 * tasarruf eder) ama yanlışsa **reddedilir**, sessizce düzeltilmez.
 *
 * ═══ 🔴 `.eq("status","pending")` KURALIN KENDİSİ — 409 ═══
 * Çekirdek yalnız BEKLEYEN satırı karara bağlar. Panelde ikinci dokunuş
 * sessizce hiçbir şey yapar (iki sekme açıkken doğru davranış); mobilde bu
 * **409 `zaten_karara_baglandi`** ile AYIRT EDİLİR — istemci "kaydettim"
 * sanmasın. Kural çekirdekte, ayrım çağıranda: `haftalik/[id]/kapat`taki
 * `zaten_kapali` kararının aynısı.
 *
 * HATA KODLARI:
 *   401 · 403 admin_required / owner_required
 *   400 gecersiz_govde · invalid (alan: karar | tur)
 *   404 not_found
 *   409 zaten_karara_baglandi
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireMobileOwner(req);
  if (!guard.ok) return guard.response;
  if (guard.katman === "kapali") return katmanKapaliYanit();
  if (!ACCESS_GATES_ENABLED) return kapilarKapaliYanit();

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return mobileError(400, "gecersiz_govde", { beklenen: "application/json" });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return mobileError(400, "gecersiz_govde", { sebep: "nesne_degil" });
  }
  const g = body as Record<string, unknown>;

  const kararHam = String(g.karar ?? "");
  if (!(KARARLAR as readonly string[]).includes(kararHam)) {
    return mobileError(400, "invalid", { alan: "karar", gecerli: KARARLAR, gelen: g.karar ?? null });
  }
  const onayla = kararHam === "onay";

  const turHam = g.tur === undefined || g.tur === null ? null : String(g.tur);
  if (turHam !== null && turHam !== "cihaz" && turHam !== "ulke") {
    return mobileError(400, "invalid", { alan: "tur", gecerli: ["cihaz", "ulke"], gelen: g.tur });
  }

  /** Satır hangi tabloda ve şu an hangi durumda — karar vermeden ÖNCE bilinmeli. */
  async function bul(t: OnayTablosu) {
    const { data } = await supabaseAdmin
      .from(t)
      .select("id, worker_id, status")
      .eq("id", id)
      .maybeSingle();
    return (data as { id: string; worker_id: string; status: string } | null) ?? null;
  }

  const aranacak: OnayTablosu[] =
    turHam === "cihaz"
      ? ["device_approvals"]
      : turHam === "ulke"
        ? ["country_approvals"]
        : ["device_approvals", "country_approvals"];

  let tablo: OnayTablosu | null = null;
  let satir: { id: string; worker_id: string; status: string } | null = null;
  for (const t of aranacak) {
    const r = await bul(t);
    if (r) {
      tablo = t;
      satir = r;
      break;
    }
  }
  if (!tablo || !satir) {
    return mobileError(404, "not_found", { id, ...(turHam ? { tur: turHam } : {}) });
  }

  // Durumu ÖNCEDEN okuduğumuz için 409'u "satır yok"tan ayırt edebiliyoruz.
  if (satir.status !== "pending") {
    return mobileError(409, "zaten_karara_baglandi", { id, mevcutDurum: satir.status });
  }

  const r = await onayKarari(tablo, id, onayla, guard.actor.worker.id);
  if (!r.ok) {
    // Yarış: iki istek aynı anda geldiyse ikincisi burada 0 satır etkiler.
    if (r.error === "not_pending") {
      return mobileError(409, "zaten_karara_baglandi", { id, sebep: "yaris" });
    }
    return mobileError(503, "db_error", { sebep: r.error ?? "hata" });
  }

  let panelTazelendi = true;
  try {
    revalidatePath("/admin/guvenlik");
  } catch {
    panelTazelendi = false;
  }

  return Response.json({
    ok: true,
    ...katmanDurumu(),
    id,
    tur: tablo === "device_approvals" ? "cihaz" : "ulke",
    tablo,
    soforId: satir.worker_id,
    karar: kararHam,
    yeniDurum: onayla ? "approved" : "denied",
    panelTazelendi,
  });
}

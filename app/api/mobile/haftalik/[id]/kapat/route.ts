import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { requireMobileFleetView } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { audit } from "@/lib/security-log";
import { aksiyonKapat, kalemKapsamda } from "@/lib/haftalik-aksiyon-db";
import { HAFTALIK_SUSTURMA_GUN } from "@/lib/haftalik-aksiyon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/haftalik/[id]/kapat — kalemi kapat.
 *
 * Gövde: `{ durum?: "yapildi" | "ilgisiz", not?: string }`
 *
 * `app/actions/haftalik-aksiyon.ts` `haftalikAksiyonKapat`ın mobil ikizi ve
 * AYNI çekirdeği çağırıyor (`aksiyonKapat`).
 *
 * ═══ 🔴 `durum` NEDEN VAR — GÖREVDE YALNIZ `{not?}` İSTENMİŞTİ ═══
 *
 * Çekirdek iki kapanış biliyor ve aralarındaki fark KALICI:
 *   · `yapildi` → kalem kapanır, biter.
 *   · `ilgisiz` → kalem kapanır **VE o kural+özne çifti
 *     ${HAFTALIK_SUSTURMA_GUN} gün SUSTURULUR** (`susturmaKayitlari`,
 *     kısmi indeks `idx_haftalik_aksiyon_ilgisiz`).
 *
 * Yalnız `{not}` alıp içeride birini seçseydik, kullanıcı "bu kalemi kapattım"
 * derken farkında olmadan bir kuralı bir aylığına susturabilirdi — ya da tam
 * tersi, susturmak isterken susturamazdı. Sessiz seçim yapmak yerine alan
 * AÇIK: verilmezse **`yapildi`** (susturmayan, geri dönüşü kolay olan), yani
 * `{not: "..."}` tek başına gönderildiğinde de çalışır.
 *
 * ═══ KAPSAM ÖNCE ═══
 * Şef kendi filosu dışındaki bir kalemi kapatamaz. Kalem listeye hiç girmemiş
 * olsa bile kimliğini tahmin edip kapatmayı denemek mümkün — kapı burada,
 * panelin kullandığı `kalemKapsamda` ile.
 *
 * ═══ TEKRAR KAPATMA 409 ═══
 * Çekirdek `durum='acik'` koşuluyla günceller; zaten kapalı bir kalem
 * `zaten_kapali` döner ve **kapanış anı TAZELENMEZ**. Aksi hâlde ikinci bir
 * dokunuş susturma penceresini sessizce uzatırdı.
 *
 * HATA KODLARI:
 *   401 · 403 fleet_view_required (şoför) · 403 kapsam_disi (şefin filosu dışı)
 *   400 gecersiz_govde · invalid (alan: durum)
 *   404 not_found
 *   409 zaten_kapali
 *   503 db_error (migration 084 yok)
 */

const DURUMLAR = ["yapildi", "ilgisiz"] as const;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireMobileFleetView(req);
  if (!guard.ok) return guard.response;
  const { id } = await params;

  let body: unknown = {};
  const ham = await req.text();
  if (ham.trim()) {
    try {
      body = JSON.parse(ham);
    } catch {
      return mobileError(400, "gecersiz_govde", { beklenen: "application/json" });
    }
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return mobileError(400, "gecersiz_govde", { sebep: "nesne_degil" });
  }
  const g = body as Record<string, unknown>;

  const durumHam = g.durum === undefined || g.durum === null ? "yapildi" : String(g.durum);
  if (!(DURUMLAR as readonly string[]).includes(durumHam)) {
    return mobileError(400, "invalid", {
      alan: "durum",
      gecerli: DURUMLAR,
      varsayilan: "yapildi",
      aciklama: `'ilgisiz' bu kural+özneyi ${HAFTALIK_SUSTURMA_GUN} gün susturur.`,
    });
  }
  const durum = durumHam as (typeof DURUMLAR)[number];
  const not = g.not === undefined || g.not === null ? null : String(g.not);

  const { data, error } = await supabaseAdmin
    .from("haftalik_aksiyonlar")
    .select("id, kural, worker_id, vehicle_id, durum")
    .eq("id", id)
    .maybeSingle();
  if (error) return mobileError(503, "db_error", { sebep: error.code ?? "hata" });
  if (!data) return mobileError(404, "not_found");

  const satir = data as {
    kural: string;
    worker_id: string | null;
    vehicle_id: string | null;
    durum: string;
  };

  // KAPSAM ÖNCE — 404 ile 403'ü ayırmak bilinçli: kalem VAR, yetki yok.
  if (!kalemKapsamda({ workerId: satir.worker_id, vehicleId: satir.vehicle_id }, guard.actor.fleetScope)) {
    return mobileError(403, "kapsam_disi", { fleet: guard.actor.fleet });
  }

  const r = await aksiyonKapat(id, durum, guard.actor.worker.id, not);
  if (!r.ok) {
    if (r.sebep === "tablo_yok") {
      return mobileError(503, "db_error", { sebep: "tablo_yok", migration: "084" });
    }
    if (r.sebep === "zaten_kapali") {
      return mobileError(409, "zaten_kapali", { mevcutDurum: satir.durum });
    }
    if (r.sebep === "yok") return mobileError(404, "not_found");
    return mobileError(503, "db_error", { sebep: r.mesaj ?? "hata" });
  }

  await audit(
    guard.actor.worker.id,
    "update",
    `haftalik_aksiyon:${durum}:${satir.kural}:${id} kaynak=mobil`
  );

  let panelTazelendi = true;
  try {
    revalidatePath("/admin/haftalik");
  } catch {
    panelTazelendi = false;
  }

  return Response.json({
    ok: true,
    id,
    durum,
    kural: satir.kural,
    notYazildi: Boolean((not ?? "").trim()),
    /** 'ilgisiz' ise bu kural+özne ne zamana kadar susturuldu. */
    susturmaGun: durum === "ilgisiz" ? HAFTALIK_SUSTURMA_GUN : null,
    panelTazelendi,
  });
}

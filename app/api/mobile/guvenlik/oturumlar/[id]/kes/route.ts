import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { requireMobileOwner } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { katmanDurumu, katmanKapaliYanit } from "@/lib/mobile-guvenlik";
import { sessionSayfasi, sessionTek } from "@/lib/security-read";
import { oturumlariKes } from "@/lib/guvenlik-eylem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/guvenlik/oturumlar/[id]/kes
 *
 * Gövde: `{ kapsam: "hepsi", dondur?: boolean }`
 *
 * `revokeSessionsAction`ın (panel) mobil ikizi ve AYNI çekirdeği çağırıyor
 * (`oturumlariKes`).
 *
 * ═══ 🔴 TEK OTURUM KESİLEMEZ — ÖLÇÜLDÜ, BU YÜZDEN `kapsam` ZORUNLU ═══
 *
 * Üründe oturum iptali SATIR düzeyinde değil KİŞİ düzeyinde çalışıyor:
 *
 *   web   → `isSessionRevoked(workerId, cookieVersion)` yalnız
 *           `workers.session_version`e bakar; `login_sessions` satırına HİÇ
 *           bakmaz.
 *   mobil → `token_version` de `workers` üzerinde; mobil token bir satır
 *           id'si taşımıyor (lib/security-log.ts `closeSessionsBySource`).
 *
 * Yani tek bir satırı kapatmak KİMSEYİ ÇIKARMAZ: satır "bitti" görünür, kişi
 * çalışmaya devam eder. Böyle bir uç, güvenlik ekranında YALAN söyleyen bir
 * düğme olurdu — 086'daki "kapatma ucu yok" kararının kardeşi, ama buradaki
 * fark şu: çalışan bir yol VAR, yalnız KAPSAMI daha geniş.
 *
 * Bu yüzden istemci kapsamı AÇIKÇA kabul etmek zorunda: `{kapsam:"hepsi"}`
 * gelmezse **400** ve sebebi gövdede yazılı. Sessizce genişletmek, "bir
 * cihazı attım" sanan patronun o kişinin bütün cihazlarını düşürmesiyle
 * biterdi. Aynı desen `haftalik/[id]/kapat`ın `durum` alanında da var:
 * kalıcı sonucu olan bir seçim istemciden AÇIKÇA alınır.
 *
 * ═══ KENDİNİ KESEMEZ ═══
 * Çekirdek `workerId === actorId` ise `self` döner. Patronun kendi oturumunu
 * düşürmesi anlamsız ve kilitlenmeye açık (045 kararı).
 *
 * HATA KODLARI:
 *   401 · 403 admin_required / owner_required
 *   400 gecersiz_govde · invalid (alan: kapsam | dondur)
 *   404 not_found (oturum satırı yok)
 *   409 self (patron kendi oturumu)
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireMobileOwner(req);
  if (!guard.ok) return guard.response;
  if (guard.katman === "kapali") return katmanKapaliYanit();

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

  /**
   * KAPSAM AÇIK ONAY. Tek geçerli değer "hepsi" — çünkü ürünün yapabildiği
   * tek şey o. "bu_oturum" göndermek 400 alır ve NEDEN olmadığını öğrenir.
   */
  if (g.kapsam !== "hepsi") {
    return mobileError(400, "invalid", {
      alan: "kapsam",
      gecerli: ["hepsi"],
      gelen: g.kapsam ?? null,
      sebep: "tek_oturum_kesilemez",
      aciklama:
        "Üründe oturum iptali KİŞİ ekseninde çalışıyor (workers.session_version + " +
        "token_version). Tek bir login_sessions satırını kapatmak kimseyi çıkarmaz; " +
        "satır 'bitti' görünür, kişi çalışmaya devam eder. Bu uç satırın SAHİBİNİN " +
        "tüm oturumlarını (web + mobil) düşürür — kapsamı açıkça onaylayın.",
    });
  }

  const dondur = g.dondur === undefined || g.dondur === null ? false : g.dondur;
  if (typeof dondur !== "boolean") {
    return mobileError(400, "invalid", { alan: "dondur", bicim: "boolean", gelen: g.dondur });
  }

  const satir = await sessionTek(id);
  if (!satir) return mobileError(404, "not_found", { id });

  // ÖNCE ÖLÇ: kaç satır açıktı? Kesmenin gerçekten bir şey yaptığı burada
  // kanıtlanıyor — "ok:true" tek başına bir ölçüm değil.
  const once = await sessionSayfasi({ limit: 1, offset: 0, workerId: satir.worker_id, acikMi: true });

  const r = await oturumlariKes(satir.worker_id, guard.actor.worker.id, { dondur });
  if (!r.ok) {
    if (r.error === "self") {
      return mobileError(409, "self", {
        aciklama: "Patron kendi oturumunu düşüremez (kilitlenme riski).",
      });
    }
    return mobileError(503, "db_error", { sebep: r.error ?? "hata" });
  }

  const sonra = await sessionSayfasi({ limit: 1, offset: 0, workerId: satir.worker_id, acikMi: true });

  let panelTazelendi = true;
  try {
    revalidatePath("/admin/guvenlik");
  } catch {
    panelTazelendi = false;
  }

  return Response.json({
    ok: true,
    ...katmanDurumu(),
    oturumId: id,
    soforId: satir.worker_id,
    sofor: satir.worker_name,
    /** Kesme KİŞİ ekseninde: bu sayı "o satır" değil "o kişinin açıkları". */
    acikOturum: { once: once.toplam, sonra: sonra.toplam },
    /** Web çerezlerini öldüren yeni sayaç değeri. */
    sessionVersion: r.sessionVersion ?? null,
    /** Mobil token'lar da düştü (044); sayaç ayrı ve sessizce artırıldı. */
    mobilKesildi: true,
    donduruldu: dondur,
    panelTazelendi,
  });
}

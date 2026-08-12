import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { setWorkerActive } from "@/lib/worker-account-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/workers/[id]/pasif — çalışanı GEÇİCİ olarak pasife alır
 * ya da geri açar.
 *
 * Gövde: `{ "pasif": true }` (pasife al) · `{ "pasif": false }` (geri aç).
 *
 * Panelde karşılığı Çalışanlar listesindeki aç/kapa düğmesi →
 * `toggleActiveAction`. Yazdığı alan `workers.is_active`.
 *
 * ═══ ⚠️ PASİF ≠ İŞTEN ÇIKIŞ ═══════════════════════════════════════════════
 * Bu uç `terminated_at`e İŞTEN ÇIKIŞ YAZMAZ ve `terminateWorkerAction`a
 * BAĞLI DEĞİLDİR. İkisi ayrı kavramdır:
 *   • `is_active=false`  → GEÇİCİ. Hastalık, uzun izin, telefonu kayıp.
 *                          Kişi kadroda durur, geri açılır.
 *   • `terminated_at`    → KALICI. Son çalışma günü, Telegram bağı kopar,
 *                          filo şefliği düşer, kişi "Ayrılanlar"a geçer.
 * Karışırsa Personel listesindeki "Ayrılanlar" bölümü sessizce yanlışa döner:
 * hasta olan biri işten çıkmış görünür ya da tersi. İşten çıkış AYRI bir
 * yüzeydir ve bu turda mobilde YOKTUR.
 *
 * ── TEK İSTİSNA: GERİ AÇARKEN terminated_at TEMİZLENİR ────────────────────
 * Bu, işten çıkışı bu uca bağlamak DEĞİL; panelin 28.07.2026'da düzelttiği
 * HAYALET DURUM hatasının aynı şekilde önlenmesidir. Eskiden yalnız is_active
 * çevriliyor, terminated_at olduğu gibi kalıyordu: "çalışıyor ama işten
 * çıkmış". İzin Takvimi o kaydı İKİ ayrı sorguyla birden yakalıyor ve aynı
 * kişi takvimde İKİ SATIR olarak çıkıyordu. Temizlemeseydik mobil o hatayı
 * geri getirirdi. Pasife ALIRKEN `terminated_at`e DOKUNULMAZ — action'daki
 * kuralın birebir aynısı.
 *
 * ── TEK ÇEKİRDEK: lib/worker-account-db.ts ────────────────────────────────
 * Yazma mantığı panelle ORTAK (12.08.2026) — `setWorkerActive`. Panel oraya
 * `"toggle"` geçer (aç-kapa düğmesinin bugünkü davranışı), bu uç AÇIK DEĞER
 * geçer. `toggleActiveAction` doğrudan çağrılamıyor: ilk satırı `requireAdmin()`
 * ve o kapı yetkisizde `redirect()` fırlatıyor (lib/session.ts:167) — mobil
 * istekte çerez yok, kimlik Bearer token'la geliyor. Ayrıntı kardeş uçta
 * (`…/pin/route.ts`) ve çekirdeğin başlığında.
 *
 * ── NEDEN TOGGLE DEĞİL, AÇIK DEĞER ────────────────────────────────────────
 * Taşıyıcının farkı: iki telefon aynı satıra aynı anda basarsa toggle kişiyi
 * geri açar (iki çevirme = başa dönüş) ve kimse fark etmez. Açık değer
 * idempotenttir: aynı isteği iki kez göndermek aynı sonucu verir. Zaten o
 * durumdaysa çekirdek yazma YAPMAZ ve `degisti:false` döner — gereksiz bir
 * `bumpTokenVersion` o kişinin telefonundaki oturumu boşuna düşürürdü.
 * Panelin yolu bu daldan GEÇMEZ: `"toggle"` tanım gereği hep değişim üretir.
 *
 * ── KAPI ──────────────────────────────────────────────────────────────────
 * requireMobileAdmin (şef/şoför 403) + assertOwnerWritable (patron kaydına
 * başka yönetici dokunamaz → 404).
 *
 * ⚠️ KENDİNİ PASİFE ALMA ENGELLENMEZ — panelde de engellenmiyor (parite).
 * Yönetici kendi kaydını kapatırsa kendi token'ı da anında ölür. Yeni bir
 * kısıt eklemek mobili panelden KATI yapardı; ayrım bilinçli, kural değil
 * eksik olarak raporlandı.
 *
 * ⚠️ HIZ SINIRI (rate limit) YOK — kardeş yazma uçlarıyla aynı durum.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return mobileError(400, "invalid_json");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return mobileError(400, "invalid", { alan: "govde", sebep: "nesne_degil" });
  }
  const g = body as Record<string, unknown>;

  // Varsayılan YOK. `{}` gönderen istemci ne istediğini söylememiştir; "pasife
  // al" varsaymak bir insanı sisteme sokmayan bir varsayım olurdu.
  if (!("pasif" in g)) return mobileError(400, "missing_fields", { alan: "pasif" });
  if (typeof g.pasif !== "boolean") {
    return mobileError(400, "invalid", { alan: "pasif", sebep: "boolean_degil" });
  }
  const r = await setWorkerActive(guard.actor.worker.id, id, !g.pasif);
  if (!r.ok) {
    // Patron koruması (045) ve "kayıt yok" AYNI cevabı verir: 404.
    if (r.sebep === "owner_protected" || r.sebep === "not_found") {
      return mobileError(404, "not_found");
    }
    return mobileError(503, "db_error", { sebep: "yazma_hatasi" });
  }

  // /admin/izinler de tazelenir: İzin Takvimi kadro listesini is_active ve
  // terminated_at'ten kuruyor (çift satır hatasının düzeldiği anda görünsün).
  // try/catch: tazeleme başarısız olsa da YAZMA GERÇEKLEŞTİ — 503 dönmek
  // yöneticiye "olmadı" der ve aynı işlemi ikinci kez yaptırırdı.
  // Değişiklik olmadıysa tazelemeye de gerek yok.
  let panelTazelendi = true;
  if (r.degisti) {
    try {
      revalidatePath("/admin/workers");
      revalidatePath("/admin/izinler");
    } catch {
      panelTazelendi = false;
    }
  }

  return Response.json({
    ok: true,
    degisti: r.degisti,
    /** false → migration 044 yok; eski mobil anahtarlar ölmedi. */
    tokenIptal: r.tokenIptal,
    panelTazelendi,
    personel: {
      id,
      aktif: r.aktif,
      /** Geri açmada null'a döner; pasife almada olduğu gibi kalır. */
      ayrilisTarihi: r.ayrilisTarihi,
    },
  });
}

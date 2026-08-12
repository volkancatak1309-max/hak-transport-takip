import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { setWorkerPin } from "@/lib/worker-account-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/workers/[id]/pin — yönetici bir çalışana YENİ PIN atar.
 *
 * Gövde: `{ "pin": "418302", "mustChange": true }` (`mustChange` opsiyonel,
 * varsayılan true — panel diyaloğunun varsayılanıyla aynı).
 *
 * Panelde karşılığı `SetPinDialog` → `setWorkerPinAction`. Bu uç o akışın
 * AYNISINI yapar; kural kümesi tek tek eşleştirildi (aşağıda).
 *
 * ── TEK ÇEKİRDEK: lib/worker-account-db.ts ────────────────────────────────
 * Yazma mantığı panelle ORTAK (12.08.2026). `setWorkerPinAction` doğrudan
 * çağrılamıyor: o action ilk satırında `requireAdmin()` çalıştırıyor ve o kapı
 * yetkisizde `redirect()` FIRLATIR (lib/session.ts:167). Mobil istekte oturum
 * ÇEREZİ yoktur — kimlik `Authorization: Bearer` ile gelir — yani action her
 * çağrıda yönlendirmeye düşerdi: istemci JSON yerine 307 + HTML görürdü.
 *
 * Çözüm kapıyı mantıktan ayırmak. Kapı burada (requireMobileAdmin), panelde
 * requireAdmin; ikisi de AYNI `setWorkerPin`i çağırır. Böylece PIN kuralı
 * değiştiğinde tek dosya güncellenir ve panel ile telefon ayrışamaz.
 *
 * Bu ucun kendine ait tek işi GÖVDE SÖZLEŞMESİDİR (JSON şekli, alan tipleri) —
 * panelin karşılığı tipli fonksiyon argümanlarıdır, bir HTTP gövdesi yoktur.
 *
 * ── MEVCUT PIN ASLA OKUNAMAZ ──────────────────────────────────────────────
 * `workers.pin_hash` bcrypt'tir, geri döndürülemez. Bu uç yalnız ÜZERİNE YAZAR.
 * Yeni PIN de yanıtta DÖNMEZ: yöneticinin kendi yazdığı değeri sunucudan geri
 * yollamak onu bir yanıt gövdesine ve loglara sokardı. Panel de döndürmüyor.
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

  if (!("pin" in g)) return mobileError(400, "missing_fields", { alan: "pin" });
  if (typeof g.pin !== "string") {
    return mobileError(400, "invalid", { alan: "pin", sebep: "metin_degil" });
  }
  // Varsayılan true — panel diyaloğunun kutusu işaretli açılıyor. Gönderildiyse
  // BOOLEAN olmak zorunda: "false" dizesini false sanmak, şoförü geçici PIN'e
  // kilitlemek demekti.
  if ("mustChange" in g && typeof g.mustChange !== "boolean") {
    return mobileError(400, "invalid", { alan: "mustChange", sebep: "boolean_degil" });
  }
  const mustChange = g.mustChange === undefined ? true : (g.mustChange as boolean);

  const r = await setWorkerPin(guard.actor.worker.id, id, g.pin, mustChange);
  if (!r.ok) {
    // Patron koruması (045) ve "kayıt yok" AYNI cevabı verir: 404. Ayırmak,
    // korunan bir kaydın VAR olduğunu doğrulardı.
    if (r.sebep === "owner_protected" || r.sebep === "not_found") {
      return mobileError(404, "not_found");
    }
    if (r.sebep === "invalid_pin") {
      // Şemanın kendi mesaj anahtarı ("errPin" | "errPinWeak") aynen taşınır —
      // istemci hangi kuralın çiğnendiğini bilsin, "geçersiz" ile yetinmesin.
      return mobileError(400, "invalid_pin", { alan: "pin", sebep: r.pinKod ?? "errPin" });
    }
    return mobileError(503, "db_error", { sebep: "yazma_hatasi" });
  }

  // Panelin sayfa önbelleği. try/catch: tazeleme başarısız olsa da YAZMA
  // GERÇEKLEŞTİ — 503 dönmek yöneticiye "olmadı" der ve aynı PIN'i ikinci kez
  // yazdırırdı. Sonuç yanıtta görünür, yutulmuyor.
  let panelTazelendi = true;
  try {
    revalidatePath("/admin/workers");
    revalidatePath(`/admin/workers/${id}`);
  } catch {
    panelTazelendi = false;
  }

  return Response.json({
    ok: true,
    /** PIN GÖVDEDE DÖNMEZ — yukarıdaki nota bakın. */
    mustChange,
    /** false → migration 044 yok; eski mobil anahtarlar ölmedi. */
    tokenIptal: r.tokenIptal,
    panelTazelendi,
  });
}

import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { requireMobileWorker } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { dvirFormuGonder } from "@/lib/dvir-submit";
import type { YanitGirdi } from "@/lib/dvir-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/dvir — ŞOFÖR ARAÇ KONTROL FORMUNU GÖNDERİR (kusur
 * fotoğraflarıyla birlikte).
 *
 * **multipart/form-data**:
 *   `vehicleId`  zorunlu
 *   `tur`        "once" | "sonra"
 *   `yanitlar`   JSON dizisi: `[{maddeId, durum, notlar}]`
 *   `foto_<maddeId>`  her KUSURLU madde için bir dosya (zorunlu)
 *   `seferId`, `lat`, `lng`, `accuracy`  opsiyonel
 *
 * Panelde karşılığı `dvirFormGonder`; gövde ORTAK (`lib/dvir-submit.ts`).
 *
 * ── 🔴 NEDEN "FOTO EKLE" UCU DEĞİL ─────────────────────────────────────────
 * İlk tasarım `POST /dvir/[id]/foto` idi: formu gönder, sonra fotoğrafı ekle.
 * CANLIDA REDDEDİLDİ — `dvir_yanitlari` KOŞULSUZ değişmez (081
 * `trg_dvir_yanit_degismez`, `HK081`): satır yazıldıktan sonra hiçbir update
 * kabul edilmiyor. Fotoğraf ancak form YAZILIRKEN konabilir.
 *
 * Bu bir kısıtlama değil, 081'in kararı: kontrol formu bir beyandır ve beyan
 * sonradan güzelleştirilemez. Düzeltmenin yolu YENİ FORM doldurmaktır.
 * Ölçüm kaydı `lib/dvir-db.ts` sonundaki notta.
 *
 * ── YETİM DOSYA KAPALI ─────────────────────────────────────────────────────
 * N kusurlu madde = N dosya, ama TEK kayıt. `coklaYukleVeYaz` (çekirdek)
 * herhangi bir adım düşerse o ana kadar yüklenen dosyaların TAMAMINI siler ve
 * kotayı iade eder. Panelin eski döngüsü bunu yapmıyordu: `createDvirForm`
 * düştüğünde N dosya birden yetim kalıyordu (ölçüldü 03.09.2026, düzeltildi).
 *
 * ── HIZ SINIRI: İSTEK BAŞINA, DOSYA BAŞINA DEĞİL ───────────────────────────
 * Kontrol listesi 15-20 maddelik; hepsi kusurluysa dosya başına kota formu
 * 10. maddede reddederdi — bir maliyet freni, yasal bir formu tamamlanamaz
 * hâle getirirdi. Tavan dosya SAYISIYLA kapalı (`COKLU_DOSYA_TAVAN`).
 *
 * ── HATA KODLARI ───────────────────────────────────────────────────────────
 *   401 ortak kapı
 *   403 arac_senin_degil · not_a_driver
 *   400 gecersiz_govde · missing_fields · madde_yok · kanit_yok
 *       dosya_yok · cok_buyuk · tip_yasak
 *   409 tablo_yok (migration 081 uygulanmamış)
 *   429 hiz_siniri + Retry-After
 *   503 depo_hatasi · hata
 */
export async function POST(req: NextRequest) {
  const guard = await requireMobileWorker(req);
  if (!guard.ok) return guard.response;
  const { worker } = guard.actor;

  // Kardeş uçların aynı cümlesi (migration 041 muafiyeti): direksiyona
  // geçmeyen yönetici araç kontrol formu doldurmaz.
  if (worker.is_admin && !worker.counts_as_driver) {
    return mobileError(403, "not_a_driver");
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return mobileError(400, "gecersiz_govde", { beklenen: "multipart/form-data" });
  }

  const vehicleId = form.get("vehicleId");
  if (typeof vehicleId !== "string" || !vehicleId.trim()) {
    return mobileError(400, "missing_fields", { alan: "vehicleId" });
  }
  const turRaw = String(form.get("tur") ?? "once");
  if (turRaw !== "once" && turRaw !== "sonra") {
    return mobileError(400, "invalid", { alan: "tur", izinli: ["once", "sonra"] });
  }

  let yanitlar: YanitGirdi[];
  try {
    const ham = JSON.parse(String(form.get("yanitlar") ?? "[]"));
    if (!Array.isArray(ham)) throw new Error("dizi degil");
    yanitlar = ham as YanitGirdi[];
  } catch {
    return mobileError(400, "invalid", { alan: "yanitlar", sebep: "json_degil" });
  }
  if (yanitlar.length === 0) return mobileError(400, "madde_yok");

  // Kusurlu maddelerin fotoğrafları — panelle AYNI alan adı deseni.
  const fotograflar = new Map<string, File>();
  for (const y of yanitlar) {
    if (y?.durum !== "kusurlu" || typeof y.maddeId !== "string") continue;
    const f = form.get(`foto_${y.maddeId}`);
    if (f instanceof File) fotograflar.set(y.maddeId, f);
  }

  const sayi = (v: FormDataEntryValue | null): number | null => {
    if (v === null) return null;
    const n = Number(String(v));
    return Number.isFinite(n) ? n : null;
  };

  const r = await dvirFormuGonder(worker.id, {
    vehicleId: vehicleId.trim(),
    tur: turRaw,
    seferId: (form.get("seferId") as string) || null,
    latitude: sayi(form.get("lat")),
    longitude: sayi(form.get("lng")),
    dogrulukM: sayi(form.get("accuracy")),
    yanitlar,
    fotograflar,
  });

  if (!r.ok) {
    if (r.sebep === "hiz_siniri") {
      return Response.json(
        { ok: false, error: "hiz_siniri", retryAfter: r.retryAfter, ayrinti: r.mesaj },
        { status: 429, headers: { "Retry-After": String(r.retryAfter ?? 60) } }
      );
    }
    if (r.sebep === "arac_senin_degil") return mobileError(403, r.sebep);
    if (r.sebep === "tablo_yok") {
      return mobileError(409, "ozellik_kapali", { migration: "081" });
    }
    if (r.sebep === "depo_hatasi" || r.sebep === "hata") {
      return mobileError(503, r.sebep, { ayrinti: r.mesaj });
    }
    // madde_yok · kanit_yok · dosya_yok · cok_buyuk · tip_yasak → istemci hatası
    return mobileError(400, r.sebep, { ayrinti: r.mesaj });
  }

  let panelTazelendi = true;
  try {
    revalidatePath("/panel/kontrol");
    revalidatePath("/admin/bakim");
  } catch {
    panelTazelendi = false;
  }

  return Response.json({
    ok: true,
    form: { id: r.formId, kusur: r.kusur, isEmri: r.isEmri },
    panelTazelendi,
  });
}

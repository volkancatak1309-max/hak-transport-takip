import type { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { requireMobileWorker } from "@/lib/mobile-scope";
import { mobileError } from "@/lib/mobile-auth";
import { yukleVeYaz } from "@/lib/upload-core";
import {
  TESLIMAT_KOVASI,
  getTeslimatByDurak,
  addTeslimatFoto,
} from "@/lib/teslimat-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/sefer/[id]/duraklar/[durakId]/foto
 * — ŞOFÖR TESLİMAT KANITINA FOTOĞRAF EKLER.
 *
 * **multipart/form-data** · alanlar: `foto` (zorunlu), `lat`, `lng`, `accuracy`.
 * Mobil API'nin İLK multipart ucu (ölçüldü 03.09.2026: o güne dek 0 dosya ucu).
 *
 * Panelde karşılığı `teslimatFotoEkle`; kurallar KOPYALANMADI —
 * `lib/upload-core.ts` ikisinin de tek kaynağı.
 *
 * ── DURAK EKSENİ, TESLİMAT EKSENİ DEĞİL ────────────────────────────────────
 * Panel `teslimatId` alıyor; şoför telefonda o kimliği bilmiyor, DURAKTA
 * duruyor. Uç bu çeviriyi `getTeslimatByDurak` ile yapar: `durak_id` ile arar
 * (`durak_no` ile DEĞİL — sıra değişebilir, kalıcı bağ id'dir) ve İPTAL
 * EDİLMİŞ kanıtı döndürmez.
 *
 * Durakta henüz kanıt yoksa `409 kanit_yok`: fotoğraf bir kanıta eklenir,
 * kanıdın kendisi değildir. Şoför önce teslimatı kaydeder.
 *
 * ── KAPI: KANITI BIRAKAN KİŞİ ──────────────────────────────────────────────
 * `requireMobileWorker` + kanıdın `workerId`si token sahibiyle aynı olmalı —
 * panelin cümlesinin aynısı. Yönetici bile başkasının kanıtına fotoğraf
 * ekleyemez: delilin kim tarafından üretildiği delilin parçasıdır.
 *
 * ── 🔴 SİLME UCU YOK, VE BU BİR EKSİK DEĞİL ────────────────────────────────
 * `teslimatlar` ve `teslimat_fotograflari` DEĞİŞMEZ (080, `HK080`
 * tetikleyicileri). Yanlış bir kanıt silinmez, İPTAL edilir — sebebiyle
 * birlikte kayıtta kalır. Fotoğrafı silebilen bir uç o değişmezliği
 * çiğnerdi: bir delili silmek, onu değiştirmekten kötüdür.
 *
 * Yetim koruması yine de burada ve GEREKLİ: `addTeslimatFoto` düşerse
 * yüklenen dosya SİLİNİR (`yukleVeYaz`). Silinen bir kayıt değil, hiç
 * kaydedilmemiş bir dosyadır.
 *
 * ── HATA KODLARI ───────────────────────────────────────────────────────────
 *   401 missing_token / invalid_token / revoked / inactive   (ortak kapı)
 *   403 kanit_senin_degil
 *   404 sefer_yok             — durakta geçerli kanıt yok
 *   409 kanit_yok             — önce teslimat kaydedilmeli
 *       ozellik_kapali        — migration 080/082 uygulanmamış
 *   400 dosya_yok · cok_buyuk · tip_yasak · gecersiz_govde
 *   429 hiz_siniri            + Retry-After
 *   503 depo_hatasi · yazma_hatasi
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; durakId: string }> }
) {
  const guard = await requireMobileWorker(req);
  if (!guard.ok) return guard.response;
  const { worker } = guard.actor;

  const { id: seferId, durakId } = await params;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    // multipart olmayan gövde: içerik türü yanlış ya da bozuk sınır.
    return mobileError(400, "gecersiz_govde", { beklenen: "multipart/form-data" });
  }

  const file = form.get("foto");
  if (!(file instanceof File)) {
    return mobileError(400, "dosya_yok", { alan: "foto" });
  }

  const sayi = (v: FormDataEntryValue | null): number | null => {
    if (v === null) return null;
    const n = Number(String(v));
    return Number.isFinite(n) ? n : null;
  };

  // ── HANGİ KANIT ────────────────────────────────────────────────────────
  const bulundu = await getTeslimatByDurak(seferId, durakId);
  if (bulundu.tabloYok) {
    return mobileError(409, "ozellik_kapali", { migration: "080" });
  }
  if (bulundu.kolonYok) {
    return mobileError(409, "ozellik_kapali", { migration: "082" });
  }
  if (!bulundu.teslimat) {
    return mobileError(409, "kanit_yok", { sebep: "durakta_gecerli_kanit_yok" });
  }
  const kanit = bulundu.teslimat;

  // Kanıtı bırakan kişi DEĞİLSE fotoğraf ekleyemez (panelin aynı cümlesi).
  if (kanit.workerId !== worker.id) {
    return mobileError(403, "kanit_senin_degil");
  }

  // ── YÜKLE + YAZ, YETİM BIRAKMADAN ──────────────────────────────────────
  let yazmaSebep: string | null = null;
  const c = await yukleVeYaz(TESLIMAT_KOVASI, worker.id, file, async (yol) => {
    const r = await addTeslimatFoto(kanit.id, yol, {
      latitude: sayi(form.get("lat")),
      longitude: sayi(form.get("lng")),
      dogrulukM: sayi(form.get("accuracy")),
    });
    if (!r.ok) {
      yazmaSebep = r.sebep;
      return null;
    }
    return r.id;
  });

  if (!c.ok) {
    if (c.hata === "hiz_siniri") {
      return Response.json(
        { ok: false, error: "hiz_siniri", retryAfter: c.retryAfter },
        { status: 429, headers: { "Retry-After": String(c.retryAfter ?? 60) } }
      );
    }
    if (c.hata === "dosya_yok" || c.hata === "cok_buyuk" || c.hata === "tip_yasak") {
      return mobileError(400, c.hata, { ayrinti: c.ayrinti });
    }
    if (c.hata === "yazma_hatasi") {
      // `dosyaTemizlendi` YUTULMUYOR: temizlik başarısızsa yetim VARDIR ve
      // yanıt bunu söyler — sessiz kalmak, sözü tutmadan tutmuş görünmektir.
      return mobileError(503, "yazma_hatasi", {
        sebep: yazmaSebep ?? undefined,
        dosyaTemizlendi: c.dosyaTemizlendi === true,
      });
    }
    return mobileError(503, "depo_hatasi", { ayrinti: c.ayrinti });
  }

  let panelTazelendi = true;
  try {
    revalidatePath("/panel/seferler");
    revalidatePath("/admin/seferler");
  } catch {
    panelTazelendi = false;
  }

  return Response.json({
    ok: true,
    foto: { id: c.kayit, yol: c.yol },
    teslimatId: kanit.id,
    panelTazelendi,
  });
}

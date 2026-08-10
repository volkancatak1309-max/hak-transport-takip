import type { NextRequest } from "next/server";
import { verifyMobileRequest, mobileError } from "@/lib/mobile-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { MAX_COUNT } from "@/lib/validation";
import { PACKAGES_ENABLED } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/mobile/shifts/current/packages — şoför KENDİ AÇIK vardiyasının
 * "alınan paket" sayısını girer/düzeltir.
 *
 * Panelin `updatePackageCountAction` (app/actions/shift.ts:828) ucunun mobil
 * ikizi. Yeni bir kural YOK; aynı cümle, aynı alan, aynı sınırlar:
 *   • yazılan TEK alan `start_package_count`
 *   • hedef: çağıranın ENDED_AT'İ NULL olan vardiyası (anahtarlı yazma)
 *   • `null` → değeri TEMİZLER (panelde boş bırakmak buna karşılık gelir)
 *   • `updated_at` / `updated_by` damgalanır
 *
 * ── NEDEN "teslim" ALINMIYOR ──────────────────────────────────────────────
 * Panelde de alınmıyor. Paket muhasebesi tek yönlü (app/actions/shift.ts:658):
 *   alınan = start_package_count      → vardiya SIRASINDA şoför girer (bu uç)
 *   teslim edilemeyen = undelivered_count → KAPANIŞTA sorulur, zorunlu
 *   teslim edilen = alınan − teslim edilemeyen → TÜRETİLİR, hiç girilmez
 * `cargo_count`'u doğrudan yazan bir uç açmak bu türetmeyi bozardı: iki kaynak
 * olurdu ve kapanış hesabı sessizce üstüne yazardı. Kapanış (dolayısıyla
 * `undelivered_count`) bu turun KAPSAMI DIŞINDA — ayrı uç gerekiyor.
 *
 * ── YETKİ ─────────────────────────────────────────────────────────────────
 * Yazma ANAHTARLI: gövdede worker_id / entry_id gibi bir hedef alanı YOK, bu
 * yüzden hiç kimse başkasının vardiyasına yazamaz — "başka şoförün vardiyası"
 * diye bir istek kurulamaz, kurulsa da WHERE kendi kimliğine bağlıdır.
 *
 * Yönetici bu uca yazamaz: `is_admin=true` olan hesap 403 `not_a_driver` alır.
 * MUAFİYET (migration 041) — `counts_as_driver=true` olan yönetici GERÇEK
 * vardiya açar (lib/driver-scope.ts onu elemiyor, Günün Panosu'nda "Vardiya
 * Başlat" düğmesiyle görünür) ve o vardiyanın paketini girebilmelidir. Kapı
 * bu yüzden ham `is_admin` değil, projedeki KARDEŞ KAPILARIN aynı cümlesidir:
 * app/actions/shift.ts:398 (elle vardiya başlatma) ve app/actions/leaves.ts:113
 * (izin girişi). Üçü ayrışamaz.
 *
 * ── MODÜL KAPALIYSA ───────────────────────────────────────────────────────
 * `PACKAGES_ENABLED=false` olan kiracıda panelde paket alanı hiç ÇİZİLMEZ ve
 * kapanışta sorulmaz. Uç de yazmayı reddeder: görünmeyen bir alana veri
 * yazmak, hiçbir yüzeyin göstermediği bir sayı üretmek olurdu.
 */
export async function POST(req: NextRequest) {
  const auth = await verifyMobileRequest(req);
  if (!auth.ok) return mobileError(auth.status, auth.code);

  if (!PACKAGES_ENABLED) return mobileError(403, "packages_disabled");

  // Yönetici kapısı — muafiyetli (yukarıdaki nota bakın).
  if (auth.worker.is_admin && !auth.worker.counts_as_driver) {
    return mobileError(403, "not_a_driver");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return mobileError(400, "invalid_json");
  }
  const input = (body ?? {}) as { paketAlinan?: unknown };
  if (!("paketAlinan" in (input as object))) {
    return mobileError(400, "missing_fields");
  }

  // Panelin savePkg()/updatePackageCountAction ikilisiyle BİREBİR aynı ayıklama:
  // boş/null temizler; aksi hâlde tamsayıya indirilir, 0..MAX_COUNT arası olmalı.
  const raw = input.paketAlinan;
  let v: number | null = null;
  if (raw !== null && raw !== undefined && String(raw).trim() !== "") {
    v = Math.floor(Number(raw));
    if (!Number.isFinite(v) || v < 0 || v > MAX_COUNT) {
      return mobileError(400, "invalid");
    }
  }

  const { data, error } = await supabaseAdmin
    .from("time_entries")
    .update({
      start_package_count: v,
      updated_at: new Date().toISOString(),
      updated_by: auth.worker.id,
    })
    // ANAHTARLI YAZMA: kendi kimliği + açık vardiya. İkisi de WHERE'de.
    .eq("worker_id", auth.worker.id)
    .is("ended_at", null)
    .select("id, start_package_count, cargo_count, undelivered_count");

  if (error) return mobileError(503, "db_error");
  // Açık vardiya yok (hiç başlamamış ya da kapanmış) — panelin "no_active"i.
  // 404: kaydın varlığını doğrulamayan cevap, /shifts/[id] ile aynı gerekçe.
  if (!data || data.length === 0) return mobileError(404, "no_active");

  const row = data[0];
  return Response.json({
    ok: true,
    vardiya: {
      id: row.id as string,
      paketAlinan: row.start_package_count as number | null,
      // Türetilen alanlar — kapanışta yazılır, bu uç DOKUNMAZ. Yine de geri
      // döner ki istemci ekranı yeniden çekmeden tazeleyebilsin.
      paketTeslim: row.cargo_count as number | null,
      paketTeslimEdilemeyen: row.undelivered_count as number | null,
    },
  });
}

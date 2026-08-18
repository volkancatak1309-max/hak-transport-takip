import type { NextRequest } from "next/server";
import { requireMobileAdmin } from "@/lib/mobile-scope";
import { SAFETY_SCORE_WEIGHTS } from "@/lib/analytics-shared";
import { SCORE_MIN_KM_COVERAGE } from "@/lib/analytics";
import {
  SAFETY_SCORE_K,
  SCORE_MIN_KM_PER_DAY,
  SCORE_MIN_KM_FLOOR,
} from "@/lib/metric-thresholds";
import { SAFETY_SCORE_CALIBRATED, SCORE_THRESHOLD_WORKED_DAYS } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/score-config — güvenlik skorunun KURALLARI.
 *
 * ── NEDEN BİR UÇ, NEDEN İSTEMCİDE SABİT DEĞİL ─────────────────────────────
 * Mobil Analiz ekranı skoru AÇIKLAMAK zorunda: "bu 43 puan neyin sonucu",
 * "neden bu şoförde puan yok". Açıklama ancak ağırlıklar, eğri sabiti ve
 * eşikler bilinirse yapılabilir. İstemciye kopyalanmış bir tablo ise ilk
 * kalibrasyon değişikliğinde SESSİZCE yalan söylemeye başlar — ve bu proje
 * ağırlıkları ölçüme göre bir kez zaten değiştirdi (harsh_acceleration 12→3,
 * 12.08.2026) ve eşiği bir kez daha (40→20). İki değişiklik de mobili
 * bozmadan geçmeliydi; bu uç onu garanti eder.
 *
 * ── DEĞERLER KOPYALANMAZ, İÇE AKTARILIR ───────────────────────────────────
 * Aşağıdaki her sayı tanımlandığı dosyadan İTHAL EDİLİR:
 *   SAFETY_SCORE_WEIGHTS  → lib/analytics-shared.ts
 *   SAFETY_SCORE_K        → lib/metric-thresholds.ts
 *   SCORE_MIN_KM_PER_DAY  → lib/metric-thresholds.ts
 *   SCORE_MIN_KM_FLOOR    → lib/metric-thresholds.ts
 *   SCORE_MIN_KM_COVERAGE → lib/analytics.ts
 *   SAFETY_SCORE_CALIBRATED / SCORE_THRESHOLD_WORKED_DAYS → lib/tenant.ts (env)
 * Burada tek bir sayı YAZILI DEĞİL. Panel bir değeri değiştirdiği gün bu uç
 * kendiliğinden doğru kalır; birinin "mobili de güncellemeyi hatırlaması"
 * gerekmez. Bu dosyaya bir sayı sabiti eklemek, kuralın ihlalidir.
 *
 * ⚠️ `kapsamaOrani` sabitinin adı kodda `SCORE_MIN_KM_COVERAGE` ve yeri
 * lib/analytics.ts — diğer üç eşikten farklı olarak metric-thresholds.ts'te
 * DEĞİL, çünkü değeri `getWorkerShiftDistance`in kapsama sayacına bağlı ve
 * onunla aynı dosyada tutuluyor. Ad/yer birliği ayrı bir tur; buraya
 * kopyalanmadı, oradan ithal edildi.
 *
 * ── FORMÜL (istemci metni için) ───────────────────────────────────────────
 *   ceza          = Σ (olay × ağırlık)                    // idling dahil
 *   ceza/1000km   = ceza / (ölçülen km / 1000)
 *   skor          = 100 × K / (K + ceza/1000km)           // 0–100'e yuvarlanır
 *   kapı          = ölçülen km ≥ esikKm  VE  kapsama ≥ kapsamaOrani
 *   esikKm        = max(minKmTaban, minKmGun × çalışılan gün)   // bayrak AÇIKKEN
 * Şoför bazlı `esikKm` sabitlerden türetilmez; kişiye göre ölçeklendiği için
 * `/api/mobile/driver-scores` satırında AYRI taşınır.
 *
 * ── KAPI: requireMobileAdmin ──────────────────────────────────────────────
 * Skorun kuralı, skorun kendisiyle aynı yüzeyin parçası. `/driver-scores` ve
 * `/analytics` şefe ve şoföre kapalı olduğu için burası da kapalı: kuralı
 * göstermek tek başına zararsız görünür ama ekranın geri kalanını okuyamayan
 * bir istemciye yarar da sağlamaz, ve iki kapının ayrışması bir gün "şef
 * niye şunu görüyor da bunu görmüyor" sorusunu doğurur.
 *
 * ── SORGU PARAMETRESİ YOK ─────────────────────────────────────────────────
 * Bu uç DÖNEME bağlı değildir: kurallar aralıktan bağımsızdır. Bir gün
 * kalibrasyon döneme göre değişirse (olmamalı) bu uç parametre almalı — o
 * zamana kadar parametre eklemek, olmayan bir esnekliği vaat etmek olurdu.
 */
export async function GET(req: NextRequest) {
  const guard = await requireMobileAdmin(req);
  if (!guard.ok) return guard.response;

  return Response.json({
    ok: true,
    /**
     * false → skor kalibre EDİLMEMİŞ. Panel bu bayrak kapalıyken skor kolonunu
     * hiç göstermez (kalibre edilmemiş bir sayı bir insan hakkında mutlak
     * iddia taşır); mobil de aynı kararı verebilsin diye bayrak burada da
     * döner — `/driver-scores` yanıtındaki `skor.kalibre` ile AYNI kaynak.
     */
    kalibre: SAFETY_SCORE_CALIBRATED,
    /** Eğrinin yarılanma sabiti: ceza/1000km = K olan şoför 50 puan alır. */
    K: SAFETY_SCORE_K,
    /**
     * Olay tipi → ceza ağırlığı. Anahtarlar `vehicle_events.event_type`
     * değerleridir; `idling` rölanti EPİZODLARINDAN gelir (nokta-olay değil).
     * Listede olmayan bir tip skora HİÇ girmez — istemci bilinmeyen bir tipi
     * "ağırlığı 0" diye değil, "skora dahil değil" diye okumalı.
     */
    agirliklar: SAFETY_SCORE_WEIGHTS,
    esikler: {
      /** Çalışılan gün başına istenen km (kişiye göre ölçekleyen çarpan). */
      minKmGun: SCORE_MIN_KM_PER_DAY,
      /** Mutlak km tabanı — gün ölçeklemesi eşiği bunun ALTINA çekemez. */
      minKmTaban: SCORE_MIN_KM_FLOOR,
      /** Km'si ölçülebilmesi gereken vardiya oranı (0–1). */
      kapsamaOrani: SCORE_MIN_KM_COVERAGE,
      /**
       * Eşik ÇALIŞILAN GÜNE göre mi ölçekleniyor? Kapalıysa eşik aracın
       * odometre ölçüm penceresinden türer (scoreMinKmForSpan) ve yukarıdaki
       * `max(taban, gün×çarpan)` formülü GEÇERLİ DEĞİLDİR. Bayrak olmadan
       * istemci esikKm'i açıklayamaz, yanlış açıklardı.
       */
      calisilanGuneGore: SCORE_THRESHOLD_WORKED_DAYS,
    },
  });
}

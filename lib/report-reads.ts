import "server-only";
import { turMemo } from "@/lib/query-counter";
import {
  listVehiclesAndWorkers,
  getWorkerShiftDistance,
  getFleetDistanceSpans,
  getVehicleDistanceSpan,
} from "@/lib/analytics";
import { listEventsInRange, listIdleEpisodesInRange } from "@/lib/telemetry";
import { aracYakitKapsamasi } from "@/lib/fuel-vehicle";

/**
 * TUR İÇİ PAYLAŞILAN OKUMALAR (16. madde, 16.09.2026).
 *
 * ═══ NEDEN VAR: AYNI OKUMA İKİ KEZ YAPILIYORDU ═════════════════════════════
 *
 * `/api/mobile/fleets/karsilastir` altı toplayıcıyı çağırıyor ve bunlardan
 * ikisi (`buildPerformanceReport`, `buildFuelReport`) kendi içlerinde AYNI
 * kaynakları bir kez daha okuyor. Ölçüldü (galzura-demo, "ay", sorgu sayacı
 * `lib/query-counter.ts` ile):
 *
 *     rpc:fleet_odometer_spans   2×   ← 4.183 ms'lik çağrı, İKİ KEZ
 *     rpc:shift_odometer_spans   3×
 *     vehicle_events             6×   (iki ayrı sayfalı okuma)
 *     idle_episodes              2×
 *     vehicles                  21×
 *     workers                   19×
 *
 * İkinci okuma birincisiyle BİREBİR aynı sonucu döndürür: aralık sabit, tur
 * içinde yazma yok. Yani bu saf tekrar — sayıyı değiştirmez, yalnız süre yakar.
 *
 * ═══ NASIL: MEVCUT `turMemo` KABI, YENİ MEKANİZMA DEĞİL ════════════════════
 *
 * `lib/query-counter.ts` zaten bir AsyncLocalStorage kabı ve tur içi memo
 * sunuyor (#84 Adım 4). Burada yeni bir önbellek İCAT EDİLMİYOR; var olan kap
 * kullanılıyor.
 *
 * ⚠️ KAP YOKSA DAVRANIŞ BİREBİR ESKİSİ. `turMemo` kap dışında doğrudan
 * üreticiyi çağırır. Yani panel sayfaları, cron'lar ve diğer rotalar bu
 * dosyadan HİÇ etkilenmez: onlar kabı açmıyor. Önbellek yalnız `sayacIle()`
 * ile açılan tek bir turun ömrü kadar yaşar, turlar arası taşınmaz — bayat
 * veri riski yok.
 *
 * ⚠️ SADECE SALT-OKUMA ve ARALIK-ANAHTARLI çağrılar buraya girer. Anahtar
 * aralığı içerir; farklı aralık farklı anahtar demektir. Yazma yapan ya da
 * tur içinde değişebilen hiçbir okuma buraya KONMAZ.
 */

/** Araç + şoför evreni. Aralıktan bağımsız → anahtar sabit. */
export function okuEvren(): ReturnType<typeof listVehiclesAndWorkers> {
  return turMemo("evren", () => listVehiclesAndWorkers());
}

/** Aralıktaki sürüş olayları (sayfalı okuma). */
export function okuOlaylar(
  startISO: string,
  endISO: string
): ReturnType<typeof listEventsInRange> {
  return turMemo(`olaylar:${startISO}:${endISO}`, () =>
    listEventsInRange(startISO, endISO)
  );
}

/**
 * Aralıktaki rölanti epizodları (sayfalı okuma).
 *
 * `vehicleId` verilirse okuma SQL'de daraltılır ve ANAHTAR da daralır — filo
 * geneli okuma ile araç okuması aynı memo kutusunu paylaşmaz, yoksa biri
 * ötekinin eksik kümesini görürdü.
 */
export function okuRolanti(
  startISO: string,
  endISO: string,
  vehicleId?: string
): ReturnType<typeof listIdleEpisodesInRange> {
  return turMemo(`rolanti:${startISO}:${endISO}:${vehicleId ?? "*"}`, () =>
    listIdleEpisodesInRange(startISO, endISO, vehicleId)
  );
}

/**
 * Filo geneli odometre açıklıkları (097). Turun EN PAHALI tek çağrısı —
 * demo'da "ay" penceresinde 4.183 ms ve iki toplayıcı da istiyordu.
 */
export function okuFiloSpan(
  startISO: string,
  endISO: string
): ReturnType<typeof getFleetDistanceSpans> {
  return turMemo(`filoSpan:${startISO}:${endISO}`, () =>
    getFleetDistanceSpans(startISO, endISO)
  );
}

/** Vardiya pencereleri + km (052). */
export function okuVardiyaMesafe(
  startISO: string,
  endISO: string
): ReturnType<typeof getWorkerShiftDistance> {
  return turMemo(`vardiyaMesafe:${startISO}:${endISO}`, () =>
    getWorkerShiftDistance(startISO, endISO)
  );
}

/**
 * ARAÇ-ARAÇ ODOMETRE AÇIKLIĞI — 097 yedek yolu.
 *
 * ⚠️ NEDEN BU DA MEMOLU: 097 tek gövdeli bir ifadedir ve demo'da "ay"
 * penceresinde rakipsizken 4.183 ms sürüyor, yükün altında ise 8 sn'lik ifade
 * tavanını aşıp `null` dönüyor. O anda İKİ toplayıcı da bu yedek yola düşüyor
 * ve AYNI 29 aracı ikişer sorguyla iki kez okuyordu (ölçüldü: device_telemetry
 * 91 → 207 çağrı). Anahtar ARAÇ BAŞINA olduğu için iki çağıranın araç listeleri
 * birebir aynı olmasa da örtüşen kısım tek kez okunur.
 */
export function okuAracSpan(
  vehicleId: string,
  startISO: string,
  endISO: string
): ReturnType<typeof getVehicleDistanceSpan> {
  return turMemo(`aracSpan:${vehicleId}:${startISO}:${endISO}`, () =>
    getVehicleDistanceSpan(vehicleId, startISO, endISO)
  );
}

/**
 * ARAÇ BAŞINA VARDİYA İÇİ YAKIT KAPSAMASI (18.09.2026).
 *
 * ⚠️ NEDEN MEMOLU: CO₂ panosu `buildFuelReport`i TEK açılışta 7 kez çağırıyor
 * (1 aralık + 6 aylık seri) ve kapsama araç başına iki sayım sorgusu demek.
 * Memosuz hâlde 29 araç × 2 × 7 = 406 sorgu ederdi; aralık anahtarı sayesinde
 * aynı pencere bir kez okunuyor. Kap yoksa davranış birebir eskisi.
 */
export function okuYakitKapsama(
  vehicleId: string,
  startISO: string,
  endISO: string,
  pencereler: { baslangic: string; bitis: string }[]
): Promise<number | null> {
  return turMemo(`yakitKapsama:${vehicleId}:${startISO}:${endISO}`, () =>
    aracYakitKapsamasi(vehicleId, pencereler)
  );
}

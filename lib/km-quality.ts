import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { mapBounded } from "@/lib/db-fanout";

/**
 * Bu hızın üstü "araç gerçekten gitti" sayılır — GPS titremesini eler.
 * lib/auto-shift.ts'teki MOVE_SPEED_KMH ile AYNI eşik; iki dosyada iki farklı
 * "hareket" tanımı olmasın diye değeri burada da 5 tutuldu.
 */
const MOVE_SPEED_KMH = 5;

/**
 * VARDİYA KM'SİNİN ÖLÇÜM OLUP OLMADIĞI — TEK KARAR NOKTASI.
 *
 * ═══ SORUN (canlıda ölçüldü, 14.08.2026) ═══
 *
 * Vardiya km'si `end_km - start_km`. İki uç da cihaz odometresinden gelir ve
 * `latestVehicleTelemetry` YAŞ SINIRI TAŞIMAZ: cihaz ölse bile en son satırı
 * "güncel" gibi döndürür. Cihaz susunca aynı BAYAT odometre hem açılışta
 * start_km'e hem kapanışta end_km'e yazılır → fark tam olarak 0 → rapor
 * "0 km" der. Bu 0 uydurmadır ama ekranda gerçek bir ölçümden ayırt edilemez.
 *
 * ÖLÇÜM (60 gün, 460 vardiya, HAK61 canlı — scripts/verify-km-null.mjs):
 *     394  normal (km > 0)     → dokunulmadı
 *      39  "0 km" gösteriyordu → 11'i GERÇEK, 28'i UYDURMA
 *      27  end_km null         → zaten "—"
 * Örnek: DO-623GL, 9 vardiya / 2.350 paket, hepsi 109.895 → 109.895 = 0 km.
 * Emrullah Arslan 11 vardiyanın 10'unda km'siz; ekranda aylık toplam 54 km.
 *
 * ═══ AYRIM NASIL YAPILIYOR — İKİ KAPI ═══
 *
 * ① Vardiya penceresinde araçtan HİÇ telemetri geldi mi? Gelmediyse cihaz
 *    sessizdi; ne odometre ne GPS var, km ölçülemez. (19 vardiya)
 * ② Telemetri var ama araç HAREKET ETTİ Mİ (speed ≥ 5 km/s)? Ettiyse ve iki
 *    odometre ucu hâlâ aynıysa sayaç hareketi izlememiş demektir — 0 yine
 *    uydurmadır. Bu kapı olmadan 7 vardiya kaçıyordu: GPS 4-63 km yol
 *    gösterirken ekranda "0 km" yazıyordu (ör. DO-775GS 06.08, 62,7 km). (7 vardiya)
 *
 * Geriye kalan 11 vardiya GERÇEK 0 km: telemetri var, araç hiç kıpırdamamış.
 * Bunlara DOKUNULMAZ — "park etti" ile "ölçemedik" ayrı kalmalı.
 *
 * Sorgu YALNIZ farkı 0 olan vardiyalar için atılır. Farkı 0'dan büyük olan bir
 * vardiya zaten kendini ölçmüş demektir; sıfır olmayan hiçbir satır için ek
 * maliyet yoktur. 60 günde 39 satır, tipik bir gün panosunda 0-3 satır.
 *
 * ⚠️ HAM VERİYE DOKUNULMAZ. `time_entries.start_km/end_km` olduğu gibi kalır;
 * burada üretilen `km_measured` yalnızca TÜRETİLMİŞ bir görünüm bayrağıdır ve
 * hiçbir yere yazılmaz. Geçmiş kayıtlar SQL ile düzeltilmez (Volkan, 15.08.2026).
 */

/** kmDiff/gösterim yollarının beklediği asgari vardiya şekli. */
export type KmShiftRow = {
  vehicle_id: string | null;
  started_at: string;
  ended_at: string | null;
  start_km: number | null;
  end_km: number | null;
};

/** `km_measured` eklenmiş satır. false → fark bir ölçüm DEĞİL, "veri yok". */
export type WithKmMeasured<T> = T & { km_measured: boolean };

/**
 * Farkı 0 olan vardiyalar için "pencerede telemetri var mıydı" sorusunu sorar ve
 * her satıra `km_measured` ekler. Sıra korunur.
 *
 * km_measured=false olan satırda `kmDiff` null döner (bkz. lib/format.ts) —
 * yani NULL'ı zaten "—" olarak çizen bütün ekranlar kendiliğinden düzelir.
 *
 * Açık vardiyada (ended_at null) pencere "şimdi"de kapanır.
 */
export async function markKmMeasured<T extends KmShiftRow>(
  rows: T[],
  now: number = Date.now()
): Promise<WithKmMeasured<T>[]> {
  // Yalnız BELİRSİZ satırlar sorgulanır: iki uç da dolu ve fark tam 0.
  const supheli: number[] = [];
  rows.forEach((r, i) => {
    if (r.vehicle_id && r.start_km != null && r.end_km != null && r.end_km - r.start_km === 0) {
      supheli.push(i);
    }
  });
  if (supheli.length === 0) {
    return rows.map((r) => ({ ...r, km_measured: true }));
  }

  const sonuc = await mapBounded(supheli, async (i) => {
    const r = rows[i];
    const to = r.ended_at ?? new Date(now).toISOString();
    const [{ count: satir, error: e1 }, { count: hareket, error: e2 }] = await Promise.all([
      // ① Pencerede HİÇ telemetri var mı? Yoksa cihaz sessizdi, ölçüm yok.
      supabaseAdmin
        .from("device_telemetry")
        .select("id", { count: "exact", head: true })
        .eq("vehicle_id", r.vehicle_id!)
        .gte("recorded_at", r.started_at)
        .lte("recorded_at", to),
      // ② Araç HAREKET ETTİ Mİ? Telemetri olup araç da yol yaptıysa ama iki
      //    odometre ucu aynıysa, odometre hareketi İZLEMEMİŞ demektir — 0 yine
      //    uydurmadır. Canlıda ölçüldü (60 gün): telemetrisi tam olan 20 "0 km"
      //    vardiyanın 7'sinde GPS 4-63 km yol gösteriyordu.
      supabaseAdmin
        .from("device_telemetry")
        .select("id", { count: "exact", head: true })
        .eq("vehicle_id", r.vehicle_id!)
        .gte("speed_kmh", MOVE_SPEED_KMH)
        .gte("recorded_at", r.started_at)
        .lte("recorded_at", to),
    ]);
    // Sorgu hata verirse ÖLÇÜLDÜ saymayız: yanlış 0 göstermektense "—" göster.
    if (e1 || e2) return { i, measured: false };
    if ((satir ?? 0) === 0) return { i, measured: false }; // cihaz sessizdi
    if ((hareket ?? 0) > 0) return { i, measured: false }; // araç gitti, sayaç saymadı
    return { i, measured: true }; // telemetri var + araç hiç kıpırdamamış → gerçek 0
  });

  const bayrak = new Map(sonuc.map((s) => [s.i, s.measured]));
  return rows.map((r, i) => ({ ...r, km_measured: bayrak.get(i) ?? true }));
}

/**
 * Tek satırlık sürümü — vardiya detayı gibi tek kayıt açan yollar için.
 */
export async function isKmMeasured(row: KmShiftRow, now: number = Date.now()): Promise<boolean> {
  const [out] = await markKmMeasured([row], now);
  return out.km_measured;
}

/**
 * ÖLÇÜLEN / TOPLAM kapsaması — "0 km" ile "N vardiyanın M'si ölçülemedi" farkını
 * ekrana taşıyabilmek için. Rapor bandında ve panoda kullanılır: bir toplam,
 * içinde kaç ölçülemeyen vardiya olduğunu SÖYLEMEDEN gösterilmemeli.
 */
export type KmCoverage = {
  /** Ölçülebilen vardiyaların km toplamı. */
  km: number;
  /** Km'si ölçülen vardiya sayısı. */
  olculen: number;
  /**
   * KAPANMIŞ ama km'si ölçülemeyen vardiya sayısı. İki yoldan olur ve ikisi de
   * aynı şeyi söyler — "cihazdan veri gelmedi":
   *  • end_km hiç yazılamadı (odometre yok, GPS izi de yok) → DO-505GS deseni;
   *  • iki uç dolu ama fark bir ölçüm değil (km_measured=false).
   * Emrullah Arslan'ın 11 vardiyasının 10'u BİRİNCİ yoldan buraya düşer;
   * eskiden bunlar sessizce "açık" sayılıyor ve toplam eksik ama tam görünüyordu.
   */
  sinyalsiz: number;
  /** HÂLÂ AÇIK vardiya sayısı — henüz ölçülemez, eksiklik değil. */
  acik: number;
};

export function kmCoverage(rows: WithKmMeasured<KmShiftRow>[]): KmCoverage {
  const out: KmCoverage = { km: 0, olculen: 0, sinyalsiz: 0, acik: 0 };
  for (const r of rows) {
    if (r.ended_at === null) {
      out.acik++; // sürüyor — kapanınca ölçülecek
      continue;
    }
    if (r.start_km == null || r.end_km == null || r.km_measured === false) {
      out.sinyalsiz++;
      continue;
    }
    out.km += r.end_km - r.start_km;
    out.olculen++;
  }
  return out;
}

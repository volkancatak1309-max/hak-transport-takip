import "server-only";
import { supabaseAdmin, fetchAllRows } from "@/lib/supabase";
import { getTestScope, withoutTestRows } from "@/lib/test-data";

/**
 * OLAY ANINDAKİ ŞOFÖR — panel ve mobilin TEK ÇEKİRDEĞİ.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 NEYİN YERİNE GELDİ
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Alarm satırlarındaki şoför adı, olay anındaki sürücü DEĞİL, aracın BUGÜNKÜ
 * atanmış şoförüydü (`vehicles.driver_name` → `listVehiclesWithStatus`). İki
 * yüzey de aynı kusuru taşıyordu:
 *
 *   panel  app/admin/alarmlar/page.tsx  → vehicles[].driverName
 *   mobil  app/api/mobile/alarms        → driverByVehicle.get(vehicle_id)
 *
 * Sonuç: araç el değiştirdiğinde geçen ayın ihlali bu ay o aracı devralan
 * kişiye yazılıyordu. Mobil arşiv satırı bu yüzden şoför adını HİÇ
 * göstermiyor (`components/alarm-archive-row.tsx`: "YANLIŞ İNSANI suçlar").
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * KURAL
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Olay anında o araçta AÇIK olan vardiyanın şoförü:
 *
 *     time_entries.vehicle_id = olayın aracı
 *     started_at <= an <= coalesce(ended_at, now())
 *
 * Eşleşen vardiya yoksa **null**. Bugünkü atanmış şoföre DÜŞÜLMEZ: "bilmiyorum"
 * demek, yanlış bir isim yazmaktan iyidir. (105'teki `olculmedi` kararının
 * aynısı: uydurma sayı yerine ölçülemedi.)
 *
 * ⚠️ AÇIK VARDİYADA ÜST SINIR `now()`. `ended_at` null olan vardiya hâlâ
 * sürüyor demektir; olay şimdiden sonra olamayacağı için pratikte sınırsızdır,
 * ama gelecek zaman damgalı bozuk bir olay satırı yanlışlıkla eşleşmesin diye
 * sınır yine de uygulanıyor.
 *
 * ⚠️ ÇAKIŞAN VARDİYA: aynı araçta aynı ana denk gelen birden fazla açık kayıt
 * olabiliyor (vardiya kilidi ARAÇ ekseninde değil, ŞOFÖR ekseninde —
 * bkz. `docs/GUNDE-TEK-VARDIYA`). Böyle bir durumda EN SON BAŞLAYAN kazanır:
 * araç en son kimin eline geçtiyse odur. Seçim `cakisma` ile sayılıyor ve
 * çağıran isterse ölçebiliyor — sessiz bir tercih değil.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * NEDEN TEK SORGU + BELLEKTE ARAMA
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Alarm başına sorgu atmak 200 satırlık bir sayfada 200 sorgu demekti. Bunun
 * yerine pencereyle KESİŞEN bütün vardiyalar bir kez okunuyor, araç başına
 * başlangıca göre sıralanıyor ve her alarm için ikili arama yapılıyor.
 * Maliyet: 1 sorgu + O(n log m).
 *
 * `fetchAllRows` ile okunuyor — PostgREST'in 1000 satır tavanı bu tabloda da
 * geçerli ve "tümzaman" penceresinde aşılır (bkz. lib/supabase.ts).
 */

/** Bir olayın şoförü — kimlik, ad ve BAĞLI OLDUĞU VARDİYA. */
export type OlaySoforu = {
  workerId: string | null;
  name: string | null;
  /** Eşleşen vardiya kaydının kimliği — "hangi vardiya" sorusunun cevabı. */
  shiftId: string | null;
};

export const SOFOR_YOK: OlaySoforu = { workerId: null, name: null, shiftId: null };

type Aralik = {
  shiftId: string;
  workerId: string | null;
  bas: number;
  /** Açık vardiyada `Infinity` değil `now`: gelecek damgalı satır eşleşmesin. */
  bit: number;
};

export type OlaySoforuCozucu = {
  /** Bir olayın şoförü. Bulunamazsa `SOFOR_YOK`. */
  bul: (vehicleId: string | null | undefined, anISO: string | null | undefined) => OlaySoforu;
  /** Pencereyle kesişen vardiya sayısı — kanıt/ölçüm için. */
  vardiyaSayisi: number;
  /** Aynı araç+ana birden fazla vardiyanın denk geldiği arama sayısı. */
  cakisma: number;
};

/**
 * Pencereyle kesişen vardiyaları bir kez okur ve bir arayıcı döndürür.
 *
 * @param startISO olay penceresinin başı
 * @param endISO   olay penceresinin sonu
 */
export async function olaySoforuCozucu(
  startISO: string,
  endISO: string
): Promise<OlaySoforuCozucu> {
  const scope = await getTestScope();

  /**
   * KESİŞİM KOŞULU: vardiya pencereden ÖNCE başlamış olabilir (dün açılan,
   * bugün kapanan) — `started_at >= startISO` yazmak o vardiyanın ilk
   * saatlerindeki alarmları sahipsiz bırakırdı.
   *
   *   started_at <= endISO  AND  (ended_at is null OR ended_at >= startISO)
   *
   * test-filtered: withoutTestRows — test hesabının vardiyası ekrana bir İSİM
   * olarak çıkmamalı. Bugünkü davranış da bu: alarm adları `listVehiclesWithStatus`
   * üzerinden geliyordu ve o liste `dropTestRows`tan geçiyor.
   */
  type Vardiya = {
    id: string;
    worker_id: string | null;
    vehicle_id: string | null;
    started_at: string;
    ended_at: string | null;
  };
  const { data: rows } = await fetchAllRows<Vardiya>((from, to) =>
    withoutTestRows(
      supabaseAdmin
        .from("time_entries")
        .select("id, worker_id, vehicle_id, started_at, ended_at")
        .not("vehicle_id", "is", null)
        .lte("started_at", endISO)
        .or(`ended_at.is.null,ended_at.gte.${startISO}`)
        .order("started_at", { ascending: true })
        .order("id"),
      "worker_id",
      scope.workerIds
    ).range(from, to)
  );

  // İSİM SÖZLÜĞÜ — yalnız eşleşen şoförler için, tek sorgu.
  const workerIds = [...new Set(rows.map((r) => r.worker_id).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  if (workerIds.length > 0) {
    const { data } = await supabaseAdmin
      .from("workers")
      .select("id, name")
      .in("id", workerIds);
    for (const w of (data ?? []) as { id: string; name: string | null }[]) {
      if (w.name) names.set(w.id, w.name);
    }
  }

  const simdi = Date.now();
  const perVehicle = new Map<string, Aralik[]>();
  for (const r of rows) {
    if (!r.vehicle_id) continue;
    const bas = new Date(r.started_at).getTime();
    if (Number.isNaN(bas)) continue;
    const bitHam = r.ended_at ? new Date(r.ended_at).getTime() : simdi;
    const bit = Number.isNaN(bitHam) ? simdi : bitHam;
    const liste = perVehicle.get(r.vehicle_id) ?? [];
    liste.push({ shiftId: r.id, workerId: r.worker_id, bas, bit });
    perVehicle.set(r.vehicle_id, liste);
  }
  for (const liste of perVehicle.values()) liste.sort((a, b) => a.bas - b.bas);

  let cakisma = 0;

  const bul = (
    vehicleId: string | null | undefined,
    anISO: string | null | undefined
  ): OlaySoforu => {
    if (!vehicleId || !anISO) return SOFOR_YOK;
    const an = new Date(anISO).getTime();
    if (Number.isNaN(an)) return SOFOR_YOK;
    const liste = perVehicle.get(vehicleId);
    if (!liste || liste.length === 0) return SOFOR_YOK;

    /**
     * `bas <= an` olan SON kaydı bul (ikili arama). Sonra geriye doğru yürüyüp
     * `an <= bit` olanı seç: sıralama başlangıca göre, bitişler iç içe olabilir.
     * Geriye yürüme kapsayan aralık bulunur bulunmaz durur — tarama değil.
     */
    let lo = 0;
    let hi = liste.length - 1;
    let idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (liste[mid].bas <= an) {
        idx = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (idx < 0) return SOFOR_YOK;

    let bulunan: Aralik | null = null;
    for (let i = idx; i >= 0; i--) {
      if (an <= liste[i].bit) {
        // EN SON BAŞLAYAN KAZANIR: `i` başlangıca göre sıralı, geriye doğru
        // gidiyoruz; ilk kapsayan zaten en geç başlayandır.
        if (bulunan === null) bulunan = liste[i];
        else break;
        // Daha erken başlayıp hâlâ kapsayan bir kayıt VARSA bu bir çakışmadır.
        for (let j = i - 1; j >= 0; j--) {
          if (an <= liste[j].bit) {
            cakisma++;
            break;
          }
        }
        break;
      }
    }
    if (!bulunan) return SOFOR_YOK;

    return {
      workerId: bulunan.workerId,
      name: bulunan.workerId ? (names.get(bulunan.workerId) ?? null) : null,
      shiftId: bulunan.shiftId,
    };
  };

  return { bul, vardiyaSayisi: rows.length, cakisma };
}

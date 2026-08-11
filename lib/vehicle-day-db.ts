import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { listVehicleTrack, type TelemetryRow } from "@/lib/telemetry";
import { mapBounded, retryOnTimeout } from "@/lib/db-fanout";
import { gunPenceresi, sonGunler, type GunOzeti } from "@/lib/vehicle-day";

/**
 * ARAÇ × GÜN ekseninin SORGU katmanı — U1-U5'in ortak okumaları.
 *
 * lib/vehicle-day.ts saf kısmı tutar (muhafız orayı Node'da çalıştırabilsin
 * diye); burada `server-only` ve `supabaseAdmin` yaşar. Bölünme keyfî değil:
 * saf tarafa tek bir DB satırı sızsa muhafız betiği çalışamaz olurdu.
 */

export type AracOzeti = { id: string; plaka: string | null };

/** Araç var mı — beş ucun da 404 kapısı. Anahtarlı, tek satırlık sorgu. */
export async function aracOzeti(id: string): Promise<AracOzeti | null> {
  const { data } = await supabaseAdmin
    .from("vehicles")
    .select("id, plate")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const v = data as { id: string; plate: string | null };
  return { id: v.id, plaka: v.plate ?? null };
}

/**
 * Bir kiracı gününün TAM izi (U2/U4/U5 aynı seriyi paylaşır).
 *
 * Pencere kiracı gününün KESİN sınırlarıdır. `lib/route-history.ts` aynı işi
 * "±1 gün UTC parantezi + viennaDayKey süzgeci" ile yapıyor; sonuç kümesi
 * birebir aynı, ama orada üç günün satırları çekilip ikisi atılıyor. Burada
 * pencere sorguya girdiği için (vehicle_id, recorded_at) indeksi tam olarak
 * istenen aralığı tarar.
 */
export async function gunIzi(
  vehicleId: string,
  gun: string
): Promise<{ pencere: { baslangic: string; bitis: string }; track: TelemetryRow[] } | null> {
  const pencere = gunPenceresi(gun);
  if (!pencere) return null;
  const track = await listVehicleTrack(vehicleId, pencere.baslangic, pencere.bitis);
  return { pencere, track };
}

export type VeriGunleri = {
  /**
   * Bakılan takvim günleri, yeniden eskiye. Yanıttaki pencere BURADAN yazılır:
   * uç ikinci kez `sonGunler()` çağırsaydı iki `new Date()` gece yarısını
   * ayrı taraflardan görebilir ve gövde kendi listesiyle çelişebilirdi.
   */
  adaylar: string[];
  gunler: GunOzeti[];
  /** Sorgusu düşen günler — SESSİZ EKSİK YASAK, listede adıyla durur. */
  olculemeyen: { tarih: string; sebep: "zaman_asimi" | "hata" }[];
};

/**
 * Son `n` kiracı gününde VERİ OLAN günler (U1).
 *
 * ── NEDEN ARAÇ BAZLI, NEDEN GÜN GÜN ────────────────────────────────────────
 * Keşif belgesinin 5b maddesi ölçtü: `device_telemetry` üzerinde FİLO GENELİ
 * gün sayımı 1,07 M satırda statement timeout (57014) veriyor. Tek aracın tek
 * günü ise anahtarlı bir aralık taramasıdır — `(vehicle_id, recorded_at)`
 * indeksi tam olarak bunu servis eder.
 *
 * Gün başına İKİ sorgu: `count` + en erken satır (artan, limit 1), sonra en geç
 * satır (azalan, limit 1). İkincisi yalnız o günde satır VARSA atılır. Alternatif
 * — 14 günün tüm `recorded_at`larını çekip bellekte gruplamak — yoğun bir araçta
 * ~30 bin satır ve 30 sayfa demekti; sayım aynı işi tabloya hiç çıkmadan yapıyor.
 *
 * Eşzamanlılık `mapBounded` ile 6: statement timeout duvar saatine değil TEK
 * İFADEYE uygulanır, 28 sorguyu birden salmak her birinin kendi süresini uzatır
 * (lib/db-fanout.ts ölçümü).
 */
export async function veriGunleri(vehicleId: string, n: number): Promise<VeriGunleri> {
  const adaylar = sonGunler(n);

  const satirlar = await mapBounded(adaylar, async (gun) => {
    const p = gunPenceresi(gun);
    if (!p) return { tarih: gun, hata: "hata" as const, nokta: 0, ilk: null, son: null };

    const ilkRes = await retryOnTimeout(() =>
      supabaseAdmin
        .from("device_telemetry")
        .select("recorded_at", { count: "exact" })
        .eq("vehicle_id", vehicleId)
        .gte("recorded_at", p.baslangic)
        .lte("recorded_at", p.bitis)
        .order("recorded_at", { ascending: true })
        .limit(1)
    );
    if (ilkRes.error) {
      const sebep = (ilkRes.error.code ?? "") === "57014" ? ("zaman_asimi" as const) : ("hata" as const);
      return { tarih: gun, hata: sebep, nokta: 0, ilk: null, son: null };
    }
    const nokta = ilkRes.count ?? 0;
    if (nokta === 0) return { tarih: gun, hata: null, nokta: 0, ilk: null, son: null };

    const sonRes = await retryOnTimeout(() =>
      supabaseAdmin
        .from("device_telemetry")
        .select("recorded_at")
        .eq("vehicle_id", vehicleId)
        .gte("recorded_at", p.baslangic)
        .lte("recorded_at", p.bitis)
        .order("recorded_at", { ascending: false })
        .limit(1)
    );
    const ilk = ((ilkRes.data ?? []) as { recorded_at: string }[])[0]?.recorded_at ?? null;
    if (sonRes.error) {
      const sebep = (sonRes.error.code ?? "") === "57014" ? ("zaman_asimi" as const) : ("hata" as const);
      return { tarih: gun, hata: sebep, nokta, ilk, son: null };
    }
    const son = ((sonRes.data ?? []) as { recorded_at: string }[])[0]?.recorded_at ?? null;
    return { tarih: gun, hata: null, nokta, ilk, son };
  });

  return {
    adaylar,
    // Noktası sıfır olan gün listeye GİRMEZ — "veri olan gün" tanımı bu.
    gunler: satirlar
      .filter((r) => r.hata === null && r.nokta > 0)
      .map((r) => ({ tarih: r.tarih, nokta: r.nokta, ilk: r.ilk, son: r.son })),
    olculemeyen: satirlar
      .filter((r) => r.hata !== null)
      .map((r) => ({ tarih: r.tarih, sebep: r.hata as "zaman_asimi" | "hata" })),
  };
}

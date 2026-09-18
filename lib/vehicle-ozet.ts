import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { loadScoreShifts, type ScoreShift } from "@/lib/score-core";
import { okuRolanti } from "@/lib/report-reads";
import { idleEpisodeDurationMs } from "@/lib/analytics";
import { IDLE_FUEL_L_PER_HOUR } from "@/lib/analytics-shared";
import type { DateRange } from "@/lib/analytics-shared";
import { FUEL_PRICE_EUR_PER_L } from "@/lib/tenant";
import { aracYakitLitresi, type YakitSebep } from "@/lib/fuel-vehicle";
import { kaynakSay } from "@/lib/km-axis";
import type { KmKaynak } from "@/lib/km-ui";

/**
 * ARAÇ × DÖNEM ÖZETİ — /api/mobile/vehicles/[id]/ozet veri katmanı.
 *
 * ═══ TEK KM, TEK RÖLANTİ, TEK LİTRE ════════════════════════════════════════
 *
 * Bu dosya HİÇBİR metriği kendi icat etmez. Üçünün de kaynağı ekranın başka
 * yerinde zaten kullanılan çekirdektir:
 *
 *   km      → `lib/km-axis.ts` (cihaz → sayaç → null), vardiya satırları
 *             `lib/score-core.ts`ten. Sürücü puanının paydası ile AYNI satırlar,
 *             AYNI karar; farkı yalnız toplama ekseni (şoför değil ARAÇ).
 *   rölanti → `idle_episodes` epizotları + `idleEpisodeDurationMs`. Analiz
 *             sayfasının Rölanti İsrafı panosuyla AYNI süre tanımı (tetik
 *             süresi dahil) ve AYNI katsayı.
 *   litre   → `lib/fuel-vehicle.ts` (araç-filtreli `report_fuel_stats_*`),
 *             Yakıt raporunun `consumedLiters`'ıyla aynı hesap.
 *
 * ⚠️ İZ EKSENİ BURADA YOK. Günlük "GPS km" ve "motor süresi" cihaz izinden
 * (`computeDistanceKm` / `computeEngineHours`) türüyordu; ikisi de bu özete
 * GİRMEZ. Sebebi ölçülmüş bir kusur: aynı araç için iz km'si ile çekirdek
 * km'si farklı çıkıyor ve ekranda iki sayı yan yana duruyordu (18.09.2026).
 *
 * ═══ "ÖLÇÜLEMEDİ ≠ 0" ══════════════════════════════════════════════════════
 * `/metrikler` ucundaki desenin aynısı: her metrik ya bir SAYI ya da null +
 * SEBEP döner. "0 km" ile "km ölçülemedi" aynı piksel, iki ayrı gerçektir.
 */

/** Km'nin hangi eksenden geldiği — karışık küme de dürüstçe söylenir. */
export type KmKaynakOzet = "cihaz" | "sayac" | "karisik" | null;

export type OzetSebep =
  | null
  /** Dönemde bu araçta hiç vardiya yok — atfedilecek sürüş de yok. */
  | "vardiya_yok"
  /** Vardiya var ama çekirdek hiçbirinde km ölçemedi. */
  | "olculmedi";

export type AracDonemOzeti = {
  /** Çekirdeğin ölçebildiği vardiyaların km toplamı; null = ölçülemedi. */
  km: number | null;
  kmKaynak: KmKaynakOzet;
  vardiyaSayisi: number;
  paket: {
    /** Şoförün gün içinde girdiği alınan paket. null = hiç girilmemiş. */
    alinan: number | null;
    /** Teslim edilen — yalnız KAPANMIŞ vardiyada gerçektir (panoyla aynı kural). */
    teslim: number | null;
  };
  rolanti: {
    ms: number;
    epizod: number;
    litre: number;
    euro: number;
  };
  yakit: {
    litre: number | null;
    euro: number | null;
    l100: {
      deger: number | null;
      /**
       * true → sayı "≈" ile gösterilmeli. Kapı DEĞİL: değer yine üretilir.
       * İki sebepten biri: payda 100 km'nin altında ya da dönem 7 günden kısa
       * (tam sayı yüzde sensörüyle kısa pencerede oran gürültülüdür).
       */
      yaklasik: boolean;
      sebep: L100Sebep;
    };
  };
  sebepler: {
    km: OzetSebep;
    yakit: YakitSebep;
    l100: L100Sebep;
  };
  /** Ölçülen / toplam vardiya — km toplamının ne kadarının eksik olduğu. */
  kapsama: { olculen: number; toplam: number };
};

/** L/100 km neden yok — "0 L/100km" ile karıştırılmaz. */
export type L100Sebep = null | "km_yok" | "yakit_olculmedi";

/** Payda bu değerin altındaysa oran "≈" ile gösterilir (kapı değil, etiket). */
export const L100_YAKLASIK_KM = 100;
/** Dönem bu gün sayısından kısaysa oran "≈" ile gösterilir. */
export const L100_YAKLASIK_GUN = 7;

function kmKaynakOzeti(shifts: ScoreShift[]): KmKaynakOzet {
  const say = kaynakSay(shifts, new Map(shifts.map((e) => [e.id, e.km_karar])));
  const olcenler: KmKaynak[] = (["cihaz", "sayac"] as const).filter((k) => say[k] > 0);
  if (olcenler.length === 0) return null;
  if (olcenler.length > 1) return "karisik";
  return olcenler[0] === "cihaz" ? "cihaz" : "sayac";
}

/**
 * Aracın dönem özeti. Tek çağrı; içindeki dört okumanın üçü tur içinde
 * paylaşılır (`loadScoreShifts` ve `okuRolanti` memolu — lib/report-reads.ts).
 */
export async function aracDonemOzeti(
  vehicleId: string,
  range: DateRange
): Promise<AracDonemOzeti> {
  const startISO = range.start.toISOString();
  const endISO = range.end.toISOString();

  // test-visible: araç kimliğine ANAHTARLI tek satır; liste okuması değil.
  const { data: aracRow } = await supabaseAdmin
    .from("vehicles")
    .select("id, tank_capacity_l")
    .eq("id", vehicleId)
    .maybeSingle();
  const depoLitre =
    (aracRow as { tank_capacity_l?: number | null } | null)?.tank_capacity_l ?? null;

  /**
   * ÜÇ OKUMA YAN YANA ve ÜÇÜ DE ARAÇ KAPSAMLI.
   *
   * Ölçüldü (HAK61, "ay", soğuk): filo geneli okumalarla 1.545 + 856 + 976 ms
   * → duvar saati ~2,0 sn. Araç kapsamıyla aynı boru hattı (aynı eleme, aynı
   * km kararı, aynı süre tanımı) çok daha küçük kümede koşuyor.
   */
  const [shifts, epizotlar, yakit] = await Promise.all([
    loadScoreShifts(range, vehicleId),
    okuRolanti(startISO, endISO, vehicleId),
    aracYakitLitresi(vehicleId, depoLitre == null ? null : Number(depoLitre), startISO, endISO),
  ]);
  let km = 0;
  let olculen = 0;
  let alinan: number | null = null;
  let teslim: number | null = null;
  for (const e of shifts) {
    const d = e.km_karar.km;
    if (d !== null) {
      km += d;
      olculen++;
    }
    if (e.start_package_count !== null && e.start_package_count !== undefined) {
      alinan = (alinan ?? 0) + e.start_package_count;
    }
    // Teslim edilen yalnız KAPANMIŞ vardiyada gerçektir (açık vardiyada
    // cargo_count hâlâ gün başı yer tutucusu) — panoyla ve Performans
    // raporuyla aynı kural.
    if (e.ended_at !== null && e.cargo_count !== null) {
      teslim = (teslim ?? 0) + e.cargo_count;
    }
  }
  const kmSebep: OzetSebep =
    shifts.length === 0 ? "vardiya_yok" : olculen === 0 ? "olculmedi" : null;
  const kmDeger = olculen > 0 ? km : null;

  // ── RÖLANTİ — EPİZOT EKSENİ ───────────────────────────────────────────────
  // Rölanti İsrafı panosuyla AYNI epizot kümesi, AYNI süre tanımı, AYNI
  // katsayı. Fark yalnız toplama ekseni: orada şoför, burada araç.
  let rolantiMs = 0;
  let epizod = 0;
  for (const ep of epizotlar) {
    // Okuma zaten araç kapsamlı; kapı savunmacı (kapsamsız çağrı gelirse de
    // sayı doğru kalsın).
    if (ep.vehicle_id !== vehicleId) continue;
    rolantiMs += idleEpisodeDurationMs(ep);
    epizod++;
  }
  const rolantiLitre = (rolantiMs / 3_600_000) * IDLE_FUEL_L_PER_HOUR;

  // ── YAKIT ─────────────────────────────────────────────────────────────────
  const gunSayisi = Math.max(
    1,
    Math.round((range.end.getTime() - range.start.getTime()) / 86_400_000)
  );
  /**
   * L/100 km HER DÖNEMDE ÜRETİLİR (Volkan kararı, 18.09.2026).
   *
   * Yakıt raporundaki `l100Available` kapısı (aralık < 7 gün → kolon HİÇ
   * çıkmaz) burada UYGULANMAZ: o kapı bir FİLO SIRALAMASI içindi; sıralama
   * gürültülü bir oranla yapılırsa yanlış araç "en çok yakan" olur. Burada
   * sıralama yok, tek aracın kendi sayısı var. Gürültü gizlenmiyor,
   * ETİKETLENİYOR: `yaklasik` true ise ekran "≈" basar.
   */
  const l100Sebep: L100Sebep =
    yakit.litre === null ? "yakit_olculmedi" : kmDeger === null || kmDeger === 0 ? "km_yok" : null;
  const l100 =
    l100Sebep === null ? ((yakit.litre as number) / (kmDeger as number)) * 100 : null;

  return {
    km: kmDeger,
    kmKaynak: kmKaynakOzeti(shifts),
    vardiyaSayisi: shifts.length,
    paket: { alinan, teslim },
    rolanti: {
      ms: rolantiMs,
      epizod,
      litre: rolantiLitre,
      // Fiyat SUNUCUDA çarpılır; env istemci paketine hiç girmez (03.08 dersi).
      euro: rolantiLitre * FUEL_PRICE_EUR_PER_L,
    },
    yakit: {
      litre: yakit.litre,
      euro: yakit.litre === null ? null : yakit.litre * FUEL_PRICE_EUR_PER_L,
      l100: {
        deger: l100,
        yaklasik:
          l100 !== null &&
          ((kmDeger as number) < L100_YAKLASIK_KM || gunSayisi < L100_YAKLASIK_GUN),
        sebep: l100Sebep,
      },
    },
    sebepler: { km: kmSebep, yakit: yakit.sebep, l100: l100Sebep },
    kapsama: { olculen, toplam: shifts.length },
  };
}

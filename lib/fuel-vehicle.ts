import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { isTimeoutError } from "@/lib/db-fanout";
import { fuelConsumedPct, pctToLiters } from "@/lib/fuel-math";
import { YAKIT_OZET_ENABLED } from "@/lib/tenant";

/**
 * ARAÇ-FİLTRELİ YAKIT OKUMASI — TEK KAYNAK (18.09.2026).
 *
 * ═══ NEDEN AYRI DOSYA ══════════════════════════════════════════════════════
 *
 * `buildFuelReport` bu RPC'yi filo genelinde `mapBounded(6)` ile çağırıyor ve
 * çağrının kendisi (hangi sürüm · hangi argümanlar · geri düşüş · zaman aşımı
 * tekrarı) o fan-out'un içine gömülüydü. Araç detayının dönem özeti AYNI
 * sayıyı istiyor ama TEK araç için; gömülü hâlde tek yol vardı: ya raporun
 * tamamını (29 aracı) hesaplatmak ya da çağrıyı KOPYALAMAK.
 *
 * İkisi de yanlıştı. Kopya, ilk sürüm değişikliğinde iki ekranda iki farklı
 * litre demektir; raporun tamamı ise tek araç için 29 katı iş.
 *
 * ═══ SÜRÜM SEÇİMİ VE GERİ DÜŞÜŞ — DEĞİŞMEDİ ════════════════════════════════
 *
 * `report_fuel_stats_vehicle_v2` (101) ön-etiketli yol; yoksa
 * `report_fuel_stats_vehicle` (050). Litre hattında 103/094 ikizi.
 * Geri düşüş TAM: yarısı yeni yarısı eski bir sonuç üretilmez.
 *
 * ⚠️ TEKRAR AYNI SÜRÜMLE. Zaman aşımı YÜKE bağlıdır, veriye değil; tekrar
 * turunda rakip yok. Ama tekrar başka bir sürümle yapılırsa tek araç sessizce
 * başka bir yoldan hesaplanır — o yüzden sürüm çağrı boyunca sabit.
 */

/** `report_fuel_stats*` satırı — yüzde hattı. */
export type FuelStatRow = {
  vehicle_id: string;
  sample_count: number;
  avg_pct: number | null;
  min_pct: number | null;
  max_pct: number | null;
  first_pct: number | null;
  last_pct: number | null;
  refill_count: number;
  refill_pct: number;
  drop_count: number;
  drop_pct: number;
  /**
   * ARIZALI SENSÖR SAYIMI — aralıktaki HAM `fuel_level_pct = 0` okuma sayısı.
   * ⚠️ OPSİYONEL: yalnız migration 107 uygulanmış kiracıda gelir.
   */
  zero_count?: number | null;
};

/** `report_fuel_volume_stats*` satırı (039/094/103) — litre cinsinden. */
export type FuelVolumeStatRow = {
  vehicle_id: string;
  sample_count: number;
  avg_l: number | null;
  min_l: number | null;
  max_l: number | null;
  first_l: number | null;
  last_l: number | null;
  refill_count: number;
  refill_l: number;
  drop_count: number;
  drop_l: number;
  /** Ardışık iki okuma arasındaki en büyük MUTLAK sıçrama (gürültü muhafızı). */
  max_step_l: number;
};

export const YUZDE_RPC_V2 = "report_fuel_stats_vehicle_v2";
export const YUZDE_RPC_V1 = "report_fuel_stats_vehicle";
export const LITRE_RPC_V2 = "report_fuel_volume_stats_vehicle_v2";
export const LITRE_RPC_V1 = "report_fuel_volume_stats_vehicle";

/** Kiracının bugünkü yüzde RPC'si — `YAKIT_OZET_ENABLED` bayrağına göre. */
export function yuzdeRpcAdi(): string {
  return YAKIT_OZET_ENABLED ? YUZDE_RPC_V2 : YUZDE_RPC_V1;
}

/** Kiracının bugünkü litre RPC'si. */
export function litreRpcAdi(): string {
  return YAKIT_OZET_ENABLED ? LITRE_RPC_V2 : LITRE_RPC_V1;
}

/**
 * TEK ARAÇ, TEK ÇAĞRI — argüman şekli burada, başka yerde değil.
 *
 * `buildFuelReport`in fan-out'u da, araç özeti de bunu çağırır. Argüman adları
 * (`p_from` / `p_to` / `p_vehicle_id`) iki yerde yazılı olsaydı bir gün biri
 * migration'la değişir, öteki sessizce `missing_function` alırdı.
 */
export function aracRpcCagir(rpc: string, vehicleId: string, startISO: string, endISO: string) {
  return supabaseAdmin.rpc(rpc, {
    p_from: startISO,
    p_to: endISO,
    p_vehicle_id: vehicleId,
  });
}

/**
 * Gürültü muhafızı — sıçraması eşiği aşan litre serisi hiç kabul edilmez.
 * Ölçüm (canlı, 3 gün): temiz araçlarda en büyük adım 0,1–1,0 L; çöp seride
 * 30–79 L. 5 L bu iki kümenin arasındaki geniş boşlukta durur.
 */
export const FUEL_VOLUME_MAX_STEP_L = 5;

/**
 * "Sensör yarı ölü" eşiği: HAM okumaların bu oranından fazlası %0 ise seriden
 * hesaplanan tüketim anlamsızdır (sıfır serisinin bitişi "dolum" gibi görünür).
 * Canlı örnek DO-687GX: 7.801 okumanın 1.729'u (%22) sıfır.
 */
export const UNRELIABLE_ZERO_RATIO = 0.1;

type OkumaSonucu<T> = {
  satir: T | null;
  /** null = başarılı. `missing_function` geri düşüşten SONRA da sürüyorsa gelir. */
  hata: "missing_function" | "timeout" | "error" | null;
};

function hataTuru(e: { code?: string | null; message?: string | null }) {
  const code = (e.code ?? "").toUpperCase();
  const msg = (e.message ?? "").toLowerCase();
  if (code === "PGRST202" || code === "42883" || msg.includes("could not find the function")) {
    return "missing_function" as const;
  }
  if (isTimeoutError(e)) return "timeout" as const;
  return "error" as const;
}

/**
 * Tek aracın yüzde/litre istatistiği — sürüm geri düşüşü + BİR zaman aşımı
 * tekrarı dahil. Rapor fan-out'u kendi orkestrasyonunu koruduğu için bu
 * fonksiyonu YALNIZ tek-araç yolları kullanır; fan-out `aracRpcCagir`ı
 * doğrudan çağırır (aynı argüman şekli, tek kaynak).
 */
async function okuTekArac<T>(
  v2: string,
  v1: string,
  vehicleId: string,
  startISO: string,
  endISO: string
): Promise<OkumaSonucu<T>> {
  const ilkRpc = YAKIT_OZET_ENABLED ? v2 : v1;
  let cevap = await aracRpcCagir(ilkRpc, vehicleId, startISO, endISO);
  let kullanilan = ilkRpc;

  if (cevap.error && hataTuru(cevap.error) === "missing_function" && ilkRpc !== v1) {
    // Bu kiracıda 101/103 çalışmamış — KOMPLE eski yola dön.
    kullanilan = v1;
    cevap = await aracRpcCagir(v1, vehicleId, startISO, endISO);
  }
  if (cevap.error && isTimeoutError(cevap.error)) {
    // Tekrar AYNI sürümle ve tek başına: ilk turda ifadeyi tavana iten şey
    // rekabetti (bkz. lib/db-fanout.ts ölçümü).
    cevap = await aracRpcCagir(kullanilan, vehicleId, startISO, endISO);
  }
  if (cevap.error) return { satir: null, hata: hataTuru(cevap.error) };
  const satirlar = (cevap.data ?? []) as T[];
  return { satir: satirlar[0] ?? null, hata: null };
}

/** Yakıt litresinin NEDEN yok olduğu — "0 litre" ile karıştırılmaz. */
export type YakitSebep =
  | null
  | "olculmedi"
  | "depo_bilinmiyor"
  | "arizali_sensor"
  | "rpc_yok"
  | "hesaplanamadi";

export type AracYakit = {
  /** Dönemde yakılan yakıt (litre). null = ölçülemedi, 0 DEĞİL. */
  litre: number | null;
  sebep: YakitSebep;
  /** Hangi hat ölçtü: yüzde sensörü mü, doğrudan litre mi. */
  kaynak: "yuzde" | "hacim" | null;
  /** De-glitch sonrası örnek sayısı — 0 ise aralıkta hiç yakıt okuması yok. */
  ornekSayisi: number;
};

/**
 * BİR ARACIN DÖNEM YAKITI — `buildFuelReport`in `consumedLiters`'ıyla AYNI
 * hesap, aynı sırayla.
 *
 *   1. YÜZDE hattı (026/050/101): `fuelConsumedPct(ilk, son, dolum)` →
 *      `pctToLiters(..., depoHacmi)`. Depo hacmi girilmemişse litre YOK.
 *   2. Yüzde okuması hiç yoksa LİTRE hattı (039/094/103): cihaz zaten litre
 *      gönderiyor, depo hacmine ihtiyaç yok.
 *   3. Hiçbiri yoksa null + `olculmedi`.
 *
 * ⚠️ ARIZALI SENSÖR LİTREYİ GİZLER. `buildFuelReport` satırı litreyi
 * hesaplamaya devam eder ama ekranda göstermez (`dataUnreliable`). Burada
 * gizleme KARARI veriye iliştiriliyor: `litre = null`, `sebep =
 * "arizali_sensor"`. İki yüzey aynı aracı farklı gösteremez — rapor onu zaten
 * göstermiyordu.
 */
export async function aracYakitLitresi(
  vehicleId: string,
  tankCapacityL: number | null,
  startISO: string,
  endISO: string
): Promise<AracYakit> {
  /**
   * ⚠️ SIFIR SAYIMI RPC İLE YAN YANA (18.09.2026, ölçümle).
   *
   * `zero_count` yalnız migration 107 uygulanmış kiracıda RPC yanıtıyla gelir.
   * ÖLÇÜLDÜ: üç kiracının HİÇBİRİNDE 107 yok (HAK61 ve demo'da `zero_count`
   * alanı gelmiyor), yani sayım her çağrıda gerekiyordu ve RPC'den SONRA
   * ardışık koşuyordu. Yan yana başlatmak bir gidiş-gelişi gizler.
   *
   * 107 uygulandığı gün satırdaki değer kazanır ve bu sorgu gereksiz bir
   * `head:true` sayımına düşer — o zaman koşullu hâle getirilmeli.
   */
  const sifirSayimi = (async () => {
    // test-visible: tek araç kimliğine ANAHTARLI sayım; liste okuması değil.
    const { count } = await supabaseAdmin
      .from("device_telemetry")
      .select("id", { count: "exact", head: true })
      .eq("vehicle_id", vehicleId)
      .eq("fuel_level_pct", 0)
      .gte("recorded_at", startISO)
      .lte("recorded_at", endISO);
    return count ?? 0;
  })();

  const yuzde = await okuTekArac<FuelStatRow>(
    YUZDE_RPC_V2,
    YUZDE_RPC_V1,
    vehicleId,
    startISO,
    endISO
  );
  // Sayım beklenmese bile reddi yutulmalı — aksi hâlde unhandled rejection.
  void sifirSayimi.catch(() => 0);

  if (yuzde.hata === "missing_function") {
    return { litre: null, sebep: "rpc_yok", kaynak: null, ornekSayisi: 0 };
  }
  if (yuzde.hata) {
    return { litre: null, sebep: "hesaplanamadi", kaynak: null, ornekSayisi: 0 };
  }

  const s = yuzde.satir;
  const ornek = s ? Number(s.sample_count) : 0;

  if (s && ornek > 0) {
    // ARIZALI SENSÖR — ham sıfır oranı. 107 varsa satırdan gelir; yoksa tek
    // sayım sorgusu (tek araç için ucuz; raporda 19 sorgu olduğu için pahalıydı).
    // 107 varsa satırdaki değer KAZANIR; yoksa yan yana başlatılan sayım.
    const zeroCount = s.zero_count ?? (await sifirSayimi);
    const zeroRatio = Math.min(1, Number(zeroCount) / Math.max(1, ornek));
    if (zeroRatio > UNRELIABLE_ZERO_RATIO) {
      return { litre: null, sebep: "arizali_sensor", kaynak: "yuzde", ornekSayisi: ornek };
    }
    if (tankCapacityL == null) {
      return { litre: null, sebep: "depo_bilinmiyor", kaynak: "yuzde", ornekSayisi: ornek };
    }
    const first = s.first_pct != null ? Number(s.first_pct) : 0;
    const last = s.last_pct != null ? Number(s.last_pct) : 0;
    const refillPct = Number(s.refill_pct) || 0;
    const consumedPct = fuelConsumedPct(first, last, refillPct);
    const litre = pctToLiters(consumedPct, tankCapacityL);
    return { litre, sebep: null, kaynak: "yuzde", ornekSayisi: ornek };
  }

  // ── LİTRE HATTI — yüzde okuması YOKSA devreye girer (yerine değil) ────────
  const hacim = await okuTekArac<FuelVolumeStatRow>(
    LITRE_RPC_V2,
    LITRE_RPC_V1,
    vehicleId,
    startISO,
    endISO
  );
  if (hacim.hata || !hacim.satir) {
    return { litre: null, sebep: "olculmedi", kaynak: null, ornekSayisi: 0 };
  }
  const h = hacim.satir;
  const hOrnek = Number(h.sample_count) || 0;
  // Gürültü muhafızı — rapordaki kapının aynısı.
  if (hOrnek === 0 || Number(h.max_step_l) > FUEL_VOLUME_MAX_STEP_L) {
    return { litre: null, sebep: "olculmedi", kaynak: null, ornekSayisi: hOrnek };
  }
  const ilk = h.first_l != null ? Number(h.first_l) : 0;
  const son = h.last_l != null ? Number(h.last_l) : 0;
  const dolum = Number(h.refill_l) || 0;
  return {
    litre: Math.max(0, dolum + (ilk - son)),
    sebep: null,
    kaynak: "hacim",
    ornekSayisi: hOrnek,
  };
}

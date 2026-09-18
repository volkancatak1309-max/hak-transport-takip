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

/**
 * YAKIT SAYISININ NEDEN YOK OLDUĞU — "0 litre" ile karıştırılmaz.
 *
 * ⚠️ PARAMETRELİ (18.09.2026). Kod tek başına ekrana yazılamaz: "kapsama
 * düşük" cümlesi yöneticiye iş vermiyor, "cihaz yakıt seviyesini vardiyanın
 * %1'inde gönderiyor" veriyor. Sayı sebebin İÇİNDE taşınır ki istemci
 * kendi eşiğini uydurmak ya da ikinci bir sorgu atmak zorunda kalmasın.
 */
export type YakitSebep =
  | null
  /** Aralıkta hiç yakıt okuması yok (ne yüzde ne litre hattı). */
  | { kod: "olculmedi" }
  /** Depo hacmi girilmemiş → yüzde litreye çevrilemiyor. */
  | { kod: "depo_yok" }
  /** Sensör yarı ölü: ham okumaların `yuzde`'si %0. */
  | { kod: "arizali_sensor"; yuzde: number }
  /** Vardiya içi telemetrinin yalnız `yuzde`'sinde yakıt seviyesi var. */
  | { kod: "kapsama_dusuk"; yuzde: number }
  /** Hesaplanan L/100 km makul aralığın dışında (`deger`). */
  | { kod: "l100_aralik_disi"; deger: number }
  /** Payda yok: mesafe ölçülemedi ya da 0 — oran denetlenemiyor. */
  | { kod: "km_yok" }
  | { kod: "rpc_yok" }
  | { kod: "hesaplanamadi" };

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
    return { litre: null, sebep: { kod: "rpc_yok" }, kaynak: null, ornekSayisi: 0 };
  }
  if (yuzde.hata) {
    return { litre: null, sebep: { kod: "hesaplanamadi" }, kaynak: null, ornekSayisi: 0 };
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
      return {
        litre: null,
        sebep: { kod: "arizali_sensor", yuzde: Math.round(zeroRatio * 100) },
        kaynak: "yuzde",
        ornekSayisi: ornek,
      };
    }
    if (tankCapacityL == null) {
      return { litre: null, sebep: { kod: "depo_yok" }, kaynak: "yuzde", ornekSayisi: ornek };
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
    return { litre: null, sebep: { kod: "olculmedi" }, kaynak: null, ornekSayisi: 0 };
  }
  const h = hacim.satir;
  const hOrnek = Number(h.sample_count) || 0;
  // Gürültü muhafızı — rapordaki kapının aynısı.
  if (hOrnek === 0 || Number(h.max_step_l) > FUEL_VOLUME_MAX_STEP_L) {
    return { litre: null, sebep: { kod: "olculmedi" }, kaynak: null, ornekSayisi: hOrnek };
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

// ── GÜVENİLİRLİK KAPISI — TEK KURAL, DÖRT YÜZEY ─────────────────────────────

/**
 * Vardiya içi yakıt okuma kapsaması eşiği.
 *
 * ÖLÇÜLDÜ (HAK61 + galzura-demo, 30 gün, 18.09.2026): kapsama iki kümede
 * toplanıyor — ya %90-99 ya %0-8. Aradaki bant BOŞ. Yani eşik nerede durursa
 * dursun aynı araçları eliyor; %80 iki kümenin ortasındaki geniş boşlukta.
 *
 * Neden gerekli: litre, aralığın İLK ve SON yakıt okumasından türüyor. Cihaz
 * vardiyanın %1'inde konuşuyorsa o iki uç nereye denk geldiğine bağlı, yani
 * sayı ölçüm değil TESADÜF. Canlı örnek DO-512GT: aynı araç, aynı sensör —
 * hafta penceresinde 2,6 L/100 km, ay penceresinde 6,1. İkisi de "ölçüm"
 * değildi; 66 bin telemetri satırının yalnız 3.493'ünde yakıt vardı.
 */
export const YAKIT_MIN_KAPSAMA = 0.8;

/**
 * Makul L/100 km aralığı — dışı GÖSTERİLMEZ.
 *
 * Alt sınır 4: HAK61 filosunun en tasarruflu ölçülen aracı 6,1 (ve o bile
 * kapsama kapısına takılıyor); temiz sensörlü araçlar 8,4-22,0 bandında.
 * 4 L/100 km bir dizel minibüs için fiziksel olarak mümkün değil — o sayı
 * "dolum sayılmadı" demektir.
 *
 * Üst sınır 60: aynı filoda ölçülen en yüksek makul değer 22,0. 60'ın üstü
 * yalnız iki şekilde çıkıyor — sensör salınımı dolum sanılıyor (DO-672GY
 * 1.049 L/100 km: 30 günde 2.129 "dolum", saniyeler içinde %72→%100
 * sıçramaları) ya da payda eksik (DO-671GY: 30 günde 1 vardiya açılmış,
 * çekirdek 64 km, odometre 701 km).
 *
 * ⚠️ BU BİR KALİBRASYON DEĞİL, MAKULLÜK ÇİTASI. Aralığı daraltmak "kötü
 * yakan aracı gizle" demek olurdu; 4-60 fiziksel olarak mümkün olanın
 * tamamını içeriyor ve yalnız ARIZAYI eliyor.
 */
export const YAKIT_L100_MIN = 4;
export const YAKIT_L100_MAX = 60;

export type YakitOlcumu = {
  /** Dönemde yakılan yakıt; kapıyı geçemediyse null. */
  litre: number | null;
  /** litre × kiracı yakıt fiyatı; litre null ise null. */
  euro: number | null;
  /** L/100 km; kapıyı geçemediyse null. */
  l100: number | null;
  /** Vardiya içi yakıt okuma oranı (0–1); ölçülemediyse null. */
  kapsama: number | null;
  /** null = sayı güvenilir. Dolu ise NEDEN gösterilmediği, parametresiyle. */
  sebep: YakitSebep;
  /** Kapıyı geçti mi — `sebep === null` ile aynı şey, okunaklı hâli. */
  guvenilir: boolean;
};

/**
 * ═══ GÜVENİLİRLİK KAPISI — SAF FONKSİYON, TEK KURAL ════════════════════════
 *
 * Yakıt sayısı ancak ÜÇ ŞART birden sağlanırsa gösterilir:
 *   (a) vardiya içi yakıt okuma kapsaması ≥ %80
 *   (b) 4 ≤ L/100 km ≤ 60
 *   (c) depo hacmi dolu (yüzde hattında; litre hattı hacme ihtiyaç duymaz)
 * Aksi hâlde litre · € · L/100 ÜÇÜ BİRDEN null olur ve SEBEP döner.
 *
 * ⚠️ ÜÇÜ BİRDEN NEDEN: litreyi gösterip oranı gizlemek denetlenmemiş bir
 * sayıyı ekranda bırakır. Canlı kanıt DO-672GY — 13.367 L, kapsama %92, depo
 * dolu; yalnız (a) ve (c) uygulansaydı bu sayı geçerdi ve tek başına Bordo
 * filosunun litresinin %98,8'ini üretmeye devam ederdi. Oranı denetleyemediğin
 * litreyi göstermek, yanlış sayıyı toplama sokmaktır.
 *
 * ⚠️ HANGİ km: ÇAĞIRANIN EKRANDA GÖSTERDİĞİ km. Yakıt raporu odometre
 * eksenini gösterir, araç özeti çekirdek eksenini. Kapı her yüzeyde O
 * YÜZEYİN paydasını denetler — başka bir sayıya bakıp gizleseydik ekranda
 * görünmeyen bir gerekçeyle sayı saklamış olurduk. Aynı aracın iki yüzeyde
 * farklı kapı sonucu alması BİLİNÇLİ ve açıklanabilir: iki yüzey farklı
 * mesafe ölçüyor.
 *
 * SAF: ağ yok, saat yok. Muhafız ve canlı ölçüm betiği bu fonksiyonu çağırır,
 * kuralın kopyasını yazmaz.
 */
export function yakitKapisi(girdi: {
  /** Ölçüm katmanının ham litresi (aracYakitLitresi). */
  hamLitre: number | null;
  /** Ölçüm katmanının sebebi — doluysa kapı onu AYNEN geçirir. */
  hamSebep: YakitSebep;
  /** Çağıranın EKRANDA gösterdiği mesafe. */
  km: number | null;
  /** Vardiya içi yakıt okuma oranı (0–1); bilinmiyorsa null. */
  kapsama: number | null;
  /** Litre başına kiracı fiyatı. */
  eurPerL: number;
}): YakitOlcumu {
  const bos = (sebep: YakitSebep): YakitOlcumu => ({
    litre: null,
    euro: null,
    l100: null,
    kapsama: girdi.kapsama,
    sebep,
    guvenilir: false,
  });

  // ① Ölçüm katmanı zaten bir sebep söylediyse (olculmedi · depo_yok ·
  //    arizali_sensor · rpc_yok) kapı ONU geçirir; üstüne ikinci sebep
  //    uydurmak, asıl arızayı gizlemek olurdu.
  if (girdi.hamSebep !== null) return bos(girdi.hamSebep);
  if (girdi.hamLitre === null) return bos({ kod: "olculmedi" });

  // ② KAPSAMA. Ölçülemediyse (pencere yok) kapı ISIRMAZ — "bilmiyoruz" ile
  //    "düşük" farklı şeyler; bilmediğimiz için sayı saklamayız.
  if (girdi.kapsama !== null && girdi.kapsama < YAKIT_MIN_KAPSAMA) {
    return bos({ kod: "kapsama_dusuk", yuzde: Math.round(girdi.kapsama * 100) });
  }

  // ③ PAYDA. Oran denetlenemiyorsa litre de gösterilmez (üstteki not).
  if (girdi.km === null || girdi.km <= 0) return bos({ kod: "km_yok" });

  // ④ MAKUL ARALIK.
  const l100 = (girdi.hamLitre / girdi.km) * 100;
  if (l100 < YAKIT_L100_MIN || l100 > YAKIT_L100_MAX) {
    return bos({ kod: "l100_aralik_disi", deger: Math.round(l100 * 10) / 10 });
  }

  return {
    litre: girdi.hamLitre,
    euro: girdi.hamLitre * girdi.eurPerL,
    l100,
    kapsama: girdi.kapsama,
    sebep: null,
    guvenilir: true,
  };
}

/**
 * VARDİYA İÇİ YAKIT OKUMA KAPSAMASI — araç başına TEK SORGU ÇİFTİ.
 *
 * "Cihaz, şoför direksiyondayken yakıt seviyesini ne sıklıkla gönderdi."
 * Payda vardiya pencerelerindeki TÜM telemetri satırı, pay `fuel_level_pct`
 * dolu olanlar.
 *
 * ⚠️ NEDEN VARDİYA BAŞINA SORGU DEĞİL: 29 araç × ~15 vardiya = ~870 sayım
 * sorgusu ederdi. Pencereler tek bir `.or(...)` aralık listesine katlanıyor;
 * ölçüldü (HAK61, 26 vardiyalı araç): filtre 2,4 KB, çift sorgu 437 ms.
 *
 * Vardiyası olmayan araçta null döner — kapsama YOK demektir, "düşük" değil
 * (bkz. `yakitKapisi` ② numaralı not).
 */
export async function aracYakitKapsamasi(
  vehicleId: string,
  pencereler: { baslangic: string; bitis: string }[]
): Promise<number | null> {
  if (pencereler.length === 0) return null;
  const aralik = pencereler
    .map((p) => `and(recorded_at.gte.${p.baslangic},recorded_at.lte.${p.bitis})`)
    .join(",");
  const [{ count: tel }, { count: yakitli }] = await Promise.all([
    // test-visible: araç kimliğine ANAHTARLI sayım; liste okuması değil.
    supabaseAdmin
      .from("device_telemetry")
      .select("id", { count: "exact", head: true })
      .eq("vehicle_id", vehicleId)
      .or(aralik),
    supabaseAdmin
      .from("device_telemetry")
      .select("id", { count: "exact", head: true })
      .eq("vehicle_id", vehicleId)
      .not("fuel_level_pct", "is", null)
      .or(aralik),
  ]);
  if (!tel || tel === 0) return null;
  return Math.min(1, (yakitli ?? 0) / tel);
}

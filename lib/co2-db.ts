import "server-only";
import { kume, topla, oranOlcekli } from "@/lib/oran-kume";

import { supabaseAdmin } from "@/lib/supabase";
import { buildFuelReport } from "@/lib/reports";
import { getTestScope, withoutTestRows } from "@/lib/test-data";
import { seferKmOlc } from "@/lib/karlilik-db";
import { mapBounded } from "@/lib/db-fanout";
import {
  CO2_KATSAYI_SURUM,
  co2Hesapla,
  gPerKm,
  hedefDurumu,
  type CO2AracSatiri,
  type CO2Esas,
  type CO2MusteriSatiri,
  type CO2SoforSatiri,
  type CO2Toplam,
} from "@/lib/co2";
import type { FuelType } from "@/lib/types";

/**
 * CO₂ PANOSU — VERİ KATMANI (migration 089).
 *
 * ═══ GİRDİ: TELEMETRİ LİTRESİ, `fuel_entries` DEĞİL ═══
 *
 * ÖLÇÜLDÜ (HAK61, 25.08.2026): `fuel_entries` 1 satır, ONAYLI **0** — bugünkü
 * CO₂ raporu 0 kg basardı. Telemetri ise 30 günde **2.584,7 L** ölçüyor
 * (29 araçtan 23'ü). CO₂ artık `buildFuelReport`ten besleniyor.
 *
 * ⚠️ Bu dosya hiçbir tabloya YAZMAZ. Yakıt raporu, skor motoru ve maliyet
 * motoru salt okunur.
 */

const TABLO_YOK = new Set(["PGRST205", "42P01", "42703"]);
const tabloYokMu = (e: { code?: string; message?: string } | null) =>
  !!e && (TABLO_YOK.has(e.code ?? "") || /schema cache|does not exist/i.test(e.message ?? ""));

// ═══════════════════════════ KİRACI AYARI ════════════════════════════════

export type CO2Ayari = {
  esas: CO2Esas;
  sebekeGkWh: number | null;
  sebekeKaynak: string | null;
  sebekeYil: number | null;
  hedefGKm: number | null;
  hedefYil: number | null;
  tabloYok: boolean;
};

export const VARSAYILAN_CO2_AYARI: CO2Ayari = {
  esas: "TTW",
  sebekeGkWh: null,
  sebekeKaynak: null,
  sebekeYil: null,
  hedefGKm: null,
  hedefYil: null,
  tabloYok: true,
};

export async function co2Ayari(): Promise<CO2Ayari> {
  const { data, error } = await supabaseAdmin
    .from("tenant_co2")
    .select("esas, sebeke_g_kwh, sebeke_kaynak, sebeke_yil, hedef_g_km, hedef_yil")
    .eq("id", "singleton")
    .maybeSingle();
  if (error || !data) return { ...VARSAYILAN_CO2_AYARI, tabloYok: tabloYokMu(error) };
  const r = data as Record<string, unknown>;
  const say = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    esas: (r.esas === "WTW" ? "WTW" : "TTW") as CO2Esas,
    sebekeGkWh: say(r.sebeke_g_kwh),
    sebekeKaynak: r.sebeke_kaynak ? String(r.sebeke_kaynak) : null,
    sebekeYil: say(r.sebeke_yil),
    hedefGKm: say(r.hedef_g_km),
    hedefYil: say(r.hedef_yil),
    tabloYok: false,
  };
}

export async function co2AyariYaz(
  girdi: {
    esas: CO2Esas;
    sebekeGkWh: number | null;
    sebekeKaynak: string | null;
    sebekeYil: number | null;
    hedefGKm: number | null;
    hedefYil: number | null;
  },
  workerId: string | null
): Promise<{ ok: boolean; hata?: string }> {
  const { error } = await supabaseAdmin
    .from("tenant_co2")
    .update({
      esas: girdi.esas,
      sebeke_g_kwh: girdi.sebekeGkWh,
      sebeke_kaynak: girdi.sebekeKaynak,
      sebeke_yil: girdi.sebekeYil,
      hedef_g_km: girdi.hedefGKm,
      hedef_yil: girdi.hedefYil,
      updated_at: new Date().toISOString(),
      updated_by: workerId,
    })
    .eq("id", "singleton");
  if (error) return { ok: false, hata: tabloYokMu(error) ? "tablo_yok" : "hata" };
  return { ok: true };
}

// ═══════════════════════════ PANO ════════════════════════════════════════

export type CO2Panosu = {
  tabloYok: boolean;
  ayar: CO2Ayari;
  bas: string;
  bit: string;
  toplam: CO2Toplam;
  araclar: CO2AracSatiri[];
  soforler: CO2SoforSatiri[];
  musteriler: CO2MusteriSatiri[];
  /**
   * Aylık seri — trend.
   *
   * `kaynak` (S4, 28.08.2026) — `kg: null`'ın İKİ ayrı anlamını ayırır:
   *   'tablo'         → `vehicle_month_metrics`ten okundu (kapanmış ay)
   *   'canli'         → o an hesaplandı (açık ay, ya da tabloda satır yoktu)
   *   'hesaplanmadi'  → 🔴 SATIR YOK ve canlı hesap da yapılmadı.
   *                     `kg: null` burada "ölçülemedi" DEĞİL, "bilinmiyor"dur.
   * Ekran ikisini AYNI göstermemeli: "ölçülemedi" bir ölçüm yargısıdır,
   * "hesaplanmadı" bir eksikliktir. (Uydurma sayı yasağının aynı kökü.)
   */
  aylik: {
    ay: string;
    kg: number | null;
    km: number | null;
    gKm: number | null;
    kaynak: "tablo" | "canli" | "hesaplanmadi";
  }[];
  hedef: ReturnType<typeof hedefDurumu>;
  katsayiSurum: string;
  /** Yakıt raporu hiç çalışmadıysa sebebi. */
  yakitYok: string | null;
};

async function aracYakitTurleri(): Promise<{ harita: Map<string, FuelType>; kolonYok: boolean }> {
  // test-visible: yalnız YAKIT TÜRÜ SÖZLÜĞÜ — hiçbir sayıyı toplama sokmaz.
  // Panonun araç kümesi `buildFuelReport`ten geliyor ve test aracı ORADA
  // eleniyor (QA'da ölçüldü: vehicles'ta TEST-001 var, panoda 4 araç). Bu
  // harita yalnız o kümedeki id'ler için okunuyor; süzmek tek bir kg'ı bile
  // değiştirmez, yalnız gereksiz bir sorgu daha eklerdi.
  const { data, error } = await supabaseAdmin.from("vehicles").select("id, fuel_type");
  if (error) {
    /**
     * 089 UYGULANMAMIŞSA HEPSİ DİZEL — kolon yokken bugünkü davranış buydu.
     * Sessizce çökmek yerine eski davranışa düşüyoruz ve `kolonYok` ile
     * ekranda söylüyoruz: "araç yakıt türü girilemiyor (089)".
     */
    return { harita: new Map(), kolonYok: tabloYokMu(error) };
  }
  return {
    harita: new Map(
      ((data ?? []) as { id: string; fuel_type: string | null }[]).map((v) => [
        v.id,
        (v.fuel_type ?? "diesel") as FuelType,
      ])
    ),
    kolonYok: false,
  };
}

/**
 * CO₂ PANOSU.
 *
 * Litre `buildFuelReport`ten (telemetri), km aynı rapordan. Her araç kendi
 * yakıt türünün katsayısıyla çarpılır; ölçülemeyen araç `null` döner ve
 * plakası `olculemeyenPlakalar`da görünür — sessiz eksik YASAK.
 */
/**
 * HANGİ PARÇA HESAPLANSIN — Ö2, kısmi sonuç (31.08.2026).
 *
 * ═══ NEDEN ═══════════════════════════════════════════════════════════════
 * Pano iki PAHALI ve BİRBİRİNDEN BAĞIMSIZ iş yapıyor (HAK61 canlı, ölçüldü):
 *
 *   gövde  → `buildFuelReport(seçilen pencere)`   8,78 sn · 199 sorgu
 *   aylık  → `aylikSeri` (son 6 ay)               8,85 sn · 199 sorgu
 *
 * Ekranın ilk göstereceği sayı yalnız GÖVDEYE bağlı; aylık seri trend
 * grafiğinin verisi. Bugün ikisi tek yanıtta bekletiliyor, yani kullanıcı
 * hazır olan sayıyı 8,85 sn fazladan bekliyor.
 *
 * 🔴 İkisi BİRLEŞTİRİLEMEZ — denendi ve ölçümle çürütüldü: pencereler
 * örtüşmüyor (`range=ay` kayan 30 gün, aylık seri UTC takvim ayı) ve
 * `consumedLiters` pencere-bağımlı olduğu için biri diğerinden türetilemez.
 * Ayrıntı: `docs/CO2-SURE.md` § 4. Geriye kalan tek kaldıraç BEKLEYİŞİ
 * BÖLMEK — bu tip onu sağlıyor.
 *
 * ⚠️ `aylik: false` iken `CO2Panosu.aylik` **boş dizi** döner. Boş dizi
 * "veri yok" DEĞİL, "bu çağrıda istenmedi" demektir; ayrımı yüzeye çıkarmak
 * ÇAĞIRANIN işidir (uç bunu `bolum` alanıyla söylüyor). Sessiz eksik yasağı
 * burada da geçerli: `aylik: []`'i "trend boş" diye çizen bir ekran yanlış
 * yapar.
 */
export type CO2Parca = {
  /** Seçilen pencerenin raporu: `toplam`, `araclar`, `soforler`, `musteriler`. */
  govde: boolean;
  /** Son 6 ayın serisi. Yalnız `bit` + ayar + yakıt türlerine bağlı. */
  aylik: boolean;
};

/** Bugünkü davranış — ikisi de. Mevcut çağıranların hiçbiri değişmedi. */
export async function co2Panosu(bas: Date, bit: Date): Promise<CO2Panosu> {
  return panoHesapla(bas, bit, { govde: true, aylik: true });
}

/** Yalnız gövde — ekranın ilk göstereceği sayı. Aylık seri hesaplanmaz. */
export async function co2PanosuOzet(bas: Date, bit: Date): Promise<CO2Panosu> {
  return panoHesapla(bas, bit, { govde: true, aylik: false });
}

/**
 * Yalnız aylık seri. `bas` OKUNMAZ — seri `bit`in ayından geriye 6 ay.
 * İmzada durmasının tek sebebi diğer ikisiyle aynı çağrı şeklini korumak.
 */
export async function co2PanosuAylik(bas: Date, bit: Date): Promise<CO2Panosu> {
  return panoHesapla(bas, bit, { govde: false, aylik: true });
}

async function panoHesapla(bas: Date, bit: Date, parca: CO2Parca): Promise<CO2Panosu> {
  const ayar = await co2Ayari();
  const { harita: turler, kolonYok } = await aracYakitTurleri();

  const bosToplam: CO2Toplam = {
    litre: null,
    km: null,
    kg: null,
    gKm: null,
    olculenArac: 0,
    toplamArac: 0,
    olculemeyenPlakalar: [],
    kgArac: 0,
    kmArac: 0,
    oranArac: 0,
    oranDisiPlakalar: [],
  };

  /**
   * Yalnız aylık seri isteniyor: seçilen pencerenin raporu HİÇ çalışmaz.
   * `yakitYok` burada null — o yargı raporun kendi cevabıdır, rapor
   * çağrılmadıysa "yakıt yok" demeye hakkımız da yok.
   */
  if (!parca.govde) {
    return {
      tabloYok: ayar.tabloYok || kolonYok,
      ayar,
      bas: bas.toISOString(),
      bit: bit.toISOString(),
      toplam: bosToplam,
      araclar: [],
      soforler: [],
      musteriler: [],
      aylik: parca.aylik ? await aylikSeri(bit, ayar, turler) : [],
      hedef: null,
      katsayiSurum: CO2_KATSAYI_SURUM,
      yakitYok: null,
    };
  }

  const rapor = await buildFuelReport({ start: bas, end: bit });

  if (!rapor.available) {
    return {
      tabloYok: ayar.tabloYok,
      ayar,
      bas: bas.toISOString(),
      bit: bit.toISOString(),
      toplam: bosToplam,
      araclar: [],
      soforler: [],
      musteriler: [],
      aylik: [],
      hedef: null,
      katsayiSurum: CO2_KATSAYI_SURUM,
      yakitYok: rapor.unavailableReason ?? "bilinmiyor",
    };
  }

  const araclar: CO2AracSatiri[] = (rapor.rows ?? []).map((r) => {
    const fuelType = turler.get(r.vehicleId) ?? "diesel";
    const sonuc = co2Hesapla({
      litre: r.consumedLiters,
      fuelType,
      esas: ayar.esas,
      sebekeGkWh: ayar.sebekeGkWh,
      // Elektrikli araçta kWh ölçümü YOK: yakıt raporu litre/yüzde ekseninde
      // çalışıyor. Bu yüzden WTW'de elektrikli araç `kwh_yok` döner — 0 değil.
      kWh: null,
    });
    return {
      vehicleId: r.vehicleId,
      plate: r.plate,
      fuelType,
      litre: r.consumedLiters,
      km: r.km,
      kg: sonuc.kg,
      gKm: gPerKm(sonuc.kg, r.km),
      sebep: sonuc.kg === null ? sonuc.sebep : r.km === null ? "km_yok" : null,
      katsayi: sonuc.katsayi,
    };
  });

  /**
   * 🔴 ORAN KÜMESİ KURALI — üç ayrı küme, tek oran.
   *
   * Her toplam kendi kümesinden; oran YALNIZ iki değerin de ölçüldüğü
   * kümeden. Kümeler o anki veriden türer: araç eklenince, bir araç bakıma
   * girince ya da cihazı susunca kendiliğinden değişir. Hiçbir yere sabit
   * sayı yazılmaz.
   *
   * ⚠️ Eski hâli `kg`'yi `kg !== null` kümesinden, `km`'yi AYNI listeden
   * `a.km ?? 0` ile alıyordu: km'si olmayan araç paya kg ekliyor, paydaya
   * 0 ekliyordu. HAK61 2026-07'de ölçüldü — 286,3 yerine 268,3 g/km,
   * **%6,7 şişik**. Ayrıntı: `docs/ORAN-KUME-KURALI.md`.
   */
  const kgK = kume("kg", araclar.filter((a) => a.kg !== null));
  const kmK = kume("km", araclar.filter((a) => a.km !== null));
  const litreK = kume("litre", araclar.filter((a) => a.litre !== null));
  /** ORAN KÜMESİ: pay ve payda buradan, başka hiçbir yerden. */
  const oranK = kume(
    "kg+km",
    araclar.filter((a) => a.kg !== null && a.km !== null)
  );

  const toplamKg = topla(kgK, (a) => a.kg);
  const toplamKm = topla(kmK, (a) => a.km);
  const toplamLitre = topla(litreK, (a) => a.litre);

  const toplam: CO2Toplam = {
    litre: toplamLitre,
    km: toplamKm,
    kg: toplamKg,
    /**
     * Pay ve payda AYNI kümeden — `toplamKg`/`toplamKm` DEĞİL.
     * `oranOlcekli` iki ucun ETİKETİNİN aynı olmasını derleme anında şart
     * koşuyor: `topla(kgK, …)` buraya geçmez, kod derlenmez
     * (`lib/oran-kume.ts`).
     */
    gKm: oranOlcekli(topla(oranK, (a) => a.kg), topla(oranK, (a) => a.km), 1000),
    olculenArac: kgK.ogeler.length,
    toplamArac: araclar.length,
    /**
     * SESSİZ EKSİK YASAK: ölçülemeyen araçların PLAKASI dışarı çıkar.
     * "23/29 araç" demek yetmez — hangi 6 araç olduğu görünmeli.
     */
    olculemeyenPlakalar: araclar.filter((a) => a.kg === null).map((a) => a.plate),
    kgArac: kgK.ogeler.length,
    kmArac: kmK.ogeler.length,
    oranArac: oranK.ogeler.length,
    /** kg'si var ama orana giremeyen araçlar — km'si ölçülemediği için. */
    oranDisiPlakalar: kgK.ogeler.filter((a) => a.km === null).map((a) => a.plate),
  };

  const soforler = await soforKirilimi(araclar, bas, bit);
  const musteriler = await musteriKirilimi(araclar, bas, bit);
  const aylik = parca.aylik ? await aylikSeri(bit, ayar, turler) : [];

  return {
    tabloYok: ayar.tabloYok || kolonYok,
    ayar,
    bas: bas.toISOString(),
    bit: bit.toISOString(),
    toplam,
    araclar: araclar.sort((a, b) => (b.kg ?? -1) - (a.kg ?? -1)),
    soforler,
    musteriler,
    aylik,
    hedef: hedefDurumu(toplam.gKm, ayar.hedefGKm),
    katsayiSurum: CO2_KATSAYI_SURUM,
    yakitYok: null,
  };
}

/**
 * ŞOFÖR KIRILIMI.
 *
 * Şoförün CO₂'si, sürdüğü ARAÇLARIN yoğunluğu × kendi ölçülen km'si.
 * Aracın toplam CO₂'sini şoförlere bölmek yerine yoğunluk kullanılıyor:
 * bölme, aynı aracı süren iki şoförden km'si ölçülemeyene de pay verirdi.
 *
 * ⚠️ ŞOFÖR TOPLAMI FİLO TOPLAMINA BİREBİR EŞİT OLMAYABİLİR — İKİ FARKLI
 * KM KAYNAĞI. Filo km'si aracın ODOMETRE AÇIKLIĞINDAN (aralığın ilk ve son
 * okuması), şoför km'si VARDİYA sayaç farklarından geliyor. QA'da ölçüldü:
 * 3.980 km (odometre) vs 4.000 km (vardiya) → %0,5 fark; kaynak, aralığın
 * son adımının odometre açıklığına girmemesi.
 *
 * Kaynakları birleştirmiyoruz çünkü ikisi de doğru: biri aracın gerçekten
 * kat ettiği yol, diğeri şoförün vardiyada kat ettiği yol — araç vardiya
 * dışında da hareket edebilir. Dışarıya verilen BEYAN filo ve müşteri
 * satırıdır; şoför kırılımı iç kullanım içindir ve ekran bunu söyler.
 */
async function soforKirilimi(
  araclar: CO2AracSatiri[],
  bas: Date,
  bit: Date
): Promise<CO2SoforSatiri[]> {
  const scope = await getTestScope();
  const { data } = await withoutTestRows(
    supabaseAdmin
      .from("time_entries")
      .select("worker_id, vehicle_id, start_km, end_km")
      .gte("started_at", bas.toISOString())
      .lte("started_at", bit.toISOString())
      .limit(3000),
    "worker_id",
    scope.workerIds
  );

  const yogunluk = new Map(araclar.filter((a) => a.gKm !== null).map((a) => [a.vehicleId, a.gKm!]));

  const kova = new Map<string, { km: number; kg: number; olculemeyenKm: number }>();
  for (const ham of (data ?? []) as {
    worker_id: string | null;
    vehicle_id: string | null;
    start_km: number | null;
    end_km: number | null;
  }[]) {
    if (!ham.worker_id) continue;
    const acc = kova.get(ham.worker_id) ?? { km: 0, kg: 0, olculemeyenKm: 0 };
    const km =
      ham.start_km !== null && ham.end_km !== null && ham.end_km > ham.start_km
        ? ham.end_km - ham.start_km
        : null;
    const g = ham.vehicle_id ? yogunluk.get(ham.vehicle_id) : undefined;
    if (km === null || g === undefined) {
      // Ölçülemeyen vardiya toplama GİRMEZ ama sayılır — kapsama dürüstlüğü.
      if (km !== null) acc.olculemeyenKm += km;
    } else {
      acc.km += km;
      acc.kg += (km * g) / 1000;
    }
    kova.set(ham.worker_id, acc);
  }

  const ids = [...kova.keys()];
  if (ids.length === 0) return [];
  const { data: wData } = await supabaseAdmin.from("workers").select("id, name").in("id", ids);
  const adlar = new Map(((wData ?? []) as { id: string; name: string }[]).map((w) => [w.id, w.name]));

  return [...kova.entries()]
    .map(([workerId, a]) => ({
      workerId,
      ad: adlar.get(workerId) ?? "—",
      km: a.km > 0 ? a.km : null,
      kg: a.km > 0 ? a.kg : null,
      gKm: a.km > 0 ? (a.kg * 1000) / a.km : null,
      olculemeyenKm: a.olculemeyenKm,
    }))
    .sort((a, b) => (b.kg ?? -1) - (a.kg ?? -1));
}

/**
 * MÜŞTERİ KIRILIMI — İHALE FORMATI (085 sefer/müşteri ekseni).
 *
 * ⚠️ BU BİR PAYLAŞTIRMA DEĞİL, ÖLÇÜMDÜR:
 *   seferin CO₂'si = SEFERİN ÖLÇÜLEN KM'Sİ × ARACIN ÖLÇÜLEN yoğunluğu
 *
 * Sefer km'si odometre penceresinden ölçülüyor (085) ve aracın g/km'si
 * telemetri litresinden. İkisi de ölçüm; çarpımları da öyle. Km'si
 * ölçülemeyen sefer toplama GİRMEZ ve ayrıca sayılır.
 */
async function musteriKirilimi(
  araclar: CO2AracSatiri[],
  bas: Date,
  bit: Date
): Promise<CO2MusteriSatiri[]> {
  const { data, error } = await supabaseAdmin
    .from("seferler")
    .select("id, musteri_id, vehicle_id, yolda_at, tamamlandi_at")
    .eq("durum", "tamamlandi")
    .gte("tarih", bas.toISOString().slice(0, 10))
    .lte("tarih", bit.toISOString().slice(0, 10))
    .limit(1000);
  if (error) return [];

  const seferler = (data ?? []) as {
    id: string;
    musteri_id: string | null;
    vehicle_id: string | null;
    yolda_at: string | null;
    tamamlandi_at: string | null;
  }[];
  if (seferler.length === 0) return [];

  const yogunluk = new Map(araclar.filter((a) => a.gKm !== null).map((a) => [a.vehicleId, a.gKm!]));

  const olculenler = await mapBounded(seferler, async (s) => {
    const km = await seferKmOlc(s.vehicle_id, s.yolda_at, s.tamamlandi_at);
    const g = s.vehicle_id ? yogunluk.get(s.vehicle_id) : undefined;
    return { s, km: km.km, g: g ?? null };
  });

  const kova = new Map<string, { km: number; kg: number; sefer: number; olculemeyen: number }>();
  for (const { s, km, g } of olculenler) {
    const anahtar = s.musteri_id ?? "";
    const acc = kova.get(anahtar) ?? { km: 0, kg: 0, sefer: 0, olculemeyen: 0 };
    acc.sefer++;
    if (km === null || g === null) acc.olculemeyen++;
    else {
      acc.km += km;
      acc.kg += (km * g) / 1000;
    }
    kova.set(anahtar, acc);
  }

  const ids = [...kova.keys()].filter(Boolean);
  const adlar = new Map<string, string>();
  if (ids.length > 0) {
    const { data: mData } = await supabaseAdmin.from("musteriler").select("id, ad").in("id", ids);
    for (const m of (mData ?? []) as { id: string; ad: string }[]) adlar.set(m.id, m.ad);
  }

  return [...kova.entries()]
    .map(([id, a]) => ({
      musteriId: id || null,
      ad: id ? (adlar.get(id) ?? "—") : "— müşteri atanmadı",
      seferSayisi: a.sefer,
      km: a.km > 0 ? a.km : null,
      kg: a.km > 0 ? a.kg : null,
      gKm: a.km > 0 ? (a.kg * 1000) / a.km : null,
      olculemeyenSefer: a.olculemeyen,
    }))
    .sort((a, b) => (b.kg ?? -1) - (a.kg ?? -1));
}

/** Son 6 ayın CO₂ serisi — trend. */
async function aylikSeri(
  bit: Date,
  ayar: CO2Ayari,
  turler: Map<string, FuelType>
): Promise<CO2Panosu["aylik"]> {
  const cikti: CO2Panosu["aylik"] = [];

  /**
   * ═══ S4 (28.08.2026) — KAPANMIŞ AYLAR HAZIR TABLODAN ═══════════════════
   *
   * Eskiden bu döngü altı ayı da `buildFuelReport` ile SIRAYLA hesaplıyordu.
   * ÖLÇÜLDÜ (HAK61 canlı): **1.112 sorgu / 23,58 sn** — ve altı ayın DÖRDÜ
   * tamamen BOŞTU (telemetri 13.07.2026'da başlıyor), yani 712 sorgu ve
   * ~8,95 sn sıfır bilgi için harcanıyordu. Ayrıntı: `docs/AYLIK-METRIK.md`.
   *
   * `vehicle_month_metrics` (090) bu iş için kurulmuştu ama yazanı yalnız
   * silme-hazırlığı ekranıydı, o yüzden tablo boştu. Artık gece cron'u
   * dolduruyor (`/api/cron/aylik-metrik`).
   *
   * 🔑 AY SINIRI AYNI: `ayOzetiYaz` → `aySiniri()` → `Date.UTC(y, m-1, 1)`;
   * buradaki pencere de `Date.UTC(...)`. İkisi de UTC, birebir aynı pencere —
   * yani tablodan okumak canlı hesapla AYNI sayıyı verir (kontrol edildi).
   *
   * ⚠️ AÇIK AY ASLA TABLODAN OKUNMAZ. İçinde bulunulan ay her gün değişir;
   * gece yazılmış satır sabaha bayat olur. O ay HER ZAMAN canlı hesaplanır.
   *
   * ⚠️ GERİ DÜŞÜŞ: kapanmış bir ayın satırı yoksa (cron kurulmamış / yeni
   * kiracı) o ay CANLI hesaplanır — davranış eskisiyle birebir aynı, yalnız
   * kazanç gerçekleşmez. Tablo hiç yoksa (090 koşmamış) hepsi canlıya düşer.
   */
  const aylar: { ay: string; bas: Date; bit: Date; acik: boolean }[] = [];
  for (let i = 5; i >= 0; i--) {
    const ayBas = new Date(Date.UTC(bit.getUTCFullYear(), bit.getUTCMonth() - i, 1));
    const ayBit = new Date(Date.UTC(bit.getUTCFullYear(), bit.getUTCMonth() - i + 1, 1));
    aylar.push({ ay: ayBas.toISOString().slice(0, 7), bas: ayBas, bit: ayBit, acik: i === 0 });
  }

  /** Kapanmış ayların hazır satırları — TEK sorgu, araç sayısından bağımsız. */
  const hazir = new Map<string, { litre: number | null; km: number | null; sebep: string | null }[]>();
  const kapali = aylar.filter((a) => !a.acik).map((a) => `${a.ay}-01`);
  if (kapali.length > 0) {
    const { data, error } = await supabaseAdmin
      .from("vehicle_month_metrics")
      .select("ay, litre, km, olculemedi_sebep, vehicle_id")
      .in("ay", kapali);
    if (!error) {
      for (const r of (data ?? []) as Record<string, unknown>[]) {
        const anahtar = String(r.ay).slice(0, 7);
        const liste = hazir.get(anahtar) ?? [];
        liste.push({
          litre: r.litre === null || r.litre === undefined ? null : Number(r.litre),
          km: r.km === null || r.km === undefined ? null : Number(r.km),
          sebep: r.olculemedi_sebep ? String(r.olculemedi_sebep) : null,
          // vehicle_id yakıt türü haritası için gerekli
          ...({ vid: String(r.vehicle_id) } as object),
        } as { litre: number | null; km: number | null; sebep: string | null });
        hazir.set(anahtar, liste);
      }
    }
    // error hâlinde `hazir` boş kalır → hepsi canlı yola düşer (geri düşüş).
  }

  /** Bir satır kümesinden ay toplamını üretir — tablo ve canlı yol ORTAK. */
  const topla = (
    satirlar: { litre: number | null; km: number | null; sebep: string | null; vid: string }[]
  ) => {
    let kg = 0;
    let km = 0;
    let varMi = false;
    for (const s of satirlar) {
      if (s.sebep !== null) continue; // ölçülemedi — SIFIR DEĞİL, atlanır
      const h = co2Hesapla({
        litre: s.litre,
        fuelType: turler.get(s.vid) ?? "diesel",
        esas: ayar.esas,
        sebekeGkWh: ayar.sebekeGkWh,
        kWh: null,
      });
      if (h.kg === null || s.km === null) continue;
      kg += h.kg;
      km += s.km;
      varMi = true;
    }
    return varMi
      ? { kg, km, gKm: gPerKm(kg, km) }
      : { kg: null, km: null, gKm: null };
  };

  for (const a of aylar) {
    const hazirSatir = a.acik ? undefined : (hazir.get(a.ay) as
      | { litre: number | null; km: number | null; sebep: string | null; vid: string }[]
      | undefined);

    if (hazirSatir && hazirSatir.length > 0) {
      cikti.push({ ay: a.ay, ...topla(hazirSatir), kaynak: "tablo" });
      continue;
    }

    // Açık ay, ya da kapanmış ama satırı olmayan ay → CANLI.
    const r = await buildFuelReport({ start: a.bas, end: a.bit });
    if (!r.available) {
      cikti.push({ ay: a.ay, kg: null, km: null, gKm: null, kaynak: "hesaplanmadi" });
      continue;
    }
    const satirlar = (r.rows ?? []).map((row) => ({
      litre: row.consumedLiters ?? null,
      km: row.km ?? null,
      // Canlı yolda "ölçülemedi" yargısı raporun kendi alanlarından türer.
      sebep: row.consumedLiters === null || row.consumedLiters === undefined ? "yetersiz_okuma" : null,
      vid: row.vehicleId,
    }));
    cikti.push({ ay: a.ay, ...topla(satirlar), kaynak: "canli" });
  }

  return cikti;
}

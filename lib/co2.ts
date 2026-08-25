import type { FuelType } from "@/lib/types";

/**
 * CO₂ HESABI — SAF KATMAN (migration 089).
 *
 * ═══ 🔴 ETİKET DÜZELTİLDİ ═══
 *
 * Bu dosya 25.08.2026'ya kadar katsayıları "EU well-to-tank tailpipe
 * convention" diye etiketliyordu. Cümle kendi içinde çelişkili ve etiket
 * YANLIŞTI:
 *
 *   TTW (tank-to-wheel)  egzozdan çıkan · doğrudan yanma · Scope 1
 *   WTT (well-to-tank)   yakıtın çıkarılması, rafinesi, dağıtımı · yukarı akış
 *   WTW (well-to-wheel)  WTT + TTW · lojistik raporlamasının istediği
 *
 * 2,64 kg CO₂/L bir **TTW** katsayısıdır. "Well-to-tank" diye etiketlemek
 * denetimde ters teper: müşteri WTW beklerken TTW alır ve rakam düşük görünür.
 *
 * ═══ HANGİ STANDART ═══
 *
 * GLEC Framework ISO 14083:2023 olarak standartlaştı; CDP, SBTi ve CSRD/ESRS E1
 * ona atıf yapıyor. Lojistikte istenen büyüklük WTW'dir. Ürün her iki esası da
 * üretir ve hangisi olduğunu HER ÇIKTIDA yazar.
 */

/** Raporlama esası — çıktıların hepsinde açıkça yazılır. */
export type CO2Esas = "TTW" | "WTW";

/**
 * KATSAYI KÜMESİ SÜRÜMÜ — PDF metodolojisine basılır.
 *
 * Sürüm, "bu sayı hangi çarpanlarla üretildi" sorusunun cevabıdır. Katsayı
 * değişirse sürüm artar ve elde basılmış eski belgeler hangi kümeyle
 * üretildiklerini kendi üstlerinde taşır.
 */
export const CO2_KATSAYI_SURUM = "2026.1";

/**
 * TTW — DOĞRUDAN YANMA (kg CO₂ / litre).
 *
 * ⚠️ SAYILAR DEĞİŞMEDİ. Etiket düzeltildi, çarpan aynı kaldı: değiştirmek
 * geçmiş raporlarla kıyası bozardı ve bu tur onun turu değil.
 * Elektrikli araçta egzoz yok → TTW = 0 ve bu DOĞRU.
 */
export const CO2_TTW: Record<FuelType, number> = {
  diesel: 2.64,
  benzin: 2.31,
  lpg: 1.51,
  elektro: 0,
};

/**
 * WTT — YUKARI AKIŞ (kg CO₂e / litre): çıkarma, rafine, dağıtım.
 *
 * Kaynak sıralaması: DEFRA/DESNZ "GHG Conversion Factors for Company
 * Reporting" WTT sütunu — dizel litresi için ~0,60 kg CO₂e mertebesinde;
 * benzin biraz altında, LPG belirgin altında.
 *
 * ⚠️ ELEKTRİK BURADA YOK. Elektrikli aracın yukarı akışı litreyle değil
 * kWh × ŞEBEKE YOĞUNLUĞU ile hesaplanır ve yoğunluk ülkeye göre değişir
 * (EEA, gCO2e/kWh). Repoda otomatik kaynak yok → kiracı girer; girilmediyse
 * `null` döner, 0 DEĞİL.
 */
export const CO2_WTT: Record<Exclude<FuelType, "elektro">, number> = {
  diesel: 0.61,
  benzin: 0.58,
  lpg: 0.24,
};

/** Kaynak künyesi — PDF metodolojisine ve panele basılır. */
export const CO2_KAYNAK = {
  ttw: "Doğrudan yanma katsayıları (TTW) — mineral yakıt, kg CO₂/L",
  wtt: "Yukarı akış katsayıları (WTT) — DEFRA/DESNZ GHG Conversion Factors mertebesi",
  standart: "ISO 14083:2023 / GLEC Framework — CSRD·ESRS E1 bu standarda atıf yapar",
  sebeke: "EEA — Greenhouse gas emission intensity of electricity generation (gCO2e/kWh)",
} as const;

export type CO2Girdi = {
  litre: number | null;
  fuelType: FuelType;
  esas: CO2Esas;
  /** gCO2e/kWh — yalnız elektrikli + WTW için. null = bilinmiyor. */
  sebekeGkWh?: number | null;
  /** Elektrikli araçta tüketim kWh — litre yerine bu kullanılır. */
  kWh?: number | null;
};

export type CO2Sonuc = {
  /** kg CO₂(e). null = ÖLÇÜLEMEDİ. 0 DEĞİL. */
  kg: number | null;
  /** Neden ölçülemedi — "0" ile karışmasın diye ayrı alan. */
  sebep: "litre_yok" | "sebeke_yok" | "kwh_yok" | null;
  /** Kullanılan çarpan (kg/L ya da kg/kWh). Açıklanabilirlik. */
  katsayi: number | null;
  esas: CO2Esas;
};

/**
 * BİR ARACIN CO₂'Sİ.
 *
 * ⚠️ ÜÇ AYRI "SIFIR OLMAYAN" DURUM:
 *   litre_yok   → tüketim ölçülemedi (cihaz verisi yok). null.
 *   kwh_yok     → elektrikli araçta kWh ölçümü yok. null.
 *   sebeke_yok  → WTW isteniyor ama şebeke yoğunluğu girilmemiş. null.
 *
 * Elektrikli araçta TTW = 0 ve bu bir ÖLÇÜM: egzoz yok. WTW'de 0 yazmak ise
 * yanlış beyandır — üretim emisyonu var, yalnız biz bilmiyoruz.
 */
export function co2Hesapla(g: CO2Girdi): CO2Sonuc {
  const esas = g.esas;

  if (g.fuelType === "elektro") {
    if (esas === "TTW") {
      // Egzoz yok — bu bir ölçüm, eksik veri değil.
      return { kg: 0, sebep: null, katsayi: 0, esas };
    }
    if (g.sebekeGkWh === null || g.sebekeGkWh === undefined) {
      return { kg: null, sebep: "sebeke_yok", katsayi: null, esas };
    }
    if (g.kWh === null || g.kWh === undefined) {
      return { kg: null, sebep: "kwh_yok", katsayi: g.sebekeGkWh / 1000, esas };
    }
    return {
      kg: (g.kWh * g.sebekeGkWh) / 1000,
      sebep: null,
      katsayi: g.sebekeGkWh / 1000,
      esas,
    };
  }

  if (g.litre === null || g.litre === undefined) {
    return { kg: null, sebep: "litre_yok", katsayi: null, esas };
  }

  const ttw = CO2_TTW[g.fuelType] ?? CO2_TTW.diesel;
  const wtt = CO2_WTT[g.fuelType as Exclude<FuelType, "elektro">] ?? CO2_WTT.diesel;
  const katsayi = esas === "WTW" ? ttw + wtt : ttw;
  return { kg: g.litre * katsayi, sebep: null, katsayi, esas };
}

/** Yoğunluk — g CO₂ / km. Km yoksa ya da CO₂ ölçülemediyse null. */
export function gPerKm(kg: number | null, km: number | null): number | null {
  if (kg === null || km === null || km <= 0) return null;
  return (kg * 1000) / km;
}

// ══════════════════════════════════════════════════════════════════════════
// PANO TİPLERİ
// ══════════════════════════════════════════════════════════════════════════

export type CO2AracSatiri = {
  vehicleId: string;
  plate: string;
  fuelType: FuelType;
  litre: number | null;
  km: number | null;
  kg: number | null;
  gKm: number | null;
  /** null olmasının sebebi — ekranda "ölçülemedi · sebep". */
  sebep: CO2Sonuc["sebep"] | "km_yok";
  katsayi: number | null;
};

export type CO2SoforSatiri = {
  workerId: string;
  ad: string;
  km: number | null;
  kg: number | null;
  gKm: number | null;
  /** Bu şoförün km'sinin ölçülemeyen kısmı — kapsama dürüstlüğü. */
  olculemeyenKm: number;
};

export type CO2MusteriSatiri = {
  musteriId: string | null;
  ad: string;
  seferSayisi: number;
  km: number | null;
  kg: number | null;
  gKm: number | null;
  /** Km'si ölçülemeyen sefer sayısı — bu seferler toplama GİRMEZ. */
  olculemeyenSefer: number;
};

export type CO2Toplam = {
  litre: number | null;
  km: number | null;
  kg: number | null;
  gKm: number | null;
  /** Litresi ölçülen araç / toplam araç — kapsama. */
  olculenArac: number;
  toplamArac: number;
  /** Litresi ölçülemeyen araçların plakaları — sessiz eksik YASAK. */
  olculemeyenPlakalar: string[];
};

/** Hedefe göre durum. Hedef yoksa null. */
export function hedefDurumu(
  gKm: number | null,
  hedefGKm: number | null
): { fark: number; yuzde: number; tuttu: boolean } | null {
  if (gKm === null || hedefGKm === null || hedefGKm <= 0) return null;
  const fark = gKm - hedefGKm;
  return { fark, yuzde: (fark / hedefGKm) * 100, tuttu: fark <= 0 };
}

// ── Eski dışa aktarımlar (PDF ve mevcut çağıranlar için) ────────────────

/**
 * ⚠️ GERİYE UYUMLULUK. `CO2_FACTORS` adı TTW kümesinin diğer adıdır; eski
 * çağıranlar (app/actions/fuel.ts, components/pdf/CO2Report.tsx) kırılmasın
 * diye duruyor. Yeni kod `CO2_TTW` + `co2Hesapla` kullanmalı — esas seçimi
 * ve "ölçülemedi" ayrımı yalnız orada var.
 */
export const CO2_FACTORS = CO2_TTW;

export function co2Kg(liters: number, fuelType: FuelType): number {
  return liters * (CO2_TTW[fuelType] ?? CO2_TTW.diesel);
}

export type CO2Vehicle = {
  plate: string;
  liters: number;
  km: number;
  lPer100: number | null;
  co2Kg: number;
  gPerKm: number | null;
};

export type CO2ReportData = {
  monthLabel: string;
  generatedAt: string;
  totalLiters: number;
  totalCo2: number;
  totalKm: number;
  avgGPerKm: number | null;
  vehicles: CO2Vehicle[];
  /** 089 — hangi esasla üretildi. Eski çağıranlarda undefined olabilir. */
  esas?: CO2Esas;
  katsayiSurum?: string;
};

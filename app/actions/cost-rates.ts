"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { writeCostRates, readCostRateRow } from "@/lib/cost-rates-db";
import { auditChange } from "@/lib/audit-change";

/**
 * MALİYET ORANLARI — panelden yazma.
 *
 * ═══ NEDEN requireAdmin, requireFleetView DEĞİL ═══
 *
 * Bu üç sayı FİLONUN TAMAMININ €/km'sini değiştirir; filo şefi yalnız kendi
 * filosundan sorumlu ve buradan yaptığı bir düzeltme karşı filonun rakamını da
 * sessizce oynatırdı. Kapsamı olan bir kullanıcıya kapsamı olmayan bir kaldıraç
 * vermek, yetki tasarımında en sık yapılan hata.
 *
 * ═══ NEDEN BOŞ = TEMİZLE ═══
 *
 * Alanı boş bırakmak "0 gir" değil "bu oranı ben vermiyorum, varsayılana dön"
 * demek. 0 zaten CHECK'e takılır (076). Boş → null → zincir env/varsayılana
 * düşer ve ekrandaki rozet "VARSAYILAN"a döner. Kullanıcı kendi girdiği bir
 * sayıdan GERİ DÖNEBİLMELİ; dönüş yolu olmayan ayar, ayar değil tuzaktır.
 */

export type CostRatesActionResult = {
  ok: boolean;
  /** "tablo_yok" → migration 076 bekliyor; ekran bunu ayrı anlatır. */
  sebep?: "tablo_yok" | "hata" | "gecersiz";
  hata?: string;
  /** Hangi alan geçersiz — form o alanı işaretler. */
  alan?: string;
};

/**
 * Serbest metni orana çevirir.
 *
 * Boş / yalnız boşluk → null (temizle). Virgüllü yazım (Avusturya ve Türkiye
 * klavyesinde varsayılan) kabul edilir: "2,043" ile "2.043" aynı sayıdır.
 * Bunu yapmasaydık Almanca yerelde çalışan bir kullanıcı her kaydedişte
 * "geçersiz sayı" görürdü ve sebebini bulamazdı.
 */
function oranCoz(raw: FormDataEntryValue | null): number | null | "gecersiz" {
  const s = String(raw ?? "").trim();
  if (s === "") return null;
  const n = Number(s.replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return "gecersiz";
  // Üst sınır bir DOĞRULAMA değil, PARMAK KAZASI kapısı: 19,10 yerine 1910
  // yazan kullanıcı €/km'yi yüz katına çıkarır ve rakam o kadar saçmadır ki
  // kimse fark etmeden karar verir. 10.000 hiçbir meşru oranın üstünde.
  if (n > 10_000) return "gecersiz";
  return n;
}

export async function saveCostRatesAction(
  formData: FormData
): Promise<CostRatesActionResult> {
  const session = await requireAdmin();

  const alanlar = [
    ["fuel_eur_per_l", "fuel"],
    ["labor_eur_per_hour", "labor"],
    ["vehicle_eur_per_day", "vehicleDay"],
  ] as const;

  const degerler: Record<string, number | null> = {};
  for (const [kolon, alanAdi] of alanlar) {
    const v = oranCoz(formData.get(kolon));
    if (v === "gecersiz") return { ok: false, sebep: "gecersiz", alan: alanAdi };
    degerler[kolon] = v;
  }

  // ÖNCEKİ DEĞERLER — iz için. Yazmadan ÖNCE okunur; sonra okusaydık "neydi"
  // sorusunun cevabı kaybolurdu.
  const { row: onceki } = await readCostRateRow();

  const sonuc = await writeCostRates(
    {
      fuel_eur_per_l: degerler.fuel_eur_per_l,
      labor_eur_per_hour: degerler.labor_eur_per_hour,
      vehicle_eur_per_day: degerler.vehicle_eur_per_day,
    },
    session.worker_id ?? null
  );
  if (!sonuc.ok) return { ok: false, sebep: sonuc.sebep, hata: sonuc.mesaj };

  // İZ: bir € oranı filo kararlarını sürüklüyor — "bu rakamı kim, ne zaman,
  // neyden neye çevirdi" altı ay sonra sorulacak. Katman kapalıysa no-op.
  await auditChange(
    session.worker_id ?? null,
    onceki ? "update" : "create",
    "cost_rates",
    "singleton",
    onceki
      ? {
          fuel_eur_per_l: onceki.fuel_eur_per_l,
          labor_eur_per_hour: onceki.labor_eur_per_hour,
          vehicle_eur_per_day: onceki.vehicle_eur_per_day,
        }
      : null,
    degerler
  );

  // Maliyet bloğu yakıt raporunda; oran değişince oradaki €/km de değişmeli.
  revalidatePath("/admin/ayarlar");
  revalidatePath("/admin/raporlar/yakit");
  return { ok: true };
}

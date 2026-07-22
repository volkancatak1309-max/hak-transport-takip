import "server-only";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * CİHAZ KONFİGÜRASYON DÖNEMİ (config epoch) — 22.07.2026.
 *
 * Alarm eşikleri (Teltonika green-driving/aşırı hız parametreleri) filoya
 * toplu olarak değiştiğinde, o andan ÖNCEKİ ve SONRAKİ olaylar aynı ölçü
 * birimiyle üretilmemiş olur. `vehicle_events` tablosunda hangi kaydın hangi
 * eşikle üretildiğini söyleyen bir alan YOK; bu yüzden sınırı ayrı bir tabloda
 * tutuyoruz (`device_config_epochs`).
 *
 * Neden gerekli: eşik gevşetildiğinde olay sayısı düşer. Sınırı bilmeyen bir
 * rapor bunu "şoförler düzeldi" diye okur — oysa yalnız cetvel değişmiştir.
 * En zararlısı TREND OKUDUR: önceki dönem eski eşikle, bu dönem yenisiyle
 * ölçülür ve herkes bir anda "iyileşmiş" görünür.
 *
 * Kural bu yüzden iki katmanlı:
 *   1. Karşılaştırma sınırı aşıyorsa trend HİÇ gösterilmez (yanlış ok yerine
 *      dürüst boşluk).
 *   2. Görüntülenen aralık sınırdan önce başlıyorsa rapora açıklama notu düşer.
 *
 * Tablo yoksa (SQL henüz çalıştırılmadıysa) her şey eskisi gibi çalışır —
 * `null` döner, hiçbir uyarı çıkmaz. Bu, projedeki diğer migration-öncesi
 * dayanıklılık desenleriyle aynıdır.
 */
export type ConfigEpoch = {
  changedAt: Date;
  params: string | null;
  note: string | null;
};

/** En son konfigürasyon değişikliği; kayıt/tablo yoksa null. */
export async function getLatestConfigEpoch(): Promise<ConfigEpoch | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from("device_config_epochs")
      .select("changed_at, params, note")
      .order("changed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;

    const changedAt = new Date(data.changed_at as string);
    if (!Number.isFinite(changedAt.getTime())) return null;

    return {
      changedAt,
      params: (data.params as string) ?? null,
      note: (data.note as string) ?? null,
    };
  } catch {
    // Tablo yok / sorgu hatası → sessizce "dönem bilgisi yok".
    return null;
  }
}

/** Bu aralık, konfigürasyon sınırından ÖNCE başlıyor mu? (rapora not düşülür) */
export function rangeStartsBeforeEpoch(
  rangeStart: Date,
  epoch: ConfigEpoch | null
): boolean {
  if (!epoch) return false;
  return rangeStart.getTime() < epoch.changedAt.getTime();
}

/** Bir dönem sınırın hangi tarafında? Sınırı kesiyorsa "straddle". */
function sideOf(start: Date, end: Date, boundaryMs: number): "before" | "after" | "straddle" {
  if (end.getTime() <= boundaryMs) return "before";
  if (start.getTime() >= boundaryMs) return "after";
  return "straddle";
}

/**
 * İki dönemin karşılaştırması sınırı aşıyor mu?
 *
 * Karşılaştırma ÜÇ durumda geçersizdir:
 *   • dönemlerden biri sınırı ortadan kesiyorsa (karışık veri), ya da
 *   • ikisi sınırın FARKLI taraflarındaysa (farklı cetveller).
 * İkisi de aynı taraftaysa (ikisi de eski ya da ikisi de yeni eşikle ölçülmüş)
 * karşılaştırma dürüsttür ve trend gösterilir.
 */
export function comparisonCrossesEpoch(
  currentStart: Date,
  currentEnd: Date,
  previousStart: Date,
  previousEnd: Date,
  epoch: ConfigEpoch | null
): boolean {
  if (!epoch) return false;
  const b = epoch.changedAt.getTime();
  const cur = sideOf(currentStart, currentEnd, b);
  const prev = sideOf(previousStart, previousEnd, b);
  if (cur === "straddle" || prev === "straddle") return true;
  return cur !== prev;
}

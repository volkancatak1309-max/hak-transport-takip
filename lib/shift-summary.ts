/**
 * VARDİYA SONU ÖZET İMZASI — hangi vardiya imza ister? (22.07.2026)
 *
 * Tek kaynak: hem panelin özet katmanını seçen sunucu bileşeni
 * (app/panel/page.tsx) hem de toplu imza action'ı (app/actions/driver-panel.ts)
 * bu modülü kullanır. İki tarafın kuralı ayrışırsa şoför, imzaladığı hâlde
 * ekranı kapanmayan bir vardiyayla baş başa kalır — 22.07.2026'daki "özet
 * döngüsü" tam olarak buydu.
 *
 * Kural iki koşulla daraltıldı:
 *  1. SİSTEM kapanışları imza istemez. Şoför kendi kapatmadığı bir vardiyanın
 *     özetini imzalamak "dijital imza" kavramını boşa düşürür (imzaladığı
 *     rakamları o üretmedi). 22.07.2026 sabahı biriken 35 imzasız kaydın 33'ü
 *     auto_idle'dı; şoför her açılışta üst üste 7 özet ekranı görüyordu.
 *  2. Çok kısa vardiyalar imza istemez. Kontak/park manevrasından doğan
 *     dakikalık kayıtlar çalışma kaydı değildir; imzalatmak gürültüdür.
 *
 * NOT: otomatik kapanış 22.07.2026'da tamamen kaldırıldı (lib/auto-shift.ts,
 * AUTO_END_ENABLED=false), yani (1) ileriye dönük yalnız geçmiş kayıtları ve
 * watchdog/yönetici kapanışlarını eler. Kural yine de duruyor: kapanışın
 * kaynağı ne olursa olsun, imzayı yalnız KENDİ kapattığı vardiya için isteriz.
 */

/** İmzasız özet bu kadar geriye kadar tekrar gösterilir (72 saat). */
export const SUMMARY_WINDOW_MS = 72 * 60 * 60 * 1000;

/** Bu süreden kısa vardiya imza istemez (25 dk). */
export const SUMMARY_MIN_SHIFT_MS = 25 * 60 * 1000;

/** İmza kuralının ihtiyaç duyduğu asgari vardiya alanları. */
export type SummaryCandidate = {
  started_at: string;
  ended_at: string | null;
  summary_confirmed_at: string | null;
  end_reason: string | null;
  auto_ended?: boolean | null;
};

/**
 * Sistem kapanışı mı? (şoförün kendi eylemi değil)
 *  • auto_idle / auto_ended → motor kapattı (22.07.2026'da kaldırıldı, geçmiş
 *    kayıtlar için duruyor)
 *  • admin              → yönetici kapattı (Kapanmamış Vardiyalar kartı)
 * 'watchdog' KASITLI olarak dışarıda: onu şoförün kendisi tetikliyor
 * (Telegram'daki "Hayır" dokunuşu), yani imzalayabileceği kendi eylemidir.
 */
function isSystemClosed(e: SummaryCandidate): boolean {
  return (
    e.auto_ended === true ||
    e.end_reason === "auto_idle" ||
    e.end_reason === "admin"
  );
}

/**
 * Bu vardiya şoförden imza istemeli mi? Panelin özet katmanı bu yanıta göre
 * açılır.
 */
export function needsSummarySignature(
  e: SummaryCandidate,
  nowMs: number = Date.now()
): boolean {
  if (e.summary_confirmed_at) return false;
  if (!e.ended_at) return false;

  const endedMs = new Date(e.ended_at).getTime();
  if (!Number.isFinite(endedMs)) return false;
  if (nowMs - endedMs > SUMMARY_WINDOW_MS) return false;

  if (isSystemClosed(e)) return false;

  const startedMs = new Date(e.started_at).getTime();
  if (Number.isFinite(startedMs) && endedMs - startedMs < SUMMARY_MIN_SHIFT_MS) {
    return false;
  }

  return true;
}

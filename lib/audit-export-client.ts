"use client";

import { SECURITY_LAYER_PUBLIC } from "@/lib/tenant";

/**
 * DIŞA AKTARMA İZİ — İSTEMCİ UCU (045).
 *
 * PDF ve CSV tarayıcıda üretiliyor; indirme anında sunucuya giden başka bir
 * istek yok. Bu yüzden izi yazacak tek yol buradan bir sunucu action'ı çağırmak
 * (bkz. app/actions/audit.ts).
 *
 * ── HAK61/SENDIGO'DA AĞ İSTEĞİ GİTMEZ ──────────────────────────────────────
 * `SECURITY_LAYER_PUBLIC` kapalıyken ilk satırda çıkar: sunucuya HİÇBİR istek
 * gitmez ve dinamik import hiç yürümediği için action chunk'ı da indirilmez.
 *
 * ⚠️ ÖLÇÜLDÜ, DÜZELTİLDİ: burada önce "modül istemci paketine bile yüklenmez"
 *    yazıyordu — YANLIŞTI. `SECURITY_LAYER_PUBLIC` düz bir literal değil,
 *    `envBool(process.env…, false)` çağrısının sonucu; Turbopack `process.env`
 *    okumasını gömüyor ama çağrıyı derleme anında katlayamıyor, dolayısıyla
 *    ölü kod eleme devreye girmiyor. Env'siz build'de action adları 7 istemci
 *    chunk'ında hâlâ görünüyor (birkaç yüz bayt, erişilemez kod). Bunu
 *    katlanabilir yapmak için bayrağı burada `process.env.X === "true"` diye
 *    yeniden okumak gerekirdi; o da lib/tenant.ts'i tek kaynak olmaktan
 *    çıkarır ve değişmezlik muhafızının denetimi dışına kaçırırdı. Ölçülen
 *    bedel (erişilemez bayt) o riske değmiyor.
 *
 * ── NEDEN `await`, NEDEN `void` DEĞİL ──────────────────────────────────────
 * Fire-and-forget yazsaydık kullanıcı indirmeden hemen sonra sekmeyi kapattığında
 * kayıt SESSİZCE düşerdi — bir iz kaydının yapabileceği en kötü şey bu. Bekleme
 * bedeli tek bir INSERT ve zaten saniyeler süren PDF üretiminin yanında ölçüye
 * girmiyor. Hata durumunda yutulur: iz yazılamaması indirmeyi bozmamalı.
 */
export async function noteExport(
  kind: "pdf" | "csv",
  target: string
): Promise<void> {
  if (!SECURITY_LAYER_PUBLIC) return;
  try {
    const m = await import("@/app/actions/audit");
    if (kind === "pdf") await m.logPdfExportAction(target);
    else await m.logCsvExportAction(target);
  } catch {
    /* iz yazılamadı — indirme çağıranda tamamlandı */
  }
}

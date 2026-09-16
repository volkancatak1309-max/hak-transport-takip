import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { dosyaYukle, IZINLI_TIPLER_PANEL } from "@/lib/upload-core";

export type UploadResult = { ok: true; path: string } | { ok: false; error: string };

/**
 * Upload a receipt photo to a private bucket via the service-role client.
 * Path: {workerId}/{yyyy}/{mm}/{uuid}.{ext}
 *
 * ═══ GÖVDESİ ARTIK lib/upload-core.ts'TE (03.09.2026) ═══════════════════════
 *
 * Boyut/tip denetimi ve Storage yazması KOPYALANMADI, çekirdeğe TAŞINDI. Sebep:
 * mobil yükleme uçları aynı kuralları işletmek zorunda ve ikinci bir kopya ilk
 * değişiklikte geride kalırdı — panelden yüklenen fotoğrafla telefondan
 * yüklenen FARKLI kurallara tabi olurdu.
 *
 * ── PANELİN DAVRANIŞI DEĞİŞMEDİ, İKİ NOKTA DIŞINDA ────────────────────────
 *   • `image/heic` HÂLÂ kabul ediliyor (`IZINLI_TIPLER_PANEL`). Yeni mobil
 *     uçlar onu almıyor; panel alıyor çünkü bugün alıyordu ve kova ayarı da
 *     izin veriyor.
 *   • ARTIK HIZ SINIRI VAR (098, kişi başına dakikada 10). Bu bilinçli bir
 *     genişletme: fren ortak çekirdekte olduğu için panel de kazanıyor.
 *     Kota `hiz_siniri` hatasıyla döner ve çağıran onu `error` alanında görür.
 *
 * Dönüş sözleşmesi AYNEN korundu (`{ok:true,path}` / `{ok:false,error}`), yani
 * altı çağıranın hiçbiri değişmedi.
 */
export async function uploadReceipt(
  bucket: string,
  workerId: string,
  file: File
): Promise<UploadResult> {
  const r = await dosyaYukle(bucket, workerId, file, {
    izinliTipler: IZINLI_TIPLER_PANEL,
  });
  if (r.ok) return { ok: true, path: r.yol };
  // Eski hata dizgeleri korunuyor: çağıranlar bunları kullanıcıya çeviriyor.
  const eskiAd: Record<string, string> = {
    dosya_yok: "no_file",
    cok_buyuk: "too_large",
    tip_yasak: "bad_type",
  };
  return { ok: false, error: eskiAd[r.hata] ?? r.ayrinti ?? r.hata };
}

/** Short-lived signed URL for viewing a private receipt. */
export async function signedReceiptUrl(
  bucket: string,
  path: string,
  expiresIn = 3600
): Promise<string | null> {
  if (!path) return null;
  const { data } = await supabaseAdmin.storage
    .from(bucket)
    .createSignedUrl(path, expiresIn);
  return data?.signedUrl ?? null;
}

/**
 * Batch-sign many receipt paths in a single request. Returns a Map keyed by the
 * original path so callers can attach a signed URL to each row. Used to render
 * receipt thumbnails for a whole list (e.g. the admin approvals table) without
 * one round-trip per row. Paths that fail to sign are simply absent from the map.
 */
export async function signedReceiptUrls(
  bucket: string,
  paths: string[],
  expiresIn = 3600
): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter(Boolean))];
  const out = new Map<string, string>();
  if (unique.length === 0) return out;

  const { data } = await supabaseAdmin.storage
    .from(bucket)
    .createSignedUrls(unique, expiresIn);

  for (const item of data ?? []) {
    if (item.path && item.signedUrl) out.set(item.path, item.signedUrl);
  }
  return out;
}

import "server-only";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * ENGEL OKUMASI (migration 111) — süzgecin GİRDİSİ.
 *
 * Ayrı dosya, çünkü üç modül de buna muhtaç ve birbirine bağlanmamalı:
 *   lib/messaging.ts        → geçmiş, okunmamış sayacı, makbuz, liste önizlemesi
 *   lib/push.ts             → grup bildiriminin alıcıları
 *   lib/mesaj-moderasyon.ts → engelle / kaldır / listele
 * Burada YALNIZ okuma ve iki küçük yardımcı var; yazma moderasyonda.
 *
 * ── SÜZGEÇ YALNIZ GRUPTA ────────────────────────────────────────────────────
 * Birebir kanal işveren kanalı (şoför ↔ yönetim, 071): şoförün yönetimi
 * engellemesi iş talimatını susturmak olurdu. Çağıranlar bu yüzden engel
 * listesini YALNIZ grup konuşmasında uygular; karar burada değil onlarda,
 * çünkü konuşmanın türünü onlar biliyor.
 *
 * ── TABLO YOKSA BOŞ, GEÇİCİ HATADA fail-closed ─────────────────────────────
 * 111 koşmamış bir kiracıda engel YAZILAMAZ, dolayısıyla boş liste doğru
 * cevaptır ve mesajlaşma kırılmaz. Geçici bir DB hatası ise "engel yok"
 * SAYILMAZ: süzgeç uygulanamıyorsa çağıran 503 döner ya da bildirimi atlar —
 * engellenmiş kişinin mesajını göstermek kullanıcıya verilen sözü bozardı.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Kimlik biçimi. PostgREST bozuk bir uuid'i 22P02 ile REDDEDİYOR (yerel
 * düzenekte ölçüldü); o hata 503'e düşüp "sunucu bozuk" gibi görünmesin diye
 * kapıda eleniyor.
 */
export function kimlikMi(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}

/**
 * "Tablo yok" — migration 111 bu kiracıda koşmadı.
 *
 * İki ayrı biçimi var, ikisi de yerel düzenekte (PostgREST 12.2.3) ölçüldü:
 *   · OKUMA  → gövdede `code: "42P01"` (13+ sürümde `PGRST205`)
 *   · YAZMA  → GÖVDESİZ 404 (`{}`): kod YOK, yalnız HTTP durumu
 * Yazma yolunun çağıranı bu yüzden `status`u da geçirir. PostgREST'te bir
 * tablo yazmasının 404 dönmesinin başka bir sebebi yok (satır bulunamaması
 * 406/PGRST116, yetki 401/403).
 */
export function tabloYok(
  error: { code?: string } | null | undefined,
  status?: number
): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || status === 404;
}

/** Okuyanın ENGELLEDİĞİ kişiler. */
export async function engellenenler(
  okuyanId: string
): Promise<{ ok: true; idler: string[] } | { ok: false }> {
  const { data, error } = await supabaseAdmin
    .from("mesaj_engeller")
    .select("engellenen_id")
    .eq("engelleyen_id", okuyanId);
  if (error) return tabloYok(error) ? { ok: true, idler: [] } : { ok: false };
  return {
    ok: true,
    idler: ((data ?? []) as { engellenen_id: string }[])
      .map((r) => r.engellenen_id)
      .filter(kimlikMi),
  };
}

/** Gönderen X'i ENGELLEYEN kişiler — grup bildiriminin alıcılarından düşülür. */
export async function gondereniEngelleyenler(
  gonderenId: string
): Promise<{ ok: true; idler: Set<string> } | { ok: false }> {
  const { data, error } = await supabaseAdmin
    .from("mesaj_engeller")
    .select("engelleyen_id")
    .eq("engellenen_id", gonderenId);
  if (error) return tabloYok(error) ? { ok: true, idler: new Set() } : { ok: false };
  return {
    ok: true,
    idler: new Set(((data ?? []) as { engelleyen_id: string }[]).map((r) => r.engelleyen_id)),
  };
}

/**
 * PostgREST `or` süzgeci: gönderen YOK (silinmiş personel) ya da engelli değil.
 *
 * ⚠️ Yalnız `not.in` YETMEZ: SQL'de `NULL NOT IN (...)` NULL döner ve satır
 * DÜŞER — gönderen kaydı silinmiş (set null) bütün mesajlar, engelle hiçbir
 * ilgisi olmadığı hâlde kaybolurdu. `is.null` dalı bunu kapatıyor.
 */
export function engelSuzgeci(engelliler: readonly string[]): string | null {
  const temiz = engelliler.filter(kimlikMi);
  if (temiz.length === 0) return null;
  return `sender_worker_id.is.null,sender_worker_id.not.in.(${temiz.join(",")})`;
}

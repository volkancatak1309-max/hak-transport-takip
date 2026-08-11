/**
 * İZİN KARARI — saf doğrulama katmanı (mobil onay/ret ucu, 11.08.2026).
 *
 * `lib/fault-reports.ts` ve `lib/action-snoozes.ts` ile aynı gerekçeyle SAF:
 * `server-only` ve `supabaseAdmin` yok, böylece muhafız betiği ucun GERÇEK
 * ayıklama kurallarını Node'da çalıştırabiliyor.
 *
 * Kararın KENDİSİ (DB yazma + iz + önbellek tazeleme) `lib/leave-decision-db.ts`
 * içindeki ORTAK fonksiyondadır; hem panelin server action'ı hem mobil uç
 * oradan beslenir. İki yüzeyde iki kopya mantık YOK.
 */

/**
 * Verilebilecek KARARLAR — mobil sözleşmenin dili.
 *
 * Türkçe ("onay"/"ret"), çünkü mobil uçların gövde ve yanıt anahtarları Türkçe
 * (bkz. `durum: "acik"|"kapali"`, `kaynak: "alarm"|…`). Veritabanındaki
 * karşılıkları İngilizce ('approved'/'rejected', migration 031 CHECK'i) ve
 * eşleme `kararStatusu` ile TEK yerde yapılır — iki sözlük ayrışamaz.
 */
export const LEAVE_KARARLARI = ["onay", "ret"] as const;
export type LeaveKarar = (typeof LEAVE_KARARLARI)[number];

/** Karar → worker_leaves.status (migration 031 CHECK kümesi). */
export function kararStatusu(karar: LeaveKarar): "approved" | "rejected" {
  return karar === "onay" ? "approved" : "rejected";
}

/**
 * Karar notu üst sınırı — karakter.
 *
 * `worker_leaves.note` (500) ile aynı büyüklük: ikisi de bir insanın telefonda
 * yazdığı kısa gerekçe. Şemada CHECK olarak DEĞİL — sınır bir ürün kararıdır.
 */
export const KARAR_NOTU_MAX = 500;

export type LeaveKararSonucu =
  | { ok: true; karar: LeaveKarar; not: string | null }
  | {
      ok: false;
      kod: "missing_fields" | "invalid" | "too_long";
      alan: "karar" | "not";
      sebep?: "tip" | "deger";
      uzunluk?: number;
    };

/**
 * Karar isteğinin gövdesini ayıkla.
 *
 * ── `not` İSTEĞE BAĞLI ─────────────────────────────────────────────────────
 * Hiç gönderilmemesi geçerlidir (`null` döner). Gönderilirse string olmalı ve
 * TRIM edilir; yalnız boşluktan ibaretse NOT YOK sayılır (`null`) — "   " bir
 * gerekçe değildir ve izde boş bir satır açmanın anlamı yok.
 *
 * Büyük/küçük harf ESNETİLMEZ: "Onay" reddedilir ve geçerli küme yanıtta
 * söylenir. Sessizce düzeltmek istemcideki hatayı gizler.
 */
export function leaveKararindanAyikla(body: unknown): LeaveKararSonucu {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, kod: "missing_fields", alan: "karar" };
  }
  const input = body as Record<string, unknown>;

  if (!("karar" in input)) return { ok: false, kod: "missing_fields", alan: "karar" };
  if (typeof input.karar !== "string") {
    return { ok: false, kod: "invalid", alan: "karar", sebep: "tip" };
  }
  const karar = input.karar.trim();
  if (!(LEAVE_KARARLARI as readonly string[]).includes(karar)) {
    return { ok: false, kod: "invalid", alan: "karar", sebep: "deger" };
  }

  let not: string | null = null;
  if ("not" in input && input.not !== null && input.not !== undefined) {
    if (typeof input.not !== "string") {
      return { ok: false, kod: "invalid", alan: "not", sebep: "tip" };
    }
    const kirpik = input.not.trim();
    if (kirpik.length > KARAR_NOTU_MAX) {
      return { ok: false, kod: "too_long", alan: "not", uzunluk: kirpik.length };
    }
    not = kirpik.length > 0 ? kirpik : null;
  }

  return { ok: true, karar: karar as LeaveKarar, not };
}

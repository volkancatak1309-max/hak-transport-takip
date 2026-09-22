import "server-only";
import { ACCESS_GATES_ENABLED, SECURITY_LAYER_ENABLED } from "@/lib/tenant";

/**
 * MOBİL GÜVENLİK UÇLARININ ORTAK SÖZLEŞMESİ (Faz D-5).
 *
 * ═══ 🔴 SESSİZ BOŞ LİSTE YASAK ═══
 *
 * `lib/security-read.ts` ve `lib/access-read.ts` bayrak kapalıyken **boş dizi**
 * döner. Panel için doğru davranış (ekran "kayıt yok" gösterir ve kırılmaz),
 * ama bir API için YALAN: istemci "hiç oturum yok" ile "bu kiracıda güvenlik
 * katmanı hiç açılmamış"ı ayırt edemez. Birinde beklenir, diğerinde kurulum
 * yapılır.
 *
 * Bu yüzden her uç çekirdeği ÇAĞIRMADAN ÖNCE bayrağa bakar ve kapalıysa
 * aşağıdaki tek tip gövdeyi döner. Emsal `servisYapilandirildi` (091,
 * takograf): "arıza" ile "hiç kurulmamış" ayrı şeylerdir.
 *
 * ═══ İKİ AYRI BAYRAK, İKİ AYRI CEVAP ═══
 *
 *   `SECURITY_LAYER_ENABLED`  → oturumlar · denetim izi · patron kademesi (045)
 *   `ACCESS_GATES_ENABLED`    → onaylar · erişim kuralları · anahtar (046/048)
 *
 * İkisi BAĞIMSIZ. Katman açık ama kapılar kapalı bir kurulumda onay uçları
 * "kapilar: kapali" der; katman kapalıysa hiçbiri veri döndürmez. Tek bayrağa
 * indirgemek, açık olan yarıyı da kapalı göstermek olurdu.
 */

/** Uçların gövdesinde taşınan kurulum durumu — her yanıtta aynı iki alan. */
export type KatmanDurumu = {
  katman: "acik" | "kapali";
  kapilar: "acik" | "kapali";
};

export function katmanDurumu(): KatmanDurumu {
  return {
    katman: SECURITY_LAYER_ENABLED ? "acik" : "kapali",
    kapilar: ACCESS_GATES_ENABLED ? "acik" : "kapali",
  };
}

/**
 * KATMAN KAPALI — 200 döner, veri DÖNMEZ.
 *
 * Neden 200 ve neden 404/503 değil: uç VAR ve çalışıyor, kiracının kurulumu
 * bu özelliği içermiyor. 404 "böyle bir uç yok" derdi (yanlış — aynı sürüm üç
 * kiracıda da dağıtık), 503 "arıza" derdi (yanlış — kasıtlı bir ayar).
 * `veri: null` alanı istemcinin listeyi boş sanmasını da engelliyor.
 */
export function katmanKapaliYanit(ek?: Record<string, unknown>): Response {
  return Response.json({
    ok: true,
    ...katmanDurumu(),
    veri: null,
    sebep: "SECURITY_LAYER_ENABLED kapalı",
    bayrak: "SECURITY_LAYER_ENABLED",
    /** 045-048 bu kiracıda koşmamış olabilir; kolon/tablo yokluğu da buraya düşer. */
    migration: "045-048",
    aciklama:
      "Bu kiracıda güvenlik katmanı açık değil. Boş liste DEĞİL — hiç veri toplanmıyor.",
    ...ek,
  });
}

/**
 * KAPILAR KAPALI — katman açık ama 046/048 bayrağı kapalı.
 *
 * Onaylar, erişim kuralları ve anahtar bu bayrağa bağlı; oturumlar ve denetim
 * izi bağlı DEĞİL. Ayrı cevap vermek, "yarısı çalışıyor" hâlini görünür kılar.
 */
export function kapilarKapaliYanit(ek?: Record<string, unknown>): Response {
  return Response.json({
    ok: true,
    ...katmanDurumu(),
    veri: null,
    sebep: "ACCESS_GATES_ENABLED kapalı",
    bayrak: "ACCESS_GATES_ENABLED",
    migration: "046-048",
    aciklama:
      "Erişim kapıları bu kiracıda açık değil (cihaz/ülke onayı, saat kilidi, ölü adam anahtarı).",
    ...ek,
  });
}

// ═══════════════════════ SAYFALAMA ═══════════════════════════════════════

/**
 * `?sayfa=` (1 tabanlı) — görevin istediği biçim.
 *
 * Depo sözleşmesi `?limit=&offset=` (lib/mobile-list.ts) ve o KORUNUYOR:
 * `limit` sayfa BOYUDUR, `sayfa` ise kaçıncı sayfa. İkisi birlikte çalışır,
 * `offset = (sayfa - 1) * limit`.
 *
 * ⚠️ `sayfa` ve `offset` BİRLİKTE verilirse 400. İkisi aynı şeyi iki dilde
 * söylüyor ve çeliştiklerinde hangisinin kazandığı sessiz bir karar olurdu —
 * istemci yanlış sayfaya baktığını hiç öğrenmezdi.
 */
export type SayfaCozum =
  | { ok: true; limit: number; offset: number; sayfa: number }
  | { ok: false; alan: string; sebep: string };

export function sayfaCoz(url: URL, maxLimit = 200, varsayilanLimit = 50): SayfaCozum {
  const sayfaHam = url.searchParams.get("sayfa");
  const offsetHam = url.searchParams.get("offset");
  if (sayfaHam !== null && offsetHam !== null) {
    return { ok: false, alan: "sayfa", sebep: "sayfa_ve_offset_birlikte" };
  }

  const limitHam = url.searchParams.get("limit");
  let limit = varsayilanLimit;
  if (limitHam !== null) {
    const n = Number(limitHam);
    if (!Number.isInteger(n) || n < 1 || n > maxLimit) {
      return { ok: false, alan: "limit", sebep: `1..${maxLimit}` };
    }
    limit = n;
  }

  if (sayfaHam !== null) {
    const n = Number(sayfaHam);
    if (!Number.isInteger(n) || n < 1) return { ok: false, alan: "sayfa", sebep: "1_veya_ustu" };
    return { ok: true, limit, offset: (n - 1) * limit, sayfa: n };
  }

  let offset = 0;
  if (offsetHam !== null) {
    const n = Number(offsetHam);
    if (!Number.isInteger(n) || n < 0) return { ok: false, alan: "offset", sebep: "0_veya_ustu" };
    offset = n;
  }
  return { ok: true, limit, offset, sayfa: Math.floor(offset / limit) + 1 };
}

/** Yanıtın sayfa bloğu — lib/mobile-list.ts `pageInfo` ile aynı alanlar + `sayfa`. */
export function sayfaBilgisi(
  c: { limit: number; offset: number; sayfa: number },
  toplam: number
) {
  return {
    limit: c.limit,
    offset: c.offset,
    sayfa: c.sayfa,
    toplam,
    sonSayfa: Math.max(1, Math.ceil(toplam / c.limit)),
    hasMore: c.offset + c.limit < toplam,
  };
}

import "server-only";
import { createHash } from "node:crypto";
import { clientIpFromHeaders } from "@/lib/auth-core";

/**
 * İSTEK BAĞLAMI — IP, cihaz parmak izi ve coğrafya (migration 045).
 *
 * ── COĞRAFYA ÜCRETSİZ ──────────────────────────────────────────────────────
 * Vercel her isteğe kendi coğrafya başlıklarını ekliyor: `x-vercel-ip-city`,
 * `x-vercel-ip-country`, `x-vercel-ip-country-region` (resmî dok:
 * vercel.com/docs/headers/request-headers). Dış bir IP-veritabanı servisine,
 * API anahtarına ya da ek maliyete GEREK YOK. Vercel dışında (yerel geliştirme,
 * başka barındırma) başlıklar gelmez → alanlar NULL kalır ve ekran boş gösterir;
 * uydurma bir konum yazmaktansa boş bırakmak doğrudur.
 *
 * Şehir adı RFC3986 kodlu gelebiliyor (Vercel dokümanı), bu yüzden çözülür.
 */

export type RequestContext = {
  ip: string;
  userAgent: string | null;
  /** UA + dil başlığının sha256'sı, 16 hane. */
  deviceHash: string;
  city: string | null;
  country: string | null;
};

type HeaderBag = { get(name: string): string | null };

/**
 * CİHAZ PARMAK İZİ — kasıtlı olarak ZAYIF ve bunu açıkça söylüyoruz.
 *
 * Yalnız User-Agent + Accept-Language'den türer. Aynı tarayıcı sürümünü aynı
 * dil ayarıyla kullanan iki farklı kişi AYNI izi üretir; aynı kişi tarayıcısını
 * güncelleyince iz DEĞİŞİR. Yani bu bir kimlik değil, bir İPUCUdur:
 * "yeni cihaz" işareti şüphe uyandırmak içindir, kanıt olarak kullanılamaz.
 *
 * Daha güçlüsü (canvas/font fingerprint) bilinçli olarak YAPILMADI: istemci
 * tarafında iz sürme gerektirir, gizlilik açısından ölçüsüz ve zaten
 * engellenebilir.
 */
export function deviceFingerprint(h: HeaderBag): string {
  const ua = h.get("user-agent") ?? "";
  const lang = h.get("accept-language") ?? "";
  return createHash("sha256").update(`${ua}|${lang}`).digest("hex").slice(0, 16);
}

/** Vercel başlıkları RFC3986 kodlu olabilir; çözülemezse ham değeri koru. */
function decode(v: string | null): string | null {
  if (!v) return null;
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

export function readRequestContext(h: HeaderBag): RequestContext {
  return {
    ip: clientIpFromHeaders(h),
    userAgent: h.get("user-agent"),
    deviceHash: deviceFingerprint(h),
    city: decode(h.get("x-vercel-ip-city")),
    country: decode(h.get("x-vercel-ip-country")),
  };
}

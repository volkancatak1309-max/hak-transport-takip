import { createHmac, timingSafeEqual } from "node:crypto";
import {
  CANLI_DAKIKA_USD,
  REALTIME_TABAN_DAKIKA_USD,
  SESLI_ASGARI_OTURUM_SN,
  SESLI_AYLIK_SINIR_SN,
  SESLI_GUNLUK_SINIR_SN,
  SESLI_OTURUM_SINIRI_SN,
} from "@/lib/asistan-sesli-sabitler";

/**
 * SESLİ ASİSTAN — SUNUCU SINIRLARI, SAF HESAP (Faz 2a hazırlığı, 03.10.2026).
 *
 * Veritabanı ve saat okumaz (an dışarıdan gelir); `scripts/check-asistan-sesli-ozet.mjs`
 * veritabanı olmadan sınar. Veritabanı tarafı `lib/asistan-sesli-kayit.ts`.
 *
 * ═══ NEDEN SUNUCUDA ═══
 * Prototipte 10 dk sınırı yalnız tarayıcıdaydı: değiştirilmiş bir istemci sınırsız
 * konuşabilirdi. Şimdi:
 *   • OTURUM JETONU — oturum açılırken sunucu, kayıt kimliği + kullanıcı + başlangıç +
 *     sınır (sn) taşıyan HMAC imzalı bir jeton verir. Araç ucu ve kalp atışı ucu jetonu
 *     ister; süresi dolunca araçlar ÇALIŞMAZ (asistan veriye ulaşamaz).
 *   • KALP ATIŞI — saniyeyi tarayıcı bildirmez; sunucu her atışta now() − başlangıç'ı
 *     sınırla kırpıp yazar.
 *   • GÜN / AY / BÜTÇE — oturum açılmadan önce, kayıttan; kapalı oturumda yazılan saniye,
 *     açık (canlı) oturumda geçen süre, kalp atışı hiç gelmemiş kapanmamış oturumda tam
 *     sınır (temkinli: atışı kesip sınırdan kaçmak işe yaramaz).
 * Kalan risk (Faz 2b): değiştirilmiş bir istemci OpenAI ses bağlantısını jeton bitince de
 * açık tutabilir — araç alamaz ama ses ücreti işler. Kapatmak için sunucunun OpenAI
 * oturumunu kendisinin kapatabilmesi gerekir (Realtime'da SDP değişimini sunucuya almak).
 */

export type OturumJetonu = {
  /** asistan_kullanim.id */
  k: string;
  /** worker id */
  w: string;
  /** başlangıç (ms, epoch) */
  b: number;
  /** bu oturumun sınırı (sn) — min(10 dk, kalan gün, kalan ay) */
  s: number;
};

/** Saat kayması ve son atış için tolerans. */
export const JETON_TOLERANS_MS = 30_000;
/** Bu kadar süredir atış gelmeyen açık oturum ÖLÜ sayılır. */
export const OLU_OTURUM_MS = 60_000;

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64url");

export function jetonImzala(j: OturumJetonu, sir: string): string {
  const govde = b64(JSON.stringify(j));
  const imza = createHmac("sha256", sir).update(govde).digest("base64url");
  return `${govde}.${imza}`;
}

export function jetonCoz(jeton: unknown, sir: string): OturumJetonu | null {
  if (typeof jeton !== "string" || jeton.length > 600) return null;
  const [govde, imza, fazla] = jeton.split(".");
  if (!govde || !imza || fazla !== undefined) return null;
  const beklenen = createHmac("sha256", sir).update(govde).digest();
  let gelen: Buffer;
  try {
    gelen = Buffer.from(imza, "base64url");
  } catch {
    return null;
  }
  if (gelen.length !== beklenen.length || !timingSafeEqual(gelen, beklenen)) return null;
  try {
    const j = JSON.parse(Buffer.from(govde, "base64url").toString("utf8")) as Partial<OturumJetonu>;
    if (typeof j.k !== "string" || typeof j.w !== "string" || typeof j.b !== "number" || typeof j.s !== "number") {
      return null;
    }
    return { k: j.k, w: j.w, b: j.b, s: j.s };
  } catch {
    return null;
  }
}

export type JetonDurumu = "gecerli" | "suresi_doldu" | "baska_kullanici";

export function jetonDurumu(j: OturumJetonu, workerId: string, simdiMs: number): JetonDurumu {
  if (j.w !== workerId) return "baska_kullanici";
  return simdiMs <= j.b + j.s * 1000 + JETON_TOLERANS_MS ? "gecerli" : "suresi_doldu";
}

/** Kalp atışında yazılacak saniye: geçen süre, oturum sınırıyla kırpılı (geriye gitmez). */
export function nabizSaniyesi(j: OturumJetonu, simdiMs: number, onceki: number): number {
  const gecen = Math.max(0, Math.floor((simdiMs - j.b) / 1000));
  return Math.max(onceki, Math.min(gecen, j.s));
}

export type KullanimSatiri = {
  basladi_at: string;
  son_nabiz_at: string | null;
  bitti_at: string | null;
  saniye: number;
};

const ms = (s: string | null) => (s ? Date.parse(s) : NaN);

/** Açık ve son 60 sn'de atış/başlangıç görmüş oturum. */
export function canliMi(r: KullanimSatiri, simdiMs: number): boolean {
  if (r.bitti_at) return false;
  const son = Number.isFinite(ms(r.son_nabiz_at)) ? ms(r.son_nabiz_at) : ms(r.basladi_at);
  return simdiMs - son < OLU_OTURUM_MS;
}

/**
 * Sınır hesabına giren saniye.
 *   kapalı                    → yazılan saniye
 *   canlı                     → geçen süre (sınırla kırpılı)
 *   ölü, en az bir atış almış → yazılan saniye (son atışa kadar)
 *   ölü, hiç atış almamış     → tam oturum sınırı (temkinli — atışı kesmek kaçış olmasın)
 */
export function etkinSaniye(r: KullanimSatiri, simdiMs: number, oturumSiniriSn = SESLI_OTURUM_SINIRI_SN): number {
  const yazili = Math.max(0, Number(r.saniye) || 0);
  if (r.bitti_at) return yazili;
  const gecen = Math.max(0, Math.floor((simdiMs - ms(r.basladi_at)) / 1000));
  if (canliMi(r, simdiMs)) return Math.max(yazili, Math.min(gecen, oturumSiniriSn));
  if (r.son_nabiz_at) return yazili;
  return Math.max(yazili, Math.min(gecen, oturumSiniriSn));
}

export type SinirKarari =
  | { izin: true; kalanSn: number }
  | { izin: false; engel: "gun_siniri" | "ay_siniri" | "butce" | "oturum_acik" };

/**
 * Yeni oturum açılabilir mi, açılırsa en fazla kaç saniye. Sıra: açık oturum → bütçe →
 * ay → gün (kullanıcıya en uzun süren engel önce söylenir).
 */
export function sinirKarari(p: {
  gunSn: number;
  aySn: number;
  kiraciAyUsd: number;
  butceUsd: number;
  acikOturumVar: boolean;
}): SinirKarari {
  if (p.acikOturumVar) return { izin: false, engel: "oturum_acik" };
  if (p.kiraciAyUsd >= p.butceUsd) return { izin: false, engel: "butce" };
  const kalanAy = SESLI_AYLIK_SINIR_SN - p.aySn;
  if (kalanAy < SESLI_ASGARI_OTURUM_SN) return { izin: false, engel: "ay_siniri" };
  const kalanGun = SESLI_GUNLUK_SINIR_SN - p.gunSn;
  if (kalanGun < SESLI_ASGARI_OTURUM_SN) return { izin: false, engel: "gun_siniri" };
  return { izin: true, kalanSn: Math.min(SESLI_OTURUM_SINIRI_SN, kalanAy, kalanGun) };
}

/** Sunucunun bildiği en düşük maliyet: dakika × birim (Realtime tabanı [TAHMİN], Live 0,05 $/dk). */
export function maliyetTabani(motor: string, model: string, saniye: number): number {
  const dk = Math.max(0, saniye) / 60;
  if (motor === "live") return dk * CANLI_DAKIKA_USD;
  if (motor === "realtime") return dk * (REALTIME_TABAN_DAKIKA_USD[model] ?? REALTIME_TABAN_DAKIKA_USD["gpt-realtime-2.1"]);
  return 0;
}

/** İstemcinin bildirdiği tahmin (0–5 $ aralığına kırpılır) ile tabanın büyüğü, 4 ondalık. */
export function kayitMaliyeti(taban: number, istemci: unknown): number {
  const i = typeof istemci === "number" && Number.isFinite(istemci) ? Math.min(Math.max(istemci, 0), 5) : 0;
  return Math.round(Math.max(taban, i) * 10_000) / 10_000;
}

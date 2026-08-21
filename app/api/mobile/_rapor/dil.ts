import { SUPPORTED_LOCALES, type Locale } from "@/i18n/request";

/**
 * RAPOR DİLİ — `?dil=tr|de`.
 *
 * ── NEDEN AYRI PARAMETRE, PANEL DİLİNDEN TÜRETME DEĞİL ────────────────────
 * Volkan kararı (21.08.2026): rapor dili ASLA panel/uygulama dilinden
 * türetilmez, her indirmeden ÖNCE kullanıcıya sorulur. Sebep somut: aynı
 * yönetici bir belgeyi Avusturya iş müfettişine (Almanca), ertesi gün şoförüne
 * (Türkçe) veriyor. Arayüz dilini belge diline bağlamak, kişinin belgeyi KİME
 * verdiğini değil, o an panelini hangi dilde açtığını belgeye yazardı.
 *
 * ⚠️ AZG DAHİL. "§ 26 AZG belgesi her zaman Almancadır" kararı KALKTI; dili
 * kullanıcı seçer (bkz. lib/azg-report.ts).
 *
 * ── ZORUNLU DEĞİL ─────────────────────────────────────────────────────────
 * Parametre verilmezse `null` döner ve her uç KENDİ eski varsayılanını
 * korur — mevcut istemciler bozulmaz. Geçersiz değer SESSİZCE yutulmaz:
 * 400 `invalid_dil`, çünkü istemci istediği dilde belge aldığını sanırdı.
 */
export type DilSonucu =
  | { ok: true; dil: Locale | null }
  | { ok: false; kod: "invalid_dil" };

export function dilCoz(url: URL): DilSonucu {
  const ham = url.searchParams.get("dil");
  if (ham === null || ham === "") return { ok: true, dil: null };
  if ((SUPPORTED_LOCALES as readonly string[]).includes(ham)) {
    return { ok: true, dil: ham as Locale };
  }
  return { ok: false, kod: "invalid_dil" };
}

/** 400 gövdesinin alanları — istemci geçerli kümeyi dokümansız görsün. */
export function dilHataAlanlari() {
  return { alan: "dil", gecerli: SUPPORTED_LOCALES, ornek: "?dil=de" };
}

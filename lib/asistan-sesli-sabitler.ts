/**
 * SESLİ ASİSTAN — istemci + sunucu ORTAK sabitleri (Faz 1 web prototipi, 03.10.2026).
 *
 * `server-only` DEĞİL: sayfa da (model/ses menüsü, maliyet göstergesi) sunucu da
 * (izin listesi) aynı listeyi okur. Burada sır yok; anahtar `lib/asistan-sesli.ts`'te.
 *
 * Kaynak (03.10.2026'da okundu): developers.openai.com model sayfaları ve
 * `guides/realtime-conversations`. Tasarım: galzura-fleet-app/docs/asistan-sesli-tasarim.md.
 */

/** 1M token başına USD — model sayfalarından, 03.10.2026. */
export type SesliFiyat = {
  metinGirdi: number;
  metinGirdiOnbellek: number;
  metinCikti: number;
  sesGirdi: number;
  sesGirdiOnbellek: number;
  sesCikti: number;
};

export type SesliModel = { id: string; fiyat: SesliFiyat };

/**
 * İZİN LİSTESİ. `gpt-realtime-2.1` ana model (karar 2); `mini` kıyas için seçilebilir,
 * ana model olmayacak (araç çağırma zayıf).
 *
 * ⚠️ `gpt-live-1` BİLEREK YOK: model var ama Realtime API'yi desteklemiyor — kendi
 * `POST /v1/live/sessions` ucu var, tarayıcıya kısa ömürlü anahtar vermiyor ve araçları
 * "delegation" ile ayrı bir modele yaptırıyor. Bu akışa eklenemez; kıyas ayrı iş.
 */
export const SESLI_MODELLER: readonly SesliModel[] = [
  {
    id: "gpt-realtime-2.1",
    fiyat: {
      metinGirdi: 4,
      metinGirdiOnbellek: 0.4,
      metinCikti: 24,
      sesGirdi: 32,
      sesGirdiOnbellek: 0.4,
      sesCikti: 64,
    },
  },
  {
    id: "gpt-realtime-2.1-mini",
    fiyat: {
      metinGirdi: 0.6,
      metinGirdiOnbellek: 0.06,
      metinCikti: 2.4,
      sesGirdi: 10,
      sesGirdiOnbellek: 0.3,
      sesCikti: 20,
    },
  },
];

export const SESLI_VARSAYILAN_MODEL = "gpt-realtime-2.1";

/**
 * SES SABİT (Volkan, Faz 1c): Realtime = `marin`. Seçim menüden kalktı; sunucu istemciden
 * ses almaz, bu sabiti kullanır.
 */
export const SESLI_SES = "marin";

/** Karar 1: tek konuşma 10 dk. Gün/ay sınırları sonraki fazda (migration gerekir). */
export const SESLI_OTURUM_SINIRI_SN = 600;

/**
 * Realtime döküm (canlı yazı) modelleri — sayfada seçilir (Faz 1b). Döküm yalnız EKRANDIR:
 * model kullanıcıyı sesten anlar; döküm hatası cevabı bozmaz (03.10 testi: "Bugün kim
 * izinli?" → ekranda "Bugünki ne yazın?", cevap doğruydu).
 *  • gpt-live-transcribe — güncel rehberin önerisi, akışla yazar, dil tahmini DÖNDÜRMEZ.
 *  • gpt-4o-transcribe   — eski nesil, Türkçede kıyas için (26.02.2027'de kapanıyor).
 *  • gpt-transcribe      — tur bitince yazar ama algılanan dili (`languages`) döndürür.
 */
export const SESLI_TRANSKRIPSIYON_MODELLERI = ["gpt-live-transcribe", "gpt-4o-transcribe", "gpt-transcribe"] as const;
export const SESLI_VARSAYILAN_TRANSKRIPSIYON = "gpt-live-transcribe";

/** İki motor: OpenAI Realtime (gpt-realtime-2.1 / mini) ve GPT-Live (gpt-live-1). */
export const SESLI_MOTORLAR = ["realtime", "live"] as const;
export type SesliMotor = (typeof SESLI_MOTORLAR)[number];

/**
 * GPT-Live — ayrı API (`POST /v1/live/sessions`, sunucu proje anahtarıyla SDP değişimi).
 * Akıl ve araçlar "Responses delegation" ile arka modelde; rehberin önerdiği başlangıç
 * modeli `gpt-6-luna` (live-delegation rehberi, 03.10.2026).
 */
export const CANLI_MODEL = "gpt-live-1";
export const CANLI_ARKA_MODEL = "gpt-6-luna";
/** SES SABİT (Volkan, Faz 1c): GPT-Live = `gleam` (`marin` bu motorda yok). */
export const CANLI_SES = "gleam";
/** Ses oturumu dakikası (saniye bazlı faturalama). Arka model ve araç kullanımı AYRICA. */
export const CANLI_DAKIKA_USD = 0.05;

/**
 * YAZILI YOL (Faz 1c): GPT-Live'da metin girişi belgelenmediği için yazılı sorular ayrı bir
 * metin yoluyla (Responses API) cevaplanır — aynı araçlar, aynı talimat. Model: belgenin
 * "en verimli" diye önerdiği güncel küçük model (models sayfası, 03.10.2026); aynı model
 * GPT-Live'ın önerilen arka modeli.
 */
export const YAZI_MODEL = "gpt-6-luna";
/** `gpt-6-luna` 1M token fiyatı (models sayfası, 03.10.2026): giriş 0,1 $ · çıkış 0,5 $. */
export const LUNA_FIYAT = { girdi: 0.1, cikti: 0.5 } as const;

export function lunaMaliyetUsd(girdi: number, cikti: number): number {
  return (girdi * LUNA_FIYAT.girdi + cikti * LUNA_FIYAT.cikti) / 1_000_000;
}

export type SesliDil = "tr" | "de" | "en";
export const SESLI_DIL_ADI: Record<SesliDil, string> = { tr: "Turkish", de: "German", en: "English" };

const IPUCU: Record<SesliDil, { harf: RegExp | null; kelime: RegExp }> = {
  tr: {
    harf: /[ğşıİĞŞ]/,
    kelime:
      /(^|\s)(bugün|kaç|ne|nerede|kim|var|mı|mi|mu|mü|araç|araçlar|sefer|izinli|şoför|sürücü|hangi|yolda|değil|evet|hayır|lütfen|şu an|şimdi)(?=\s|$|[?.!,])/gu,
  },
  de: {
    harf: /[ßäÄ]/,
    kelime:
      /(^|\s)(wie|viele|heute|wer|wo|ist|sind|das|der|die|und|nicht|fahrzeug|fahrzeuge|fahrer|urlaub|bitte|welche|gibt|unterwegs|jetzt)(?=\s|$|[?.!,])/gu,
  },
  en: {
    harf: null,
    kelime:
      /(^|\s)(the|how|many|what|who|where|is|are|today|vehicle|vehicles|driver|drivers|leave|please|which|any|right|now)(?=\s|$|[?.!,])/gu,
  },
};

/**
 * Dil kanıtı (döküm metninden): kazanan dil ve PUANI (özel harf 2, ipucu kelime 1).
 * Kanıt yoksa ya da iki dil berabereyse `null`. Kısa dolgu sesleri ("eee", "ok") dil
 * kanıtı sayılmaz (rehber: "ignore short filler sounds … for language detection").
 */
export function dilPuani(metin: string): { dil: SesliDil; puan: number } | null {
  // Harf ipucu ÖZGÜN metinde (İ/ı ayrımı kaybolmasın); kelimeler yerel-bağımsız küçük harfte
  // (`toLocaleLowerCase("tr")` İngilizce "Is"i "ıs" yapıp kalıbı bozardı).
  const m = ` ${metin.toLowerCase()} `;
  if (m.trim().length < 4) return null;
  const puan = (Object.keys(IPUCU) as SesliDil[]).map((dil) => {
    const ip = IPUCU[dil];
    return [dil, (ip.harf?.test(metin) ? 2 : 0) + (m.match(ip.kelime)?.length ?? 0)] as const;
  });
  puan.sort((a, b) => b[1] - a[1]);
  const [ilk, ikinci] = puan;
  return ilk[1] >= 1 && ilk[1] > ikinci[1] ? { dil: ilk[0], puan: ilk[1] } : null;
}

/** Basit dil tahmini. Kanıt yoksa `null` — o zaman dil DEĞİŞMEZ. */
export function dilTahmin(metin: string): SesliDil | null {
  return dilPuani(metin)?.dil ?? null;
}

/** `response.done` → `response.usage`'tan toplanan token sayıları. */
export type SesliKullanim = {
  metinGirdi: number;
  metinGirdiOnbellek: number;
  sesGirdi: number;
  sesGirdiOnbellek: number;
  metinCikti: number;
  sesCikti: number;
};

export function bosKullanim(): SesliKullanim {
  return {
    metinGirdi: 0,
    metinGirdiOnbellek: 0,
    sesGirdi: 0,
    sesGirdiOnbellek: 0,
    metinCikti: 0,
    sesCikti: 0,
  };
}

const sayi = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * `response.usage`'ı biriktirir. Alanlar: `input_token_details.{text_tokens,
 * audio_tokens, cached_tokens_details.{text_tokens, audio_tokens}}` ve
 * `output_token_details.{text_tokens, audio_tokens}`.
 */
export function kullanimEkle(onceki: SesliKullanim, usage: unknown): SesliKullanim {
  const u = (usage ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const girdi = (u.input_token_details ?? {}) as Record<string, unknown>;
  const onbellek = (girdi.cached_tokens_details ?? {}) as Record<string, unknown>;
  const cikti = (u.output_token_details ?? {}) as Record<string, unknown>;
  return {
    metinGirdi: onceki.metinGirdi + sayi(girdi.text_tokens),
    metinGirdiOnbellek: onceki.metinGirdiOnbellek + sayi(onbellek.text_tokens),
    sesGirdi: onceki.sesGirdi + sayi(girdi.audio_tokens),
    sesGirdiOnbellek: onceki.sesGirdiOnbellek + sayi(onbellek.audio_tokens),
    metinCikti: onceki.metinCikti + sayi(cikti.text_tokens),
    sesCikti: onceki.sesCikti + sayi(cikti.audio_tokens),
  };
}

/**
 * TAHMİNİ maliyet (USD). Önbellekli tokenlar girdinin içinden düşülür. Transkripsiyon
 * (canlı döküm) ücreti `usage`'da yok — dahil DEĞİL; ekran bunu yazar.
 */
export function tahminiMaliyetUsd(modelId: string, k: SesliKullanim): number {
  const m = SESLI_MODELLER.find((x) => x.id === modelId) ?? SESLI_MODELLER[0];
  const f = m.fiyat;
  const metinTaze = Math.max(0, k.metinGirdi - k.metinGirdiOnbellek);
  const sesTaze = Math.max(0, k.sesGirdi - k.sesGirdiOnbellek);
  const usd =
    metinTaze * f.metinGirdi +
    k.metinGirdiOnbellek * f.metinGirdiOnbellek +
    sesTaze * f.sesGirdi +
    k.sesGirdiOnbellek * f.sesGirdiOnbellek +
    k.metinCikti * f.metinCikti +
    k.sesCikti * f.sesCikti;
  return usd / 1_000_000;
}

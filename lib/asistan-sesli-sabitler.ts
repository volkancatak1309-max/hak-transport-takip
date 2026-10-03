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

/** OpenAI'ın güncel ses listesi (client_secrets başvurusu, 03.10.2026). */
export const SESLI_SESLER = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "sage",
  "shimmer",
  "verse",
  "marin",
  "cedar",
] as const;

/**
 * İki kadın tınılı ADAY (karar 3) — menüde en üstte. Seçim Volkan'ın kulağına kalır.
 * `marin` OpenAI'ın Realtime için önerdiği iki sesten biri; `coral` ikinci aday.
 */
export const SESLI_ADAY_SESLER: readonly string[] = ["marin", "coral"];
export const SESLI_VARSAYILAN_SES = "marin";

/** Karar 1: tek konuşma 10 dk. Gün/ay sınırları sonraki fazda (migration gerekir). */
export const SESLI_OTURUM_SINIRI_SN = 600;

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

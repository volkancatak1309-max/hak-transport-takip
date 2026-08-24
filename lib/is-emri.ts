/**
 * İŞ EMRİ — İSTEMCİYE DE AÇIK sabitler ve türler (migration 081).
 *
 * ⚠️ Bu dosya `server-only` DEĞİL ve olmamalı. `lib/is-emri-db.ts` Supabase
 * istemcisini (dolayısıyla `node:async_hooks`) çekiyor; durum ve öncelik
 * listeleri oradan import edildiğinde istemci paketi derlenemiyor — build
 * "does not support external modules" diye düşüyor.
 *
 * `lib/fault-reports.ts` ile `lib/fault-reports-db.ts` ayrımının aynısı:
 * saf sabit/tür burada, veriye dokunan her şey `-db` dosyasında.
 */

export const IS_EMRI_DURUMLARI = ["acik", "serviste", "kapali"] as const;
export type IsEmriDurum = (typeof IS_EMRI_DURUMLARI)[number];

export const IS_EMRI_ONCELIKLERI = ["dusuk", "normal", "yuksek", "kritik"] as const;
export type IsEmriOncelik = (typeof IS_EMRI_ONCELIKLERI)[number];

/** Emrin doğduğu yer. Bilinmeyen bir değer ekranda HAM basılır, çevrilmez. */
export const IS_EMRI_KAYNAKLARI = [
  "surucu",
  "dvir",
  "dtc",
  "periyodik",
  "elle",
] as const;
export type IsEmriKaynak = (typeof IS_EMRI_KAYNAKLARI)[number];

export type IsEmri = {
  id: string;
  vehicleId: string;
  plaka: string;
  aciklama: string;
  durum: IsEmriDurum;
  oncelik: IsEmriOncelik;
  kaynak: string;
  bildirenId: string;
  bildirenAd: string;
  atananId: string | null;
  atananAd: string | null;
  maliyet: number | null;
  servisAt: string | null;
  kapanisNotu: string | null;
  createdAt: string;
  closedAt: string | null;
};

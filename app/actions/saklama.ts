"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { audit } from "@/lib/security-log";
import {
  saklamaAyari,
  saklamaAyariYaz,
  silmeDurumu,
  ayOzetiYaz,
  omurIziniTazele,
  kmDondur,
  hamSil,
} from "@/lib/saklama-db";
import { ayarDenetle, type SaklamaAyari, type SilmeKapisi } from "@/lib/saklama";

/**
 * SAKLAMA POLİTİKASI — sunucu eylemleri (migration 090).
 *
 * ═══ TEK KAPI: requireAdmin ═══
 *
 * Saklama süresini değiştirmek, ürünün dışarıya verdiği hukuki beyanı
 * değiştirmektir. Filo şefine açık DEĞİL — CO₂ esasında (089) ve giriş
 * kilidinde (042) verilen kararın aynısı.
 *
 * ═══ ⚠️ SİLME BU DOSYADAN BAŞLATILAMAZ ═══
 *
 * `hazirlikYurut` yalnız HAZIRLIK yapar (ömür izi + özet + km dondurma) ve
 * silmeyi KURU modda çağırır — yani ne olacağını sayar, hiçbir şey silmez.
 * Gerçek silme YALNIZ cron rotasından ve YALNIZ `silme_acik` açıkken olur.
 *
 * Sebebi: silme geri alınamaz. Bir ekran düğmesinin arkasına koymak, yanlış
 * sekmede bir tıklamayla 1,6 milyon satırı götürebilirdi.
 */

export type SaklamaPanosu = {
  ayar: SaklamaAyari;
  kapi: SilmeKapisi;
  kesim: string;
  eksikAylar: string[];
  hazirAylar: string[];
  kmDonmamis: number;
};

export async function getSaklamaPanosu(): Promise<SaklamaPanosu> {
  const session = await requireAdmin();
  await audit(session.worker_id ?? null, "page_view", "/admin/saklama");
  return silmeDurumu();
}

export type SaklamaSonuc = { ok: true } | { ok: false; hata: string };

export async function saklamaAyarKaydet(girdi: {
  hamGun: number;
  silmeAcik: boolean;
  gerekce: string | null;
}): Promise<SaklamaSonuc> {
  const session = await requireAdmin();

  /**
   * ⚠️ GEREKÇE KAPISI. 90 günün üstünü YASAKLAMIYORUZ — bazı kiracının
   * gerçek bir sebebi olabilir. Sebepsiz uzatmayı imkânsız kılıyoruz.
   * Denetimde sorulacak ilk soru "neden bu kadar uzun"; cevabı ürünün
   * içinde durmalı, birinin hafızasında değil.
   */
  const hata = ayarDenetle(girdi.hamGun, girdi.gerekce);
  if (hata) return { ok: false, hata };

  const onceki = await saklamaAyari();
  const r = await saklamaAyariYaz(girdi, session.worker_id ?? null);
  if (!r.ok) return { ok: false, hata: r.hata ?? "hata" };

  /**
   * İZ: eski→yeni değerin ikisi de yazılır. "Kim ne zaman uzattı" sorusunun
   * cevabı denetim kaydında durmalı; ayar tablosu yalnız SON hâli tutuyor.
   */
  await audit(
    session.worker_id ?? null,
    "update",
    `saklama:${onceki.hamGun}→${girdi.hamGun}gun silme:${onceki.silmeAcik}→${girdi.silmeAcik}`
  );
  revalidatePath("/admin/saklama");
  return { ok: true };
}

export type HazirlikSonuc = {
  ok: boolean;
  hata?: string;
  omurIzi: number;
  ozetYazilan: string[];
  kmDondurulan: number;
  kmKalan: number;
  /** KURU sayım: silme açılsaydı kaç satır giderdi. Hiçbir şey silinmedi. */
  silinecekTelemetri: number;
  silinecekKonum: number;
};

/**
 * HAZIRLIĞI İLERLET — ömür izi, eksik ay özetleri, km dondurma.
 *
 * ⚠️ HİÇBİR SATIR SİLMEZ. Sondaki sayım KURU moddan gelir.
 *
 * Bir turda en fazla `AY_TAVANI` ay işlenir: her ay tam bir yakıt raporu
 * koşusudur (canlıda ~60 sn/tur ölçüldü) ve sunucu eylemi zaman aşımına
 * uğrarsa kullanıcı ne olduğunu bilemez. Tur tur ilerlemek, her turun kendi
 * başına tamamlanmış bir iş olmasını sağlar.
 */
const AY_TAVANI = 2;

export async function hazirlikYurut(): Promise<HazirlikSonuc> {
  const session = await requireAdmin();

  const omur = await omurIziniTazele();
  if (!omur.ok) {
    return {
      ok: false,
      hata: omur.hata ?? "omur_izi_hata",
      omurIzi: 0,
      ozetYazilan: [],
      kmDondurulan: 0,
      kmKalan: 0,
      silinecekTelemetri: 0,
      silinecekKonum: 0,
    };
  }

  const durum = await silmeDurumu();

  const yazilan: string[] = [];
  for (const ay of durum.eksikAylar.slice(0, AY_TAVANI)) {
    const r = await ayOzetiYaz(ay);
    if (!r.ok) {
      return {
        ok: false,
        hata: r.hata ?? "ozet_hata",
        omurIzi: omur.satir,
        ozetYazilan: yazilan,
        kmDondurulan: 0,
        kmKalan: 0,
        silinecekTelemetri: 0,
        silinecekKonum: 0,
      };
    }
    yazilan.push(ay);
  }

  const km = await kmDondur();
  const kuru = await hamSil(durum.ayar.hamGun, true);

  await audit(
    session.worker_id ?? null,
    "update",
    `saklama_hazirlik:ozet=${yazilan.length} km=${km.dondurulan}`
  );
  revalidatePath("/admin/saklama");

  return {
    ok: true,
    omurIzi: omur.satir,
    ozetYazilan: yazilan,
    kmDondurulan: km.dondurulan,
    kmKalan: km.kalan,
    silinecekTelemetri: kuru.telemetri,
    silinecekKonum: kuru.konum,
  };
}

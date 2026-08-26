"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { audit } from "@/lib/security-log";
import {
  saklamaAyari,
  saklamaAyariYaz,
  kategoriler,
  yasalEsik,
  uyarilar,
  hazirlikDurumu,
  hazirligiIlerlet,
  manuelSil,
  silmeIzi,
  aralikSatirSayisi,
  HAM_TABLOLAR,
  type HamTablo,
  type SilmeIziSatiri,
} from "@/lib/saklama-db";
import {
  ayarDenetle,
  aralikDenetle,
  araligiCoz,
  silinebilirMi,
  uyariAciliyeti,
  type AralikTuru,
  type KategoriSatiri,
  type SaklamaAyari,
  type SaklamaUyarisi,
  type SilmeKapisi,
  type VeriKategorisi,
  type YasalEsik,
} from "@/lib/saklama";

/**
 * SAKLAMA — sunucu eylemleri (migration 090).
 *
 * ═══ TEK KAPI: requireAdmin ═══
 *
 * Uyarı eşiğini değiştirmek ve veri silmek, ürünün dışarıya verdiği hukuki
 * beyanı ve müşterinin verisini etkiler. Filo şefine açık DEĞİL — CO₂
 * esasında (089) ve giriş kilidinde (042) verilen kararın aynısı.
 *
 * ═══ 🔴 SİLME BİR İNSAN EYLEMİDİR ═══
 *
 * Otomatik silme YOK. `araligiSil` yalnız buradan çağrılır ve:
 *   · aralığı KULLANICI seçer (hafta / ay / iki tarih arası)
 *   · önce KURU mod ("şu kadar satır silinecek")
 *   · çift onay: ikinci adımda kutuya elle "SIL" yazılır
 *   · sebep zorunlu ve denetim izine yazılır
 *   · 'yasal_zorunlu' kategori için buraya HİÇ GELİNMEZ — arayüz düğmeyi
 *     çizmez; kapı yine de son savunma olarak duruyor
 */

export type SaklamaPanosu = {
  ayar: SaklamaAyari;
  uyarilar: (SaklamaUyarisi & { aciliyet: number })[];
  kategoriler: KategoriSatiri[];
  esik: YasalEsik | null;
  izi: SilmeIziSatiri[];
  /** Silinebilir ham tablolar — 'yasal_zorunlu' olanlar burada YOKTUR. */
  silinebilirTablolar: { tablo: HamTablo; kategori: VeriKategorisi }[];
};

export async function getSaklamaPanosu(): Promise<SaklamaPanosu> {
  const session = await requireAdmin();
  await audit(session.worker_id ?? null, "page_view", "/admin/saklama");

  const ayar = await saklamaAyari();
  const [{ uyarilar: liste }, kats, esik, izi] = await Promise.all([
    uyarilar(),
    kategoriler(),
    yasalEsik(ayar.ulkeKodu, "ham_konum"),
    silmeIzi(20),
  ]);

  /**
   * ⚠️ ARAYÜZ 'yasal_zorunlu' İÇİN SİLME SEÇENEĞİ GÖSTERMEZ.
   *
   * Liste burada süzülüyor, ekranda değil: seçenek hiç üretilmezse yanlışlıkla
   * render edilemez. Reddetmek bir hatadır ve hata mesajı okunmayabilir;
   * göstermemek bir tasarımdır.
   */
  const katMap = new Map(kats.filter((k) => k.kolonAdi === null).map((k) => [k.tabloAdi, k.kategori]));
  const silinebilirTablolar = HAM_TABLOLAR.map((t) => ({
    tablo: t,
    // Sınıflandırılmamış tablo FAIL-CLOSED: 'yasal_zorunlu' sayılır.
    kategori: katMap.get(t) ?? ("yasal_zorunlu" as VeriKategorisi),
  })).filter((x) => silinebilirMi(x.kategori));

  return {
    ayar,
    uyarilar: liste.map((u) => ({ ...u, aciliyet: uyariAciliyeti(u) })),
    kategoriler: kats,
    esik,
    izi,
    silinebilirTablolar,
  };
}

export type SaklamaSonuc = { ok: true } | { ok: false; hata: string };

export async function saklamaAyarKaydet(girdi: {
  uyariGun: number;
  ulkeKodu: string;
  gerekce: string | null;
}): Promise<SaklamaSonuc> {
  const session = await requireAdmin();

  const hata = ayarDenetle(girdi.uyariGun, girdi.ulkeKodu);
  if (hata) return { ok: false, hata };

  const onceki = await saklamaAyari();
  const r = await saklamaAyariYaz(girdi, session.worker_id ?? null);
  if (!r.ok) return { ok: false, hata: r.hata ?? "hata" };

  // İZ: eski→yeni. "Kim ne zaman değiştirdi" denetim kaydında durmalı;
  // ayar tablosu yalnız SON hâli tutuyor.
  await audit(
    session.worker_id ?? null,
    "update",
    `saklama_uyari:${onceki.uyariGun}→${girdi.uyariGun}gun ulke:${onceki.ulkeKodu}→${girdi.ulkeKodu}`
  );
  revalidatePath("/admin/saklama");
  return { ok: true };
}

// ═══════════════════════════ KURU MOD ════════════════════════════════════

export type OnIzleme = {
  ok: boolean;
  hata?: string;
  tablo: HamTablo;
  aralikBas: string;
  aralikBit: string;
  satir: number;
  kapi: SilmeKapisi;
  hazirlik: { omurIzi: number; eksikAylar: string[]; kmDonmamis: number };
};

/**
 * 🔴 KURU MOD — "şu kadar satır silinecek". HİÇBİR ŞEY SİLMEZ.
 *
 * Çift onayın BİRİNCİ ayağı budur: kullanıcı sayıyı görmeden "SIL" yazamaz.
 */
export async function silmeOnIzleme(girdi: {
  tablo: HamTablo;
  tur: AralikTuru;
  referans?: string;
  bas?: string;
  bit?: string;
}): Promise<OnIzleme> {
  const session = await requireAdmin();
  const bos = {
    tablo: girdi.tablo,
    aralikBas: "",
    aralikBit: "",
    satir: 0,
    kapi: { izin: false, engel: null, ayrinti: "" } as SilmeKapisi,
    hazirlik: { omurIzi: 0, eksikAylar: [] as string[], kmDonmamis: 0 },
  };

  const a = araligiCoz(girdi.tur, girdi);
  if (!a) return { ok: false, hata: "aralik_gecersiz", ...bos };
  const aralikHatasi = aralikDenetle(a);
  if (aralikHatasi) {
    return { ok: false, hata: aralikHatasi, ...bos, aralikBas: a.bas.toISOString(), aralikBit: a.bit.toISOString() };
  }

  const r = await manuelSil({
    tablo: girdi.tablo,
    aralik: a,
    sebep: "",
    onayMetni: "",
    workerId: session.worker_id ?? null,
    kuru: true,
  });
  const h = await hazirlikDurumu(a);

  return {
    ok: r.ok,
    hata: r.hata,
    tablo: girdi.tablo,
    aralikBas: a.bas.toISOString(),
    aralikBit: a.bit.toISOString(),
    satir: r.satir,
    kapi: r.kapi,
    hazirlik: { omurIzi: h.omurIzi, eksikAylar: h.eksikAylar, kmDonmamis: h.kmDonmamis },
  };
}

/** Hazırlığı ilerletir. ⚠️ HİÇBİR SATIR SİLMEZ. */
export async function hazirlikYurut(girdi: {
  tur: AralikTuru;
  referans?: string;
  bas?: string;
  bit?: string;
}): Promise<{ ok: boolean; hata?: string; omurIzi: number; ozetYazilan: string[]; kmDondurulan: number; kmKalan: number }> {
  const session = await requireAdmin();
  const bos = { omurIzi: 0, ozetYazilan: [] as string[], kmDondurulan: 0, kmKalan: 0 };
  const a = araligiCoz(girdi.tur, girdi);
  if (!a) return { ok: false, hata: "aralik_gecersiz", ...bos };

  const r = await hazirligiIlerlet(a);
  if (r.ok) {
    await audit(
      session.worker_id ?? null,
      "update",
      `saklama_hazirlik:ozet=${r.ozetYazilan.length} km=${r.kmDondurulan}`
    );
    revalidatePath("/admin/saklama");
  }
  return r;
}

// ═══════════════════════════ GERÇEK SİLME ════════════════════════════════

export type SilmeCevabi = {
  ok: boolean;
  hata?: string;
  silinen: number;
  kapi: SilmeKapisi;
};

/**
 * 🔴 GERÇEK SİLME — geri alınamaz.
 *
 * Çift onayın İKİNCİ ayağı: `onayMetni` kutusuna elle "SIL" yazılmış olmalı.
 * Sebep zorunlu ve denetim izine yazılır (kim, ne zaman, hangi aralık, kaç
 * satır, neden).
 *
 * ⚠️ Kategori 'yasal_zorunlu' ise buraya hiç gelinmez: `getSaklamaPanosu`
 * o tabloyu `silinebilirTablolar` listesine koymaz, ekran seçenek üretmez.
 * `manuelSil` içindeki kapı SON savunmadır.
 */
export async function araligiSil(girdi: {
  tablo: HamTablo;
  tur: AralikTuru;
  referans?: string;
  bas?: string;
  bit?: string;
  sebep: string;
  onayMetni: string;
}): Promise<SilmeCevabi> {
  const session = await requireAdmin();
  const bosKapi: SilmeKapisi = { izin: false, engel: null, ayrinti: "" };

  const a = araligiCoz(girdi.tur, girdi);
  if (!a) return { ok: false, hata: "aralik_gecersiz", silinen: 0, kapi: bosKapi };

  const oncekiSayi = await aralikSatirSayisi(girdi.tablo, a);

  const r = await manuelSil({
    tablo: girdi.tablo,
    aralik: a,
    sebep: girdi.sebep,
    onayMetni: girdi.onayMetni,
    workerId: session.worker_id ?? null,
    kuru: false,
  });

  if (!r.ok) return { ok: false, hata: r.hata ?? "hata", silinen: 0, kapi: r.kapi };

  /**
   * İkinci iz: `saklama_silme_izi` hukuki kayıt, `security_log` operasyonel
   * kayıt. İkisi ayrı sorulara cevap veriyor — biri "hangi veri gitti",
   * diğeri "bu hesap ne yaptı".
   */
  await audit(
    session.worker_id ?? null,
    "delete",
    `saklama_sil:${girdi.tablo} ${a.bas.toISOString().slice(0, 10)}→${a.bit.toISOString().slice(0, 10)} ${r.satir}/${oncekiSayi} satır`
  );
  revalidatePath("/admin/saklama");
  return { ok: true, silinen: r.satir, kapi: r.kapi };
}

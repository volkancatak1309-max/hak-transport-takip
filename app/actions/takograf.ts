"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { audit } from "@/lib/security-log";
import {
  dosya,
  dosyalar,
  dosyaYukle,
  faaliyetler,
  indirmeBaglantisi,
  olaylar,
  ayristirVeYaz,
  type TakografDosya,
  type TakografFaaliyet,
  type TakografOlay,
  type YuklemeHataKodu,
} from "@/lib/takograf-db";
import { servisSagligi, servisYapilandirildi } from "@/lib/takograf-servis";
import {
  TAKOGRAF_KOVA,
  sayaclar,
  type AyristirmaDurumu,
  type MuhurDurumu,
  type SuzgecSayaci,
} from "@/lib/takograf";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * TAKOGRAF — sunucu eylemleri (migration 091).
 *
 * ═══ TEK KAPI: requireAdmin ═══
 *
 * Takograf indirmesi ŞİRKET KARTI sahibinin yükümlülüğüdür — bir şirket uyum
 * işi, filo operasyonu değil. Filo şefine kapalı (Volkan kararı).
 *
 * ═══ 🔴 SİLME EYLEMİ YOK ═══
 *
 * Bu dosyada dosya silen bir fonksiyon YOKTUR ve olmayacaktır. Arşiv ürünün
 * satış vaadi; müşteri denetimde bu kayıttan indirecek. Veritabanı tarafında
 * da HK091 tetikleyicisi silmeyi reddeder (091 §2).
 */

export type TakografPanosu = {
  tabloYok: boolean;
  servisAyakta: boolean;
  servisSebep: string | null;
  satirlar: TakografDosya[];
  sayac: SuzgecSayaci;
};

export async function getTakografPanosu(): Promise<TakografPanosu> {
  const session = await requireAdmin();
  await audit(session.worker_id ?? null, "page_view", "/admin/takograf");

  const [{ satirlar, tabloYok }, saglik] = await Promise.all([
    dosyalar(),
    servisYapilandirildi() ? servisSagligi() : Promise.resolve({ ayakta: false, sebep: "yapilandirilmadi" }),
  ]);

  return {
    tabloYok,
    servisAyakta: saglik.ayakta,
    servisSebep: saglik.ayakta ? null : saglik.sebep ?? null,
    satirlar,
    sayac: sayaclar(satirlar),
  };
}

export type TakografDetay = {
  dosya: TakografDosya | null;
  faaliyetler: TakografFaaliyet[];
  olaylar: TakografOlay[];
};

export async function getTakografDetay(id: string): Promise<TakografDetay> {
  const session = await requireAdmin();
  await audit(session.worker_id ?? null, "page_view", `/admin/takograf/${id}`);
  const d = await dosya(id);
  if (!d) return { dosya: null, faaliyetler: [], olaylar: [] };
  const [f, o] = await Promise.all([faaliyetler(id), olaylar(id)]);
  return { dosya: d, faaliyetler: f, olaylar: o };
}

// ═══════════════════════════ YÜKLEME ═════════════════════════════════════

export type YuklemeCevabi =
  | {
      ok: true;
      id: string;
      ayristirmaDurumu: AyristirmaDurumu;
      muhurDurumu: MuhurDurumu;
      faaliyet: number;
    }
  // Hata kodu KAPALI KÜME (lib/takograf-db.ts): ekranda karşılığı olmayan bir
  // kod eklenirse derleme kırılır, kullanıcı ham anahtar görmez.
  | { ok: false; hata: YuklemeHataKodu; mevcutId?: string; ayrinti?: string };

/**
 * 🔴 TEK YÜKLEME YOLU — ve dosya HER KOŞULDA saklanır.
 *
 * Servis düşse, dosya bozuk olsa, mühür tutmasa bile: dosya Storage'da,
 * satır veritabanında, indirme bağlantısı çalışır durumda kalır.
 * Kullanıcıya dönen "hata" yalnız Storage'a bile yazamadığımız durumdur.
 */
export async function takografYukle(form: FormData): Promise<YuklemeCevabi> {
  const session = await requireAdmin();

  const f = form.get("dosya");
  if (!(f instanceof File)) return { ok: false, hata: "dosya_yok" };

  const baytlar = new Uint8Array(await f.arrayBuffer());
  const sonuc = await dosyaYukle({
    ad: f.name,
    baytlar,
    yukleyenWorkerId: session.worker_id ?? null,
  });

  if (!sonuc.ok) {
    return { ok: false, hata: sonuc.hata, mevcutId: sonuc.mevcutId, ayrinti: sonuc.ayrinti };
  }

  /**
   * İZ: dosya ADI yazılmaz — kişisel ad taşıyabilir. Kimlik, tür ve
   * sonuç durumu yeterli.
   */
  await audit(
    session.worker_id ?? null,
    "create",
    `takograf_yukle:${sonuc.id} tur=${sonuc.dosya.tur} ayristirma=${sonuc.dosya.ayristirmaDurumu} muhur=${sonuc.dosya.muhurDurumu}`
  );
  revalidatePath("/admin/takograf");

  return {
    ok: true,
    id: sonuc.id,
    ayristirmaDurumu: sonuc.dosya.ayristirmaDurumu,
    muhurDurumu: sonuc.dosya.muhurDurumu,
    faaliyet: sonuc.dosya.faaliyetSayisi,
  };
}

/**
 * Yeniden okuma — servis erişilemediğinde ya da ayrıştırıcı güncellendiğinde.
 *
 * ⚠️ Dosyayı Storage'dan geri OKUR; yeniden yüklemez. Arşivdeki bayt bayt
 * aynı dosya üzerinde çalışır.
 */
export async function takografYenidenOku(id: string): Promise<{ ok: boolean; hata?: string }> {
  const session = await requireAdmin();
  const d = await dosya(id);
  if (!d) return { ok: false, hata: "bulunamadi" };

  const { data, error } = await supabaseAdmin.storage.from(TAKOGRAF_KOVA).download(d.depoYolu);
  if (error || !data) return { ok: false, hata: "arsivden_okunamadi" };

  await ayristirVeYaz(id, new Uint8Array(await data.arrayBuffer()));
  await audit(session.worker_id ?? null, "update", `takograf_yeniden_oku:${id}`);
  revalidatePath("/admin/takograf");
  revalidatePath(`/admin/takograf/${id}`);
  return { ok: true };
}

// ═══════════════════════════ İNDİRME ═════════════════════════════════════

/**
 * ORİJİNAL dosyanın imzalı indirme bağlantısı.
 *
 * ⚠️ Bayt bayt yüklendiği gibi — hiçbir dönüşüm yok. Denetimde geçerli olan
 * budur; bizim ayrıştırdığımız JSON değil.
 */
export async function takografIndirmeBaglantisi(
  id: string
): Promise<{ ok: true; url: string; ad: string } | { ok: false; hata: string }> {
  const session = await requireAdmin();
  const d = await dosya(id);
  if (!d) return { ok: false, hata: "bulunamadi" };

  const url = await indirmeBaglantisi(d.depoYolu);
  if (!url) return { ok: false, hata: "baglanti_uretilemedi" };

  await audit(session.worker_id ?? null, "tacho_download", `takograf_indir:${id}`);
  return { ok: true, url, ad: d.dosyaAdi };
}

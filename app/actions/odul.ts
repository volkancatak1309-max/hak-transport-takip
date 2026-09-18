"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, requireFleetView } from "@/lib/session";
import { audit } from "@/lib/security-log";
import {
  donemOzeti,
  liderlikPanosu,
  odulAyariYaz,
  type DonemOzeti,
  type LiderlikPanosu,
} from "@/lib/odul-db";

/**
 * ŞOFÖR ÖDÜL — sunucu eylemleri (migration 088).
 *
 * ═══ İKİ KAPI ═══
 *   OKUMA → `requireFleetView` (yönetici + filo şefi)
 *   AYAR  → `requireAdmin`. İsim görünürlüğünü açmak, DE'de işletme kurulu
 *           onayı gerektiren bir karardır (§ 87 Abs. 1 Nr. 6 BetrVG); şefe
 *           açık değil.
 */

export type OdulGorunum = LiderlikPanosu & {
  ozet: DonemOzeti;
  /**
   * SAKLANAN ayar — ayar formunun başlangıcı bundan gelir.
   *
   * ⚠️ `ayar.isimGorunur` yönetici ekranı için true'ya SABİTLENİYOR (aşağıdaki
   * gerekçe). Form o değeri okusaydı, kapalı ayarı açık gösterir ve kaydete
   * basan yönetici farkında olmadan isimleri şoförlere AÇARDI.
   */
  ayarKayitli: { isimGorunur: boolean; rozetAcik: boolean };
};

export async function getOdulPanosu(): Promise<OdulGorunum> {
  const { session } = await requireFleetView();
  await audit(session.worker_id ?? null, "page_view", "/admin/odul");

  /**
   * ⚠️ YÖNETİCİ EKRANINDA İSİMLER HER ZAMAN AÇIK.
   *
   * `isim_gorunur` ayarı ŞOFÖRLERİN BİRBİRİNİ görmesini düzenler. Yönetici
   * zaten her şoförün performans raporunu görüyor (`/admin/raporlar`); orada
   * isim varken burada gizlemek bilgiyi korumaz, yalnız ekranı işe yaramaz
   * kılardı. § 87 BetrVG'nin konusu da çalışanlar arası kıyaslamadır.
   */
  const [pano, ozet] = await Promise.all([
    // İsim bayrağı MASKELEMENİN YAPILDIĞI yere iniyor; sonradan ezmek geç
    // kalıyordu (bkz. liderlikPanosu üçüncü parametre notu).
    liderlikPanosu(session.worker_id ?? null, (n) => `#${n}`, true),
    donemOzeti(),
  ]);

  return {
    ...pano,
    // `pano.ayar.isimGorunur` zaten true (zorlandı); SAKLANAN değer forma
    // gitsin diye ayrı taşınıyor.
    ayarKayitli: pano.ayarKayitli,
    ozet,
  };
}

export type OdulSonuc = { ok: true } | { ok: false; hata: string };

export async function odulAyarKaydet(girdi: {
  isimGorunur: boolean;
  rozetAcik: boolean;
}): Promise<OdulSonuc> {
  const session = await requireAdmin();
  const r = await odulAyariYaz(girdi, session.worker_id ?? null);
  if (!r.ok) return { ok: false, hata: r.hata ?? "hata" };

  await audit(
    session.worker_id ?? null,
    "update",
    `odul_ayari:isim=${girdi.isimGorunur}:rozet=${girdi.rozetAcik}`
  );
  revalidatePath("/admin/odul");
  return { ok: true };
}

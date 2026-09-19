"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import {
  kiraciAyarlari,
  kiraciAyarlariniYaz,
  BIRIM_SISTEMLERI,
  type BirimSistemi,
} from "@/lib/tenant-settings";
import { auditChange } from "@/lib/audit-change";

/**
 * KİRACI AYARLARI — panelden yazma (migration 108).
 *
 * ═══ MOBİLLE AYNI ÇEKİRDEK ════════════════════════════════════════════════
 *
 * Yazma `lib/tenant-settings.ts` `kiraciAyarlariniYaz`den geçiyor; mobil
 * `PATCH /api/mobile/tenant` da aynı fonksiyonu çağırıyor. Doğrulama
 * (IANA adının `Intl` ile çözülmesi, birim kümesi) orada duruyor — iki yerde
 * iki kural olsaydı panelde kaydedilen bir dilim telefonda reddedilirdi ve
 * kullanıcı hangisinin doğru olduğunu bilemezdi.
 *
 * ═══ NEDEN requireAdmin, requireFleetView DEĞİL ═══════════════════════════
 *
 * İki ayar da FİLONUN TAMAMINI etkiliyor: saat dilimi gün sınırını (dolayısıyla
 * AZG gün atfını), ölçü birimi her ekranı. Filo şefi yalnız kendi filosundan
 * sorumlu; buradan yaptığı bir değişiklik karşı filonun raporunu da sessizce
 * oynatırdı. Kapsamı olan bir kullanıcıya kapsamsız bir kaldıraç vermek, yetki
 * tasarımında en sık yapılan hata (076'nın maliyet oranlarıyla aynı gerekçe).
 *
 * ═══ NEDEN BOŞ = VARSAYILANA DÖN ══════════════════════════════════════════
 *
 * Saat dilimi alanını boş bırakmak "UTC yap" değil, "ben girmiyorum, env/kod
 * varsayılanı geçerli olsun" demek. Kullanıcı kendi girdiği bir değerden GERİ
 * DÖNEBİLMELİ; dönüş yolu olmayan ayar, ayar değil tuzaktır.
 */

export type KiraciAyarSonuc = {
  ok: boolean;
  /** "tablo_yok" → migration 108 bekliyor; ekran bunu ayrı anlatır. */
  sebep?: "tablo_yok" | "hata" | "gecersiz";
  /** Hangi alan geçersiz — form o alanı işaretler. */
  alan?: string;
  hata?: string;
};

export async function saveTenantSettingsAction(
  formData: FormData
): Promise<KiraciAyarSonuc> {
  const session = await requireAdmin();

  const birimHam = String(formData.get("unit_system") ?? "").trim();
  if (birimHam && !(BIRIM_SISTEMLERI as readonly string[]).includes(birimHam)) {
    return { ok: false, sebep: "gecersiz", alan: "birimSistemi" };
  }
  // Seçici her zaman bir değer gönderir; boş gelirse "dokunma" sayılır.
  const birimSistemi = birimHam ? (birimHam as BirimSistemi) : undefined;

  // Boş dize → null → varsayılana dön. `undefined` ile karıştırılmamalı:
  // burada alan FORMDA VAR, kullanıcı onu bilerek boşalttı.
  const tzHam = String(formData.get("timezone") ?? "").trim();
  const saatDilimi = tzHam === "" ? null : tzHam;

  // ESKİ HÂL yazmadan ÖNCE okunur; sonra okusaydık "neydi" sorusunun cevabı
  // kaybolurdu.
  const once = await kiraciAyarlari();

  const sonuc = await kiraciAyarlariniYaz({ birimSistemi, saatDilimi }, session.worker_id ?? null);
  if (!sonuc.ok) {
    return { ok: false, sebep: sonuc.sebep, alan: sonuc.alan, hata: sonuc.mesaj };
  }

  const sonra = await kiraciAyarlari({ tazele: true });

  /**
   * İZ: saat dilimi GÜN SINIRINI oynatıyor — bir vardiyanın hangi güne
   * sayıldığı, AZG raporunun hangi güne düştüğü buna bağlı. "Bu ayarı kim, ne
   * zaman, neyden neye çevirdi" altı ay sonra sorulacak. Katman kapalıysa no-op.
   */
  await auditChange(
    session.worker_id ?? null,
    once.satir ? "update" : "create",
    "tenant_settings",
    "singleton",
    { unit_system: once.birimSistemi, timezone: once.satir?.timezone ?? null },
    { unit_system: sonra.birimSistemi, timezone: sonra.satir?.timezone ?? null }
  );

  // Gün sınırı değişmiş olabilir: pano, ayarlar ve şoför paneli bayatlamasın.
  revalidatePath("/admin");
  revalidatePath("/admin/ayarlar");
  revalidatePath("/panel");
  return { ok: true };
}

"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin, requireFleetView } from "@/lib/session";
import { audit } from "@/lib/security-log";
import { karlilikPanosu, listMusteriler, seferKmOlc, type KarlilikPanosu, type MusteriRow } from "@/lib/karlilik-db";
import { GELIR_MODELLERI, gelirTutari, type GelirModeli } from "@/lib/karlilik";

/**
 * KÂRLILIK — sunucu eylemleri (migration 085).
 *
 * ═══ İKİ AYRI KAPI ═══
 *   OKUMA  → `requireFleetView` (yönetici + filo şefi). Kârlılık bir yönetim
 *            ekranı; şef kendi filosunun işini yönetiyorsa görmeli.
 *   YAZMA  → `requireAdmin`. Gelir girmek PARA kaydıdır; şefe açık değil.
 *
 * Bu ayrım bilinçli: 084'te kapatma yetkisi şefe açıktı çünkü kapatma bir
 * OPERASYON kararı. Gelir girişi bir MUHASEBE kaydı — geri alınabilir ama
 * raporun tamamını değiştirir.
 */

const TABLO_YOK = new Set(["PGRST205", "42P01"]);
const tabloYokMu = (e: { code?: string; message?: string } | null) =>
  !!e && (TABLO_YOK.has(e.code ?? "") || /schema cache|does not exist/i.test(e.message ?? ""));

export type KarlilikSonuc = { ok: true } | { ok: false; hata: string };

// ═══════════════════════════ OKUMA ═══════════════════════════════════════

export type KarlilikGorunum = KarlilikPanosu & {
  musteriler: MusteriRow[];
  bas: string;
  bit: string;
};

/**
 * PANO — verilen aralık (varsayılan son 30 gün).
 *
 * `fleetLPer100Km` BİLEREK geçilmiyor: onu ölçen `buildFuelReport` ağır bir
 * rapor ve bu ekran onu beklememeli. `resolveCostRates` kendi düşüş zincirini
 * uygular ve etiketi "varsayılan" olur — ekran farkı GÖSTERİR, gizlemez.
 */
export async function getKarlilikPanosu(
  basGun?: string,
  bitGun?: string
): Promise<KarlilikGorunum> {
  const { session } = await requireFleetView();
  const bit = bitGun ? new Date(`${bitGun}T23:59:59Z`) : new Date();
  const bas = basGun
    ? new Date(`${basGun}T00:00:00Z`)
    : new Date(bit.getTime() - 30 * 86_400_000);

  await audit(session.worker_id ?? null, "page_view", "/admin/karlilik");

  const [pano, { satirlar: musteriler }] = await Promise.all([
    karlilikPanosu(bas, bit),
    listMusteriler(),
  ]);

  return {
    ...pano,
    musteriler,
    bas: bas.toISOString().slice(0, 10),
    bit: bit.toISOString().slice(0, 10),
  };
}

// ═══════════════════════════ MÜŞTERİ CRUD ════════════════════════════════

export async function musteriKaydet(girdi: {
  id?: string;
  ad: string;
  kod?: string | null;
  vergiNo?: string | null;
  adres?: string | null;
  iletisim?: string | null;
  notlar?: string | null;
}): Promise<KarlilikSonuc> {
  const session = await requireAdmin();
  const ad = girdi.ad.trim();
  if (ad.length < 1 || ad.length > 120) return { ok: false, hata: "ad_gecersiz" };

  const govde = {
    ad,
    kod: girdi.kod?.trim() || null,
    vergi_no: girdi.vergiNo?.trim() || null,
    adres: girdi.adres?.trim() || null,
    iletisim: girdi.iletisim?.trim() || null,
    notlar: girdi.notlar?.trim() || null,
  };

  const { error } = girdi.id
    ? await supabaseAdmin
        .from("musteriler")
        .update({ ...govde, updated_at: new Date().toISOString() })
        .eq("id", girdi.id)
    : await supabaseAdmin.from("musteriler").insert({ ...govde, created_by: session.worker_id ?? null });

  if (error) {
    if (tabloYokMu(error)) return { ok: false, hata: "tablo_yok" };
    // Aynı ad zaten var (kısmi tekil indeks, yalnız aktif satırlar).
    if (error.code === "23505") return { ok: false, hata: "ad_zaten_var" };
    return { ok: false, hata: "hata" };
  }

  await audit(session.worker_id ?? null, girdi.id ? "update" : "create", `musteri:${girdi.id ?? ad}`);
  revalidatePath("/admin/karlilik");
  return { ok: true };
}

/**
 * MÜŞTERİ SİLME — İKİ AŞAMALI (lint:crud kuralı).
 *
 * Seferi ya da geliri olan müşteri SİLİNMEZ, pasifleşir: geçmiş kârlılık
 * raporunun muhatabı odur, silinirse rapor "— müşteri yok" satırına düşer ve
 * geçmiş sessizce bozulur.
 */
export async function musteriSil(id: string): Promise<KarlilikSonuc & { pasiflesti?: boolean }> {
  const session = await requireAdmin();

  const { count } = await supabaseAdmin
    .from("seferler")
    .select("id", { count: "exact", head: true })
    .eq("musteri_id", id);

  if ((count ?? 0) > 0) {
    const { error } = await supabaseAdmin.from("musteriler").update({ aktif: false }).eq("id", id);
    if (error) return { ok: false, hata: "hata" };
    await audit(session.worker_id ?? null, "update", `musteri_pasif:${id}`);
    revalidatePath("/admin/karlilik");
    return { ok: true, pasiflesti: true };
  }

  const { error } = await supabaseAdmin.from("musteriler").delete().eq("id", id);
  if (error) {
    // FK başka bir yerden bağlıysa (gelir satırı, bölge) yine pasifleştir.
    if (error.code === "23503") {
      await supabaseAdmin.from("musteriler").update({ aktif: false }).eq("id", id);
      revalidatePath("/admin/karlilik");
      return { ok: true, pasiflesti: true };
    }
    if (tabloYokMu(error)) return { ok: false, hata: "tablo_yok" };
    return { ok: false, hata: "hata" };
  }
  await audit(session.worker_id ?? null, "delete", `musteri:${id}`);
  revalidatePath("/admin/karlilik");
  return { ok: true, pasiflesti: false };
}

/** Seferin müşterisini ata/kaldır. */
export async function seferMusteriAta(
  seferId: string,
  musteriId: string | null
): Promise<KarlilikSonuc> {
  const session = await requireAdmin();
  const { error } = await supabaseAdmin
    .from("seferler")
    .update({ musteri_id: musteriId })
    .eq("id", seferId);
  if (error) return { ok: false, hata: tabloYokMu(error) ? "tablo_yok" : "hata" };
  await audit(session.worker_id ?? null, "update", `sefer_musteri:${seferId}`);
  revalidatePath("/admin/karlilik");
  revalidatePath(`/admin/seferler/${seferId}`);
  return { ok: true };
}

// ═══════════════════════════ GELİR ═══════════════════════════════════════

export type GelirGirdi = {
  seferId: string;
  durakId?: string | null;
  model: GelirModeli;
  birimFiyat: number;
  miktar: number;
  miktarKaynak?: "elle" | "olculdu";
  aciklama?: string | null;
};

export async function gelirEkle(g: GelirGirdi): Promise<KarlilikSonuc & { tutar?: number }> {
  const session = await requireAdmin();

  if (!GELIR_MODELLERI.includes(g.model)) return { ok: false, hata: "model_gecersiz" };
  if (!Number.isFinite(g.birimFiyat) || g.birimFiyat < 0) return { ok: false, hata: "fiyat_gecersiz" };
  const miktar = g.model === "sefer" ? 1 : g.miktar;
  if (!Number.isFinite(miktar) || miktar < 0) return { ok: false, hata: "miktar_gecersiz" };

  const { error } = await supabaseAdmin.from("sefer_gelirleri").insert({
    sefer_id: g.seferId,
    durak_id: g.durakId ?? null,
    model: g.model,
    birim_fiyat: g.birimFiyat,
    miktar,
    miktar_kaynak: g.miktarKaynak ?? "elle",
    aciklama: g.aciklama?.trim() || null,
    created_by: session.worker_id ?? null,
  });

  if (error) return { ok: false, hata: tabloYokMu(error) ? "tablo_yok" : "hata" };

  await audit(session.worker_id ?? null, "create", `gelir:${g.seferId}`);
  revalidatePath("/admin/karlilik");
  revalidatePath(`/admin/seferler/${g.seferId}`);
  // Önizleme ile kaydın aynı sayıyı vermesi ekranda doğrulanabilsin diye
  // tutar geri dönüyor — DB'deki üretilmiş kolonun aynası.
  return { ok: true, tutar: gelirTutari(g.birimFiyat, miktar) };
}

/**
 * GELİR SATIRINI DÜZELT.
 *
 * Satır SİLİNİP yeniden yazılmıyor: `created_at`/`created_by` izi korunuyor.
 * `tutar_eur` üretilmiş kolon olduğu için birim fiyat ya da miktar
 * değiştiğinde tutar KENDİLİĞİNDEN yeniden hesaplanır — iki alanın
 * çelişmesi şema düzeyinde imkânsız.
 */
export async function gelirDuzelt(
  id: string,
  g: Omit<GelirGirdi, "seferId" | "durakId">
): Promise<KarlilikSonuc & { tutar?: number }> {
  const session = await requireAdmin();

  if (!GELIR_MODELLERI.includes(g.model)) return { ok: false, hata: "model_gecersiz" };
  if (!Number.isFinite(g.birimFiyat) || g.birimFiyat < 0) return { ok: false, hata: "fiyat_gecersiz" };
  const miktar = g.model === "sefer" ? 1 : g.miktar;
  if (!Number.isFinite(miktar) || miktar < 0) return { ok: false, hata: "miktar_gecersiz" };

  const { error } = await supabaseAdmin
    .from("sefer_gelirleri")
    .update({
      model: g.model,
      birim_fiyat: g.birimFiyat,
      miktar,
      miktar_kaynak: g.miktarKaynak ?? "elle",
      aciklama: g.aciklama?.trim() || null,
    })
    .eq("id", id);

  if (error) return { ok: false, hata: tabloYokMu(error) ? "tablo_yok" : "hata" };
  await audit(session.worker_id ?? null, "update", `gelir:${id}`);
  revalidatePath("/admin/karlilik");
  return { ok: true, tutar: gelirTutari(g.birimFiyat, miktar) };
}

export async function gelirSil(id: string): Promise<KarlilikSonuc> {
  const session = await requireAdmin();
  const { error } = await supabaseAdmin.from("sefer_gelirleri").delete().eq("id", id);
  if (error) return { ok: false, hata: tabloYokMu(error) ? "tablo_yok" : "hata" };
  await audit(session.worker_id ?? null, "delete", `gelir:${id}`);
  revalidatePath("/admin/karlilik");
  return { ok: true };
}

/**
 * ÖLÇÜLEN MİKTARI GETİR — form "ölçüldü" seçeneğini doldurabilsin.
 *
 * km   → odometre penceresi (ölçülemezse null, 0 DEĞİL)
 * saat → seferin kendi penceresi
 * paket → seferin teslimat sayısı (080)
 *
 * ⚠️ null dönen alanı form 0 ile doldurMAZ: kullanıcı elle girer ve kayıt
 * `miktar_kaynak='elle'` olur. Ölçülemeyeni ölçülmüş gibi işaretlemek, bu
 * ekranın tüm güvenilirliğini bitirirdi.
 */
export async function seferOlculenMiktar(seferId: string): Promise<{
  km: number | null;
  kmDurum: string;
  saat: number | null;
  paket: number | null;
}> {
  await requireFleetView();

  const { data } = await supabaseAdmin
    .from("seferler")
    .select("id, vehicle_id, yolda_at, tamamlandi_at")
    .eq("id", seferId)
    .maybeSingle();

  const s = data as { vehicle_id: string | null; yolda_at: string | null; tamamlandi_at: string | null } | null;
  if (!s) return { km: null, kmDurum: "pencere_yok", saat: null, paket: null };

  const km = await seferKmOlc(s.vehicle_id, s.yolda_at, s.tamamlandi_at);
  const saat =
    s.yolda_at && s.tamamlandi_at && Date.parse(s.tamamlandi_at) > Date.parse(s.yolda_at)
      ? Math.round(((Date.parse(s.tamamlandi_at) - Date.parse(s.yolda_at)) / 3_600_000) * 100) / 100
      : null;

  const { count } = await supabaseAdmin
    .from("teslimatlar")
    .select("id", { count: "exact", head: true })
    .eq("sefer_id", seferId)
    .is("iptal_at", null);

  return { km: km.km, kmDurum: km.durum, saat, paket: count ?? null };
}

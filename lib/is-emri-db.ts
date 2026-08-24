import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { tabloYokMu } from "@/lib/fault-reports";
import type { IsEmri, IsEmriDurum, IsEmriOncelik } from "@/lib/is-emri";

/**
 * İŞ EMRİ — veri katmanı (migration 081).
 *
 * ═══ NEDEN AYRI TABLO DEĞİL ═══
 *
 * İş emri `vehicle_fault_reports` tablosunda yaşıyor. Ölçüldü (25.08.2026):
 * o tablo canlıda VAR ama 0 satır; şoförün "arıza bildir" yüzeyi (mobil U7)
 * oraya yazıyor. Ayrı bir iş emri tablosu açsaydık "bu araçta ne sorun var"
 * sorusunun İKİ listesi olurdu ve yönetici ikisine birden bakmak zorunda
 * kalırdı. Kaynak farkı `kaynak` kolonunda: surucu · dvir · dtc · periyodik ·
 * elle.
 *
 * ═══ BU DOSYA İLE lib/fault-reports-db.ts AYRIMI ═══
 *
 * `fault-reports-db.ts` MOBİL sözleşmedir (U7): dar alan kümesi, acik/kapali.
 * Bu dosya PANEL yüzeyidir: öncelik, atanan, maliyet, servis tarihi, üçüncü
 * durum. İkisi aynı tabloyu okur; ortak olan tek şey satırın kendisi.
 * ⚠️ Mobil uç yalnız acik/kapali gönderiyor — 'serviste' panelden atanır ve
 * mobil onu "açık değil, kapalı değil" diye değil, ham değeriyle görür.
 */

// Sabitler ve satır türü `lib/is-emri.ts`te — İSTEMCİ de onları import ediyor
// ve bu dosya `server-only`. Aynı listeyi iki yerde tanımlamak yerine tek
// kaynak orada; buradan yeniden dışa aktarılıyor.
export {
  IS_EMRI_DURUMLARI,
  IS_EMRI_ONCELIKLERI,
  IS_EMRI_KAYNAKLARI,
  type IsEmriDurum,
  type IsEmriOncelik,
  type IsEmriKaynak,
  type IsEmri,
} from "@/lib/is-emri";

const COLS =
  "id, vehicle_id, reported_by, aciklama, durum, created_at, closed_at, kaynak, oncelik, atanan_id, maliyet, servis_at, kapanis_notu, dvir_yanit_id";

export type IsEmriSonuc<T> =
  | { ok: true; veri: T }
  | { ok: false; sebep: "tablo_yok" | "yok" | "hata"; mesaj?: string };

async function zenginlestir(satirlar: Record<string, unknown>[]): Promise<IsEmri[]> {
  if (satirlar.length === 0) return [];
  const aracIds = [...new Set(satirlar.map((r) => String(r.vehicle_id)))];
  const kisiIds = [
    ...new Set(
      satirlar.flatMap((r) => [String(r.reported_by), r.atanan_id ? String(r.atanan_id) : null])
    ),
  ].filter(Boolean) as string[];

  const [{ data: vRows }, { data: wRows }] = await Promise.all([
    supabaseAdmin.from("vehicles").select("id, plate").in("id", aracIds),
    kisiIds.length
      ? supabaseAdmin.from("workers").select("id, name").in("id", kisiIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const plaka = new Map(((vRows ?? []) as { id: string; plate: string }[]).map((v) => [v.id, v.plate]));
  const ad = new Map(((wRows ?? []) as { id: string; name: string }[]).map((w) => [w.id, w.name]));

  return satirlar.map((r) => ({
    id: String(r.id),
    vehicleId: String(r.vehicle_id),
    plaka: plaka.get(String(r.vehicle_id)) ?? "—",
    aciklama: String(r.aciklama),
    durum: String(r.durum) as IsEmriDurum,
    oncelik: String(r.oncelik ?? "normal") as IsEmriOncelik,
    kaynak: String(r.kaynak ?? "surucu"),
    bildirenId: String(r.reported_by),
    bildirenAd: ad.get(String(r.reported_by)) ?? "—",
    atananId: r.atanan_id ? String(r.atanan_id) : null,
    atananAd: r.atanan_id ? (ad.get(String(r.atanan_id)) ?? "—") : null,
    maliyet: r.maliyet == null ? null : Number(r.maliyet),
    servisAt: r.servis_at ? String(r.servis_at) : null,
    kapanisNotu: r.kapanis_notu ? String(r.kapanis_notu) : null,
    createdAt: String(r.created_at),
    closedAt: r.closed_at ? String(r.closed_at) : null,
  }));
}

/**
 * İş emirleri.
 *
 * `yalnizAcik` varsayılan TRUE: yöneticinin ekranı bir KUYRUKTUR, arşiv değil.
 * Kapanmışları görmek isteyen açıkça ister.
 */
export async function listIsEmirleri(opts?: {
  vehicleIds?: string[] | null;
  yalnizAcik?: boolean;
  limit?: number;
}): Promise<{ emirler: IsEmri[]; tabloYok: boolean }> {
  let q = supabaseAdmin.from("vehicle_fault_reports").select(COLS);
  if (opts?.vehicleIds) {
    if (opts.vehicleIds.length === 0) return { emirler: [], tabloYok: false };
    q = q.in("vehicle_id", opts.vehicleIds);
  }
  if (opts?.yalnizAcik !== false) q = q.neq("durum", "kapali");
  const { data, error } = await q
    .order("created_at", { ascending: false })
    .limit(opts?.limit ?? 100);
  if (error) return { emirler: [], tabloYok: tabloYokMu(error) };
  return { emirler: await zenginlestir((data ?? []) as Record<string, unknown>[]), tabloYok: false };
}

/**
 * AÇIK iş emri olan araçlar — "sorunlu" rozetinin tek kaynağı.
 *
 * ⚠️ `vehicles`a bayrak yazılmıyor: açık emrin varlığı zaten gerçeğin kendisi.
 * Bayrak koysaydık kapanışta güncellemeyi unutan bir yol, sonsuza dek sorunlu
 * görünen bir araç bırakırdı.
 */
export async function sorunluAraclar(
  vehicleIds?: string[] | null
): Promise<{ harita: Map<string, number>; tabloYok: boolean }> {
  let q = supabaseAdmin.from("vehicle_fault_reports").select("vehicle_id").neq("durum", "kapali");
  if (vehicleIds) {
    if (vehicleIds.length === 0) return { harita: new Map(), tabloYok: false };
    q = q.in("vehicle_id", vehicleIds);
  }
  const { data, error } = await q;
  if (error) return { harita: new Map(), tabloYok: tabloYokMu(error) };
  const harita = new Map<string, number>();
  for (const r of (data ?? []) as { vehicle_id: string }[]) {
    harita.set(r.vehicle_id, (harita.get(r.vehicle_id) ?? 0) + 1);
  }
  return { harita, tabloYok: false };
}

export async function getIsEmri(id: string): Promise<IsEmri | null> {
  const { data, error } = await supabaseAdmin
    .from("vehicle_fault_reports")
    .select(COLS)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  const [e] = await zenginlestir([data as Record<string, unknown>]);
  return e ?? null;
}

/** Elle iş emri (panelden) — kaynak 'elle' ya da 'dtc'. */
export async function createIsEmri(
  g: {
    vehicleId: string;
    aciklama: string;
    oncelik?: IsEmriOncelik;
    kaynak?: "elle" | "dtc" | "periyodik";
    atananId?: string | null;
  },
  actorWorkerId: string
): Promise<IsEmriSonuc<{ id: string }>> {
  const { data, error } = await supabaseAdmin
    .from("vehicle_fault_reports")
    .insert({
      vehicle_id: g.vehicleId,
      reported_by: actorWorkerId,
      aciklama: g.aciklama.trim().slice(0, 1000),
      durum: "acik",
      kaynak: g.kaynak ?? "elle",
      oncelik: g.oncelik ?? "normal",
      atanan_id: g.atananId ?? null,
    })
    .select("id")
    .maybeSingle();
  if (error || !data) {
    return { ok: false, sebep: error && tabloYokMu(error) ? "tablo_yok" : "hata", mesaj: error?.message };
  }
  return { ok: true, veri: { id: String((data as { id: string }).id) } };
}

/**
 * İş emrini günceller: durum, öncelik, atanan, maliyet, servis tarihi, kapanış.
 *
 * ⚠️ AÇIKLAMA DEĞİŞTİRİLEMEZ. Kusurun ne olduğu, bildirildiği andaki hâliyle
 * kalır — DVIR yolunda o metin kontrol formundaki kanıttan doğuyor ve onu
 * sonradan yeniden yazmak, kanıtı yeniden yazmak olurdu.
 */
export async function updateIsEmri(
  id: string,
  yama: {
    durum?: IsEmriDurum;
    oncelik?: IsEmriOncelik;
    atananId?: string | null;
    maliyet?: number | null;
    servisAt?: string | null;
    kapanisNotu?: string | null;
  },
  actorWorkerId: string | null
): Promise<IsEmriSonuc<{ id: string }>> {
  const satir: Record<string, unknown> = {};
  if (yama.durum) satir.durum = yama.durum;
  if (yama.oncelik) satir.oncelik = yama.oncelik;
  if (yama.atananId !== undefined) satir.atanan_id = yama.atananId;
  if (yama.maliyet !== undefined) satir.maliyet = yama.maliyet;
  if (yama.servisAt !== undefined) satir.servis_at = yama.servisAt;
  if (yama.kapanisNotu !== undefined) satir.kapanis_notu = yama.kapanisNotu?.slice(0, 500) ?? null;

  /**
   * KAPANIŞ DAMGASI kapanışla birlikte düşer, tekrar açılışta SİLİNİR.
   * 057'nin kuralı: "aynı durum ikinci kez YAZMAZ" — burada da kapalıyı
   * kapalıya çekmek damgayı tazelemesin diye koşul aşağıda `.neq`.
   */
  if (yama.durum === "kapali") {
    satir.closed_at = new Date().toISOString();
    satir.closed_by = actorWorkerId;
  } else if (yama.durum) {
    satir.closed_at = null;
    satir.closed_by = null;
  }

  if (Object.keys(satir).length === 0) return { ok: false, sebep: "hata", mesaj: "bos_yama" };

  let q = supabaseAdmin.from("vehicle_fault_reports").update(satir).eq("id", id);
  // Kapalıyı tekrar kapatmak damgayı tazelemesin.
  if (yama.durum === "kapali") q = q.neq("durum", "kapali");

  const { data, error } = await q.select("id").maybeSingle();
  if (error) {
    return { ok: false, sebep: tabloYokMu(error) ? "tablo_yok" : "hata", mesaj: error.message };
  }
  // `data` null = satır zaten o durumdaydı. Hata DEĞİL: istenen sonuç zaten var.
  return { ok: true, veri: { id: data ? String((data as { id: string }).id) : id } };
}

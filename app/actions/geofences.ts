"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/session";
import { geofenceSchema } from "@/lib/validation";
import type { Geofence } from "@/lib/types";
import { auditChange } from "@/lib/audit-change";
import { bolgeZiyaretleriniKapat } from "@/lib/zone-visits";

export type GeofenceResultAction = { ok: boolean; error?: string; id?: string };

const COLS_BASE =
  "id, name, type, center_lat, center_lng, radius_m, rule_kind, active, created_at";
const COLS = COLS_BASE + ", purpose";
const COLS_FULL = COLS + ", customer_name, min_dwell_s";

/**
 * Bölgeleri okur — ÜÇ KADEMELİ düşüş (migration-öncesi dayanıklılık deseni).
 *
 *   064 var → COLS_FULL (müşteri alanları dahil)
 *   034 var → COLS      (purpose var, müşteri alanları yok)
 *   ikisi de yok → COLS_BASE, purpose='rule' varsayılır
 *
 * Kademeyi ATLAMAK sessiz bir hata olurdu: 064 koşulmamış bir veritabanında
 * doğrudan COLS_BASE'e düşseydik `purpose` de kaybolur, DEPO bölgeleri normal
 * kural bölgesine dönüşür ve vardiya otomatiği sessizce ölürdü.
 */
async function selectZones(activeOnly: boolean): Promise<Geofence[]> {
  const q0 = supabaseAdmin.from("geofences").select(COLS_FULL);
  const { data: d0, error: e0 } = await (activeOnly ? q0.eq("active", true) : q0).order(
    "created_at",
    { ascending: false }
  );
  if (!e0 && d0) return d0 as unknown as Geofence[];
  const q1 = supabaseAdmin.from("geofences").select(COLS);
  const { data, error } = await (activeOnly ? q1.eq("active", true) : q1).order(
    "created_at",
    { ascending: false }
  );
  if (!error && data) return data as unknown as Geofence[];
  const q2 = supabaseAdmin.from("geofences").select(COLS_BASE);
  const { data: d2 } = await (activeOnly ? q2.eq("active", true) : q2).order(
    "created_at",
    { ascending: false }
  );
  return ((d2 ?? []) as unknown as Omit<Geofence, "purpose">[]).map((z) => ({
    ...z,
    purpose: "rule" as const,
  }));
}

/** All zones (admin management list). */
export async function getGeofences(): Promise<Geofence[]> {
  await requireAdmin();
  return selectZones(false);
}

/** Active zones only — the set fed to computeGeofenceEvents. Degrades to an empty
 *  list if the table doesn't exist yet (migration 015 not run). */
export async function getActiveGeofences(): Promise<Geofence[]> {
  await requireAdmin();
  return selectZones(true);
}

function parse(formData: FormData) {
  return geofenceSchema.safeParse({
    name: formData.get("name"),
    center_lat: formData.get("center_lat"),
    center_lng: formData.get("center_lng"),
    radius_m: formData.get("radius_m"),
    rule_kind: formData.get("rule_kind"),
    purpose: formData.get("purpose") ?? undefined,
    customer_name: formData.get("customer_name") ?? undefined,
    min_dwell_s: formData.get("min_dwell_s") ?? undefined,
  });
}

/**
 * Müşteri alanları — amaç 'customer' DEĞİLSE temizlenir.
 *
 * Temizlemek (null/varsayılan yazmak) atlamaktan daha doğru: bir bölge
 * müşteriden kurala çevrildiğinde eski müşteri adı satırda kalsaydı, rapor
 * onu artık okumasa bile denetim izinde yanlış bir gerçek gibi dururdu.
 */
function musteriAlanlari(d: { purpose: string; customer_name: string | null; min_dwell_s: number }) {
  return d.purpose === "customer"
    ? { customer_name: d.customer_name, min_dwell_s: d.min_dwell_s }
    : { customer_name: null, min_dwell_s: 120 };
}

/**
 * 064 YOKSA YAZMA DA DÜŞMELİ — okuma tarafındaki kademeli düşüşün karşılığı.
 *
 * 19.08.2026'da ölçüldü: `customer_name` / `min_dwell_s` kolonları HER yazmaya
 * ekleniyordu. 064 koşulmamış bir kurulumda (demo) bu, **kural bölgesi bile
 * oluşturulamaz** hâle getirdi — üstelik kullanıcıya yalnız "Kaydedilemedi"
 * diyerek, sebebini söylemeden. Bir müşteri bölgesi ÖZELLİĞİ eklerken mevcut
 * bölge yönetimini kırmak kabul edilemez.
 *
 * Kural: yeni kolonlar yalnız VARSA yazılır. Kolon yoksa (`42703` /
 * PostgREST `PGRST204`) aynı satır o alanlar olmadan yeniden denenir ve eski
 * davranış aynen sürer. Yalnız `purpose='customer'` gerçekten 064'e muhtaçtır;
 * o durumda sessizce kural bölgesine düşmek YANLIŞ olurdu (kullanıcı ölçüm
 * açtığını sanır, hiç ölçüm olmaz) → ayrı hata koduyla reddedilir.
 */
function kolonYok(e: { code?: string; message?: string } | null): boolean {
  if (!e) return false;
  if (e.code === "42703" || e.code === "PGRST204") return true;
  const m = (e.message ?? "").toLowerCase();
  return m.includes("customer_name") || m.includes("min_dwell_s");
}

/** Müşteri alanları çıkarılmış kopya — 064 öncesi kurulumlar için. */
function musterisiz<T extends Record<string, unknown>>(satir: T): Record<string, unknown> {
  const kalan: Record<string, unknown> = { ...satir };
  delete kalan.customer_name;
  delete kalan.min_dwell_s;
  return kalan;
}

export async function createGeofence(
  formData: FormData
): Promise<GeofenceResultAction> {
  const session = await requireAdmin();
  const parsed = parse(formData);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "validation" };
  }
  const satir = {
    name: parsed.data.name,
    type: "circle",
    center_lat: parsed.data.center_lat,
    center_lng: parsed.data.center_lng,
    radius_m: parsed.data.radius_m,
    rule_kind: parsed.data.rule_kind,
    purpose: parsed.data.purpose,
    // Müşteri alanları YALNIZ purpose='customer' iken dolar: bir kural
    // bölgesine müşteri adı iliştirmek raporda hayalet satır üretirdi.
    ...musteriAlanlari(parsed.data),
    active: true,
  };
  let { data, error } = await supabaseAdmin
    .from("geofences")
    .insert(satir)
    .select("id")
    .maybeSingle();
  if (kolonYok(error)) {
    // 064 yok. Müşteri bölgesi gerçekten imkânsız; diğer amaçlar eskisi gibi.
    if (parsed.data.purpose === "customer") return { ok: false, error: "musteri_kapali" };
    ({ data, error } = await supabaseAdmin
      .from("geofences")
      .insert(musterisiz(satir))
      .select("id")
      .maybeSingle());
  }
  if (error || !data) return { ok: false, error: error?.message ?? "insert" };
  // Değişiklik izi: bölge sınırı vardiya OTOMATININ girdisidir (depo tetiği),
  // yani buradaki bir değişiklik vardiya kayıtlarını dolaylı olarak etkiler.
  await auditChange(session.worker_id ?? null, "create", "geofences",
    data.id as string, null, { ...parsed.data, active: true });
  revalidatePath("/admin/bolgeler");
  return { ok: true, id: data.id as string };
}

export async function updateGeofence(
  formData: FormData
): Promise<GeofenceResultAction> {
  const session = await requireAdmin();
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return { ok: false, error: "id" };
  const parsed = parse(formData);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "validation" };
  }
  // ESKİ HÂL yazmadan ÖNCE okunur — sonrasında okumak yeni değeri verirdi ve
  // iz "neyin neye döndüğünü" söyleyemezdi.
  const { data: once } = await supabaseAdmin
    .from("geofences")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  const yama = {
    name: parsed.data.name,
    center_lat: parsed.data.center_lat,
    center_lng: parsed.data.center_lng,
    radius_m: parsed.data.radius_m,
    rule_kind: parsed.data.rule_kind,
    purpose: parsed.data.purpose,
    ...musteriAlanlari(parsed.data),
  };
  let { error } = await supabaseAdmin.from("geofences").update(yama).eq("id", id);
  if (kolonYok(error)) {
    if (parsed.data.purpose === "customer") return { ok: false, error: "musteri_kapali" };
    ({ error } = await supabaseAdmin.from("geofences").update(musterisiz(yama)).eq("id", id));
  }
  if (error) return { ok: false, error: error.message };
  await auditChange(session.worker_id ?? null, "update", "geofences", id,
    once as Record<string, unknown> | null, parsed.data);
  revalidatePath("/admin/bolgeler");
  return { ok: true, id };
}

export async function toggleGeofence(
  id: string,
  active: boolean
): Promise<GeofenceResultAction> {
  const session = await requireAdmin();
  const { data: once } = await supabaseAdmin
    .from("geofences")
    .select("id, name, active")
    .eq("id", id)
    .maybeSingle();
  const { error } = await supabaseAdmin
    .from("geofences")
    .update({ active })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  // Bölge ölçümden çıkıyorsa açık ziyaretleri ASKIDA BIRAKMA (#136): ölçüm
  // durduğu an onlar da kapanmalı, yoksa rapor süresiz "devam ediyor" gösterir.
  if (!active) await bolgeZiyaretleriniKapat(id);
  await auditChange(session.worker_id ?? null, "update", "geofences", id,
    once as Record<string, unknown> | null, { active });
  revalidatePath("/admin/bolgeler");
  return { ok: true, id };
}

export async function deleteGeofence(id: string): Promise<GeofenceResultAction> {
  const session = await requireAdmin();
  // SİLMEDE TAM KAYIT: satır gittikten sonra ne olduğunu okumanın başka yolu
  // kalmıyor, bu yüzden bütün alanlar ize yazılır.
  const { data: once } = await supabaseAdmin
    .from("geofences")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  const { error } = await supabaseAdmin.from("geofences").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  await auditChange(session.worker_id ?? null, "delete", "geofences", id,
    once as Record<string, unknown> | null, null);
  revalidatePath("/admin/bolgeler");
  return { ok: true, id };
}

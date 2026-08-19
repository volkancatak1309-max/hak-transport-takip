import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import type { Geofence, GeofencePurpose } from "@/lib/types";

/**
 * BÖLGE VERİ KATMANI — panelin ve mobilin ORTAK kaynağı.
 *
 * ═══ NEDEN BU DOSYA VAR (19.08.2026) ═══
 *
 * CRUD, `app/actions/geofences.ts` içinde `"use server"` action'ların gövdesiydi
 * ve her biri `requireAdmin()` ile başlıyordu — yani ÇEREZ okuyan bir kapı.
 * Mobil uçlarda çerez YOK (token var); o action'lar bir route handler'dan
 * çağrılamaz, `requireAdmin` yönlendirme fırlatır. AZG raporunda (Tur 3) aynı
 * durum yaşandı ve aynı çözüm uygulandı: hesap/yazma lib'e taşınır, action
 * kapı + devir olarak kalır.
 *
 * ⚠️ KAPI BURADA YOK. Çağıran yetkiyi KENDİ denetler:
 *   · panel → app/actions/geofences.ts (requireAdmin)
 *   · mobil → app/api/mobile/geofences/** (requireMobileAdmin)
 * Bu dosyayı kapısız bir yerden çağırmak, bölge yazmasını herkese açmaktır.
 *
 * ═══ İKİ EKSEN, BİRBİRİNE KARIŞTIRILMAZ ═══
 *
 *   category = GÖRSEL kategori ('depot' | 'customer' | 'restricted' | 'custom')
 *              Rozet. MOTOR OKUMAZ. Mobil bunu serbestçe yazar.
 *   purpose  = DAVRANIŞ anahtarı ('rule' | 'depot')
 *              purpose='depot' beş şeyi sürüyor: otomatik vardiya tetiği, depo
 *              kilidi, başlangıç anı türetme, şoför paneli rozeti, kural
 *              değerlendirmesinden muafiyet.
 *
 * ⚠️ MOBİL `purpose` YAZMAZ (bilinçli). Yazabilseydi telefondaki bir menü
 * seçimi otomatik vardiya başlatmayı kapatabilirdi; ölçüldü (18.08.2026):
 * son 30 günde 511 vardiyanın 346'sı (%68) depo tetiğiyle açılıyor ve canlıda
 * yalnız 2 depo bölgesi var. Mobilden açılan her bölge purpose='rule' doğar;
 * gerçek depo tanımlamak PANELİN işidir.
 *
 * ═══ ARŞİV ═══
 * `archived_at` null = arşivde değil. Arşivlemek bölgeyi AYNI ZAMANDA KAPATIR
 * (active=false) — böylece motor filtresi (`active=true`) arşivliyi zaten
 * dışarıda bırakır ve lib/depot.ts'e tek satır dokunmak gerekmez. Geri alma
 * AÇMAZ: kapalı döner, açmak ayrı ve bilinçli bir eylemdir.
 */

export const GEOFENCE_CATEGORIES = [
  "depot",
  "customer",
  "restricted",
  "custom",
] as const;
export type GeofenceCategory = (typeof GEOFENCE_CATEGORIES)[number];

/** Tabloda okunan tam satır (015 + 034 + kategori/arşiv migration'ları). */
export type GeofenceRow = Geofence & {
  category: GeofenceCategory;
  archived_at: string | null;
};

const COLS =
  "id, name, type, center_lat, center_lng, radius_m, rule_kind, active, created_at, purpose, category, archived_at";

export type ListeSecenek = {
  /** true → arşivliler de gelir. Varsayılan false (arşivli gizli). */
  arsivDahil?: boolean;
  /** true → yalnız aktif olanlar (motor değerlendirmesi için). */
  yalnizAktif?: boolean;
};

/** Bölgeleri okur; en yeni önce. */
export async function listGeofences(
  secenek: ListeSecenek = {}
): Promise<GeofenceRow[]> {
  let q = supabaseAdmin.from("geofences").select(COLS);
  if (!secenek.arsivDahil) q = q.is("archived_at", null);
  if (secenek.yalnizAktif) q = q.eq("active", true);
  const { data, error } = await q.order("created_at", { ascending: false });
  if (error) throw new Error(`geofences_list:${error.code}:${error.message}`);
  return (data ?? []) as unknown as GeofenceRow[];
}

export async function getGeofenceById(id: string): Promise<GeofenceRow | null> {
  const { data, error } = await supabaseAdmin
    .from("geofences")
    .select(COLS)
    .eq("id", id)
    .maybeSingle();
  if (error) return null;
  return (data as unknown as GeofenceRow) ?? null;
}

export type GeofenceCreate = {
  name: string;
  center_lat: number;
  center_lng: number;
  radius_m: number;
  category: GeofenceCategory;
  /**
   * DAVRANIŞ anahtarı. Mobil bunu GEÇMEZ → 'rule' doğar (bkz. dosya başlığı).
   * Panel geçer, çünkü depo tanımlamak panelin işidir.
   */
  purpose?: GeofencePurpose;
  rule_kind?: Geofence["rule_kind"];
};

/** Yeni bölge. `active` daima true doğar — panelin bugünkü davranışı. */
export async function insertGeofence(g: GeofenceCreate): Promise<GeofenceRow> {
  const { data, error } = await supabaseAdmin
    .from("geofences")
    .insert({
      name: g.name,
      type: "circle",
      center_lat: g.center_lat,
      center_lng: g.center_lng,
      radius_m: g.radius_m,
      rule_kind: g.rule_kind ?? "forbidden",
      purpose: g.purpose ?? "rule",
      category: g.category,
      active: true,
    })
    .select(COLS)
    .maybeSingle();
  if (error || !data) {
    throw new Error(`geofences_insert:${error?.code ?? "?"}:${error?.message ?? "insert"}`);
  }
  return data as unknown as GeofenceRow;
}

/**
 * KISMİ güncelleme — yalnız VERİLEN alanlar yazılır.
 *
 * `undefined` "dokunma" demektir; `null` hiçbir alan için geçerli değer değil.
 * Bu ayrım PATCH'in tamamı: istemci yalnız yarıçapı gönderdiğinde adın
 * silinmemesi buna bağlı.
 */
export type GeofencePatch = Partial<
  Pick<GeofenceRow, "name" | "center_lat" | "center_lng" | "radius_m" | "category">
> &
  Partial<Pick<GeofenceRow, "purpose" | "rule_kind">>;

export async function patchGeofence(
  id: string,
  yama: GeofencePatch
): Promise<GeofenceRow | null> {
  const alanlar = Object.fromEntries(
    Object.entries(yama).filter(([, v]) => v !== undefined)
  );
  if (Object.keys(alanlar).length === 0) return getGeofenceById(id);
  const { data, error } = await supabaseAdmin
    .from("geofences")
    .update(alanlar)
    .eq("id", id)
    .select(COLS)
    .maybeSingle();
  if (error) throw new Error(`geofences_patch:${error.code}:${error.message}`);
  return (data as unknown as GeofenceRow) ?? null;
}

/** Aç/kapa — panelin `toggleGeofence`iyle aynı tek alanlık güncelleme. */
export async function setGeofenceActive(
  id: string,
  active: boolean
): Promise<GeofenceRow | null> {
  const { data, error } = await supabaseAdmin
    .from("geofences")
    .update({ active })
    .eq("id", id)
    .select(COLS)
    .maybeSingle();
  if (error) throw new Error(`geofences_active:${error.code}:${error.message}`);
  return (data as unknown as GeofenceRow) ?? null;
}

/**
 * Arşivle / arşivden çıkar.
 *
 * ⚠️ ASİMETRİK ve bilinçli:
 *   arşivle    → archived_at = now VE active = false
 *   geri al    → archived_at = null, `active` DEĞİŞMEZ (kapalı döner)
 *
 * Arşivlemenin kapatması, motor filtresini (`active=true`) kendiliğinden doğru
 * yapar — `lib/depot.ts`'e dokunmadan. Geri almanın açmaması ise bir bölgeyi
 * arşivden çıkarmanın onu sessizce yeniden devreye sokmasını engeller: bir depo
 * bölgesi geri alındığı anda otomatik vardiya tetiği tekrar canlanırdı.
 */
export async function setGeofenceArchived(
  id: string,
  arsiv: boolean
): Promise<GeofenceRow | null> {
  const alanlar = arsiv
    ? { archived_at: new Date().toISOString(), active: false }
    : { archived_at: null };
  const { data, error } = await supabaseAdmin
    .from("geofences")
    .update(alanlar)
    .eq("id", id)
    .select(COLS)
    .maybeSingle();
  if (error) throw new Error(`geofences_archive:${error.code}:${error.message}`);
  return (data as unknown as GeofenceRow) ?? null;
}

/** Mobil JSON gövdesi — tek biçim, beş uç da bunu döndürür. */
export function geofenceGovdesi(z: GeofenceRow) {
  return {
    id: z.id,
    ad: z.name,
    kategori: z.category,
    lat: z.center_lat,
    lng: z.center_lng,
    yaricapM: z.radius_m,
    aktif: z.active,
    archivedAt: z.archived_at,
    /**
     * DAVRANIŞ anahtarı, SALT OKUNUR. Kategori rozetiyle karıştırılmasın:
     * bir bölge kategori olarak "depot" görünüp vardiya tetiği OLMAYABİLİR
     * (mobilden açılan bölgeler böyledir). Ekran "otomatik vardiya başlatır"
     * ibaresini kategoriye değil BUNA bakarak göstermeli.
     */
    vardiyaTetigi: z.purpose === "depot",
    olusturuldu: z.created_at,
  };
}

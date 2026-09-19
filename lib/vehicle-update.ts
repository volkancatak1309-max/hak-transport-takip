import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { getDriverScope } from "@/lib/driver-scope";
import { auditChange } from "@/lib/audit-change";
import type { Vehicle } from "@/lib/types";

/**
 * ARAÇ YAZMA ÇEKİRDEĞİ — panelin ve mobilin ORTAK kaynağı (19.09.2026).
 *
 * ═══ NEDEN BU DOSYA VAR ════════════════════════════════════════════════════
 *
 * `app/actions/vehicles.ts` `"use server"` action'ları ÇEREZ okuyan bir kapıyla
 * (`requireAdmin()`) başlıyor; mobil uçta çerez yok, jeton var. Bölge katmanında
 * (lib/geofences-db.ts) ve AZG raporunda aynı durum yaşandı ve aynı çözüm
 * uygulandı: hesap/yazma lib'e taşınır, action kapı + devir olarak kalır.
 *
 * ⚠️ KAPI BURADA YOK. Çağıran yetkiyi KENDİ denetler:
 *   · panel → app/actions/vehicles.ts (requireAdmin)
 *   · mobil → app/api/mobile/vehicles/** (requireMobileAdmin)
 * Bu dosyayı kapısız bir yerden çağırmak, araç yazmasını herkese açmaktır.
 *
 * ═══ KISMİ GÜNCELLEME — "YOK" İLE "NULL" AYRI ŞEYLER ══════════════════════
 *
 * Panelin formu HER alanı gönderir; bu yüzden `updateVehicle` bugüne kadar
 * bütün kolonları birden yazıyor ve gövdede olmayanı `null`a çekiyordu. Bu bir
 * FORM davranışıdır, bir VERİ kuralı değil. PATCH'te aynısını yapmak felaket
 * olurdu: telefondan yalnız muayene tarihini düzelten bir yönetici, aracın
 * IMEI'sini, depo hacmini ve şoför atamasını da silerdi.
 *
 * Bu yüzden çekirdek YAMA (`Partial`) alır:
 *   · alan YOK (`undefined`) → DOKUNULMAZ
 *   · alan `null`            → o kolon GERÇEKTEN boşaltılır (bilinçli silme)
 * Panel davranışı değişmedi: action bütün alanları AÇIKÇA geçiyor, yani eskisi
 * gibi hepsi yazılıyor.
 *
 * ═══ KORUNAN KURALLAR (hepsi panelden, hiçbiri yeniden yazılmadı) ══════════
 *   · plaka BÜYÜK harf (`plate.toUpperCase()`),
 *   · plaka / IMEI / flespi cihaz kimliği TEKİL — çakışan aracın PLAKASI
 *     söylenir, ham 23505 gösterilmez,
 *   · araca yönetici/test hesabı ŞOFÖR olarak atanamaz (`assertDriverAssignable`),
 *   · bir şoför tek araca atanır; eski aracı serbest bırakılır ve
 *     `workers.plate` aynası hizalanır (`applyDriverAssignment`),
 *   · plaka değişince atama aynı kalsa bile ayna yeniden yazılır,
 *   · `auditChange` izi ESKİ HÂL ile birlikte düşer.
 */

export type AracYama = Partial<{
  plate: string;
  make: string | null;
  model: string | null;
  year: number | null;
  status: Vehicle["status"];
  fleet: Vehicle["fleet"];
  assigned_worker_id: string | null;
  flespi_device_id: number | null;
  imei: string | null;
  inspection_due: string | null;
  insurance_due: string | null;
  tank_capacity_l: number | null;
  fuel_type: string;
  notes: string | null;
}>;

export type AracSonuc =
  | { ok: true; id: string; degisen: string[] }
  | { ok: false; error: string; conflict?: string };

/**
 * Araca ŞOFÖR OLMAYAN biri atanamaz (yönetici / test hesabı).
 *
 * Seçici zaten yalnız şoför gösteriyor ama bu SUNUCU kapısı istemciye güvenmez.
 * Kritik olan yanı: `vehicles.assigned_worker_id`, olayların şoför eksenine
 * çevrildiği TEK bağdır (lib/analytics.ts resolveDriver). Buraya bir yönetici
 * yazılırsa Top-10, Rölanti Panosu ve Aylık Pivot'ta o aracın olayları
 * "Atanmamış" satırına düşer — sızıntı olmaz ama aracın gerçek sahibi kaybolur.
 *
 * null (atamayı temizleme) her zaman serbest. Şefler is_admin=false → geçer.
 */
export async function assertDriverAssignable(
  workerId: string | null
): Promise<AracSonuc | null> {
  if (!workerId) return null;
  const driverScope = await getDriverScope();
  if (driverScope.isDriver(workerId)) return null;
  return { ok: false, error: "Yönetici hesabı araca şoför olarak atanamaz" };
}

/**
 * Atama yazıldıktan SONRA çalışan tutarlılık adımı.
 *
 *  1) Bir şoför aynı anda tek araca atanabilir: şoför paneli ve Çalışanlar
 *     sayfası ilişkiden TEK araç okur (limit 1), ikinci atama sessizce
 *     görünmez olurdu. Bu yüzden şoförün varsa eski aracı serbest bırakılır.
 *  2) `workers.plate` AYNASI. Kanonik kaynak `vehicles.assigned_worker_id` ama
 *     eski okuma noktaları (harita şoför listesi, rota geçmişi, seferler,
 *     session.plate) hâlâ `workers.plate`e bakıyor. Ayna burada güncellenmezse
 *     bu ekranlar yeni personelde kalıcı "—" gösterirdi.
 */
export async function applyDriverAssignment(
  vehicleId: string,
  plate: string,
  workerId: string | null,
  previousWorkerId: string | null
): Promise<void> {
  if (workerId) {
    await supabaseAdmin
      .from("vehicles")
      .update({ assigned_worker_id: null })
      .eq("assigned_worker_id", workerId)
      .neq("id", vehicleId);
  }
  // Aracı bırakan şoförün aynası temizlenir (başka araca geçtiyse aşağıda
  // zaten yeni plakasıyla yeniden yazılır).
  if (previousWorkerId && previousWorkerId !== workerId) {
    await supabaseAdmin
      .from("workers")
      .update({ plate: null })
      .eq("id", previousWorkerId);
  }
  if (workerId) {
    await supabaseAdmin.from("workers").update({ plate }).eq("id", workerId);
  }
}

/** Plate of a DIFFERENT vehicle already using `value` in `field`, else null. */
async function conflictPlate(
  field: "plate" | "imei" | "flespi_device_id",
  value: string | number,
  excludeId: string | null
): Promise<string | null> {
  // test-visible: benzersizlik denetimi TEST araçlarını da görmek ZORUNDA —
  // elenirse test aracının plakası ikinci kez yazılabilir ve 23505 ham hâliyle
  // kullanıcıya düşer.
  let q = supabaseAdmin.from("vehicles").select("id, plate").eq(field, value);
  if (excludeId) q = q.neq("id", excludeId);
  const { data } = await q.limit(1).maybeSingle();
  return data ? (data.plate as string) : null;
}

/**
 * Dostane tekillik ön-denetimi: ham 23505 asla yüzeye çıkmaz ve ÇAKIŞAN ARACIN
 * PLAKASI söylenir. Kısmi güncellemede YALNIZ gövdede gelen alanlar denetlenir —
 * dokunulmamış bir IMEI'yi yeniden denetlemek gereksiz sorgu olurdu.
 */
export async function checkVehicleConflicts(
  plate: string | undefined,
  imei: string | null | undefined,
  deviceId: number | null | undefined,
  excludeId: string | null
): Promise<AracSonuc | null> {
  if (plate !== undefined) {
    const p = await conflictPlate("plate", plate, excludeId);
    if (p) return { ok: false, error: "plate_taken", conflict: p };
  }
  if (imei) {
    const c = await conflictPlate("imei", imei, excludeId);
    if (c) return { ok: false, error: "imei_taken", conflict: c };
  }
  if (deviceId != null) {
    const c = await conflictPlate("flespi_device_id", deviceId, excludeId);
    if (c) return { ok: false, error: "device_taken", conflict: c };
  }
  return null;
}

/** Yamadaki tanımlı alanlar — `undefined` olanlar düşer. */
function tanimliAlanlar(yama: AracYama): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(yama).filter(([, v]) => v !== undefined)
  );
}

/**
 * ARACI GÜNCELLE — kısmi.
 *
 * `assignmentTouched`: yamada `assigned_worker_id` VARSA atama dokunulmuş
 * sayılır. Panelde bu karar `assigned_worker_id_prev` gizli alanıyla veriliyor
 * ve gerekçesi aynı: muayene tarihini düzeltmek için dakikalar önce açılmış bir
 * form kaydedildiğinde, bu arada başka bir yöneticinin yaptığı şoför değişikliği
 * sessizce geri alınmamalı (lost update). PATCH'te alanın YOKLUĞU aynı sözü
 * doğal olarak veriyor — istemcinin ayrıca "önceki değer" taşımasına gerek yok.
 */
export async function aracGuncelle(girdi: {
  actorId: string | null;
  id: string;
  yama: AracYama;
}): Promise<AracSonuc> {
  const { actorId, id } = girdi;
  if (!id) return { ok: false, error: "id" };

  const yama: AracYama = { ...girdi.yama };
  if (yama.plate !== undefined) yama.plate = yama.plate.toUpperCase();

  const conflict = await checkVehicleConflicts(
    yama.plate,
    yama.imei,
    yama.flespi_device_id,
    id
  );
  if (conflict) return conflict;

  const assignmentTouched = yama.assigned_worker_id !== undefined;
  if (assignmentTouched) {
    const notDriver = await assertDriverAssignable(yama.assigned_worker_id ?? null);
    if (notDriver) return notDriver;
  }

  // ESKİ HÂL yazmadan ÖNCE okunur: sonrasında okumak yeni değeri verirdi ve iz
  // "neyin neye döndüğünü" söyleyemezdi. Atama ayrışması da bu satıra muhtaç.
  const { data: current } = await supabaseAdmin
    .from("vehicles")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!current) return { ok: false, error: "not_found" };
  const mevcut = current as Record<string, unknown>;
  const currentWorkerId = (mevcut.assigned_worker_id as string) ?? null;

  /**
   * DİFF: yalnız GERÇEKTEN değişen alan yazılır.
   *
   * Aynı değeri yazmak hem gereksiz bir UPDATE hem de yanıltıcı bir denetim
   * izidir — "plaka değişti" diyen ama eski=yeni olan bir satır, denetimi
   * okuyan kişiye yanlış bir olay anlatır.
   */
  const update: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(tanimliAlanlar(yama))) {
    if ((mevcut[k] ?? null) !== (v ?? null)) update[k] = v;
  }

  const plate = (yama.plate ?? (mevcut.plate as string)) as string;

  if (Object.keys(update).length > 0) {
    const { error } = await supabaseAdmin.from("vehicles").update(update).eq("id", id);
    if (error) return { ok: false, error: error.message };
  }

  if (assignmentTouched && "assigned_worker_id" in update) {
    await applyDriverAssignment(id, plate, yama.assigned_worker_id ?? null, currentWorkerId);
  } else if (currentWorkerId && "plate" in update) {
    // Atama değişmedi ama plaka değişti — ayna yine hizalanmalı.
    await supabaseAdmin.from("workers").update({ plate }).eq("id", currentWorkerId);
  }

  if (Object.keys(update).length > 0) {
    await auditChange(actorId, "update", "vehicles", id, mevcut, update);
  }
  return { ok: true, id, degisen: Object.keys(update) };
}

/**
 * YENİ ARAÇ.
 *
 * `plate` zorunlu; gerisi çağıranın doğrulamasına bağlı. `fleet` verilmezse
 * kolon varsayılanına ('mavi') düşer — panel formu her zaman gönderiyor, mobil
 * göndermeyebilir ve o durumda kurulumun varsayılanı doğru cevaptır.
 */
export async function aracOlustur(girdi: {
  actorId: string | null;
  alanlar: AracYama & { plate: string };
}): Promise<AracSonuc> {
  const { actorId } = girdi;
  const alanlar = { ...girdi.alanlar, plate: girdi.alanlar.plate.toUpperCase() };

  const conflict = await checkVehicleConflicts(
    alanlar.plate,
    alanlar.imei,
    alanlar.flespi_device_id,
    null
  );
  if (conflict) return conflict;

  const notDriver = await assertDriverAssignable(alanlar.assigned_worker_id ?? null);
  if (notDriver) return notDriver;

  const { data, error } = await supabaseAdmin
    .from("vehicles")
    .insert(tanimliAlanlar(alanlar))
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, error: error?.message ?? "insert" };

  const id = data.id as string;
  await applyDriverAssignment(id, alanlar.plate, alanlar.assigned_worker_id ?? null, null);
  await auditChange(actorId, "create", "vehicles", id, null, tanimliAlanlar(alanlar));
  return { ok: true, id, degisen: Object.keys(tanimliAlanlar(alanlar)) };
}

"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabase";
import { getTestScope, withoutTestRows } from "@/lib/test-data";
import { requireAdmin } from "@/lib/session";
import {
  createWorkerSchema,
  updateWorkerSchema,
  adminSetPinSchema,
  DEFAULT_TEMP_PIN,
} from "@/lib/validation";
import { canonicalPhone, phoneVariants } from "@/lib/phone";

export type WorkerResult = { ok: boolean; error?: string };

// Telefon normalizasyonu lib/phone.ts'te — tek kaynak. Panelden yapıştırılan
// numara Unicode yön işaretleri taşıyabiliyor; kanonik biçim onları da düşürür.

/** Next free 4-digit Personalnummer (0001, 0002, …) based on the current max. */
async function nextEmployeeNumber(): Promise<string> {
  // test-visible: test hesabının employee_number'ı NULL (migration 028), yani
  // aşağıdaki `not null` filtresi onu zaten dışarıda bırakıyor. Filtre koymak
  // sonucu değiştirmez, yalnız yanıltıcı olurdu.
  const { data } = await supabaseAdmin
    .from("workers")
    .select("employee_number")
    .not("employee_number", "is", null);
  const max = (data ?? []).reduce((m, w) => {
    const n = parseInt((w.employee_number as string) ?? "", 10);
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return String(max + 1).padStart(4, "0");
}

export async function createWorkerAction(formData: FormData): Promise<WorkerResult> {
  await requireAdmin();

  // Saha standardı: PIN alanı boş bırakıldıysa geçici varsayılan (DEFAULT_TEMP_PIN
  // = 123456). Sunucu tek doğruluk kaynağı — istemci boşluğu doldurmasa da garanti
  // burada; must_change_pin=true zaten ilk girişte değişimi zorunlu kılıyor.
  const rawPin = (formData.get("pin") as string | null)?.trim();
  const pin = rawPin && rawPin.length > 0 ? rawPin : DEFAULT_TEMP_PIN;

  const parsed = createWorkerSchema.safeParse({
    name: formData.get("name"),
    phone: formData.get("phone"),
    pin,
    plate: formData.get("plate") || null,
    employee_number: formData.get("employee_number") || null,
    is_admin: formData.get("is_admin") === "on",
    counts_as_driver: formData.get("counts_as_driver") === "on",
    // Personel dosyası (migration 025) — boş string null'a düşer (opsiyonel).
    birth_date: formData.get("birth_date") || null,
    email: formData.get("email") || null,
    address: formData.get("address") || null,
    social_security_no: formData.get("social_security_no") || null,
    employment_start: formData.get("employment_start") || null,
    employment_type: formData.get("employment_type") || null,
    license_no: formData.get("license_no") || null,
    license_expiry: formData.get("license_expiry") || null,
    emergency_contact_name: formData.get("emergency_contact_name") || null,
    emergency_contact_relation: formData.get("emergency_contact_relation") || null,
    emergency_contact_phone: formData.get("emergency_contact_phone") || null,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Geçersiz veri" };
  }

  const phone = canonicalPhone(parsed.data.phone);

  const { data: existing } = await supabaseAdmin
    .from("workers")
    .select("id")
    .eq("phone", phone)
    .maybeSingle();
  if (existing) return { ok: false, error: "Bu telefon zaten kayıtlı" };

  const pin_hash = await bcrypt.hash(parsed.data.pin, 10);

  const employee_number =
    parsed.data.employee_number && parsed.data.employee_number.length > 0
      ? parsed.data.employee_number
      : await nextEmployeeNumber();

  const d = parsed.data;
  const { error } = await supabaseAdmin.from("workers").insert({
    name: d.name,
    phone,
    pin_hash,
    plate: d.plate ?? null,
    employee_number,
    is_admin: d.is_admin ?? false,
    // Araç kullanan yönetici muafiyeti (migration 041) — varsayılan false.
    counts_as_driver: d.counts_as_driver ?? false,
    is_active: true,
    // Admin-set PIN is temporary — force the driver to set their own at /pin.
    must_change_pin: true,
    // Personel dosyası (migration 025).
    birth_date: d.birth_date ?? null,
    email: d.email ?? null,
    address: d.address ?? null,
    social_security_no: d.social_security_no ?? null,
    employment_start: d.employment_start ?? null,
    employment_type: d.employment_type ?? null,
    license_no: d.license_no ?? null,
    license_expiry: d.license_expiry ?? null,
    emergency_contact_name: d.emergency_contact_name ?? null,
    emergency_contact_relation: d.emergency_contact_relation ?? null,
    emergency_contact_phone: d.emergency_contact_phone ?? null,
  });

  if (error) return { ok: false, error: "Kayıt başarısız: " + error.message };

  revalidatePath("/admin");
  revalidatePath("/admin/workers");
  return { ok: true };
}

/**
 * Şoför → araç ataması TEK KAYNAK olan vehicles.assigned_worker_id üzerinden
 * uygulanır (araç formundaki applyDriverAssignment'ın şoför-tarafı ikizi; aynı
 * kurallar). Bir şoför tek araca atanır; workers.plate yalnız türetilmiş AYNA.
 *
 *  1) Bu şoförü işaret eden diğer tüm araçlar (hedef hariç) serbest bırakılır —
 *     "bir şoför → bir araç" kuralı korunur.
 *  2) Hedef araçta BAŞKA şoför varsa onun plaka aynası temizlenir (o araçtan
 *     düştü), sonra hedef araca bu şoför yazılır.
 *  3) workers.plate aynası hedef aracın plakasıyla (veya atama kaldırıldıysa
 *     null) hizalanır — harita/rota/session gibi hâlâ plate okuyan noktalar için.
 */
async function applyWorkerVehicle(
  workerId: string,
  nextVehicleId: string | null
): Promise<void> {
  let release = supabaseAdmin
    .from("vehicles")
    .update({ assigned_worker_id: null })
    .eq("assigned_worker_id", workerId);
  if (nextVehicleId) release = release.neq("id", nextVehicleId);
  await release;

  if (nextVehicleId) {
    const { data: veh } = await supabaseAdmin
      .from("vehicles")
      .select("plate, assigned_worker_id")
      .eq("id", nextVehicleId)
      .maybeSingle();
    const otherWorker = (veh?.assigned_worker_id as string | null) ?? null;
    if (otherWorker && otherWorker !== workerId) {
      await supabaseAdmin.from("workers").update({ plate: null }).eq("id", otherWorker);
    }
    await supabaseAdmin
      .from("vehicles")
      .update({ assigned_worker_id: workerId })
      .eq("id", nextVehicleId);
    await supabaseAdmin
      .from("workers")
      .update({ plate: (veh?.plate as string | null) ?? null })
      .eq("id", workerId);
  } else {
    await supabaseAdmin.from("workers").update({ plate: null }).eq("id", workerId);
  }
}

/** Düzenle dialog'u açılınca lazy çekilir: araç seçenekleri (id+plaka) ve bu
 *  şoförün şu anki atanmış aracının id'si (vehicles.assigned_worker_id'den). */
export async function getWorkerVehicleOptions(workerId: string): Promise<{
  vehicles: { id: string; plate: string }[];
  currentVehicleId: string | null;
}> {
  await requireAdmin();
  const scope = await getTestScope();
  const { data } = await withoutTestRows(
    supabaseAdmin
      .from("vehicles")
      .select("id, plate, assigned_worker_id")
      .neq("status", "inactive")
      .order("plate"),
    "id",
    scope.vehicleIds
  );
  const rows = (data ?? []) as {
    id: string;
    plate: string;
    assigned_worker_id: string | null;
  }[];
  const current = rows.find((v) => v.assigned_worker_id === workerId) ?? null;
  return {
    vehicles: rows.map((v) => ({ id: v.id, plate: v.plate })),
    currentVehicleId: current?.id ?? null,
  };
}

export async function updateWorkerAction(formData: FormData): Promise<WorkerResult> {
  await requireAdmin();

  const id = formData.get("id");
  if (typeof id !== "string" || !id) return { ok: false, error: "Geçersiz kayıt" };

  const et = formData.get("employment_type");
  const parsed = updateWorkerSchema.safeParse({
    name: formData.get("name"),
    phone: formData.get("phone"),
    employee_number: formData.get("employee_number") || null,
    counts_as_driver: formData.get("counts_as_driver") === "on",
    birth_date: formData.get("birth_date") || null,
    email: formData.get("email") || null,
    address: formData.get("address") || null,
    social_security_no: formData.get("social_security_no") || null,
    employment_start: formData.get("employment_start") || null,
    // Select "none" sentinel → null (alanı temizleme). Boş string de null'a düşer.
    employment_type: et && et !== "none" ? et : null,
    license_no: formData.get("license_no") || null,
    license_expiry: formData.get("license_expiry") || null,
    emergency_contact_name: formData.get("emergency_contact_name") || null,
    emergency_contact_relation: formData.get("emergency_contact_relation") || null,
    emergency_contact_phone: formData.get("emergency_contact_phone") || null,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Geçersiz veri" };
  }
  const d = parsed.data;
  const phone = canonicalPhone(d.phone);

  // Telefon benzersizliği — kendisi hariç.
  const { data: dupe } = await supabaseAdmin
    .from("workers")
    .select("id")
    .in("phone", phoneVariants(phone))
    .neq("id", id)
    .maybeSingle();
  if (dupe) return { ok: false, error: "Bu telefon zaten kayıtlı" };

  // Mevcut satırı çek → SADECE DEĞİŞEN alanı yaz (mevcut doğru veriyi ezme).
  // plate/pin_hash/is_active/must_change_pin/is_admin bu diff'e HİÇ girmez.
  const { data: cur } = await supabaseAdmin
    .from("workers")
    .select(
      "name, phone, employee_number, counts_as_driver, birth_date, email, address, social_security_no, employment_start, employment_type, license_no, license_expiry, emergency_contact_name, emergency_contact_relation, emergency_contact_phone"
    )
    .eq("id", id)
    .maybeSingle();
  if (!cur) return { ok: false, error: "Çalışan bulunamadı" };

  const next: Record<string, unknown> = {
    name: d.name,
    phone,
    employee_number: d.employee_number ?? null,
    // Muafiyet işareti (migration 041): kutu işaretsizse FALSE yazılır — yani
    // form onu geri de alabilir. Diff mantığı değişmediyse hiç UPDATE etmez.
    counts_as_driver: d.counts_as_driver ?? false,
    birth_date: d.birth_date ?? null,
    email: d.email ?? null,
    address: d.address ?? null,
    social_security_no: d.social_security_no ?? null,
    employment_start: d.employment_start ?? null,
    employment_type: d.employment_type ?? null,
    license_no: d.license_no ?? null,
    license_expiry: d.license_expiry ?? null,
    emergency_contact_name: d.emergency_contact_name ?? null,
    emergency_contact_relation: d.emergency_contact_relation ?? null,
    emergency_contact_phone: d.emergency_contact_phone ?? null,
  };
  const update: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(next)) {
    if ((cur as Record<string, unknown>)[k] !== v) update[k] = v;
  }

  if (Object.keys(update).length > 0) {
    const { error } = await supabaseAdmin.from("workers").update(update).eq("id", id);
    if (error) return { ok: false, error: "Güncelleme başarısız: " + error.message };
  }

  // Araç ataması — yalnız GERÇEKTEN değiştiyse dokunulur (form açıldığındaki
  // değeri prev olarak geri gönderiyoruz; lost-update'i önler). Tek kaynak:
  // vehicles.assigned_worker_id.
  const prevRaw = formData.get("assigned_vehicle_id_prev");
  const nextRaw = formData.get("assigned_vehicle_id");
  const prevVehicle =
    typeof prevRaw === "string" && prevRaw && prevRaw !== "none" ? prevRaw : null;
  const nextVehicle =
    typeof nextRaw === "string" && nextRaw && nextRaw !== "none" ? nextRaw : null;
  if (prevVehicle !== nextVehicle) {
    await applyWorkerVehicle(id, nextVehicle);
  }

  revalidatePath("/admin");
  revalidatePath("/admin/workers");
  revalidatePath(`/admin/workers/${id}`);
  revalidatePath("/admin/araclar");
  revalidatePath("/panel");
  return { ok: true };
}

export async function toggleActiveAction(workerId: string): Promise<WorkerResult> {
  await requireAdmin();

  const { data: worker } = await supabaseAdmin
    .from("workers")
    .select("is_active")
    .eq("id", workerId)
    .maybeSingle();
  if (!worker) return { ok: false, error: "Çalışan bulunamadı" };

  const nextActive = !worker.is_active;

  /**
   * AKTİFLEŞTİRME, İŞTEN ÇIKIŞI DA GERİ ALIR (28.07.2026).
   *
   * Eskiden yalnız is_active çevriliyordu, terminated_at olduğu gibi kalıyordu.
   * Sonuç bir HAYALET DURUM: "çalışıyor ama işten çıkmış". İzin Takvimi bu
   * kaydı İKİ ayrı sorguyla birden yakalıyordu — aktif kadro (is_active=true)
   * ve ayrılanlar (terminated_at dolu) — ve aynı kişi takvimde İKİ SATIR
   * olarak, biri normal biri gri, yan yana çıkıyordu.
   *
   * terminated_at yalnız AKTİFLEŞTİRİRKEN temizlenir. Pasifleştirme ona
   * DOKUNMAZ: "işten çıkar" akışı (terminateWorkerAction) ayrı bir karardır ve
   * çıkış tarihini oraya yazar; buradaki basit aç/kapa onu ezmemeli.
   */
  const patch: Record<string, unknown> = { is_active: nextActive };
  if (nextActive) patch.terminated_at = null;

  const { error } = await supabaseAdmin
    .from("workers")
    .update(patch)
    .eq("id", workerId);

  if (error) return { ok: false, error: "Güncelleme başarısız" };

  revalidatePath("/admin/workers");
  // İzin Takvimi kadro listesini bu iki alandan kuruyor — çift satır hatasının
  // düzeldiği anında görünmesi için o sayfa da tazelenir.
  revalidatePath("/admin/izinler");
  return { ok: true };
}

/**
 * İŞTEN ÇIKIŞ (Modül 2). Personeli "ayrıldı" olarak işaretler: terminated_at
 * (son çalışma günü) + is_active=false (canlı yüzeyler is_active ile kendiliğinden
 * düşürür) + Telegram bağını temizler (artık bildirim gitmesin) + filo şefliğini
 * bırakır (managed_fleet=null).
 *
 * KASITLI olarak `vehicles.assigned_worker_id` BOŞALTILMAZ: araç "şoförsüz kaldı"
 * Dikkat/Aksiyon kalemiyle patronu bilinçli yeniden atamaya iter (kullanıcı
 * kararı). Geçmiş raporlar SİLİNMEZ — ayrılan personelin adı eski AZG/vardiya/
 * yakıt raporlarında görünmeye devam eder (7 yıl arşiv).
 */
export async function terminateWorkerAction(
  workerId: string,
  lastDay: string
): Promise<WorkerResult> {
  await requireAdmin();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(lastDay)) {
    return { ok: false, error: "Geçersiz tarih" };
  }
  const { data: worker } = await supabaseAdmin
    .from("workers")
    .select("is_admin")
    .eq("id", workerId)
    .maybeSingle();
  if (!worker) return { ok: false, error: "Çalışan bulunamadı" };
  if (worker.is_admin === true) {
    return { ok: false, error: "Yönetici hesabı işten çıkarılamaz" };
  }

  const { error } = await supabaseAdmin
    .from("workers")
    .update({
      terminated_at: lastDay,
      is_active: false,
      telegram_chat_id: null,
      telegram_linked_at: null,
      // FİLO ŞEFLİĞİ DE BIRAKILIR (28.07.2026). Eskiden managed_fleet olduğu
      // gibi kalıyordu: ayrılan kişi veride hâlâ "bordo filosunun şefi"
      // görünüyordu. Bugün zararsız çünkü lib/fleet-scope.ts is_active=false
      // olanı şef saymıyor — yani koruma BAŞKA bir alanın yan etkisine
      // dayanıyordu. Yarın biri o kontrolü gevşetirse ayrılmış bir şef sessizce
      // filo kapsamı kazanır. Yetki, veriyle birlikte bırakılır.
      managed_fleet: null,
    })
    .eq("id", workerId);
  if (error) return { ok: false, error: "Güncelleme başarısız" };

  revalidatePath("/admin");
  revalidatePath("/admin/workers");
  revalidatePath("/admin/araclar");
  revalidatePath("/panel");
  return { ok: true };
}

/**
 * Yönetici bir şoföre YENİ PIN ATAR (21.07.2026 — eskiden sistem rastgele
 * üretiyordu; artık yönetici kendisi yazıyor, çünkü PIN'i şoföre sözlü olarak
 * o iletiyor).
 *
 * MEVCUT PIN HİÇBİR ZAMAN OKUNAMAZ/GÖSTERİLEMEZ: `workers.pin_hash` bcrypt'tir,
 * geri döndürülemez — bu eylem yalnızca ÜZERİNE YAZAR. "Şifreyi göster" diye bir
 * yol yoktur ve eklenmemelidir.
 *
 * `mustChange=true` (varsayılan) → şoför bu PIN'le girer ve /pin ekranında kendi
 * kalıcı PIN'ini belirlemeye zorlanır; yöneticinin verdiği geçici PIN böylece
 * kalıcı olmaz. Yönetici bilinçli olarak kapatabilir (ekranı çeviremeyen şoför
 * için PIN sabit kalsın istenebilir) — bu yüzden bayrak zorlanmıyor, soruluyor.
 */
export async function setWorkerPinAction(
  workerId: string,
  pin: string,
  mustChange: boolean
): Promise<WorkerResult> {
  await requireAdmin();

  const parsed = adminSetPinSchema.safeParse(pin);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "errPin" };
  }

  const { data: worker } = await supabaseAdmin
    .from("workers")
    .select("id")
    .eq("id", workerId)
    .maybeSingle();
  if (!worker) return { ok: false, error: "notFound" };

  const pin_hash = await bcrypt.hash(parsed.data, 10);

  const { error } = await supabaseAdmin
    .from("workers")
    .update({ pin_hash, must_change_pin: mustChange })
    .eq("id", workerId);

  if (error) return { ok: false, error: "pinUpdateFailed" };

  revalidatePath("/admin/workers");
  revalidatePath(`/admin/workers/${workerId}`);
  // PIN'i geri DÖNDÜRMEYİZ: yönetici zaten kendi yazdı, ekranda duruyor.
  // Sunucudan geri yollamak onu bir yanıt gövdesine ve loglara sokardı.
  return { ok: true };
}

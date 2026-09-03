"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import {
  requireWorker,
  requireAdmin,
  getSession,
  requireManualStartAuth,
} from "@/lib/session";
import {
  getManagedFleet,
  getFleetScope,
  UNRESTRICTED,
  type FleetScope,
} from "@/lib/fleet-scope";
import { MAX_COUNT } from "@/lib/validation";
import { listShiftEdits } from "@/lib/shift-edit-log";
import { endShiftForWorker } from "@/lib/shift-end";
import { startShiftSelf, startShiftForWorkerCore } from "@/lib/shift-start";
import {
  correctShiftFields,
  correctShiftKm,
  closeShiftByAdmin,
} from "@/lib/shift-correct";

export type ShiftResult = {
  ok: boolean;
  error?: string;
  /** true = yeni satır açılmadı, o günün kapanmış vardiyası yeniden açıldı. */
  reopened?: boolean;
};


/**
 * Manuel vardiya başlatma (şoför paneli bekleme ekranı).
 *
 * BAŞLATMA KURALLARI lib/shift-start.ts'te — MOBİLLE TEK KAYNAK (03.09.2026).
 * Buradan çıkarılmasının sebebi mobil başlatma ucunun
 * (POST /api/mobile/shifts/start) aynı vardiyayı açması gerekmesi;
 * lib/shift-end.ts'in 22.08.2026'da kapanış için yaptığının aynısı.
 *
 * Bu action'ın SÖZLEŞMESİ DEĞİŞMEDİ: aynı hata dizgeleri (`inactive_worker`,
 * `no_vehicle`, `vehicle_unavailable`, `active`, `day_done`, `outside_depot`,
 * ham DB mesajı) ve `reopened` bayrağı aynen dönüyor, dolayısıyla
 * PanelClient'ın hata eşlemesi olduğu gibi çalışıyor.
 */
export async function startShiftManualAction(
  /** GEÇİCİ ARAÇ (22.07.2026) — bkz. lib/shift-start.ts startShiftSelf. */
  overrideVehicleId?: string
): Promise<ShiftResult> {
  const session = await requireWorker();
  const r = await startShiftSelf(session.worker_id!, { overrideVehicleId });
  if (!r.ok) return { ok: false, error: r.error };

  revalidatePath("/panel");
  revalidatePath("/admin");
  // `reopened` yalnız TRUE iken alan olarak dönüyordu; şekli koruyoruz.
  return r.reopened ? { ok: true, reopened: true } : { ok: true };
}

/**
 * YÖNETİCİ / FİLO ŞEFİ, bir personelin vardiyasını ELLE başlatır (Modül 7 telafi).
 *
 * Yetki kapısı `requireManualStartAuth` (lib/session.ts → lib/manual-start-scope.ts),
 * başlatma gövdesi lib/shift-start.ts. İkisi de mobil `POST
 * /api/mobile/shifts/start-for` ile ORTAK; bu action yalnız kimliği oturumdan
 * çözüp sonucu panelin sözleşmesine çeviriyor.
 */
export async function startShiftForWorkerAction(input: {
  workerId: string;
  /** ISO — çağıran (tarayıcı) Viyana duvar-saatinden türetir. */
  startedAt: string;
  /** Verilmezse şoförün atanmış aracı. */
  vehicleId?: string;
}): Promise<ShiftResult> {
  const auth = await requireManualStartAuth(input.workerId);
  if (!auth.ok) return { ok: false, error: auth.error };

  const r = await startShiftForWorkerCore(auth, input);
  if (!r.ok) return { ok: false, error: r.error };

  revalidatePath("/panel");
  revalidatePath("/admin");
  revalidatePath("/admin/workers");
  return r.reopened ? { ok: true, reopened: true } : { ok: true };
}

/**
 * Manuel başlatma dialogu için seçilebilir araçlar (aktif, test-değil). Kapsam:
 * patron → tüm filo; filo şefi → yalnız kendi filosunun araçları (fail-closed:
 * kapsam çözülemezse boş liste). assigned_worker_id de döner ki dialog şoförün
 * atanmış aracını varsayılan seçebilsin.
 */
export async function listStartableVehiclesAction(): Promise<
  { id: string; plate: string; assigned_worker_id: string | null }[]
> {
  const session = await getSession();
  if (!session.worker_id) return [];

  let scope: FleetScope = UNRESTRICTED;
  if (!session.is_admin) {
    const fleet = await getManagedFleet(session.worker_id);
    if (!fleet) return [];
    scope = await getFleetScope(fleet);
  }

  // test-visible: test araçları .not("is_test","is",true) ile zaten elenir; liste
  // kapsam-farkında (patron=tümü, şef=kendi filosu) ama test-değil şartı iki
  // yolda da sabittir. Manuel başlatma seçicisine test aracı gelmez.
  const { data } = await supabaseAdmin
    .from("vehicles")
    .select("id, plate, assigned_worker_id")
    .eq("status", "active")
    .not("is_test", "is", true)
    .order("plate");
  let rows = (data ?? []) as {
    id: string;
    plate: string;
    assigned_worker_id: string | null;
  }[];
  if (scope.restricted) rows = rows.filter((v) => scope.isFleetVehicle(v.id));
  return rows;
}

export async function endShiftAction(formData: FormData): Promise<ShiftResult> {
  const session = await requireWorker();

  // KAPANIŞ KURALLARI lib/shift-end.ts'te — MOBİLLE TEK KAYNAK (22.08.2026).
  // Buradan çıkarılmasının sebebi mobil kapanış ucunun (POST
  // /api/mobile/shifts/current/end) aynı muhasebeyi yapmak zorunda olması.
  // Bu action'ın SÖZLEŞMESİ DEĞİŞMEDİ: aynı hata dizgeleri (`no_active`,
  // `undelivered_required`, `undelivered_over:…`, `db`, ham DB mesajı) aynı
  // sırayla dönüyor, dolayısıyla PanelClient'ın mapErr'i olduğu gibi çalışıyor.
  const r = await endShiftForWorker(session.worker_id!, {
    plate: formData.get("plate") || null,
    notes: formData.get("notes") || null,
    break_minutes: formData.get("break_minutes") || null,
    cargo_count: formData.get("cargo_count") || null,
    undelivered_count: formData.get("undelivered_count") || null,
  });
  if (!r.ok) return { ok: false, error: r.error };

  // DIS BILDIRIM KATMANI SOKULDU (20.08.2026): kapanista sofore ayrica
  // ozet mesaji gonderiliyordu. Ozetin KENDISI degismedi — panel/mobil ozet
  // ve imza dongusu (summary_notified_at) aynen calisiyor.

  revalidatePath("/panel");
  revalidatePath("/admin");
  return { ok: true };
}

/**
 * Marks the active shift as "on break" server-side (so the vehicle/admin views
 * can show the molada status live). Best-effort; the panel keeps its own local
 * break timer for the worked-time math.
 */
export async function startBreakAction(): Promise<ShiftResult> {
  const session = await requireWorker();
  const { error } = await supabaseAdmin
    .from("time_entries")
    .update({ break_started_at: new Date().toISOString() })
    .eq("worker_id", session.worker_id!)
    .is("ended_at", null)
    .is("break_started_at", null);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/panel");
  return { ok: true };
}

/**
 * Logs accumulated break minutes to the active shift.
 * Called from the panel when user toggles break OFF — we add elapsed minutes to break_minutes.
 * Also clears the server-side break flag (break_started_at).
 */
export async function addBreakMinutesAction(minutes: number): Promise<ShiftResult> {
  const session = await requireWorker();
  const add = Math.max(0, Math.floor(minutes));

  const { data: active } = await supabaseAdmin
    .from("time_entries")
    .select("id, break_minutes")
    .eq("worker_id", session.worker_id!)
    .is("ended_at", null)
    .maybeSingle();

  if (!active) return { ok: false, error: "no_active" };

  const newBreak = (active.break_minutes ?? 0) + add;
  // Keep break-minute logging independent of the new column so this never
  // regresses if migration 009 hasn't been applied yet.
  const { error } = await supabaseAdmin
    .from("time_entries")
    .update({ break_minutes: newBreak })
    .eq("id", active.id)
    .eq("worker_id", session.worker_id!);

  if (error) return { ok: false, error: error.message };

  // Best-effort: clear the server-side break flag (no-op pre-migration).
  await supabaseAdmin
    .from("time_entries")
    .update({ break_started_at: null })
    .eq("id", active.id)
    .then(
      () => {},
      () => {}
    );

  revalidatePath("/panel");
  return { ok: true };
}

/*
 * updateStartKmAction (şoförün kendi başlangıç km'sini düzeltmesi) 21.07.2026'da
 * KALDIRILDI. Km artık cihazdan türetiliyor (odometre → GPS), şoför hiçbir yerde
 * sayaç girmez — düzeltme yolu da kalırsa yanlış değerin geri sızacağı kapı
 * açık kalırdı. Yanlış türetilmiş bir km'yi YÖNETİCİ düzeltir:
 * adminUpdateKmAction (components/KmEditButton).
 */

/**
 * Driver sets/updates the start-of-day package count on their OWN, OPEN shift
 * (often known only hours after loading). Empty clears it. Open-shift only.
 */
export async function updatePackageCountAction(
  count: number | null
): Promise<ShiftResult> {
  const session = await requireWorker();
  let v: number | null = null;
  if (count !== null && count !== undefined && String(count) !== "") {
    v = Math.floor(Number(count));
    if (!Number.isFinite(v) || v < 0 || v > MAX_COUNT) return { ok: false, error: "invalid" };
  }

  const { data, error } = await supabaseAdmin
    .from("time_entries")
    .update({
      start_package_count: v,
      updated_at: new Date().toISOString(),
      updated_by: session.worker_id,
    })
    .eq("worker_id", session.worker_id!)
    .is("ended_at", null)
    .select("id");

  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: "no_active" };

  revalidatePath("/panel");
  revalidatePath("/admin");
  return { ok: true };
}

/**
 * KM DÜZELTMESİ — gövde lib/shift-correct.ts'te (MOBİLLE TEK KAYNAK, 03.09.2026).
 *
 * Bu action'ın SÖZLEŞMESİ DEĞİŞMEDİ: aynı hata dizgeleri (`errKmNeg`,
 * `errKmRange`, `km_low:<e>:<s>`, `km_high:<fark>:<tavan>`, ham DB mesajı).
 */
export async function adminUpdateKmAction(
  entryId: string,
  startKm: number,
  endKm: number | null
): Promise<ShiftResult> {
  const session = await requireAdmin();
  const r = await correctShiftKm(session.worker_id, entryId, startKm, endKm);
  if (!r.ok) return { ok: false, error: r.error };

  revalidatePath("/admin");
  revalidatePath("/panel");
  return { ok: true };
}

/**
 * KAPANMAMIŞ VARDİYAYI YÖNETİCİ KAPATIR — gövde lib/shift-correct.ts'te
 * (MOBİLLE TEK KAYNAK, 03.09.2026). Sebep ZORUNLU, iz ZORUNLU (087).
 *
 * SÖZLEŞME DEĞİŞMEDİ: `errReasonShort`, `no_active`, ham DB mesajı.
 */
export async function adminCloseShiftAction(
  entryId: string,
  reason: string
): Promise<ShiftResult> {
  const session = await requireAdmin();
  const r = await closeShiftByAdmin(session.worker_id, entryId, reason);
  if (!r.ok) return { ok: false, error: r.error };

  revalidatePath("/admin");
  revalidatePath("/panel");
  return { ok: true };
}

/**
 * TAM DÜZELTME — gövde lib/shift-correct.ts'te (MOBİLLE TEK KAYNAK, 03.09.2026).
 *
 * SÖZLEŞME DEĞİŞMEDİ: şema mesaj anahtarları, `km_low:…`, paket tavanı kodları
 * ve ham DB mesajı aynı sırayla dönüyor.
 */
export async function editEntryAction(formData: FormData): Promise<ShiftResult> {
  const session = await requireAdmin();

  const r = await correctShiftFields(session.worker_id, {
    id: formData.get("id"),
    started_at: formData.get("started_at"),
    ended_at: formData.get("ended_at") || null,
    start_km: formData.get("start_km"),
    end_km: formData.get("end_km") || null,
    plate: formData.get("plate") || null,
    notes: formData.get("notes") || null,
    break_minutes: formData.get("break_minutes") || null,
    start_package_count: formData.get("start_package_count") || null,
    undelivered_count: formData.get("undelivered_count") || null,
    reason: formData.get("reason") || "",
  });
  if (!r.ok) return { ok: false, error: r.error };

  revalidatePath("/admin");
  revalidatePath("/panel");
  return { ok: true };
}

/**
 * Bir vardiyanın düzenleme geçmişi (detay çekmecesi). Yalnız yönetici.
 * Tablo yoksa boş dizi döner — ekranda "geçmiş yok" görünür, hata değil.
 */
export async function getShiftEditsAction(entryId: string) {
  await requireAdmin();
  return listShiftEdits(entryId);
}

export async function deleteEntryAction(id: string): Promise<ShiftResult> {
  await requireAdmin();
  const { error } = await supabaseAdmin.from("time_entries").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin");
  return { ok: true };
}

"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { getTestScope } from "@/lib/test-data";
import { requireWorker } from "@/lib/session";
import { uploadReceipt, signedReceiptUrls } from "@/lib/storage";
import { recountShiftPackages } from "@/lib/shift-packages";
import { sendTelegramMessage } from "@/lib/telegram";
import { driverReportMessage } from "@/lib/telegram-messages";
import { SUMMARY_WINDOW_MS } from "@/lib/shift-summary";
import type { DriverReportType } from "@/lib/types";

/**
 * Şoför Paneli v2 server action'ları (İş 1–3):
 *  - vardiya başlangıç onayı (tek dokunuş),
 *  - +1 PAKET (GPS + zaman damgalı, Geri Al'lı),
 *  - FOTO ÇEK (konum+saat damgalı, Supabase Storage),
 *  - SORUN BİLDİR (4 hazır seçenek),
 *  - vardiya sonu özet onayı (dijital imza: timestamp + user_id).
 *
 * Hepsi kendi requireWorker() çağrısını yapar (middleware yok) ve aktif
 * vardiyayı SUNUCU tarafında çözer — istemciden time_entry_id kabul edilmez.
 */

const PHOTO_BUCKET = "shift-photos";

/** Geri Al penceresi: istemci tostu 5 sn, sunucu emniyeti 10 dk. */
const UNDO_WINDOW_MS = 10 * 60 * 1000;

// Offline replay'deki resolveEventTime ile aynı pencere (app/actions/offline.ts):
// istemci saatine yalnız makul aralıkta güvenilir.
const MAX_FUTURE_SKEW_MS = 5 * 60_000;
const MAX_BACKDATE_MS = 48 * 60 * 60_000;

export type DriverPanelResult = { ok: boolean; error?: string };
/** Toplu özet imzası: kaç vardiya imzalandı (0 = imzalanacak kayıt yoktu). */
export type ConfirmSummaryResult = DriverPanelResult & { signed?: number };
export type AddPackageResult = {
  ok: boolean;
  error?: string;
  packageId?: string;
  count?: number;
};
export type UndoPackageResult = { ok: boolean; error?: string; count?: number };
export type ShiftPhotoItem = {
  id: string;
  url: string | null;
  taken_at: string;
  latitude: number | null;
  longitude: number | null;
};

function clampEventTime(clientTime?: string | null): string {
  const now = Date.now();
  if (!clientTime) return new Date(now).toISOString();
  const t = new Date(clientTime).getTime();
  if (Number.isNaN(t)) return new Date(now).toISOString();
  if (t > now + MAX_FUTURE_SKEW_MS) return new Date(now).toISOString();
  if (t < now - MAX_BACKDATE_MS) return new Date(now).toISOString();
  return new Date(t).toISOString();
}

function cleanCoord(
  lat: unknown,
  lng: unknown
): { latitude: number | null; longitude: number | null } {
  const la = Number(lat);
  const ln = Number(lng);
  if (
    Number.isFinite(la) &&
    Number.isFinite(ln) &&
    la >= -90 &&
    la <= 90 &&
    ln >= -180 &&
    ln <= 180
  ) {
    return { latitude: la, longitude: ln };
  }
  return { latitude: null, longitude: null };
}

function cleanAccuracy(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

type ActiveShiftRow = {
  id: string;
  vehicle_id: string | null;
  plate: string | null;
  started_at: string;
  confirmation_status: string;
};

async function findActiveShift(workerId: string): Promise<ActiveShiftRow | null> {
  const { data } = await supabaseAdmin
    .from("time_entries")
    .select("id, vehicle_id, plate, started_at, confirmation_status")
    .eq("worker_id", workerId)
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as ActiveShiftRow | null) ?? null;
}

/**
 * İş 1 — Şoför, otomatik başlayan vardiyayı tek dokunuşla onaylar.
 * İdempotent: zaten onaylıysa ok döner.
 */
export async function confirmShiftStartAction(): Promise<DriverPanelResult> {
  const session = await requireWorker();

  const active = await findActiveShift(session.worker_id!);
  if (!active) return { ok: false, error: "no_active" };
  if (active.confirmation_status === "confirmed") return { ok: true };

  const { error } = await supabaseAdmin
    .from("time_entries")
    .update({
      confirmation_status: "confirmed",
      confirmed_at: new Date().toISOString(),
    })
    .eq("id", active.id)
    .eq("worker_id", session.worker_id!)
    .is("ended_at", null);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/panel");
  revalidatePath("/admin");
  return { ok: true };
}

/**
 * İş 2 — "+1 PAKET": o anki GPS konumu + zaman damgasıyla bir paket kaydı.
 * cargo_count, shift_packages'tan yeniden sayılarak senkron tutulur.
 */
export async function addPackageAction(input: {
  lat?: number | null;
  lng?: number | null;
  accuracy?: number | null;
  clientTime?: string | null;
}): Promise<AddPackageResult> {
  const session = await requireWorker();

  const active = await findActiveShift(session.worker_id!);
  if (!active) return { ok: false, error: "no_active" };

  const { latitude, longitude } = cleanCoord(input.lat, input.lng);
  const { data, error } = await supabaseAdmin
    .from("shift_packages")
    .insert({
      time_entry_id: active.id,
      worker_id: session.worker_id!,
      latitude,
      longitude,
      accuracy: cleanAccuracy(input.accuracy),
      recorded_at: clampEventTime(input.clientTime),
    })
    .select("id")
    .maybeSingle();

  if (error || !data) return { ok: false, error: error?.message ?? "db" };

  let count: number | undefined;
  try {
    count = await recountShiftPackages(active.id);
  } catch {
    // Sayaç senkronu bir sonraki dokunuşta düzelir; kayıt yazıldı.
  }

  revalidatePath("/panel");
  return { ok: true, packageId: data.id as string, count };
}

/** İş 2 — "Geri Al": yanlış basılan paketi siler (sunucu penceresi 10 dk). */
export async function undoPackageAction(
  packageId: string
): Promise<UndoPackageResult> {
  const session = await requireWorker();

  const { data: row } = await supabaseAdmin
    .from("shift_packages")
    .select("id, time_entry_id, created_at")
    .eq("id", packageId)
    .eq("worker_id", session.worker_id!)
    .maybeSingle();
  if (!row) return { ok: false, error: "not_found" };

  if (Date.now() - new Date(row.created_at as string).getTime() > UNDO_WINDOW_MS) {
    return { ok: false, error: "too_late" };
  }

  const { error } = await supabaseAdmin
    .from("shift_packages")
    .delete()
    .eq("id", packageId)
    .eq("worker_id", session.worker_id!);
  if (error) return { ok: false, error: error.message };

  let count: number | undefined;
  try {
    count = await recountShiftPackages(row.time_entry_id as string);
  } catch {
    // recount hatası geri almayı bozmasın
  }

  revalidatePath("/panel");
  return { ok: true, count };
}

/**
 * İş 2 — "FOTO ÇEK": kamera fotoğrafı otomatik konum + saat damgasıyla
 * Supabase Storage'a yüklenir ve aktif vardiyaya bağlanır.
 * formData: photo (File), lat?, lng?, accuracy?
 */
export async function addShiftPhotoAction(
  formData: FormData
): Promise<DriverPanelResult> {
  const session = await requireWorker();

  const active = await findActiveShift(session.worker_id!);
  if (!active) return { ok: false, error: "no_active" };

  const file = formData.get("photo") as File | null;
  if (!file || file.size === 0) return { ok: false, error: "no_file" };

  const up = await uploadReceipt(PHOTO_BUCKET, session.worker_id!, file);
  if (!up.ok) return { ok: false, error: up.error };

  const { latitude, longitude } = cleanCoord(
    formData.get("lat"),
    formData.get("lng")
  );
  const { error } = await supabaseAdmin.from("shift_photos").insert({
    time_entry_id: active.id,
    worker_id: session.worker_id!,
    storage_path: up.path,
    latitude,
    longitude,
    accuracy: cleanAccuracy(formData.get("accuracy")),
    taken_at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/panel");
  return { ok: true };
}

const REPORT_TYPES: DriverReportType[] = [
  "vehicle_fault",
  "address_issue",
  "damaged_package",
  "other",
];

/**
 * İş 2 — "SORUN BİLDİR": 4 hazır seçenekten biri, yazı zorunluluğu yok.
 * Kayıt admin paneline düşer; bağlı adminlere best-effort Telegram gider.
 * Aktif vardiya opsiyonel (vardiya dışı arıza bildirimi de kaydedilir).
 */
export async function reportProblemAction(input: {
  type: DriverReportType;
  lat?: number | null;
  lng?: number | null;
  clientTime?: string | null;
}): Promise<DriverPanelResult> {
  const session = await requireWorker();

  if (!REPORT_TYPES.includes(input.type)) {
    return { ok: false, error: "invalid" };
  }

  const active = await findActiveShift(session.worker_id!);
  const { latitude, longitude } = cleanCoord(input.lat, input.lng);

  const { error } = await supabaseAdmin.from("driver_reports").insert({
    worker_id: session.worker_id!,
    time_entry_id: active?.id ?? null,
    vehicle_id: active?.vehicle_id ?? null,
    report_type: input.type,
    latitude,
    longitude,
    created_at: clampEventTime(input.clientTime),
  });
  if (error) return { ok: false, error: error.message };

  // Best-effort Telegram → adminler; bildirim hatası kaydı etkilemez.
  try {
    // Test şoförünün bildirimi yöneticilerin telefonuna DÜŞMEZ.
    const scope = await getTestScope();
    if (scope.isTestWorker(session.worker_id)) return { ok: true };
    const plate = active?.plate ?? session.plate ?? "—";
    // test-visible: alıcı listesi (is_admin) — özne yukarıda elendi.
    const { data: admins } = await supabaseAdmin
      .from("workers")
      .select("telegram_chat_id, telegram_locale")
      .eq("is_admin", true)
      .not("telegram_chat_id", "is", null);
    for (const a of admins ?? []) {
      await sendTelegramMessage(
        a.telegram_chat_id as string,
        driverReportMessage((a.telegram_locale as string) ?? null, {
          name: session.name ?? "—",
          plate,
          type: input.type,
        })
      );
    }
  } catch {
    // sessiz geç
  }

  revalidatePath("/panel");
  revalidatePath("/admin");
  return { ok: true };
}

/**
 * İş 3 — Vardiya sonu özetinin şoför onayı = günlük çalışma kaydına dijital
 * imza (timestamp + user_id).
 *
 * TOPLU İMZA (22.07.2026). Eskiden tek `entryId` imzalanıyordu; panel ise her
 * yenilemede sıradaki imzasız vardiyayı aynı ekranla gösteriyordu. Şoförde 7
 * imzasız kayıt birikince ONAYLA'ya basmak ekranı kapatmıyor, bir sonrakini
 * açıyordu — sahadan "onaylıyorum, kapanmıyor, döngüde" diye bildirilen hata
 * buydu (canlı kanıt: aynı şoförün 12 saniyede 3 imzası).
 *
 * Artık istemci kayıt seçmez: sunucu, şoförün 72 saatteki TÜM imzasız kapalı
 * vardiyalarını TEK update ile imzalar. Tek dokunuş = ekran kesin kapanır.
 * Pencere dışında kalan eski kayıtlara dokunulmaz (panel de göstermiyor).
 *
 * İdempotent: imzalanacak kayıt kalmamışsa `signed: 0` ile ok döner — ekran
 * zaten kapanacağı için bu bir hata değildir.
 */
export async function confirmShiftSummaryAction(): Promise<ConfirmSummaryResult> {
  const session = await requireWorker();

  const sinceIso = new Date(Date.now() - SUMMARY_WINDOW_MS).toISOString();

  const { data, error } = await supabaseAdmin
    .from("time_entries")
    .update({
      summary_confirmed_at: new Date().toISOString(),
      summary_confirmed_by: session.worker_id!,
    })
    .eq("worker_id", session.worker_id!)
    .not("ended_at", "is", null)
    .is("summary_confirmed_at", null)
    .gte("ended_at", sinceIso)
    .select("id");

  // Sessiz `ok: true` KALDIRILDI (22.07.2026). Eskiden kolon/migration kokan
  // her hata "başarılı" sayılıyordu: sunucu hiçbir şey yazmazken şoför yeşil
  // tost görüyor, ekran açık kalıyordu — gerçek sonsuz döngünün reçetesi.
  // Artık yazamadıysak şoför bunu görür ve tekrar dener.
  if (error) return { ok: false, error: error.message };

  revalidatePath("/panel");
  revalidatePath("/admin");
  return { ok: true, signed: data?.length ?? 0 };
}

/**
 * Vardiya fotoğraflarını imzalı URL'lerle listeler — vardiya sahibi ya da
 * admin. Admin panelindeki foto rozeti ve şoförün kendi kontrolü kullanır.
 */
export async function getShiftPhotosAction(
  entryId: string
): Promise<ShiftPhotoItem[]> {
  const session = await requireWorker();

  const { data: entry } = await supabaseAdmin
    .from("time_entries")
    .select("id, worker_id")
    .eq("id", entryId)
    .maybeSingle();
  if (!entry) return [];
  if (!session.is_admin && entry.worker_id !== session.worker_id) return [];

  const { data } = await supabaseAdmin
    .from("shift_photos")
    .select("id, storage_path, taken_at, latitude, longitude")
    .eq("time_entry_id", entryId)
    .order("taken_at", { ascending: true });
  const rows = data ?? [];
  if (rows.length === 0) return [];

  const urls = await signedReceiptUrls(
    PHOTO_BUCKET,
    rows.map((r) => r.storage_path as string)
  );
  return rows.map((r) => ({
    id: r.id as string,
    url: urls.get(r.storage_path as string) ?? null,
    taken_at: r.taken_at as string,
    latitude: (r.latitude as number | null) ?? null,
    longitude: (r.longitude as number | null) ?? null,
  }));
}

/** Admin — şoför bildirimini "çözüldü" işaretler (dikkat listesinden düşer). */
export async function resolveDriverReportAction(
  reportId: string
): Promise<DriverPanelResult> {
  const session = await requireWorker();
  if (!session.is_admin) return { ok: false, error: "not_allowed" };

  const { error } = await supabaseAdmin
    .from("driver_reports")
    .update({
      resolved_at: new Date().toISOString(),
      resolved_by: session.worker_id!,
    })
    .eq("id", reportId)
    .is("resolved_at", null);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin");
  return { ok: true };
}

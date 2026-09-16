import "server-only";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { isLeaveTypeKey } from "@/lib/leave-types";
import { LEAVES_ENABLED } from "@/lib/features";
import {
  findOverlappingLeaves,
  getLeaveById,
  LEAVE_COLS,
  type LeaveRow,
} from "@/lib/leaves";
import { logLeaveEdit } from "@/lib/leave-edit-log";
import { startOfDayViennaFromYmd, endOfDayViennaFromYmd } from "@/lib/format";
import type { FleetScope } from "@/lib/fleet-scope";

/**
 * İZİN GİRİŞİ/TALEBİ — ORTAK ÇEKİRDEK (16.09.2026).
 *
 * ── NEDEN VAR ──────────────────────────────────────────────────────────────
 * İzin YAZMA iki YÜZEYDEN yapılıyor:
 *   • panel  → app/actions/leaves.ts `submitLeaveAction`
 *              (server action, `hak_session` çerezi, requireFleetView → redirect)
 *   • mobil  → POST /api/mobile/leaves
 *              (Bearer token, requireMobileFleetView → 403 JSON)
 * AYRILAN tek şey KAPI ve HATA BİÇİMİ. Kuralların kendisi — rol→status
 * eşlemesi, hedef personel kapıları, örtüşme, vardiya teyidi, iz ve önbellek
 * tazeleme — TEK yerde, burada. `lib/leave-decision-db.ts` (onay/ret) ile
 * birebir aynı duruş; gerekçesi de aynı: ikinci bir kopya yazılsaydı iki yüzey
 * zamanla ayrışırdı — biri iz bırakır öteki bırakmaz, biri kapıyı uygular
 * öteki unuturdu.
 *
 * ── YETKİ BURADA ÇÖZÜLMEZ, TAŞINIR ─────────────────────────────────────────
 * Çağıran kimliği kendi kapısından geçirir ve sonucu `LeaveSubmitActor` olarak
 * verir. Çekirdek "bu aktör kim" diye SORMAZ; "bu aktörün bu işi yapmaya hakkı
 * var mı" sorusunun VERİYE BAĞLI kısmını (şefin kapsamı, hedefin durumu)
 * uygular. Rol tespiti kapıda, kural burada.
 *
 * ── İKİ AŞAMA, ÇÜNKÜ SIRA DAVRANIŞTIR ──────────────────────────────────────
 * `parseLeaveInput` ve `submitLeave` bilerek AYRI: panelde doğrulama
 * `requireFleetView()`ten ÖNCE koşuyor ve bu kasıtlı — geçersiz gövde gönderen
 * yetkisiz bir kullanıcı /panel'e ATILMAZ, sessizce `invalid` alır. Tek bir
 * fonksiyona katlansaydı kapı doğrulamanın önüne geçer, o davranış sessizce
 * değişirdi. Aynı gerekçe `decideLeaveFromPanel`ın `LEAVES_ENABLED`i
 * `requireAdmin`den önce denetlemesinde de yazılı.
 */

const YMD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date");

const leaveInput = z.object({
  worker_id: z.string().uuid(),
  leave_type: z.string().refine(isLeaveTypeKey, "leave_type"),
  start_date: YMD,
  end_date: YMD,
  note: z.string().trim().max(500).optional().nullable(),
  /** Vardiya çakışması teyidi geçildi → yine de kaydet. */
  force: z.boolean().optional(),
  /** Düzenleme ise mevcut kaydın id'si. */
  id: z.string().uuid().optional(),
});

export type LeaveInput = z.input<typeof leaveInput>;
export type LeaveParsed = z.output<typeof leaveInput>;

/** Çağıranın kapısından çıkan kimlik + kapsam. */
export type LeaveSubmitActor = {
  /** İzi ve `created_by`/`approved_by` alanlarını yazan kişi. */
  workerId: string | null;
  /** Filo şefi mi (patron değil) — status ve kapsam kapısını belirler. */
  isChief: boolean;
  /** Şefin kapsamı; patronda UNRESTRICTED. */
  scope: FleetScope;
};

/**
 * Hata kodları — panelin bugünkü `LeaveActionResult.error` dizgeleriyle
 * BİREBİR aynı. Yeniden adlandırmak bir davranış değişikliği olurdu: panel
 * ekranı bu dizgelere göre mesaj basıyor.
 */
export type LeaveSubmitHata =
  | "disabled"
  | "not_found"
  | "no_worker"
  | "admin_target"
  | "terminated_target"
  | "scope"
  | "forbidden"
  | "overlap"
  | "db";

export type LeaveSubmitSonuc =
  | { ok: true; id: string; satir: LeaveRow; olusturuldu: boolean }
  /** Vardiya çakışması — ENGEL DEĞİL, teyit isteği. */
  | { ok: false; needConfirm: true; conflictShifts: number }
  | { ok: false; needConfirm?: false; hata: LeaveSubmitHata };

/**
 * Gövde doğrulaması — SAF, yan etkisiz, DB'ye dokunmaz.
 *
 * `range` ayrı bir koddur (zod'a girmez) çünkü panelde bugün de ayrı: şema
 * geçerli ama bitiş başlangıçtan önce olabiliyor ve kullanıcıya gösterilen
 * mesaj farklı.
 */
export function parseLeaveInput(
  input: unknown
): { ok: true; data: LeaveParsed } | { ok: false; hata: "invalid" | "range" } {
  const parsed = leaveInput.safeParse(input);
  if (!parsed.success) return { ok: false, hata: "invalid" };
  const data = parsed.data;
  if (data.end_date < data.start_date) return { ok: false, hata: "range" };
  return { ok: true, data };
}

/** İzin aralığında o şoförün kaç vardiyası var (Viyana günleri). */
async function countShiftsInRange(
  workerId: string,
  startYmd: string,
  endYmd: string
): Promise<number> {
  const start = startOfDayViennaFromYmd(startYmd);
  const end = endOfDayViennaFromYmd(endYmd);
  if (!start || !end) return 0;
  const { count } = await supabaseAdmin
    .from("time_entries")
    .select("id", { count: "exact", head: true })
    .eq("worker_id", workerId)
    .gte("started_at", start.toISOString())
    .lte("started_at", end.toISOString());
  return count ?? 0;
}

/**
 * İzin girişi/talebi (create) VE düzenleme (update).
 *
 * Rolü ÇAĞIRAN belirler: patron → `approved`, şef → `pending` (+ kapsam
 * assert). `data.id` doluysa düzenlemedir.
 *
 * `worker_leaves` YAZMA hataları GÖRÜNÜR döner (asıl veri tablosu; sessiz
 * düşerse yönetici "oldu" sanır). Yalnız `leave_edit_log` best-effort'tur.
 */
export async function submitLeave(
  data: LeaveParsed,
  actor: LeaveSubmitActor
): Promise<LeaveSubmitSonuc> {
  if (!LEAVES_ENABLED) return { ok: false, hata: "disabled" };

  const { workerId, isChief, scope } = actor;

  const existing = data.id ? await getLeaveById(data.id) : null;
  if (data.id && !existing) return { ok: false, hata: "not_found" };

  // Hedef personel geçerli mi (yönetici hesabına / var olmayan kişiye izin yok).
  const { data: target } = await supabaseAdmin
    .from("workers")
    .select("id, is_admin, counts_as_driver, is_active, terminated_at")
    .eq("id", data.worker_id)
    .maybeSingle();
  if (!target) return { ok: false, hata: "no_worker" };
  // MUAFİYET (migration 041): counts_as_driver=true olan yönetici İzin
  // Takvimi'nde ZATEN satır olarak duruyor — sayfa kadroyu onlyDrivers ile
  // kuruyor ve kapsam onu elemiyor. Kapı buradaki ham is_admin kontrolüyle
  // kalsaydı takvimde görünen ama izin girilemeyen bir satır olurdu: aynı kişi
  // şoför sayılıp izni girilemezdi. Koşul kapsamla ve shift.ts'teki kardeş
  // kapıyla AYNI cümleyi kurar — üçü birden ayrışamaz.
  if (target.is_admin === true && target.counts_as_driver !== true) {
    return { ok: false, hata: "admin_target" };
  }
  // AYRILAN personel salt okunur: yeni izin girilemez, mevcut düzenlenemez.
  // Takvimde UI yolu zaten yok; bu sunucu kapısı boşluğu kapatır (fail-closed).
  // terminated_at yoksa (migration 032 gelmeden) alan undefined → kapı sessiz açık.
  if (target.terminated_at) return { ok: false, hata: "terminated_target" };

  // Filo şefi: yalnız KENDİ filosunun personeline + düzenlemede yalnız kendi
  // PENDING talebine dokunabilir (fail-closed).
  if (isChief) {
    if (!scope.isFleetWorker(data.worker_id)) return { ok: false, hata: "scope" };
    if (existing) {
      if (
        existing.created_by !== workerId ||
        existing.status !== "pending" ||
        !scope.isFleetWorker(existing.worker_id)
      ) {
        return { ok: false, hata: "forbidden" };
      }
    }
  }

  // Örtüşme: aynı şoför için aynı günlere düşen (reddedilmemiş) izin engellenir.
  const overlaps = await findOverlappingLeaves(
    data.worker_id,
    data.start_date,
    data.end_date,
    data.id
  );
  if (overlaps.length > 0) return { ok: false, hata: "overlap" };

  // Vardiya çakışması: ENGEL DEĞİL, teyit. force gelmediyse teyit iste.
  if (!data.force) {
    const shifts = await countShiftsInRange(
      data.worker_id,
      data.start_date,
      data.end_date
    );
    if (shifts > 0) return { ok: false, needConfirm: true, conflictShifts: shifts };
  }

  const nowIso = new Date().toISOString();
  // Onay akışı: şef → pending; patron → approved (kendi onaylar).
  const approved = !isChief;

  if (existing) {
    // Düzenleme: patron her alanı, şef yalnız kendi pending'ini (worker_id sabit).
    const patch: Record<string, unknown> = {
      leave_type: data.leave_type,
      start_date: data.start_date,
      end_date: data.end_date,
      note: data.note ?? null,
      updated_at: nowIso,
    };
    if (!isChief) patch.worker_id = data.worker_id;
    const { data: upd, error } = await supabaseAdmin
      .from("worker_leaves")
      .update(patch)
      .eq("id", data.id!)
      .select(LEAVE_COLS)
      .maybeSingle();
    if (error || !upd) return { ok: false, hata: "db" };
    await logLeaveEdit(
      data.id!,
      workerId,
      "update",
      existing as unknown as Record<string, unknown>,
      upd as unknown as Record<string, unknown>
    );
    revalidateLeaveSurfaces();
    return { ok: true, id: data.id!, satir: upd as LeaveRow, olusturuldu: false };
  }

  const row = {
    worker_id: data.worker_id,
    leave_type: data.leave_type,
    start_date: data.start_date,
    end_date: data.end_date,
    status: approved ? "approved" : "pending",
    note: data.note ?? null,
    created_by: workerId,
    approved_by: approved ? workerId : null,
    decided_at: approved ? nowIso : null,
  };
  const { data: ins, error } = await supabaseAdmin
    .from("worker_leaves")
    .insert(row)
    .select(LEAVE_COLS)
    .maybeSingle();
  if (error || !ins) return { ok: false, hata: "db" };
  // Şef mi patron mu — status='pending'/'approved' zaten ayırt eder; action
  // her hâlde 'create' (DB CHECK ve LeaveEditAction ile tutarlı).
  await logLeaveEdit(
    (ins as LeaveRow).id,
    workerId,
    "create",
    null,
    ins as unknown as Record<string, unknown>
  );
  revalidateLeaveSurfaces();
  return {
    ok: true,
    id: (ins as LeaveRow).id,
    satir: ins as LeaveRow,
    olusturuldu: true,
  };
}

/**
 * İznin görüneceği panel sayfalarını tazele.
 *
 * `lib/leave-decision-db.ts` içindeki aynı adlı yardımcının İKİZİ ve bilerek
 * kopyalandı: taşıdığı şey iş kuralı değil, iki satırlık önbellek tazeleme.
 * Ortak bir modüle çıkarmak `next/cache` bağımlılığını `lib/leaves.ts` gibi
 * okuma yolunun her yerinden çekilen bir dosyaya sokardı — kazancından büyük
 * bir yüzey değişikliği. İş kuralları (yukarıdaki gövde) tek kaynakta.
 *
 * try/catch şart: `revalidatePath` istek kapsamı ister. Server action ve route
 * handler'da kapsam vardır; doğrulama betiği (`scripts/verify-*.mjs`) uçları
 * düz Node'da çağırır ve orada kapsam YOKTUR. Tazeleme başarısız diye ZATEN
 * YAZILMIŞ bir izni hata saymak yanlış olurdu: veri doğru, yalnız önbellek bayat.
 */
function revalidateLeaveSurfaces(): void {
  try {
    revalidatePath("/admin/izinler");
    revalidatePath("/admin");
  } catch {
    // İstek kapsamı yok (doğrulama betiği) — yazma etkilenmez.
  }
}

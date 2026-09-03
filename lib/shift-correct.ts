import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import {
  editEntrySchema,
  MAX_ODOMETER,
  MAX_PER_SHIFT_KM,
} from "@/lib/validation";
import { checkUndelivered } from "@/lib/package-limits";
import { logShiftEdit } from "@/lib/shift-edit-log";
import { seferePaketBaglaVardiyadan } from "@/lib/sefer-bridge";
import { latestVehicleTelemetry } from "@/lib/telemetry";
import { resolveEndKm } from "@/lib/auto-shift";

/**
 * VARDİYA DÜZELTME — TEK KAYNAK (03.09.2026).
 *
 * `app/actions/shift.ts`teki ÜÇ yönetici eyleminin gövdesi buraya taşındı:
 * `editEntryAction` (tam düzeltme), `adminUpdateKmAction` (km) ve
 * `adminCloseShiftAction` (kapanmamış vardiyayı kapat). Kural kümesi AYNI;
 * taşınırken hiçbir davranış değiştirilmedi. Sebep, mobil `PATCH
 * /api/mobile/shifts/[id]` ucunun aynı düzeltmeyi yapması gerekmesi.
 *
 * ── NEDEN KOPYALANMADI — BURASI YASAL BİR YÜZEY ───────────────────────────
 * `started_at`, `ended_at` ve `break_minutes` AZG raporunu (Avusturya iş
 * müfettişliği) DOĞRUDAN besleyen üç alandır. İkinci bir düzeltme yolu şu
 * güvencelerden birini sessizce kaybedebilirdi:
 *   • SEBEP ZORUNLU (087) — sebepsiz düzeltme reddedilir
 *   • `logShiftEdit` — değişen HER alan için iz satırı, tek `edit_group` altında
 *   • paket matematiği: teslim = alınan − geri getirilen (yönetici türetilmiş
 *     alanı elle giremez, 22.07.2026)
 *   • `checkUndelivered` anlamsal tavanı
 *   • plaka→`vehicle_id` senkronu (03.08.2026): iki referansın ayrışması
 *     telemetriyi/km'yi başka araca yazıyordu
 *   • sefer paket köprüsü (`seferePaketBaglaVardiyadan`)
 *
 * ── BU DOSYA KİMLİK DOĞRULAMAZ ────────────────────────────────────────────
 * `aktorId` yalnız İZ içindir. "Bu kişi yönetici mi" sorusunu çağıran ZATEN
 * sormuş olmalıdır (panelde `requireAdmin`, mobilde `requireMobileAdmin`) —
 * lib/worker-account-db.ts ile aynı sözleşme.
 *
 * ── revalidatePath BURADA DEĞİL ───────────────────────────────────────────
 * Panelde çıplak, mobil uçta try/catch içinde. Aynı gerekçe.
 */

export type ShiftCorrectOutcome = { ok: true } | { ok: false; error: string };

/**
 * TAM DÜZELTME — panelin düzenleme formunun karşılığı (`editEntryAction`).
 *
 * Girdi ALANLARI `editEntrySchema`dan geçer ve şema `z.coerce` kullanır:
 * FormData'nın string'i de JSON'un sayısı da aynı sonucu verir
 * (lib/shift-end.ts ile aynı desen).
 */
export async function correctShiftFields(
  aktorId: string | null | undefined,
  input: {
    id: unknown;
    started_at: unknown;
    ended_at?: unknown;
    start_km: unknown;
    end_km?: unknown;
    plate?: unknown;
    notes?: unknown;
    break_minutes?: unknown;
    start_package_count?: unknown;
    undelivered_count?: unknown;
    reason: unknown;
  }
): Promise<ShiftCorrectOutcome> {
  const parsed = editEntrySchema.safeParse({
    id: input.id,
    started_at: input.started_at,
    ended_at: input.ended_at ?? null,
    start_km: input.start_km,
    end_km: input.end_km ?? null,
    plate: input.plate ?? null,
    notes: input.notes ?? null,
    break_minutes: input.break_minutes ?? null,
    start_package_count: input.start_package_count ?? null,
    undelivered_count: input.undelivered_count ?? null,
    reason: input.reason ?? "",
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "validation" };
  }

  // PAKET MANTIĞI ŞOFÖRLE AYNI (22.07.2026). Yönetici de "teslim edilen"i elle
  // giremez; alınan − geri getirilen olarak hesaplanır. Böylece düzeltme
  // sırasında tutarsız üçlü (alınan/teslim/geri) oluşturulamaz — eskiden
  // türetilmiş alan düzenlenebilirken kaynak alanlar düzenlenemiyordu.
  const taken = parsed.data.start_package_count ?? null;
  const returned = parsed.data.undelivered_count ?? null;
  if (returned !== null) {
    const bound = checkUndelivered(returned, taken);
    if (!bound.ok) return { ok: false, error: bound.code };
  }
  const derivedCargo =
    taken !== null && returned !== null ? Math.max(0, taken - returned) : null;

  const startedAtIso = new Date(parsed.data.started_at).toISOString();
  const endedAtIso = parsed.data.ended_at
    ? new Date(parsed.data.ended_at).toISOString()
    : null;

  if (
    endedAtIso &&
    parsed.data.end_km !== null &&
    parsed.data.end_km !== undefined &&
    parsed.data.end_km < parsed.data.start_km
  ) {
    return { ok: false, error: `km_low:${parsed.data.end_km}:${parsed.data.start_km}` };
  }

  // ARAÇ REFERANSI SENKRONU (03.08.2026). Form yalnız `plate` metnini
  // düzenletiyor; vehicle_id'ye hiç dokunulmuyordu ve iki referans ayrışıyordu
  // (satırda "W-1234" yazarken telemetri/km başka aracın id'sinden okunuyordu).
  // Artık plaka bir araca çözülüyorsa vehicle_id de o araca yazılır. Çözülmüyorsa
  // (bilinmeyen/boş plaka) null yazılır: yanlış aracı asılı bırakmaktansa bağı
  // yokuz demek dürüsttür — hiçbir yüzey "bilinmiyor"u sayı gibi göstermiyor.
  const plateText = (parsed.data.plate ?? "").trim();
  let nextVehicleId: string | null = null;
  if (plateText) {
    const { data: vehRow } = await supabaseAdmin
      .from("vehicles")
      .select("id")
      .ilike("plate", plateText)
      .limit(1)
      .maybeSingle();
    nextVehicleId = (vehRow?.id as string | undefined) ?? null;
  }

  const update: Record<string, unknown> = {
    started_at: startedAtIso,
    ended_at: endedAtIso,
    start_km: parsed.data.start_km,
    end_km: parsed.data.end_km,
    plate: parsed.data.plate,
    vehicle_id: nextVehicleId,
    notes: parsed.data.notes,
    break_minutes: parsed.data.break_minutes ?? 0,
    start_package_count: taken,
    undelivered_count: returned,
    updated_at: new Date().toISOString(),
    updated_by: aktorId ?? null,
  };
  // Teslim edilen yalnız ikisi de biliniyorsa yazılır; biri boşsa mevcut
  // değeri EZMEYİZ (yarım veriyle uydurma sayı üretmek yerine dokunmayız).
  if (derivedCargo !== null) update.cargo_count = derivedCargo;

  // Değişiklik izini yazabilmek için ÖNCEKİ hâli okuyoruz (AZG yasal rapor:
  // started_at/ended_at/break_minutes doğrudan bu tablodan besleniyor).
  const { data: before } = await supabaseAdmin
    .from("time_entries")
    .select(
      "started_at, ended_at, start_km, end_km, plate, vehicle_id, notes, break_minutes, start_package_count, undelivered_count, cargo_count"
    )
    .eq("id", parsed.data.id)
    .maybeSingle();

  const { error } = await supabaseAdmin
    .from("time_entries")
    .update(update)
    .eq("id", parsed.data.id);

  if (error) return { ok: false, error: error.message };

  await logShiftEdit(parsed.data.id, aktorId ?? null, before ?? null, update, {
    reason: parsed.data.reason,
    kaynak: "duzeltme",
  });

  // SEFER PAKET KÖPRÜSÜ (Tur 3) — yönetici teslim sayısını düzeltirse seferin
  // taşıdığı rakam da tazelensin; yoksa sefer düzeltilmiş vardiyanın YANLIŞ
  // sayısını taşımaya devam ederdi.
  await seferePaketBaglaVardiyadan(parsed.data.id);

  return { ok: true };
}

/**
 * KM DÜZELTMESİ — açık ya da kapalı HERHANGİ bir vardiyanın sayaçları
 * (`adminUpdateKmAction`). Negatif olmama ve bitiş ≥ başlangıç doğrulanır;
 * denetim kolonları (updated_at/updated_by) damgalanır.
 */
export async function correctShiftKm(
  aktorId: string | null | undefined,
  entryId: string,
  startKm: number,
  endKm: number | null
): Promise<ShiftCorrectOutcome> {
  const s = Math.floor(Number(startKm));
  if (!Number.isFinite(s) || s < 0) return { ok: false, error: "errKmNeg" };
  if (s > MAX_ODOMETER) return { ok: false, error: "errKmRange" };

  let e: number | null = null;
  if (endKm !== null && endKm !== undefined && String(endKm) !== "") {
    e = Math.floor(Number(endKm));
    if (!Number.isFinite(e) || e < 0) return { ok: false, error: "errKmNeg" };
    if (e > MAX_ODOMETER) return { ok: false, error: "errKmRange" };
    if (e < s) return { ok: false, error: `km_low:${e}:${s}` };
    if (e - s > MAX_PER_SHIFT_KM) {
      return { ok: false, error: `km_high:${e - s}:${MAX_PER_SHIFT_KM}` };
    }
  }

  // Düzenleme izi için önceki km değerleri (bkz. lib/shift-edit-log.ts).
  const { data: beforeKm } = await supabaseAdmin
    .from("time_entries")
    .select("start_km, end_km")
    .eq("id", entryId)
    .maybeSingle();

  const kmUpdate = {
    start_km: s,
    end_km: e,
    updated_at: new Date().toISOString(),
    updated_by: aktorId ?? null,
  };
  const { error } = await supabaseAdmin
    .from("time_entries")
    .update(kmUpdate)
    .eq("id", entryId);

  if (error) return { ok: false, error: error.message };

  await logShiftEdit(entryId, aktorId ?? null, beforeKm ?? null, kmUpdate, {
    reason: "Km düzeltmesi (panel)",
    kaynak: "km",
  });

  return { ok: true };
}

/**
 * YÖNETİCİ KAPANMAMIŞ BİR VARDİYAYI KAPATIR — SEBEP ZORUNLU, İZ ZORUNLU (087).
 *
 * Neden gerekli (22.07.2026): otomatik kapanış kaldırıldı, yani unutulan
 * vardiyayı kapatacak tek mekanizma watchdog'un şoföre sorduğu soruydu — ve o
 * fiilen ölüydü (katman 20.08.2026'da tamamen söküldü). Telafi yolu olmadan
 * "vardiyayı sadece personel kapatır" kuralı, unutulan vardiyanın günlerce
 * açık kalması demekti (canlı: 27 saat açık kayıt).
 *
 * Bitiş anı "şimdi" DEĞİL: aracın son telemetri kaydı tercih edilir — sökülen
 * watchdog kapanışıyla birebir aynı kural. 27 saattir açık duran bir vardiyayı
 * "şimdi"ye kapatmak 27 saatlik çalışma yazardı. Bitiş km'si de manuel
 * kapanışla aynı kaynaktan türetilir (resolveEndKm).
 *
 * 🔴 ÖNCEDEN İZ BIRAKMIYORDU. Bu eylem `ended_at` ve `end_km` yazıyor;
 * `ended_at` AZG raporunu doğrudan besleyen üç alandan biri. `editEntryAction`
 * iz bırakırken kapatmanın bırakmaması, aynı tabloya iki farklı standart
 * uygulamaktı — ve denetimde "bu bitiş saatini kim koydu" sorusu cevapsız
 * kalıyordu.
 */
export async function closeShiftByAdmin(
  aktorId: string | null | undefined,
  entryId: string,
  reason: string
): Promise<ShiftCorrectOutcome> {
  const sebep = (reason ?? "").trim();
  if (sebep.length < 3) return { ok: false, error: "errReasonShort" };

  const { data: entry } = await supabaseAdmin
    .from("time_entries")
    .select("id, worker_id, vehicle_id, started_at, start_km, confirmation_status")
    .eq("id", entryId)
    .is("ended_at", null)
    .maybeSingle();
  if (!entry) return { ok: false, error: "no_active" };

  // Bitiş anı: aracın son telemetrisi → yoksa şimdi. Vardiya başlangıcından
  // önceye asla düşmez (bozuk telemetride negatif süre üretmesin).
  let endedIso = new Date().toISOString();
  if (entry.vehicle_id) {
    const { data: lastFix } = await supabaseAdmin
      .from("device_telemetry")
      .select("recorded_at")
      .eq("vehicle_id", entry.vehicle_id as string)
      .gte("recorded_at", entry.started_at as string)
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastFix?.recorded_at) endedIso = lastFix.recorded_at as string;
  }

  let endKm: number | null = null;
  if (entry.vehicle_id) {
    const latest = await latestVehicleTelemetry(entry.vehicle_id as string);
    endKm = await resolveEndKm(
      entry.vehicle_id as string,
      { started_at: entry.started_at as string, start_km: entry.start_km as number },
      endedIso,
      latest?.odometer_km,
      latest?.recorded_at
    );
  }

  const { error } = await supabaseAdmin
    .from("time_entries")
    .update({
      ended_at: endedIso,
      end_km: endKm,
      end_reason: "admin",
      summary_notified_at: endedIso,
      updated_at: new Date().toISOString(),
      updated_by: aktorId ?? null,
    })
    .eq("id", entryId)
    .is("ended_at", null);

  if (error) return { ok: false, error: error.message };

  /**
   * DENETİM İZİ — kapatma da bir düzeltmedir.
   *
   * `before` yalnız değişen iki alanı taşır: `ended_at` zaten null'dı,
   * `end_km` de. Log yazıcısı değişen alanları kendisi süzer.
   */
  await logShiftEdit(
    entryId,
    aktorId ?? null,
    { ended_at: null, end_km: null },
    { ended_at: endedIso, end_km: endKm },
    { reason: sebep, kaynak: "kapatma" }
  );

  // Başlangıç onayı verilmeden kapanan vardiya "onaysız" işaretlenir — manuel
  // kapanıştaki desenin aynısı (best-effort, kapanışı geri döndürmez).
  await supabaseAdmin
    .from("time_entries")
    .update({ confirmation_status: "unconfirmed" })
    .eq("id", entryId)
    .eq("confirmation_status", "pending")
    .then(
      () => {},
      () => {}
    );

  return { ok: true };
}

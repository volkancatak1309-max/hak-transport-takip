import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { endShiftSchema } from "@/lib/validation";
import { PACKAGES_ENABLED } from "@/lib/tenant";
import { checkUndelivered } from "@/lib/package-limits";
import { seferePaketBaglaVardiyadan } from "@/lib/sefer-bridge";
import { latestVehicleTelemetry } from "@/lib/telemetry";
import { resolveEndKm } from "@/lib/auto-shift";

/**
 * VARDİYA KAPATMA — TEK KAYNAK (Tur 1, 22.08.2026).
 *
 * Bu dosya `app/actions/shift.ts:endShiftAction`'dan ÇIKARILDI. Kural kümesi
 * satır satır aynıdır; taşınırken hiçbir davranış değiştirilmedi. Ayrılmasının
 * tek sebebi ikinci bir yüzeyin (mobil `POST /api/mobile/shifts/current/end`)
 * aynı kapanışı yapması gerekmesi.
 *
 * ── NEDEN KOPYALANMADI ──────────────────────────────────────────────────────
 * Kapanış görünenden çok daha fazlasını yapıyor: bitiş km'sini CİHAZDAN türetir
 * (şoför sayaç girmez, 21.07.2026), paket muhasebesini yürütür
 * (teslim = alınan − teslim edilemeyen), `checkUndelivered` anlamsal tavanını
 * uygular, paket modülü kapalı kiracıda alanı hiç sormaz, migration öncesi
 * kolona düşer, sefer köprüsünü tetikler ve onaysız vardiyayı işaretler.
 * İkinci bir kopya ilk değişiklikte geride kalırdı: panelden kapatılan vardiya
 * ile telefondan kapatılan vardiya FARKLI kayıt üretirdi ve bu fark raporlara,
 * AZG belgesine ve paket muhasebesine sessizce yayılırdı.
 *
 * ── ÇEVRİMDIŞI KUYRUK BİLEREK DIŞARIDA ──────────────────────────────────────
 * `app/actions/offline.ts`'in "end" dalı BENZER ama AYNI DEĞİL ve öyle kalmalı:
 * orada sınır dışı bir değer isteği REDDETMEZ, yalnız o alanı yazmaz — çünkü
 * çevrimdışı kuyruk hiçbir koşulda vardiyayı açıkta bırakmamalı. Buradaki
 * fonksiyon ise reddeder. İkisini birleştirmek, ikisinden birinin bilinçli
 * kararını yok etmek olurdu; bu yüzden birleştirilmedi.
 */

/** Kapanış formunun ham alanları. Şema `z.coerce` kullanıyor: FormData'nın
 *  string'i de JSON'un sayısı da aynı sonucu verir. */
export type ShiftEndInput = {
  plate?: unknown;
  notes?: unknown;
  break_minutes?: unknown;
  cargo_count?: unknown;
  undelivered_count?: unknown;
};

export type ShiftEndOutcome =
  | {
      ok: true;
      entryId: string;
      endedAt: string;
      /** Cihazdan türetildi; telemetrisi yoksa null ("ölçülemedi"). */
      endKm: number | null;
      /** alınan − teslim edilemeyen. Alınan bilinmiyorsa null. */
      delivered: number | null;
      undelivered: number | null;
    }
  | { ok: false; error: string };

/**
 * Bir çalışanın AÇIK vardiyasını kapatır.
 *
 * `workerId` ÇAĞIRANDAN gelir ve çağıran onu oturumdan/token'dan çözmek
 * ZORUNDADIR — bu fonksiyon kimlik doğrulamaz. Web tarafında `requireWorker()`,
 * mobilde `requireMobileWorker()` bu güvenceyi veriyor. Gövdeden gelen bir
 * worker_id'ye ASLA bağlanmaz: aksi hâlde bir şoför başkasının vardiyasını
 * kapatabilirdi.
 */
export async function endShiftForWorker(
  workerId: string,
  input: ShiftEndInput
): Promise<ShiftEndOutcome> {
  const parsed = endShiftSchema.safeParse({
    plate: input.plate ?? null,
    notes: input.notes ?? null,
    break_minutes: input.break_minutes ?? null,
    cargo_count: input.cargo_count ?? null,
    undelivered_count: input.undelivered_count ?? null,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "validation" };
  }

  // Yeni paket akışı: "teslim edilemeyen" kapanışta ZORUNLU (0 girilebilir, boş
  // bırakılamaz). İstemci de required yapıyor; sunucu son söz.
  //
  // PAKET MODÜLÜ KAPALI olan kiracıda (03.08.2026) bu alan hiçbir adımda
  // SORULMAZ — zorunlu tutmak vardiyayı KAPATILAMAZ yapardı. Kapalıyken null
  // geçer ve kolona null yazılır: "sayılmadı" demektir. 0 yazmak sayılmış gibi
  // görünürdü ve bu uydurma bir değer olurdu.
  if (
    PACKAGES_ENABLED &&
    (parsed.data.undelivered_count === null ||
      parsed.data.undelivered_count === undefined)
  ) {
    return { ok: false, error: "undelivered_required" };
  }

  const { data: active, error: findErr } = await supabaseAdmin
    .from("time_entries")
    .select(
      "id, vehicle_id, start_km, started_at, break_minutes, start_package_count"
    )
    .eq("worker_id", workerId)
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (findErr) return { ok: false, error: "db" };
  if (!active) return { ok: false, error: "no_active" };

  const endedIso = new Date().toISOString();

  // BİTİŞ KM'Sİ CİHAZDAN — şoför sayaç girmez (21.07.2026). Yanlış girilen
  // sayaç değerleri raporda 3.000 km'lik hayalet vardiyalar üretiyordu.
  // Kaynak sırası otomatik kapanışın birebir aynısı (resolveEndKm): cihaz
  // odometresi → GPS mesafesi → null. Telemetrisi olmayan araçta null kalır ve
  // rapor dürüstçe "—" gösterir; uydurma sayı yazmayız.
  let endKm: number | null = null;
  if (active.vehicle_id) {
    const latest = await latestVehicleTelemetry(active.vehicle_id as string);
    endKm = await resolveEndKm(
      active.vehicle_id as string,
      { started_at: active.started_at, start_km: active.start_km },
      endedIso,
      latest?.odometer_km,
      latest?.recorded_at
    );
  }

  // Paket muhasebesi (yeni akış, +1 sayaç yok):
  //  • alınan  = start_package_count (şoför gün içinde manuel girdi)
  //  • teslim edilemeyen = undelivered_count (kapanışta girilir, zorunlu)
  //  • teslim edilen (cargo_count) = alınan − teslim edilemeyen  → TÜRETİLİR
  // Alınan hiç girilmemişse (null) teslim edilen bilinmiyor kalır (null yazmayız,
  // mevcut değeri ezmeyiz).
  const undelivered = parsed.data.undelivered_count ?? null;
  const totalTaken = active.start_package_count;

  // ÜST SINIR (22.07.2026). endShiftSchema'daki MAX_COUNT (100.000) bir şema
  // tavanı; anlamlı değil — canlıya 87.189 "teslim edilemeyen" girilebildi.
  // Anlamsal sınır: teslim edilemeyen ≤ alınan (bilinmiyorsa mutlak tavan).
  // Şema geçse bile sunucu son sözü söyler.
  if (undelivered !== null) {
    const bound = checkUndelivered(undelivered, totalTaken as number | null);
    if (!bound.ok) return { ok: false, error: bound.code };
  }
  const delivered =
    undelivered !== null && totalTaken !== null && totalTaken !== undefined
      ? Math.max(0, totalTaken - undelivered)
      : null;

  const updateData: Record<string, unknown> = {
    ended_at: endedIso,
    end_km: endKm,
    notes: parsed.data.notes,
    summary_notified_at: endedIso,
    end_reason: "manual",
    undelivered_count: undelivered,
  };
  if (parsed.data.plate) updateData.plate = parsed.data.plate;
  if (parsed.data.break_minutes !== null && parsed.data.break_minutes !== undefined) {
    updateData.break_minutes = parsed.data.break_minutes;
  }
  if (delivered !== null) updateData.cargo_count = delivered;

  let { error } = await supabaseAdmin
    .from("time_entries")
    .update(updateData)
    .eq("id", active.id)
    .eq("worker_id", workerId);
  if (error && /undelivered_count|end_reason|column/i.test(error.message)) {
    // Pre-migration fallback: column not applied yet → end the shift anyway.
    const legacy = { ...updateData };
    delete legacy.undelivered_count;
    delete legacy.end_reason;
    ({ error } = await supabaseAdmin
      .from("time_entries")
      .update(legacy)
      .eq("id", active.id)
      .eq("worker_id", workerId));
  }

  if (error) return { ok: false, error: error.message };

  // SEFER PAKET KÖPRÜSÜ (Tur 3) — "akşam paket sayısı" burada kesinleşiyor
  // (teslim = alınan − teslim edilemeyen). Yan görev: throw etmez, kapanışı
  // hiçbir koşulda geri döndürmez; giriş akışı aynen kalır.
  await seferePaketBaglaVardiyadan(active.id as string);

  // Başlangıç onayı hiç verilmeden kapanan vardiya "onaysız" işaretlenir →
  // yönetici panelinde uyarı rozeti (İş 1). Best-effort: migration 020
  // uygulanmadıysa sessiz no-op (kapanışı asla geri döndürmez).
  await supabaseAdmin
    .from("time_entries")
    .update({ confirmation_status: "unconfirmed" })
    .eq("id", active.id)
    .eq("confirmation_status", "pending")
    .then(
      () => {},
      () => {}
    );

  return {
    ok: true,
    entryId: active.id as string,
    endedAt: endedIso,
    endKm,
    delivered,
    undelivered,
  };
}

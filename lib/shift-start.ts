import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { SHIFT_PER_DAY } from "@/lib/tenant";
import { startOfTodayVienna } from "@/lib/format";
import { evaluateDepotGate, resolveShiftStartAt } from "@/lib/depot";
import { latestVehicleTelemetry } from "@/lib/telemetry";
import { resolveStartKm } from "@/lib/auto-shift";
import { hasShiftToday } from "@/lib/shift-day";
import type { ManualStartAuth } from "@/lib/manual-start-scope";

/**
 * VARDİYA BAŞLATMA — TEK KAYNAK (03.09.2026).
 *
 * Bu dosya `app/actions/shift.ts`ten ÇIKARILDI: `startShiftManualAction` ve
 * `startShiftForWorkerAction` gövdeleri satır satır buraya taşındı. Kural
 * kümesi AYNI; taşınırken hiçbir davranış değiştirilmedi. Ayrılmasının tek
 * sebebi ikinci bir yüzeyin (mobil `POST /api/mobile/shifts/start` ve
 * `/start-for`) aynı vardiyayı açması gerekmesi.
 *
 * ── NEDEN KOPYALANMADI ────────────────────────────────────────────────────
 * Başlatma görünenden çok daha fazlasını yapıyor ve her parçası bir VAKA'nın
 * sonucu:
 *   • çift açık vardiya guard'ı + `uq_time_entries_one_open` 23505 yakalama
 *   • GÜNDE TEK VARDİYA → yeni satır DEĞİL, o günün satırını YENİDEN AÇ
 *     (22.07.2026) — ve `SHIFT_PER_DAY='many'` kiracısında bu dal ATLANIR,
 *     çünkü orada yeniden açma birinci vardiyayı SİLİYORDU (14.08.2026,
 *     Sendigo vakası)
 *   • depo kapısı yalnız YENİ vardiyada, yeniden açmada DEĞİL
 *   • `started_at` "şimdi" DEĞİL: depo girişi → 14 günlük ortalama → now
 *   • `location_unverified` / `start_time_estimated` ayrımı (038)
 *   • migration 037 öncesi `started_by`/`start_source` kolonsuz geri düşüş
 * İkinci bir kopya ilk değişiklikte geride kalırdı ve panelden açılan vardiya
 * ile telefondan açılan vardiya FARKLI kayıt üretirdi — fark raporlara, AZG
 * belgesine ve otomatik kapanış davranışına sessizce yayılırdı.
 *
 * ── BU DOSYA KİMLİK DOĞRULAMAZ ────────────────────────────────────────────
 * `workerId` / `auth` ÇAĞIRANDAN gelir. Panelde `requireWorker()` ve
 * `requireManualStartAuth()`, mobilde `requireMobileWorker()` ve
 * `requireMobileManualStart()` bu güvenceyi veriyor (lib/shift-end.ts ile
 * aynı sözleşme).
 *
 * ── revalidatePath BURADA DEĞİL ───────────────────────────────────────────
 * Panelde çıplak, mobil uçta try/catch içinde çağrılıyor. İkisini tek imzada
 * birleştirmek panelin bugünkü davranışını değiştirirdi (worker-account-db.ts
 * ile aynı gerekçe).
 */

export type ShiftStartOutcome =
  | {
      ok: true;
      /** true = yeni satır açılmadı, o günün kapanmış vardiyası yeniden açıldı. */
      reopened: boolean;
      /** Açılan/yeniden açılan satırın kimliği. */
      entryId: string | null;
    }
  | { ok: false; error: string };

/** Yeniden açarken kapanışa ait ne varsa temizlenen alanlar — İKİ yolda da aynı. */
function reopenClearFields(nowIso: string, actorId: string | null | undefined) {
  return {
    ended_at: null,
    end_km: null,
    end_reason: null,
    auto_ended: false,
    summary_notified_at: null,
    summary_confirmed_at: null,
    summary_confirmed_by: null,
    undelivered_count: null,
    updated_at: nowIso,
    updated_by: actorId ?? null,
  };
}

/**
 * ŞOFÖR KENDİ VARDİYASINI ELLE BAŞLATIR (panel bekleme ekranı / mobil).
 *
 * Kontak sinyali gecikirse ya da hiç gelmezse şoför vardiyayı kendi başlatır.
 * Araç ilişkisinin TEK kaynağı vehicles.assigned_worker_id'dir — şoför araç
 * seçmez, atanmış aracıyla açar. Yazılan satır lib/auto-shift.ts'in yazdığıyla
 * aynı kolon setine sahiptir; farklar bilinçli:
 *   • auto_started=false  → auto-shift bu vardiyayı ASLA otomatik kapatmaz
 *     (auto-shift.ts: `if (!vehicleShift || !vehicleShift.auto_started) continue`);
 *     başlatan bitirir.
 *   • confirmation_status="confirmed" → başlatma zaten şoförün kendi eylemi,
 *     bir saniye sonra "VARDİYAYI ONAYLA" kartını göstermek anlamsız olurdu.
 * vehicle_id HER ZAMAN doldurulur: auto-shift açık vardiyaları hem worker'a hem
 * araca göre indeksler; boş bırakmak kontak açılınca ikinci satır riskidir.
 *
 * @param opts.overrideVehicleId GEÇİCİ ARAÇ (22.07.2026). Verilirse vardiya BU
 *   araçla açılır; şoförün atanmış aracı (vehicles.assigned_worker_id) DEĞİŞMEZ
 *   — o kalıcı ilişki, bu ise "bugün hangi araçla" sorusunun cevabıdır ve
 *   time_entries.vehicle_id üzerinde yaşar. Ertesi gün yeni satır yine atanmış
 *   araçla açılır; temizlenecek bir durum YOKTUR.
 */
export async function startShiftSelf(
  workerId: string,
  opts?: { overrideVehicleId?: string }
): Promise<ShiftStartOutcome> {
  const overrideVehicleId = opts?.overrideVehicleId;

  // 0) Çalışan hâlâ aktif mi? requireWorker BUNU KAPSAMAZ: is_active yalnız
  //    girişte bir kez bakılıyor (app/actions/auth.ts) ve oturum çerezi 30 gün
  //    yaşıyor. İşten ayrılan şoförün telefonu aksi hâlde ay sonuna kadar
  //    vardiya açabilirdi. auto-shift aynı kontrolü yapıyor (w.is_active).
  //
  //    ⚠️ MOBİLDE FAZLADAN DEĞİL: verifyMobileRequest is_active'i her istekte
  //    okuyor, ama bu fonksiyon kimliğin nereden geldiğini bilmez ve kapıyı
  //    çağırana devretmek, çağıranlardan birinin unutmasıyla ayrılmış bir
  //    şoförün vardiya açması demek olurdu.
  const { data: me } = await supabaseAdmin
    .from("workers")
    .select("is_active")
    .eq("id", workerId)
    .maybeSingle();
  if (!me || me.is_active !== true) return { ok: false, error: "inactive_worker" };

  // 1) Araç. Şoför geçici araç seçtiyse O, seçmediyse atanmış aracı.
  //    "active" katılığı iki yolda da aynı: bakımdaki araçla vardiya açılmaz.
  //
  //    ÇÖZÜM ERTELENDİ, ÇAĞRI YERİ AŞAĞIDA (14.08.2026). Eskiden bu blok burada
  //    ÇALIŞIYOR ve `no_vehicle` ile ERKEN DÖNÜYORDU — yani yeniden açma dalına
  //    (madde 2b) hiç varılamıyordu. Ataması olmayan şoförde (Sendigo,
  //    DRIVER_VEHICLE_CHOICE='free') "VARDİYAYI YENİDEN AÇ" düğmesi bu yüzden
  //    "Sana atanmış araç yok" diyordu: yeniden açılacak satırın ARACI ZATEN
  //    BELLİYKEN kod onu aramaya gidiyordu. Artık çözüm ihtiyaç anında yapılır.
  const resolveVehicle = async (): Promise<
    | { ok: true; veh: { id: string; plate: string; status: string } }
    | { ok: false; error: string }
  > => {
    if (overrideVehicleId) {
      const { data } = await supabaseAdmin
        .from("vehicles")
        .select("id, plate, status, is_test")
        .eq("id", overrideVehicleId)
        .maybeSingle();
      // Test aracı seçiciye hiç gelmiyor; yine de sunucu son sözü söyler.
      if (!data || data.is_test === true) return { ok: false, error: "no_vehicle" };
      if ((data.status as string) !== "active") {
        return { ok: false, error: "vehicle_unavailable" };
      }
      return {
        ok: true,
        veh: {
          id: data.id as string,
          plate: data.plate as string,
          status: data.status as string,
        },
      };
    }
    const { data } = await supabaseAdmin
      .from("vehicles")
      .select("id, plate, status")
      .eq("assigned_worker_id", workerId)
      .neq("status", "inactive")
      .order("plate")
      .limit(1)
      .maybeSingle();
    if (!data) return { ok: false, error: "no_vehicle" };
    if ((data.status as string) !== "active") {
      return { ok: false, error: "vehicle_unavailable" };
    }
    return {
      ok: true,
      veh: {
        id: data.id as string,
        plate: data.plate as string,
        status: data.status as string,
      },
    };
  };

  // 2) Çift açık vardiya guard'ı. DB tarafında uq_time_entries_one_open partial
  //    unique index son sözü söyler.
  const { data: active } = await supabaseAdmin
    .from("time_entries")
    .select("id")
    .eq("worker_id", workerId)
    .is("ended_at", null)
    .maybeSingle();
  if (active) return { ok: false, error: "active" };

  // 2a) ARAÇ guard'ı KALDIRILDI (22.07.2026, Volkan kararı). Eskiden aynı
  //     araçta ikinci açık vardiya `vehicle_busy` ile reddediliyordu. Artık
  //     ENGELLENMİYOR: sahada iki kişinin aynı araca binmesi gerçek bir durum;
  //     yazılım onu yasaklamak yerine GÖRÜNÜR kılıyor. DB tarafı zaten güvenli:
  //     uq_time_entries_one_open worker_id bazlıdır.

  // 2b) GÜNDE TEK VARDİYA (lib/shift-day.ts) — çıkmaz sokak DEĞİL: o satırı
  //     YENİDEN AÇIYORUZ. Kapanışa ait ne varsa temizlenir; break_minutes ve
  //     start_km korunur (aynı vardiyanın devamı). undelivered_count sıfırlanır
  //     ki kapanış formu yeniden sorsun.
  //
  //     SHIFT_PER_DAY='many' (Sendigo): kural BU KİRACIDA YOK — yeniden açma
  //     started_at üzerine yazar, yani birinci vardiyayı SİLER (14.08.2026
  //     canlı vakası). O modda dal ATLANIR, aşağıda YENİ SATIR açılır.
  if (SHIFT_PER_DAY === "one" && (await hasShiftToday(workerId))) {
    const { data: todays } = await supabaseAdmin
      .from("time_entries")
      .select("id, vehicle_id, plate")
      .eq("worker_id", workerId)
      .gte("started_at", startOfTodayVienna().toISOString())
      .not("ended_at", "is", null)
      .order("ended_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Kapanmış vardiya bulunamadıysa kural gerçekten uygulanır (savunmacı: açık
    // vardiya ihtimali yukarıdaki guard'da zaten elendi).
    if (!todays) return { ok: false, error: "day_done" };

    // ARAÇ: seçilen/atanan, yoksa SATIRIN KENDİ ARACI. Yeniden açma yeni bir
    // araç ilişkisi kurmuyor — var olanı sürdürüyor.
    // `vehicle_unavailable` YEDEKLENMEZ: bakımdaki araçla vardiya sürdürülmez.
    const rv = await resolveVehicle();
    let veh: { id: string; plate: string };
    if (rv.ok) {
      veh = rv.veh;
    } else if (rv.error === "no_vehicle" && !overrideVehicleId && todays.vehicle_id) {
      veh = { id: todays.vehicle_id as string, plate: (todays.plate as string) ?? "—" };
    } else {
      return { ok: false, error: rv.error };
    }

    // ⚠️ `still_active_asked_at` BU YÜKTEN ÇIKARILDI (21.08.2026): sökülen
    // watchdog'un damgasıydı, ölü bir kolona yazmaktı.
    // ARAÇ da yazılır (03.08.2026): eskiden yeniden açma vehicle_id/plate'e
    // hiç dokunmuyor, şoför başka araç seçse bile vardiya sabahki araçla devam
    // ediyordu — telemetri, km ve rapor yanlış araca yazılıyordu.
    const { error: reopenErr } = await supabaseAdmin
      .from("time_entries")
      .update({
        ...reopenClearFields(new Date().toISOString(), workerId),
        vehicle_id: veh.id,
        plate: veh.plate,
      })
      .eq("id", todays.id as string)
      .eq("worker_id", workerId)
      .not("ended_at", "is", null);

    if (reopenErr) {
      // 23505 = uq_time_entries_one_open: aynı saniyede başka bir yol vardiya
      // açtıysa bu hata değil, "zaten aktif" durumudur.
      if (/duplicate key|23505/i.test(reopenErr.message)) {
        return { ok: false, error: "active" };
      }
      return { ok: false, error: reopenErr.message };
    }

    return { ok: true, reopened: true, entryId: todays.id as string };
  }

  // YENİ SATIR yolu — araç burada çözülür (yeniden açmanın yedeği yok: yeni
  // vardiya gerçek bir araç ister).
  const rvNew = await resolveVehicle();
  if (!rvNew.ok) return { ok: false, error: rvNew.error };
  const veh = rvNew.veh;

  // DEPO KAPISI (Modül 6) — YALNIZ yeni vardiya için (yeniden-açma yukarıda döndü;
  // yolda olan şoför devam ederken depoda olması beklenmez). Mesai depoda başlar:
  // araç KESİN depo dışında + muafiyet yoksa vardiya AÇILMAZ. Belirsiz/cihaz-ölü/
  // muafiyet → izin ver ama "konum doğrulanamadı" işaretle. Sunucu son sözü söyler:
  // buton pasif olsa da doğrudan çağrılıp kilit aşılamasın (fail-closed).
  const depotGate = await evaluateDepotGate(veh.id, workerId);
  if (depotGate.blocked) return { ok: false, error: "outside_depot" };

  // 3) Başlangıç km: odometre → aracın son biten vardiyası → 0.
  const latest = await latestVehicleTelemetry(veh.id);
  const startKm = await resolveStartKm(veh.id, latest?.odometer_km, latest?.recorded_at);

  // 3a) BAŞLANGIÇ ANI — "şimdi" DEĞİL (25.07.2026). Mesai depoda başlar, şoför
  //     ise depoya vardıktan bir süre sonra butona basıyor; butona basma anını
  //     yazmak mesaiyi sistematik olarak kısa gösteriyordu. Sıra (lib/depot.ts):
  //     bugünkü depo girişi → son 14 günün ortalama geliş saati → now.
  //     Şoför saat SEÇEMEZ, girmez; hesap tamamen sunucuda.
  //     confirmed_at bilinçli olarak AYRI ve "şimdi": onay anı gerçekten şimdi.
  const resolvedStart = await resolveShiftStartAt(veh.id);
  const startedIso = resolvedStart.at;
  const confirmedIso = new Date().toISOString();
  const { data: ins, error } = await supabaseAdmin
    .from("time_entries")
    .insert({
      worker_id: workerId,
      vehicle_id: veh.id,
      plate: veh.plate,
      started_at: startedIso,
      start_km: startKm,
      break_minutes: 0,
      auto_started: false,
      confirmation_status: "confirmed",
      confirmed_at: confirmedIso,
    })
    .select("id")
    .maybeSingle();
  if (error) {
    // 23505 = uq_time_entries_one_open. Şoför butona bastığı saniyede cron
    // kontaktan açtıysa bu bir hata değil, "zaten aktif" durumudur.
    if (/duplicate key|23505/i.test(error.message)) {
      return { ok: false, error: "active" };
    }
    return { ok: false, error: error.message };
  }

  // İKİ AYRI OLGU, İKİ AYRI BAYRAK (038, 27.07.2026):
  //   • location_unverified  → depo kapısı konumu doğrulayamadı: cihaz sessiz/
  //     ölü ya da yönetici muafiyeti. ARAÇTAN SİNYAL YOK.
  //   • start_time_estimated → araç depoda AMA started_at depo girişinden
  //     türetilemedi (ortalama / "şimdi"). SAAT TAHMİNİ.
  // İkisi aynı anda da düşebilir. Best-effort: kolon yoksa sessiz geç; manuel
  // başlatma ASLA kolon eksikliğiyle kırılmamalı.
  if ((depotGate.unverified || !resolvedStart.verified) && ins?.id) {
    const entryId = ins.id as string;
    const flags: Record<string, boolean> = {};
    if (depotGate.unverified) flags.location_unverified = true;
    if (!resolvedStart.verified) flags.start_time_estimated = true;
    try {
      const upd = await supabaseAdmin
        .from("time_entries")
        .update(flags)
        .eq("id", entryId);
      // 038 uygulanmamış ortam: yeni kolon yok → eski bayrağı tek başına yaz.
      if (
        upd.error &&
        /start_time_estimated|column/i.test(upd.error.message) &&
        flags.location_unverified
      ) {
        await supabaseAdmin
          .from("time_entries")
          .update({ location_unverified: true })
          .eq("id", entryId);
      }
    } catch {
      // kolon yok / hata → işaret düşmez, vardiya sağlam
    }
  }

  return { ok: true, reopened: false, entryId: (ins?.id as string | undefined) ?? null };
}

/**
 * YÖNETİCİ / FİLO ŞEFİ, bir personelin vardiyasını ELLE başlatır (Modül 7 telafi).
 *
 * Depo-tetikli otomatik vardiya telemetri düştüğünde açılmaz (bkz. lib/depot.ts);
 * o boşlukta mesaiyi insan eliyle başlatmanın yolu budur. `startShiftSelf`ten
 * FARKI: o YALNIZ kişinin kendisi için açar; bu ise BAŞKASI adına açar ve
 * yetkiyi çağıranın çözdüğü `ManualStartAuth` taşır.
 *
 * Bilinçli farklar:
 *   • started_at ÇAĞIRANDAN gelir (geri-tarihlenebilir: "mesaiye 06:30'da başladı").
 *     Bugünün Viyana günü içinde ve gelecekte olmayan bir an olmalı.
 *   • DEPO KİLİDİ UYGULANMAZ: araç şu an sahada olabilir (telemetri düştüğü için
 *     zaten buradayız); yönetici/şef bilerek override ediyor. Kilit koysaydık
 *     "araç depo dışında" diye başlatmayı engellerdi — telafinin amacına aykırı.
 *   • start_source = rol ('admin'|'chief'), started_by = eylemi yapan → iz + panel
 *     Dikkat kalemi (yalnız 'chief' bildirimi gösterir).
 */
export async function startShiftForWorkerCore(
  auth: Extract<ManualStartAuth, { ok: true }>,
  input: {
    workerId: string;
    /** ISO — çağıran Viyana duvar-saatinden türetir. */
    startedAt: string;
    /** Verilmezse şoförün atanmış aracı. */
    vehicleId?: string;
  }
): Promise<ShiftStartOutcome> {
  // Hedef şoför hâlâ kadroda mı?
  const { data: target } = await supabaseAdmin
    .from("workers")
    .select("id, is_active, is_admin, counts_as_driver")
    .eq("id", input.workerId)
    .maybeSingle();
  if (!target || target.is_active !== true) {
    return { ok: false, error: "inactive_worker" };
  }
  // Yönetici adına vardiya AÇILAMAZ. Seçici (roster) zaten yöneticileri
  // göstermiyor ama bu sunucu kapısı istemciye güvenmez: böyle bir satır
  // açılırsa Analiz, AZG ve tüm raporlara GERÇEK vardiya gibi girer ve şoför
  // metriklerini kalıcı olarak kirletir (canlıda iki demo satır tam olarak
  // bunu yapmıştı). Şefler is_admin=false olduğu için bu kapıya TAKILMAZ.
  //
  // MUAFİYET (migration 041): counts_as_driver=true olan yönetici roster'a
  // GİRER (lib/driver-scope.ts onu elemiyor) ve "Vardiya Başlat" düğmesiyle
  // görünür. Koşul kapsamla AYNI cümleyi kurar — ayrışamaz.
  if (target.is_admin === true && target.counts_as_driver !== true) {
    return { ok: false, error: "not_a_driver" };
  }

  // Araç: verilen (override) ya da atanmış. active + test-değil şartı iki yolda da.
  let veh: { id: string; plate: string } | null = null;
  if (input.vehicleId) {
    const { data } = await supabaseAdmin
      .from("vehicles")
      .select("id, plate, status, is_test, assigned_worker_id")
      .eq("id", input.vehicleId)
      .maybeSingle();
    if (!data || data.is_test === true) return { ok: false, error: "no_vehicle" };
    if ((data.status as string) !== "active") {
      return { ok: false, error: "vehicle_unavailable" };
    }
    // Şef YALNIZ kendi filosundaki aracı VEYA şoförün atanmış aracını seçebilir.
    if (auth.role === "chief") {
      const inScope =
        auth.scope.isFleetVehicle(data.id as string) ||
        (data.assigned_worker_id as string | null) === input.workerId;
      if (!inScope) return { ok: false, error: "vehicle_out_of_scope" };
    }
    veh = { id: data.id as string, plate: data.plate as string };
  } else {
    const { data } = await supabaseAdmin
      .from("vehicles")
      .select("id, plate, status")
      .eq("assigned_worker_id", input.workerId)
      .neq("status", "inactive")
      .order("plate")
      .limit(1)
      .maybeSingle();
    if (!data) return { ok: false, error: "no_vehicle" };
    if ((data.status as string) !== "active") {
      return { ok: false, error: "vehicle_unavailable" };
    }
    veh = { id: data.id as string, plate: data.plate as string };
  }

  // Başlangıç anı: bugünün Viyana günü içinde + gelecekte değil (60 sn tolerans).
  const startedMs = new Date(input.startedAt).getTime();
  if (!Number.isFinite(startedMs)) return { ok: false, error: "invalid_time" };
  if (startedMs > Date.now() + 60_000) return { ok: false, error: "future_time" };
  if (startedMs < startOfTodayVienna().getTime()) {
    return { ok: false, error: "not_today" };
  }
  const startedIso = new Date(startedMs).toISOString();

  // Çift açık vardiya guard'ı (DB'de uq_time_entries_one_open son sözü söyler).
  const { data: active } = await supabaseAdmin
    .from("time_entries")
    .select("id")
    .eq("worker_id", input.workerId)
    .is("ended_at", null)
    .maybeSingle();
  if (active) return { ok: false, error: "active" };

  // GÜNDE TEK VARDİYA: bugün kapanmış vardiya varsa YENİDEN AÇ (yeni satır üretme).
  // SHIFT_PER_DAY='many' kiracısında bu dal ATLANIR — bkz. startShiftSelf 2b.
  if (SHIFT_PER_DAY === "one" && (await hasShiftToday(input.workerId))) {
    const { data: todays } = await supabaseAdmin
      .from("time_entries")
      .select("id")
      .eq("worker_id", input.workerId)
      .gte("started_at", startOfTodayVienna().toISOString())
      .not("ended_at", "is", null)
      .order("ended_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!todays) return { ok: false, error: "day_done" };

    const reopenBase: Record<string, unknown> = {
      ...reopenClearFields(new Date().toISOString(), auth.actorId),
      started_at: startedIso,
      vehicle_id: veh.id,
      plate: veh.plate,
    };
    const reopen = { ...reopenBase, started_by: auth.actorId, start_source: auth.role };
    let up = await supabaseAdmin
      .from("time_entries")
      .update(reopen)
      .eq("id", todays.id as string)
      .eq("worker_id", input.workerId)
      .not("ended_at", "is", null);
    if (up.error && /start_source|started_by|column/i.test(up.error.message)) {
      // 037 öncesi: iz kolonları yok → kolonsuz yeniden dene (iz eksik, vardiya açık).
      up = await supabaseAdmin
        .from("time_entries")
        .update(reopenBase)
        .eq("id", todays.id as string)
        .eq("worker_id", input.workerId)
        .not("ended_at", "is", null);
    }
    if (up.error) {
      if (/duplicate key|23505/i.test(up.error.message)) {
        return { ok: false, error: "active" };
      }
      return { ok: false, error: up.error.message };
    }
    return { ok: true, reopened: true, entryId: todays.id as string };
  }

  // Yeni satır. km: odometre → aracın son biten vardiyası → 0 (resolveStartKm).
  const latest = await latestVehicleTelemetry(veh.id);
  const startKm = await resolveStartKm(veh.id, latest?.odometer_km, latest?.recorded_at);

  const insertBase: Record<string, unknown> = {
    worker_id: input.workerId,
    vehicle_id: veh.id,
    plate: veh.plate,
    started_at: startedIso,
    start_km: startKm,
    break_minutes: 0,
    // auto_started=false → auto-shift bu vardiyayı ASLA otomatik kapatmaz.
    auto_started: false,
    // Yetkili bir eylem; şoför onayı beklemez.
    confirmation_status: "confirmed",
    confirmed_at: startedIso,
  };
  const insertAudit = { ...insertBase, started_by: auth.actorId, start_source: auth.role };

  let res = await supabaseAdmin
    .from("time_entries")
    .insert(insertAudit)
    .select("id")
    .maybeSingle();
  if (res.error && /start_source|started_by|column/i.test(res.error.message)) {
    res = await supabaseAdmin
      .from("time_entries")
      .insert(insertBase)
      .select("id")
      .maybeSingle();
  }
  if (res.error) {
    if (/duplicate key|23505/i.test(res.error.message)) {
      return { ok: false, error: "active" };
    }
    return { ok: false, error: res.error.message };
  }

  return {
    ok: true,
    reopened: false,
    entryId: ((res.data as { id?: string } | null)?.id as string | undefined) ?? null,
  };
}

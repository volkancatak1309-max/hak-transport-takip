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
import {
  endShiftSchema,
  editEntrySchema,
  MAX_ODOMETER,
  MAX_PER_SHIFT_KM,
  MAX_COUNT,
} from "@/lib/validation";
import { PACKAGES_ENABLED, SHIFT_PER_DAY } from "@/lib/tenant";
import {
  workedMs,
  formatDurationShort,
  formatTime,
  startOfTodayVienna,
} from "@/lib/format";
import { checkUndelivered } from "@/lib/package-limits";
import { logShiftEdit, listShiftEdits } from "@/lib/shift-edit-log";
import { evaluateDepotGate, resolveShiftStartAt } from "@/lib/depot";
import { latestVehicleTelemetry } from "@/lib/telemetry";
import { resolveStartKm, resolveEndKm } from "@/lib/auto-shift";
import { hasShiftToday } from "@/lib/shift-day";
import { getTestScope } from "@/lib/test-data";
import { sendTelegramMessage } from "@/lib/telegram";
import {
  shiftSummaryMessage,
  shiftStartedMessage,
} from "@/lib/telegram-messages";

export type ShiftResult = {
  ok: boolean;
  error?: string;
  /** true = yeni satır açılmadı, o günün kapanmış vardiyası yeniden açıldı. */
  reopened?: boolean;
};

/**
 * Notify every linked admin that a driver just started a shift. Best-effort:
 * runs after the shift row is committed and never blocks or fails the action.
 */
async function notifyAdminsShiftStarted(
  workerId: string,
  workerName: string,
  plate: string,
  startedIso: string
): Promise<void> {
  // Test vardiyası yöneticilere bildirim ATMAZ. Telegram, panelden bağımsız
  // ikinci bir yüzey — burada elemezsek test hesabı ekranlarda gizliyken
  // herkesin telefonuna düşer.
  const scope = await getTestScope();
  if (scope.isTestWorker(workerId)) return;

  // test-visible: alıcı listesi (is_admin) — özne yukarıda elendi.
  const { data: admins } = await supabaseAdmin
    .from("workers")
    .select("telegram_chat_id, telegram_locale")
    .eq("is_admin", true)
    .not("telegram_chat_id", "is", null);

  for (const a of admins ?? []) {
    const loc = (a.telegram_locale as string) ?? "tr";
    await sendTelegramMessage(
      a.telegram_chat_id as string,
      shiftStartedMessage(loc, {
        name: workerName,
        plate,
        time: formatTime(startedIso, loc),
      })
    );
  }
}

/**
 * Manuel vardiya başlatma (şoför paneli bekleme ekranı).
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
 */
export async function startShiftManualAction(
  /**
   * GEÇİCİ ARAÇ (22.07.2026). Verilirse vardiya BU araçla açılır; şoförün
   * atanmış aracı (vehicles.assigned_worker_id) DEĞİŞMEZ — o kalıcı ilişki,
   * bu ise "bugün hangi araçla" sorusunun cevabıdır ve time_entries.vehicle_id
   * üzerinde yaşar. Ertesi gün yeni satır yine atanmış araçla açılır;
   * temizlenecek bir durum YOKTUR.
   */
  overrideVehicleId?: string
): Promise<ShiftResult> {
  const session = await requireWorker();

  // 0) Çalışan hâlâ aktif mi? requireWorker BUNU KAPSAMAZ: is_active yalnız
  //    girişte bir kez bakılıyor (app/actions/auth.ts) ve oturum çerezi 30 gün
  //    yaşıyor. İşten ayrılan şoförün telefonu aksi hâlde ay sonuna kadar
  //    vardiya açabilirdi. auto-shift aynı kontrolü yapıyor (w.is_active).
  const { data: me } = await supabaseAdmin
    .from("workers")
    .select("is_active")
    .eq("id", session.worker_id!)
    .maybeSingle();
  if (!me || me.is_active !== true) return { ok: false, error: "inactive_worker" };

  // 1) Araç. Şoför geçici araç seçtiyse O, seçmediyse atanmış aracı.
  //    "active" katılığı iki yolda da aynı: bakımdaki araçla vardiya açılmaz.
  //
  //    ÇÖZÜM ERTELENDİ, ÇAĞRI YERİ AŞAĞIDA (14.08.2026). Eskiden bu blok burada
  //    ÇALIŞIYOR ve `no_vehicle` ile ERKEN DÖNÜYORDU — yani yeniden açma dalına
  //    (madde 2b) hiç varılamıyordu. Ataması olmayan şoförde (Sendigo,
  //    DRIVER_VEHICLE_CHOICE='free': canlıda 5 aracın yalnız test aracı atanmış)
  //    "VARDİYAYI YENİDEN AÇ" düğmesi bu yüzden "Sana atanmış araç yok" diyordu:
  //    yeniden açılacak satırın ARACI ZATEN BELLİYKEN kod onu aramaya gidiyordu.
  //    Artık çözüm ihtiyaç anında yapılır ve yeniden açmada satırın kendi aracı
  //    yedektir. HAK61'de (atamalı mod) sorgu aynı sorgu, sonuç aynı sonuç.
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
      .eq("assigned_worker_id", session.worker_id!)
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

  // 2) Çift açık vardiya guard'ı (startShiftAction ile aynı). DB tarafında
  //    uq_time_entries_one_open partial unique index son sözü söyler.
  const { data: active } = await supabaseAdmin
    .from("time_entries")
    .select("id")
    .eq("worker_id", session.worker_id!)
    .is("ended_at", null)
    .maybeSingle();
  if (active) return { ok: false, error: "active" };

  // 2a) ARAÇ guard'ı KALDIRILDI (22.07.2026, Volkan kararı). Eskiden aynı
  //     araçta ikinci açık vardiya `vehicle_busy` ile reddediliyordu. Artık
  //     ENGELLENMİYOR: şoför paneldeki seçicide "bu aracı şu an X kullanıyor"
  //     uyarısını görür ve yine de devam edebilir (kural 3). Sahada iki kişinin
  //     aynı araca binmesi gerçek bir durum; yazılım onu yasaklamak yerine
  //     GÖRÜNÜR kılıyor — yönetici Araçlar sayfasında iki şoförü de görür ve
  //     km çift sayımı rozetle işaretlenir.
  //     DB tarafı zaten güvenli: uq_time_entries_one_open worker_id bazlıdır,
  //     yani bir şoförün iki açık vardiyası hâlâ imkânsız.

  // 2b) GÜNDE TEK VARDİYA (lib/shift-day.ts) — artık çıkmaz sokak DEĞİL.
  //
  //     Kural aynı kalıyor: bir şoförün bir Viyana gününde EN FAZLA BİR vardiya
  //     SATIRI olur. Ama "bugün zaten kapattın" demek yerine o satırı YENİDEN
  //     AÇIYORUZ. Gerekçe (22.07.2026): kapanış artık yalnız insan eliyle
  //     oluyor ve tek yanlış dokunuş şoförün gününü bitiriyordu — kurtarma yolu
  //     yalnız yöneticideydi. Yeniden açmak yeni satır üretmediği için "günde
  //     tek vardiya" muhasebesi bozulmaz; gün sonunda yine tek kayıt kalır.
  //
  //     Kapanışa ait ne varsa temizlenir: imza (vardiya bitmediği için geçersiz),
  //     km/kapanış sebebi ve watchdog sayacı. break_minutes ve start_km korunur —
  //     aynı vardiyanın devamıdır. undelivered_count sıfırlanır ki kapanış formu
  //     yeniden sorsun; cargo_count kapanışta zaten yeniden türetilir.
  //
  //     SHIFT_PER_DAY='many' (Sendigo, 14.08.2026): kural BU KİRACIDA YOK.
  //     Gece vardiyası + gündüz çağrı işi aynı güne düşüyor ve ikincisi
  //     GERÇEKTEN ayrı bir vardiyadır. Yeniden açma o gün için YANLIŞ cevaptır:
  //     started_at/ended_at üzerine yazar, yani birinci vardiyayı SİLER. Canlıda
  //     görüldü (14.08.2026, Sendigo): Can Özsavaş'ın 07:10→09:28 vardiyası
  //     yönetici "yeniden aç" dediğinde 20:00 başlangıcıyla ezildi, satır
  //     created_at=05:10 damgasıyla tek başına kaldı ve sabahki 2 sa 18 dk
  //     kayboldu. 'many' modda bu dal ATLANIR, aşağıda YENİ SATIR açılır.
  if (SHIFT_PER_DAY === "one" && (await hasShiftToday(session.worker_id!))) {
    const { data: todays } = await supabaseAdmin
      .from("time_entries")
      .select("id, vehicle_id, plate")
      .eq("worker_id", session.worker_id!)
      .gte("started_at", startOfTodayVienna().toISOString())
      .not("ended_at", "is", null)
      .order("ended_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Kapanmış vardiya bulunamadıysa kural gerçekten uygulanır (savunmacı: açık
    // vardiya ihtimali yukarıdaki guard'da zaten elendi).
    if (!todays) return { ok: false, error: "day_done" };

    // ARAÇ: seçilen/atanan, yoksa SATIRIN KENDİ ARACI. Yeniden açma yeni bir
    // araç ilişkisi kurmuyor — var olanı sürdürüyor; şoför araç seçmediyse
    // ve ataması da yoksa doğru cevap "hata" değil, sabahki araçtır.
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

    // ARAÇ da yazılır (03.08.2026). Eskiden yeniden açma vehicle_id ve plate'e
    // HİÇ dokunmuyordu: şoför günün ikinci açılışında BAŞKA araç seçse bile
    // vardiya sabahki araçla devam ediyordu — telemetri, km ve rapor yanlış
    // araca yazılıyordu. Yönetici/şef yolu (aşağıda) ikisini zaten yazıyordu;
    // iki yeniden-açma yolu bu noktada ayrışmıştı, artık aynı.
    const { error: reopenErr } = await supabaseAdmin
      .from("time_entries")
      .update({
        ended_at: null,
        end_km: null,
        end_reason: null,
        auto_ended: false,
        summary_notified_at: null,
        summary_confirmed_at: null,
        summary_confirmed_by: null,
        still_active_asked_at: null,
        undelivered_count: null,
        vehicle_id: veh.id,
        plate: veh.plate,
        updated_at: new Date().toISOString(),
        updated_by: session.worker_id,
      })
      .eq("id", todays.id as string)
      .eq("worker_id", session.worker_id!)
      .not("ended_at", "is", null);

    if (reopenErr) {
      // 23505 = uq_time_entries_one_open: aynı saniyede başka bir yol vardiya
      // açtıysa bu hata değil, "zaten aktif" durumudur.
      if (/duplicate key|23505/i.test(reopenErr.message)) {
        return { ok: false, error: "active" };
      }
      return { ok: false, error: reopenErr.message };
    }

    revalidatePath("/panel");
    revalidatePath("/admin");
    return { ok: true, reopened: true };
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
  // buton pasif olsa da action doğrudan çağrılıp kilit aşılamasın (fail-closed).
  const depotGate = await evaluateDepotGate(veh.id, session.worker_id!);
  if (depotGate.blocked) return { ok: false, error: "outside_depot" };

  // 3) Başlangıç km: odometre → aracın son biten vardiyası → 0. Şoför
  //    "Ayarlar → Başlangıç KM"den düzeltebilir.
  const latest = await latestVehicleTelemetry(veh.id as string);
  const startKm = await resolveStartKm(veh.id as string, latest?.odometer_km);

  // 3a) BAŞLANGIÇ ANI — "şimdi" DEĞİL (25.07.2026). Mesai depoda başlar, şoför
  //     ise depoya vardıktan bir süre sonra butona basıyor; butona basma anını
  //     yazmak mesaiyi sistematik olarak kısa gösteriyordu. Sıra (lib/depot.ts):
  //     bugünkü depo girişi → son 14 günün ortalama geliş saati → now.
  //     Şoför saat SEÇEMEZ, girmez; hesap tamamen sunucuda.
  //     confirmed_at bilinçli olarak AYRI ve "şimdi": onay anı gerçekten şimdi.
  const resolvedStart = await resolveShiftStartAt(veh.id as string);
  const startedIso = resolvedStart.at;
  const confirmedIso = new Date().toISOString();
  const { data: ins, error } = await supabaseAdmin
    .from("time_entries")
    .insert({
      worker_id: session.worker_id!,
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

  // İKİ AYRI OLGU, İKİ AYRI BAYRAK (038, 27.07.2026). Eskiden ikisi de tek
  // `location_unverified`e yığılıyordu ve pano "konum doğrulanmadı" derken
  // vakaların çoğunda konum DOĞRULANMIŞTI (27.07: 8 kaydın 7'si depodaydı):
  //   • location_unverified  → depo kapısı konumu doğrulayamadı: cihaz sessiz/
  //     ölü ya da yönetici muafiyeti. ARAÇTAN SİNYAL YOK.
  //   • start_time_estimated → araç depoda AMA started_at depo girişinden
  //     türetilemedi (kademe 2 ortalama / kademe 3 "şimdi"). SAAT TAHMİNİ.
  // İkisi aynı anda da düşebilir (cihaz ölü → hem konum hem saat bilinmez).
  //
  // Best-effort: kolon yoksa sessiz geç; manuel başlatma ASLA kolon eksikliğiyle
  // kırılmamalı.
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
      // (Yalnız saat tahminiyse yazacak bir şey yok; sessizce geçilir.)
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

  await notifyAdminsShiftStarted(
    session.worker_id!,
    session.name ?? "—",
    (veh.plate as string) ?? "—",
    startedIso
  );

  revalidatePath("/panel");
  revalidatePath("/admin");
  return { ok: true };
}

/**
 * YÖNETİCİ / FİLO ŞEFİ, bir personelin vardiyasını ELLE başlatır (Modül 7 telafi).
 *
 * Depo-tetikli otomatik vardiya telemetri düştüğünde açılmaz (bkz. lib/depot.ts);
 * o boşlukta mesaiyi insan eliyle başlatmanın yolu budur. startShiftManualAction'dan
 * FARKI: o requireWorker() ile YALNIZ kendisi için açar; bu ise BAŞKASI adına açar
 * ve yetkiyi requireManualStartAuth ile denetler (patron=herkes, şef=yalnız kendi
 * filosu, fail-closed). İçini (resolveStartKm, insert kolon seti, one-open guard,
 * günde-tek-vardiya + yeniden-açma) startShiftManualAction ile paylaşır.
 *
 * Bilinçli farklar:
 *   • started_at ÇAĞIRANDAN gelir (geri-tarihlenebilir: "mesaiye 06:30'da başladı").
 *     Bugünün Viyana günü içinde ve gelecekte olmayan bir an olmalı.
 *   • DEPO KİLİDİ UYGULANMAZ: araç şu an sahada olabilir (telemetri düştüğü için
 *     zaten buradayız); yönetici/şef bilerek override ediyor. Kilit koysaydık
 *     "araç depo dışında" diye başlatmayı engellerdi — telafinin amacına aykırı.
 *   • start_source = rol ('admin'|'chief'), started_by = eylemi yapan → iz + panel
 *     Dikkat kalemi (yalnız 'chief' bildirimi gösterir). Bildirim = PANEL (Volkan
 *     kararı): push yok, start_source kalıcı olduğu için Dikkat panosu türetir.
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
  // GİRER (lib/driver-scope.ts onu elemiyor) ve Günün Panosu'nda "Vardiya
  // Başlat" düğmesiyle görünür. Kapı buradaki ham is_admin kontrolüyle kalsaydı
  // düğme sunucuda "not_a_driver" ile reddedilirdi: listede duran ama
  // çalışmayan bir eylem. Koşul kapsamla AYNI cümleyi kurar — ayrışamaz.
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
  // SHIFT_PER_DAY='many' kiracısında bu dal ATLANIR — bkz. startShiftManualAction
  // madde 2b: yeniden açma started_at'in üzerine yazdığı için ikinci vardiyayı
  // eklemez, birincisini SİLER.
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
      ended_at: null,
      end_km: null,
      end_reason: null,
      auto_ended: false,
      summary_notified_at: null,
      summary_confirmed_at: null,
      summary_confirmed_by: null,
      still_active_asked_at: null,
      undelivered_count: null,
      started_at: startedIso,
      vehicle_id: veh.id,
      plate: veh.plate,
      updated_at: new Date().toISOString(),
      updated_by: auth.actorId,
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
    revalidatePath("/panel");
    revalidatePath("/admin");
    revalidatePath("/admin/workers");
    return { ok: true, reopened: true };
  }

  // Yeni satır. km: odometre → aracın son biten vardiyası → 0 (resolveStartKm).
  const latest = await latestVehicleTelemetry(veh.id);
  const startKm = await resolveStartKm(veh.id, latest?.odometer_km);

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

  revalidatePath("/panel");
  revalidatePath("/admin");
  revalidatePath("/admin/workers");
  return { ok: true };
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

  const parsed = endShiftSchema.safeParse({
    plate: formData.get("plate") || null,
    notes: formData.get("notes") || null,
    break_minutes: formData.get("break_minutes") || null,
    cargo_count: formData.get("cargo_count") || null,
    undelivered_count: formData.get("undelivered_count") || null,
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
    .eq("worker_id", session.worker_id!)
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
      latest?.odometer_km
    );
  }
  const finalBreak =
    parsed.data.break_minutes ?? active.break_minutes ?? 0;

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
    .eq("worker_id", session.worker_id!);
  if (error && /undelivered_count|end_reason|column/i.test(error.message)) {
    // Pre-migration fallback: column not applied yet → end the shift anyway.
    const legacy = { ...updateData };
    delete legacy.undelivered_count;
    delete legacy.end_reason;
    ({ error } = await supabaseAdmin
      .from("time_entries")
      .update(legacy)
      .eq("id", active.id)
      .eq("worker_id", session.worker_id!));
  }

  if (error) return { ok: false, error: error.message };

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

  // Telegram end-of-shift summary to the driver (best-effort, never blocks).
  const { data: me } = await supabaseAdmin
    .from("workers")
    .select("telegram_chat_id, telegram_locale")
    .eq("id", session.worker_id!)
    .maybeSingle();
  if (me?.telegram_chat_id) {
    const loc = (me.telegram_locale as string) ?? "tr";
    const ms = workedMs({
      started_at: active.started_at,
      ended_at: endedIso,
      break_minutes: finalBreak,
    });
    await sendTelegramMessage(
      me.telegram_chat_id as string,
      shiftSummaryMessage(loc, {
        hours: formatDurationShort(ms, loc),
        // Cihazdan km çözülemediyse "—" — otomatik kapanış özetiyle aynı dil.
        km: endKm !== null ? String(endKm - active.start_km) : "—",
        cargo: String(delivered ?? 0),
        breakMin: String(finalBreak),
      })
    );
  }

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
 * Admin corrects the start/end odometer of ANY shift (open or closed). Validates
 * non-negative and end ≥ start; stamps the audit columns (updated_at/updated_by).
 */
export async function adminUpdateKmAction(
  entryId: string,
  startKm: number,
  endKm: number | null
): Promise<ShiftResult> {
  const session = await requireAdmin();
  const s = Math.floor(Number(startKm));
  if (!Number.isFinite(s) || s < 0) return { ok: false, error: "errKmNeg" };
  if (s > MAX_ODOMETER) return { ok: false, error: "errKmRange" };

  let e: number | null = null;
  if (endKm !== null && endKm !== undefined && String(endKm) !== "") {
    e = Math.floor(Number(endKm));
    if (!Number.isFinite(e) || e < 0) return { ok: false, error: "errKmNeg" };
    if (e > MAX_ODOMETER) return { ok: false, error: "errKmRange" };
    if (e < s) return { ok: false, error: `km_low:${e}:${s}` };
    if (e - s > MAX_PER_SHIFT_KM) return { ok: false, error: `km_high:${e - s}:${MAX_PER_SHIFT_KM}` };
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
    updated_by: session.worker_id,
  };
  const { error } = await supabaseAdmin
    .from("time_entries")
    .update(kmUpdate)
    .eq("id", entryId);

  if (error) return { ok: false, error: error.message };

  await logShiftEdit(entryId, session.worker_id ?? null, beforeKm ?? null, kmUpdate);

  revalidatePath("/admin");
  revalidatePath("/panel");
  return { ok: true };
}

/**
 * Yönetici, KAPANMAMIŞ bir vardiyayı kapatır ("Kapanmamış Vardiyalar" kartı).
 *
 * Neden gerekli (22.07.2026): otomatik kapanış kaldırıldı, yani unutulan
 * vardiyayı kapatacak tek mekanizma watchdog'un Telegram sorusuydu — ve o
 * fiilen ölü: 31 aktif şoförün HİÇBİRİ Telegram'a bağlı değil, watchdog yalnız
 * adminlere haber verip `still_active_asked_at` damgalıyor. Telafi yolu
 * olmadan "vardiyayı sadece personel kapatır" kuralı, unutulan vardiyanın
 * günlerce açık kalması demekti (canlı: 27 saat açık kayıt).
 *
 * Bitiş anı "şimdi" DEĞİL: aracın son telemetri kaydı tercih edilir — watchdog
 * kapanışıyla (app/api/telegram/webhook) birebir aynı kural. 27 saattir açık
 * duran bir vardiyayı "şimdi"ye kapatmak 27 saatlik çalışma yazardı.
 * Bitiş km'si de manuel kapanışla aynı kaynaktan türetilir (resolveEndKm).
 */
export async function adminCloseShiftAction(entryId: string): Promise<ShiftResult> {
  const session = await requireAdmin();

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
      latest?.odometer_km
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
      updated_by: session.worker_id,
    })
    .eq("id", entryId)
    .is("ended_at", null);

  if (error) return { ok: false, error: error.message };

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

  revalidatePath("/admin");
  revalidatePath("/panel");
  return { ok: true };
}

export async function editEntryAction(formData: FormData): Promise<ShiftResult> {
  const session = await requireAdmin();

  const parsed = editEntrySchema.safeParse({
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
  const endedAtIso = parsed.data.ended_at ? new Date(parsed.data.ended_at).toISOString() : null;

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
    updated_by: session.worker_id,
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

  await logShiftEdit(parsed.data.id, session.worker_id ?? null, before ?? null, update);

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

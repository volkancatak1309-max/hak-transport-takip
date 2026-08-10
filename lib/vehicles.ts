import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { startOfTodayVienna } from "@/lib/format";
import { computeLiveStatus } from "@/lib/vehicle-ui";
import { latestVehicleTelemetry, listActiveDtc, type VehicleDtcRow } from "@/lib/telemetry";
import { getTestScope, dropTestRows } from "@/lib/test-data";
import { UNRESTRICTED, dropOtherFleets, type FleetScope } from "@/lib/fleet-scope";
import { isFleetVisible } from "@/lib/tenant";
import type {
  VehicleFleet,
  Vehicle,
  VehicleWithStatus,
  VehiclePenalty,
  TimeEntry,
  Worker,
} from "@/lib/types";

type ActiveShift = Pick<
  TimeEntry,
  "id" | "worker_id" | "vehicle_id" | "break_started_at" | "started_at"
>;

/** Vehicles for the shift-start picker (active fleet only). */
export async function listVehiclesForSelect(): Promise<
  Pick<Vehicle, "id" | "plate" | "make" | "model">[]
> {
  const scope = await getTestScope();
  // test-filtered: dropTestRows — test aracı yönetici seçicilerinde çıkmaz.
  // fleet-scoped: BİLEREK filo kapsamı YOK — bu seçici şoföre aittir, yönetici
  // yüzeyi değildir; şoför her filodan araç seçebilmelidir (kural 2).
  const { data } = await supabaseAdmin
    .from("vehicles")
    .select("id, plate, make, model")
    .neq("status", "inactive")
    .order("plate");
  const rows = (data ?? []) as Pick<Vehicle, "id" | "plate" | "make" | "model">[];
  return dropTestRows(rows, (v) => ({ vehicle: v.id }), scope);
}

/** Şoför seçicisindeki bir araç satırı. */
export type PickableVehicle = {
  id: string;
  plate: string;
  make: string | null;
  model: string | null;
  fleet: VehicleFleet;
  /** Bu aracı ŞU AN açık vardiyada kullanan şoför(ler)in adı. */
  inUseBy: string[];
  /** Bu, şoförün kendi atanmış aracı mı? Listede en üstte gösterilir. */
  isOwn: boolean;
};

/**
 * GEÇİCİ ARAÇ SEÇİCİSİ (22.07.2026) — şoför paneli.
 *
 * Aracı bozulan / izinde olan şoför başka araçla vardiya açar. Liste
 * BİLEREK filo ayrımı yapmaz: mavi şoför bordo araç seçebilir.
 *
 * `inUseBy` boş değilse o araçta şu an açık vardiyası olan biri vardır.
 * Bu ENGEL DEĞİL, UYARIDIR (kural 3): şoför yine de seçebilir. Panel
 * uyarıyı gösterir, karar şoförün.
 */
export async function listVehiclesForDriverPick(
  workerId: string
): Promise<PickableVehicle[]> {
  const scope = await getTestScope();

  // fleet-scoped: ŞEF kapsamı BİLEREK YOK. Bu şoföre ait bir seçicidir,
  // yönetici yüzeyi değil; kural 2 gereği filolar arası seçim serbesttir
  // (mavi şoför bordo araç seçebilmeli). Filo şefinin gördüğü yüzeyler
  // ayrı ve orada kapsam uygulanıyor.
  //
  // 03.08.2026 — KİRACININ KULLANMADIĞI filo yine de elenir (ACTIVE_FLEETS,
  // aşağıda). HAK61'de iki filo da kullanımda → liste DEĞİŞMEZ. Tek filolu
  // müşteride arayüzün hiçbir yerinde görünmeyen bir filonun aracı seçiciye
  // düşmemeli.
  // test-filtered: dropTestRows — test aracı şoföre de gösterilmez.
  const [{ data: vData }, { data: sData }] = await Promise.all([
    supabaseAdmin
      .from("vehicles")
      .select("id, plate, make, model, fleet, assigned_worker_id")
      .eq("status", "active")
      .order("plate"),
    // test-filtered: dropTestRows (aşağıda) — açık vardiyalar, "kim kullanıyor".
    // fleet-scoped: BİLEREK kapsam YOK — "bu aracı şu an kim kullanıyor"
    // sorusunun cevabı filoya bağlı değildir; şoför hangi filodan araç seçerse
    // seçsin doğru uyarıyı görmelidir.
    supabaseAdmin
      .from("time_entries")
      .select("worker_id, vehicle_id")
      .is("ended_at", null),
  ]);

  const vehicles = dropTestRows(
    ((vData ?? []) as (Pick<Vehicle, "id" | "plate" | "make" | "model" | "fleet"> & {
      assigned_worker_id: string | null;
    })[]).filter((v) => isFleetVisible(v.fleet)),
    (v) => ({ vehicle: v.id }),
    scope
  );
  const openShifts = dropTestRows(
    (sData ?? []) as { worker_id: string | null; vehicle_id: string | null }[],
    (s) => ({ worker: s.worker_id, vehicle: s.vehicle_id }),
    scope
  );

  const names = await workerNames([
    ...new Set(openShifts.map((s) => s.worker_id).filter(Boolean) as string[]),
  ]);
  const usersByVehicle = new Map<string, string[]>();
  for (const s of openShifts) {
    if (!s.vehicle_id || !s.worker_id) continue;
    // Şoförün KENDİ açık vardiyası "başkası kullanıyor" sayılmaz.
    if (s.worker_id === workerId) continue;
    const arr = usersByVehicle.get(s.vehicle_id) ?? [];
    arr.push(names.get(s.worker_id) ?? "—");
    usersByVehicle.set(s.vehicle_id, arr);
  }

  return vehicles
    .map((v) => ({
      id: v.id,
      plate: v.plate,
      make: v.make,
      model: v.model,
      fleet: v.fleet,
      inUseBy: usersByVehicle.get(v.id) ?? [],
      isOwn: v.assigned_worker_id === workerId,
    }))
    // Kendi aracı en üstte, sonra plakaya göre.
    .sort((a, b) =>
      a.isOwn === b.isOwn ? a.plate.localeCompare(b.plate) : a.isOwn ? -1 : 1
    );
}

/** All vehicles with derived live status + current/assigned driver. */
export async function listVehiclesWithStatus(
  fleet: FleetScope = UNRESTRICTED
): Promise<VehicleWithStatus[]> {
  const scope = await getTestScope();
  // test-filtered: dropTestRows — Araçlar sayfasını, yönetici panosunun filo
  // sayaçlarını ve Operasyon Özeti'ni besleyen ana boğaz.
  const [{ data: vData }, { data: sData }] = await Promise.all([
    supabaseAdmin.from("vehicles").select("*").order("plate"),
    supabaseAdmin
      .from("time_entries")
      .select("id, worker_id, vehicle_id, break_started_at, started_at")
      .is("ended_at", null),
  ]);

  // Iki eleme UST USTE: once test kayitlari, sonra filo kapsami.
  const vehicles = dropOtherFleets(
    dropTestRows((vData ?? []) as Vehicle[], (v) => ({ vehicle: v.id }), scope),
    (v) => ({ vehicle: v.id }),
    fleet
  );
  const activeShifts = dropOtherFleets(
    dropTestRows(
      (sData ?? []) as ActiveShift[],
      (s) => ({ worker: s.worker_id, vehicle: s.vehicle_id }),
      scope
    ),
    (s) => ({ vehicle: s.vehicle_id }),
    fleet
  );

  // Araç → o araçtaki AÇIK vardiyalar. Eskiden yalnız İLKİ tutuluyordu;
  // geçici araç seçimi serbest bırakıldıktan sonra (22.07.2026) bir araçta
  // iki şoför olabiliyor ve yönetici ikisini de görmeli.
  const shiftsByVehicle = new Map<string, ActiveShift[]>();
  for (const s of activeShifts) {
    if (!s.vehicle_id) continue;
    const arr = shiftsByVehicle.get(s.vehicle_id) ?? [];
    arr.push(s);
    shiftsByVehicle.set(s.vehicle_id, arr);
  }

  // Resolve all worker names we need (active drivers + assigned drivers).
  const workerIds = new Set<string>();
  for (const v of vehicles) if (v.assigned_worker_id) workerIds.add(v.assigned_worker_id);
  for (const s of activeShifts) if (s.worker_id) workerIds.add(s.worker_id);
  const names = await workerNames([...workerIds]);

  return vehicles.map((v) => {
    const shifts = shiftsByVehicle.get(v.id) ?? [];
    const shift = shifts[0];
    // Araç "molada" ancak o araçtaki HERKES moladaysa sayılır; biri hâlâ
    // yoldaysa araç sevkiyattadır.
    const onBreak = shifts.length > 0 && shifts.every((x) => !!x.break_started_at);
    const live_status = computeLiveStatus({
      baseStatus: v.status,
      hasActiveShift: !!shift,
      onBreak,
    });
    const driver_id = shift?.worker_id ?? v.assigned_worker_id ?? null;
    return {
      ...v,
      live_status,
      driver_id,
      driver_name: driver_id ? names.get(driver_id) ?? null : null,
      driver_is_live: !!shift,
      live_drivers: shifts
        .map((x) => (x.worker_id ? names.get(x.worker_id) ?? null : null))
        .filter((n): n is string => !!n),
    };
  });
}

export type VehicleDetail = {
  vehicle: VehicleWithStatus;
  today: {
    km: number | null;
    startKm: number | null;
    endKm: number | null;
    firstStart: string | null;
    lastEnd: string | null;
    startPackages: number | null;
    endPackages: number | null;
  };
  recent: {
    id: string;
    date: string;
    driver_name: string | null;
    start_km: number;
    end_km: number | null;
    km: number | null;
    ended: boolean;
  }[];
  /** Penalties (Strafe) booked against this vehicle, newest first. */
  penalties: VehiclePenalty[];
  /**
   * Aktif (temizlenmemiş) arıza kodları — `listActiveDtc` ile aynı satırlar,
   * üstüne panelin rozetiyle AYNI formülden çıkan `km_driven` (10.08.2026).
   *
   * Panelde bu rozet VehicleDetailClient içinde hesaplanıyordu
   * (`odometer_km − first_seen_odometer_km`, biri null ise "—"). Mobil uçta o
   * odometre yok; formülü uca kopyalamak ikinci bir kaynak yaratırdı, bu yüzden
   * hesap buraya — iki yüzeyin de okuduğu tek fonksiyona — taşındı.
   *
   * ŞİDDET/SEVERITY YOK: `vehicle_dtc`'de böyle bir kolon yok (lib/telemetry.ts).
   * Sözlük metni de burada iliştirilmez; `lib/dtc-codes.ts` `server-only` ve
   * yalnız gösterim katmanı (panel sayfası / mobil uç) `lookupDtc` çağırır.
   */
  faults: (VehicleDtcRow & { km_driven: number | null })[];
  /** Aracın en güncel odometresi (device_telemetry) — `km_driven`'ın kaynağı. */
  odometerKm: number | null;
};

/** Full detail for one vehicle: status, today's figures, recent shifts. */
export async function getVehicleDetail(id: string): Promise<VehicleDetail | null> {
  const { data: vData } = await supabaseAdmin
    .from("vehicles")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!vData) return null;
  const vehicle = vData as Vehicle;

  // Recent shifts on this vehicle (newest first).
  const { data: entries } = await supabaseAdmin
    .from("time_entries")
    .select(
      "id, worker_id, started_at, ended_at, start_km, end_km, break_started_at, start_package_count, cargo_count"
    )
    .eq("vehicle_id", id)
    .order("started_at", { ascending: false })
    .limit(15);
  const shifts = (entries ?? []) as (Pick<
    TimeEntry,
    | "id"
    | "worker_id"
    | "started_at"
    | "ended_at"
    | "start_km"
    | "end_km"
    | "break_started_at"
    | "start_package_count"
    | "cargo_count"
  >)[];

  const workerIds = new Set<string>();
  if (vehicle.assigned_worker_id) workerIds.add(vehicle.assigned_worker_id);
  for (const s of shifts) if (s.worker_id) workerIds.add(s.worker_id);
  const names = await workerNames([...workerIds]);

  const activeShift = shifts.find((s) => s.ended_at === null) ?? null;
  const onBreak = !!activeShift?.break_started_at;
  const live_status = computeLiveStatus({
    baseStatus: vehicle.status,
    hasActiveShift: !!activeShift,
    onBreak,
  });
  const driver_id = activeShift?.worker_id ?? vehicle.assigned_worker_id ?? null;

  const vehicleWithStatus: VehicleWithStatus = {
    ...vehicle,
    live_status,
    driver_id,
    driver_name: driver_id ? names.get(driver_id) ?? null : null,
    driver_is_live: !!activeShift,
    live_drivers: shifts
      .filter((x) => x.ended_at === null && x.worker_id)
      .map((x) => names.get(x.worker_id as string) ?? null)
      .filter((n): n is string => !!n),
  };

  // Today's figures (Vienna day) across this vehicle's shifts.
  const todayStart = startOfTodayVienna().getTime();
  const todays = shifts.filter((s) => new Date(s.started_at).getTime() >= todayStart);
  let km = 0;
  let hasKm = false;
  let startKm: number | null = null;
  let endKm: number | null = null;
  let firstStart: string | null = null;
  let lastEnd: string | null = null;
  let startPackages: number | null = null;
  let endPackages: number | null = null;
  // Oldest-first within today for sensible start/end.
  for (const s of [...todays].reverse()) {
    if (startKm === null) startKm = s.start_km;
    if (s.end_km !== null) {
      endKm = s.end_km;
      km += s.end_km - s.start_km;
      hasKm = true;
    }
    if (!firstStart) firstStart = s.started_at;
    if (s.ended_at) lastEnd = s.ended_at;
    if (startPackages === null && s.start_package_count !== null)
      startPackages = s.start_package_count;
    if (s.cargo_count !== null) endPackages = s.cargo_count;
  }

  const recent = shifts.map((s) => ({
    id: s.id,
    date: s.started_at,
    driver_name: s.worker_id ? names.get(s.worker_id) ?? null : null,
    start_km: s.start_km,
    end_km: s.end_km,
    km: s.end_km !== null ? s.end_km - s.start_km : null,
    ended: s.ended_at !== null,
  }));

  // Penalties (Strafe) for this vehicle — unpaid first, then newest.
  const { data: penData } = await supabaseAdmin
    .from("vehicle_penalties")
    .select("*")
    .eq("vehicle_id", id)
    .order("paid", { ascending: true })
    .order("penalty_date", { ascending: false });
  const penalties = (penData ?? []) as VehiclePenalty[];

  // Aktif arızalar + odometre. İkisi de best-effort (migration 021 yoksa boş /
  // null) — araç detayı arıza yüzünden ASLA düşmez, panelin bugünkü davranışı.
  const [dtc, telemetry] = await Promise.all([
    listActiveDtc(id),
    latestVehicleTelemetry(id),
  ]);
  const odometerKm = telemetry?.odometer_km ?? null;
  const faults = dtc.map((d) => ({
    ...d,
    // Panel rozetiyle BİREBİR (VehicleDetailClient DtcRailCard): iki uçtan biri
    // null ise hesap YOK — negatife düşen fark 0'a kırpılır (odometre geriye
    // gitmiş görünen cihazda "eksi km" basmamak için).
    km_driven:
      odometerKm !== null && d.first_seen_odometer_km !== null
        ? Math.max(0, Math.round(odometerKm - d.first_seen_odometer_km))
        : null,
  }));

  return {
    vehicle: vehicleWithStatus,
    today: {
      km: hasKm ? km : null,
      startKm,
      endKm,
      firstStart,
      lastEnd,
      startPackages,
      endPackages,
    },
    recent,
    penalties,
    faults,
    odometerKm,
  };
}

async function workerNames(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data } = await supabaseAdmin
    .from("workers")
    .select("id, name")
    .in("id", ids);
  return new Map(((data ?? []) as Pick<Worker, "id" | "name">[]).map((w) => [w.id, w.name]));
}

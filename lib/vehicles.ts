import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { startOfTodayVienna } from "@/lib/format";
import { computeLiveStatus } from "@/lib/vehicle-ui";
import type {
  Vehicle,
  VehicleWithStatus,
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
  const { data } = await supabaseAdmin
    .from("vehicles")
    .select("id, plate, make, model")
    .neq("status", "inactive")
    .order("plate");
  return (data ?? []) as Pick<Vehicle, "id" | "plate" | "make" | "model">[];
}

/** All vehicles with derived live status + current/assigned driver. */
export async function listVehiclesWithStatus(): Promise<VehicleWithStatus[]> {
  const [{ data: vData }, { data: sData }] = await Promise.all([
    supabaseAdmin.from("vehicles").select("*").order("plate"),
    supabaseAdmin
      .from("time_entries")
      .select("id, worker_id, vehicle_id, break_started_at, started_at")
      .is("ended_at", null),
  ]);

  const vehicles = (vData ?? []) as Vehicle[];
  const activeShifts = (sData ?? []) as ActiveShift[];

  const activeByVehicle = new Map<string, ActiveShift>();
  for (const s of activeShifts) {
    if (s.vehicle_id && !activeByVehicle.has(s.vehicle_id)) {
      activeByVehicle.set(s.vehicle_id, s);
    }
  }

  // Resolve all worker names we need (active drivers + assigned drivers).
  const workerIds = new Set<string>();
  for (const v of vehicles) if (v.assigned_worker_id) workerIds.add(v.assigned_worker_id);
  for (const s of activeShifts) if (s.worker_id) workerIds.add(s.worker_id);
  const names = await workerNames([...workerIds]);

  return vehicles.map((v) => {
    const shift = activeByVehicle.get(v.id);
    const onBreak = !!shift?.break_started_at;
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

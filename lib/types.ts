export type Worker = {
  id: string;
  name: string;
  phone: string;
  pin_hash: string;
  plate: string | null;
  employee_number: string | null;
  telegram_chat_id: string | null;
  telegram_username: string | null;
  telegram_linked_at: string | null;
  telegram_locale: string | null;
  is_admin: boolean;
  is_active: boolean;
  created_at: string;
};

export type TimeEntry = {
  id: string;
  worker_id: string;
  started_at: string;
  ended_at: string | null;
  start_km: number;
  end_km: number | null;
  plate: string | null;
  notes: string | null;
  break_minutes: number | null;
  cargo_count: number | null;
  updated_at: string | null;
  updated_by: string | null;
  nine_hour_notified_at: string | null;
  lenkzeit_notified_at: string | null;
  summary_notified_at: string | null;
  created_at: string;
};

export type TimeEntryWithWorker = TimeEntry & {
  workers: Pick<Worker, "id" | "name" | "plate"> | null;
};

export type DriverLocation = {
  id: string;
  worker_id: string;
  time_entry_id: string | null;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  recorded_at: string;
};

export type ActiveDriver = {
  worker_id: string;
  name: string;
  plate: string | null;
  shift_started_at: string;
  time_entry_id: string;
  latitude: number;
  longitude: number;
  recorded_at: string;
  route: [number, number][];
};

export type AssignmentStop = { label: string; address: string };
export type AssignmentCategory = "lieferung" | "abholung" | "kurier" | "verteilung";
export type AssignmentStatus = "assigned" | "started" | "completed" | "cancelled";

export type Assignment = {
  id: string;
  worker_id: string;
  scheduled_at: string;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  stops: AssignmentStop[];
  start_km: number | null;
  end_km: number | null;
  category: AssignmentCategory;
  package_count: number | null;
  notes: string | null;
  status: AssignmentStatus;
  cancel_reason: string | null;
  assignment_notified_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type AssignmentWithWorker = Assignment & {
  worker_name: string;
  worker_plate: string | null;
};

export type ApprovalStatus = "pending" | "approved" | "rejected";
export type FuelType = "diesel" | "benzin" | "lpg" | "elektro";
export type ExpenseCategory = "maut" | "verpflegung" | "parking" | "diesel" | "sonstige";
export type MaintenanceType =
  | "oil_change"
  | "inspection"
  | "tire_change"
  | "brake_check"
  | "general_service"
  | "repair"
  | "other";

export type FuelEntry = {
  id: string;
  worker_id: string | null;
  vehicle_plate: string;
  fueled_at: string;
  liters: number;
  total_cost: number;
  cost_per_liter: number;
  odometer_km: number;
  fuel_type: FuelType;
  station_name: string | null;
  receipt_path: string;
  receipt_url: string | null;
  status: ApprovalStatus;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type FuelEntryWithWorker = FuelEntry & {
  worker_name: string;
  consumption?: number | null; // L/100km vs the previous fill for this vehicle
};

export type ExpenseEntry = {
  id: string;
  worker_id: string | null;
  spent_at: string;
  category: ExpenseCategory;
  amount: number;
  description: string | null;
  vehicle_plate: string | null;
  receipt_path: string;
  receipt_url: string | null;
  status: ApprovalStatus;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ExpenseEntryWithWorker = ExpenseEntry & {
  worker_name: string;
};

export type VehicleMaintenance = {
  id: string;
  vehicle_plate: string;
  serviced_at: string;
  service_type: MaintenanceType;
  odometer_km: number;
  cost: number | null;
  description: string | null;
  next_service_km: number | null;
  next_service_date: string | null;
  receipt_path: string | null;
  receipt_url: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type SessionData = {
  worker_id?: string;
  name?: string;
  phone?: string;
  is_admin?: boolean;
  plate?: string | null;
};

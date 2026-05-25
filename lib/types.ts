export type Worker = {
  id: string;
  name: string;
  phone: string;
  pin_hash: string;
  plate: string | null;
  employee_number: string | null;
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

export type SessionData = {
  worker_id?: string;
  name?: string;
  phone?: string;
  is_admin?: boolean;
  plate?: string | null;
};

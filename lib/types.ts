export type Worker = {
  id: string;
  name: string;
  phone: string;
  pin_hash: string;
  plate: string | null;
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

export type SessionData = {
  worker_id?: string;
  name?: string;
  phone?: string;
  is_admin?: boolean;
  plate?: string | null;
};

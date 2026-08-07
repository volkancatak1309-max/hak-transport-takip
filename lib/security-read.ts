import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { SECURITY_LAYER_ENABLED } from "@/lib/tenant";

/**
 * GÜVENLİK EKRANI OKUMA KATMANI (045).
 *
 * Katman kapalıyken ya da migration 045 çalıştırılmamışken BOŞ döner —
 * ekran "kayıt yok" gösterir, hata vermez. Bu deponun eksik-tabloya dayanıklı
 * okuma deseninin aynısı (bkz. selectZones, readTokenVersion).
 */

export type SessionRow = {
  id: string;
  worker_id: string;
  worker_name: string;
  started_at: string;
  last_seen_at: string;
  ended_at: string | null;
  ended_reason: string | null;
  ip: string | null;
  user_agent: string | null;
  device_hash: string | null;
  city: string | null;
  country: string | null;
  new_device: boolean;
  concurrent: boolean;
};

export type AuditRow = {
  id: string;
  worker_id: string | null;
  worker_name: string;
  at: string;
  action: string;
  target: string | null;
  ip: string | null;
};

export type SecurityWorker = {
  id: string;
  name: string;
  phone: string;
  is_admin: boolean;
  is_owner: boolean;
  is_active: boolean;
  acikOturum: number;
};

async function workerNames(): Promise<Map<string, string>> {
  // test-visible: GÜVENLİK ekranı. Test hesabı BİLEREK elenmiyor — bu ekranın
  // işi "kim girdi"yi eksiksiz göstermek. Test hesabı gizlenseydi o hesapla
  // yapılmış bir giriş adsız ("—") görünür, yani ele geçirilmiş bir test
  // hesabı tam da izlenmesi gereken yerde görünmez olurdu.
  const { data } = await supabaseAdmin.from("workers").select("id, name");
  return new Map(((data ?? []) as { id: string; name: string }[]).map((w) => [w.id, w.name]));
}

/** Son N giriş oturumu (en yeniden eskiye). */
export async function listSessions(limit = 200): Promise<SessionRow[]> {
  if (!SECURITY_LAYER_ENABLED) return [];
  try {
    const { data, error } = await supabaseAdmin
      .from("login_sessions")
      .select(
        "id, worker_id, started_at, last_seen_at, ended_at, ended_reason, ip, user_agent, device_hash, city, country, new_device, concurrent"
      )
      .order("started_at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    const isim = await workerNames();
    return data.map((r) => ({
      ...(r as Omit<SessionRow, "worker_name">),
      worker_name: isim.get((r as { worker_id: string }).worker_id) ?? "—",
    }));
  } catch {
    return [];
  }
}

/** Şu an açık oturumlar. */
export async function listOpenSessions(): Promise<SessionRow[]> {
  const hepsi = await listSessions(400);
  return hepsi.filter((s) => s.ended_at === null);
}

/** Son eylem izi. */
export async function listAudit(limit = 200): Promise<AuditRow[]> {
  if (!SECURITY_LAYER_ENABLED) return [];
  try {
    const { data, error } = await supabaseAdmin
      .from("audit_log")
      .select("id, worker_id, at, action, target, ip")
      .order("at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    const isim = await workerNames();
    return data.map((r) => {
      const row = r as Omit<AuditRow, "worker_name">;
      return { ...row, worker_name: row.worker_id ? isim.get(row.worker_id) ?? "—" : "—" };
    });
  } catch {
    return [];
  }
}

/**
 * Kullanıcı listesi + açık oturum sayısı (dondurma düğmesi için).
 * `is_owner` kolonu yoksa (045 öncesi) false kabul edilir.
 */
export async function listSecurityWorkers(): Promise<SecurityWorker[]> {
  try {
    // test-visible: GÜVENLİK ekranı — yukarıdaki gerekçenin aynısı. Patron
    // test hesabının da oturumlarını görebilmeli ve onu dondurabilmeli.
    const { data, error } = await supabaseAdmin
      .from("workers")
      .select("id, name, phone, is_admin, is_owner, is_active")
      .order("name");
    if (error || !data) return [];
    const acik = await listOpenSessions();
    const sayac = new Map<string, number>();
    for (const s of acik) sayac.set(s.worker_id, (sayac.get(s.worker_id) ?? 0) + 1);
    return (data as Record<string, unknown>[]).map((w) => ({
      id: w.id as string,
      name: (w.name as string) ?? "—",
      phone: (w.phone as string) ?? "",
      is_admin: w.is_admin === true,
      is_owner: w.is_owner === true,
      is_active: w.is_active === true,
      acikOturum: sayac.get(w.id as string) ?? 0,
    }));
  } catch {
    return [];
  }
}

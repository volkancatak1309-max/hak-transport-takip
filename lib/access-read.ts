import "server-only";
import { supabaseAdmin } from "@/lib/supabase";
import { getTestScope, withoutTestRows } from "@/lib/test-data";
import {
  ACCESS_GATES_ENABLED,
  ACCESS_COUNTRIES,
  ACCESS_HOURS_START,
  ACCESS_HOURS_END,
} from "@/lib/tenant";

/**
 * ERİŞİM KAPILARI — PATRON EKRANI OKUMA KATMANI (046).
 *
 * Bayrak kapalıyken ya da migration 046 çalıştırılmamışken BOŞ döner; ekran
 * "kayıt yok" gösterir, hata vermez (045'teki lib/security-read.ts deseninin
 * aynısı).
 */

export type PendingDevice = {
  id: string;
  worker_id: string;
  worker_name: string;
  device_hash: string;
  requested_at: string;
  first_ip: string | null;
  first_city: string | null;
  first_country: string | null;
  user_agent: string | null;
};

export type PendingCountry = {
  id: string;
  worker_id: string;
  worker_name: string;
  country: string;
  requested_at: string;
};

export type AccessRule = {
  id: string;
  name: string;
  /** Kişiye özel aralık; null ise kiracı varsayılanı geçerli. */
  start: string | null;
  end: string | null;
  /** Ekranda gösterilecek etkin aralık (kişisel yoksa varsayılan). */
  etkin: string;
  /** Kişiye özel serbest ülkeler; null ise kiracı varsayılanı. */
  countries: string[] | null;
  etkinCountries: string[];
  is_owner: boolean;
};

/** Kiracı varsayılanları — ekranda "neye göre" sorusunun cevabı. */
export const ACCESS_DEFAULTS = {
  hours: `${ACCESS_HOURS_START}–${ACCESS_HOURS_END}`,
  countries: ACCESS_COUNTRIES,
};

async function workerNames(): Promise<Map<string, string>> {
  // owner-visible: bu ekran requireOwner arkasında — gizlenecek izleyici yok.
  // test-visible: bekleyen onay bir test hesabına aitse patron onu GÖRMELİ;
  // adsız bir onay satırı karar verilemez hâle gelir.
  const { data } = await supabaseAdmin.from("workers").select("id, name");
  return new Map(((data ?? []) as { id: string; name: string }[]).map((w) => [w.id, w.name]));
}

/** Bekleyen CİHAZ onayları (en yeniden eskiye). */
export async function listPendingDevices(): Promise<PendingDevice[]> {
  if (!ACCESS_GATES_ENABLED) return [];
  try {
    const { data, error } = await supabaseAdmin
      .from("device_approvals")
      .select(
        "id, worker_id, device_hash, requested_at, first_ip, first_city, first_country, user_agent"
      )
      .eq("status", "pending")
      .order("requested_at", { ascending: false })
      .limit(100);
    if (error || !data) return [];
    const isim = await workerNames();
    return data.map((r) => {
      const row = r as Omit<PendingDevice, "worker_name">;
      return { ...row, worker_name: isim.get(row.worker_id) ?? "—" };
    });
  } catch {
    return [];
  }
}

/** Bekleyen ÜLKE onayları. */
export async function listPendingCountries(): Promise<PendingCountry[]> {
  if (!ACCESS_GATES_ENABLED) return [];
  try {
    const { data, error } = await supabaseAdmin
      .from("country_approvals")
      .select("id, worker_id, country, requested_at")
      .eq("status", "pending")
      .order("requested_at", { ascending: false })
      .limit(100);
    if (error || !data) return [];
    const isim = await workerNames();
    return data.map((r) => {
      const row = r as Omit<PendingCountry, "worker_name">;
      return { ...row, worker_name: isim.get(row.worker_id) ?? "—" };
    });
  } catch {
    return [];
  }
}

/** "HH:MM:SS" → "HH:MM". Boş/geçersizse null. */
function hhmm(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{2}):(\d{2})/.exec(v.trim());
  return m ? `${m[1]}:${m[2]}` : null;
}

/** Kişi bazında erişim kuralları (saat aralığı + serbest ülkeler). */
export async function listAccessRules(): Promise<AccessRule[]> {
  if (!ACCESS_GATES_ENABLED) return [];
  try {
    const scope = await getTestScope();
    // test-filtered: kural tablosu bir YÖNETİM listesi — test hesabı burada da
    // kalabalık yapar (045'teki kullanıcı listesiyle aynı gerekçe).
    // owner-visible: ekran requireOwner arkasında; patron kendi satırını da
    // görür ve görmelidir (kendi aralığını değiştirebilmeli).
    const { data, error } = await withoutTestRows(
      supabaseAdmin
        .from("workers")
        .select(
          "id, name, is_owner, access_hours_start, access_hours_end, allowed_countries"
        )
        .eq("is_active", true)
        .order("name"),
      "id",
      scope.workerIds
    );
    if (error || !data) return [];
    return (data as Record<string, unknown>[]).map((w) => {
      const start = hhmm(w.access_hours_start);
      const end = hhmm(w.access_hours_end);
      const countries = (w.allowed_countries as string[] | null) ?? null;
      return {
        id: w.id as string,
        name: (w.name as string) ?? "—",
        start,
        end,
        etkin:
          start && end
            ? `${start}–${end}`
            : `${ACCESS_HOURS_START}–${ACCESS_HOURS_END} (varsayılan)`,
        countries,
        etkinCountries: countries ?? ACCESS_COUNTRIES,
        is_owner: w.is_owner === true,
      };
    });
  } catch {
    return [];
  }
}

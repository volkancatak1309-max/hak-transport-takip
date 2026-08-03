import { requireWorker } from "@/lib/session";
import { getManagedFleet } from "@/lib/fleet-scope";
import { supabaseAdmin } from "@/lib/supabase";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { PanelClient } from "./PanelClient";
import { startOfTodayVienna, startOfWeekVienna } from "@/lib/format";
import { needsSummarySignature } from "@/lib/shift-summary";
import { getDepotPanel } from "@/lib/depot";
import type { TimeEntry, VehicleBaseStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PanelPage() {
  const session = await requireWorker();
  // Filo sefi ise ust barda "Filo Yonetimi" gecisi cikar (migration 029).
  // Rol cerezden DEGIL DB'den okunur: cerez 30 gun yasiyor.
  const managedFleet = await getManagedFleet(session.worker_id!);

  const since = new Date();
  since.setDate(since.getDate() - 30);

  const { data: entries } = await supabaseAdmin
    .from("time_entries")
    .select("*")
    .eq("worker_id", session.worker_id!)
    .gte("started_at", since.toISOString())
    .order("started_at", { ascending: false });

  const all = (entries ?? []) as TimeEntry[];
  const active = all.find((e) => e.ended_at === null) ?? null;
  const past = all.filter((e) => e.ended_at !== null);

  // İş 3 — imzasız vardiya özeti. Kuralın TEK kaynağı lib/shift-summary.ts:
  // 72 saatlik pencere + sistem kapanışları ve 25 dakikadan kısa vardiyalar
  // imza istemez (çöp yığınının kaynağı buydu — bkz. modül başlığı).
  //
  // AÇIK VARDİYA VARKEN ÖZET GÖSTERİLMEZ (22.07.2026): özet katmanı tam ekran
  // (fixed inset-0 z-50) ve paneli tamamen kaplıyordu; imzasız eski kaydı olan
  // şoför "Vardiyayı Bitir" butonuna hiç ulaşamıyor, vardiya açık kalıyordu.
  // Sıra artık net: önce çalış ve kendi kapat, imza sonra.
  const nowMs = Date.now();
  const pendingSummary = active
    ? null
    : past.find((e) => needsSummarySignature(e, nowMs)) ?? null;

  const { data: me } = await supabaseAdmin
    .from("workers")
    .select("telegram_chat_id, telegram_username")
    .eq("id", session.worker_id!)
    .maybeSingle();
  const telegram = {
    linked: !!me?.telegram_chat_id,
    username: (me?.telegram_username as string) ?? null,
  };

  // İş 1 — bekleme ekranı: şoförün atandığı araç (kontak bu aracı izler).
  // Şoför↔araç ilişkisinin TEK kaynağı vehicles.assigned_worker_id'dir;
  // workers.plate yalnızca eski kayıtlar için tutulan bir aynadır.
  // status da okunur: bakımdaki araçta manuel başlatma butonu çıkmamalı
  // (auto-shift de yalnız "active" araçta vardiya açar).
  const { data: veh } = await supabaseAdmin
    .from("vehicles")
    .select("id, plate, make, model, status")
    .eq("assigned_worker_id", session.worker_id!)
    .neq("status", "inactive")
    .order("plate")
    .limit(1)
    .maybeSingle();
  const assignedVehicle =
    (veh as {
      id: string;
      plate: string;
      make: string | null;
      model: string | null;
      status: VehicleBaseStatus;
    } | null) ?? null;

  // Sefer sayacı sorgusu kaldırıldı (21.07.2026): panelde "Seferler" linki
  // yok artık, rozetini besleyecek bir tüketici kalmadı. /panel/seferler
  // rotası ve sefer modülü DURUYOR — yalnız bu sayfanın sorgusu düştü.

  const todayStart = startOfTodayVienna();
  const weekStart = startOfWeekVienna();

  const todayEntries = past.filter(
    (e) => new Date(e.started_at).getTime() >= todayStart.getTime()
  );
  const weekEntries = past.filter(
    (e) => new Date(e.started_at).getTime() >= weekStart.getTime()
  );

  // DEPO DURUMU (Modül 3 öneri + Modül 6 kilit): yalnız bekleme ekranı
  // koşullarında (aracı atanmış + aktif vardiya YOK + bugün açılmamış) hesaplanır.
  // Depo bölgesi yoksa locked=false + state='no_depot' → kilit uygulanmaz.
  const depotPanel =
    assignedVehicle && !active && todayEntries.length === 0
      ? await getDepotPanel(assignedVehicle.id, session.worker_id!)
      : null;

  function sumWorkedMs(arr: TimeEntry[]) {
    let total = 0;
    for (const e of arr) {
      const s = new Date(e.started_at).getTime();
      const en = e.ended_at ? new Date(e.ended_at).getTime() : Date.now();
      const br = (e.break_minutes ?? 0) * 60_000;
      total += Math.max(0, en - s - br);
    }
    return total;
  }
  function sumKm(arr: TimeEntry[]) {
    let total = 0;
    for (const e of arr)
      if (e.end_km !== null && e.start_km !== null) total += e.end_km - e.start_km;
    return total;
  }
  function sumCargo(arr: TimeEntry[]) {
    let total = 0;
    for (const e of arr) total += e.cargo_count ?? 0;
    return total;
  }

  return (
    <DashboardShell
      user={{
        id: session.worker_id!,
        name: session.name!,
        phone: session.phone ?? "",
        // isAdmin=false BİLEREK: yönetici panele girdiğinde diğer şoförlerle
        // AYNI ekranı görmeli (menü de dahil). Yönetici yetkisi ayrı bayrakla
        // taşınır ve yalnız üst çubuktaki "Filo Yönetimi" dönüş bağlantısını
        // açar — sunucu tarafında hiçbir kapıyı gevşetmez.
        isAdmin: false,
        adminAccount: session.is_admin === true,
        managedFleet,
      }}
    >
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6">
        <PanelClient
          active={active}
          pendingSummary={pendingSummary}
          telegram={telegram}
          /* Günde tek vardiya (lib/shift-day.ts): bugün açılmış bir vardiya
             varsa panel "bugünkü vardiyan tamamlandı" der ve başlat butonunu
             göstermez. `past` üzerinden hesaplanır — açık vardiya zaten
             `active` dalında ele alınır. */
          shiftDoneToday={todayEntries.length > 0}
          totals={{
            todayClosedPackages: sumCargo(todayEntries),
            weekMs: sumWorkedMs(weekEntries),
            weekKm: sumKm(weekEntries),
            weekShifts: weekEntries.length,
          }}
          assignedVehicle={assignedVehicle}
          depotPanel={depotPanel}
        />
      </div>
    </DashboardShell>
  );
}

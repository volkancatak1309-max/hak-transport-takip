import { getTranslations } from "next-intl/server";
import {
  Clock3,
  Hourglass,
  Route,
  Siren,
  Gauge,
  BarChart3,
  Milestone,
  TrendingUp,
  Fuel,
  MapPinned,
} from "lucide-react";
import { requireAdmin } from "@/lib/session";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { PageHeader } from "@/components/ui-v2";
import { ReportCard } from "@/components/admin/ReportCard";
import { supabaseAdmin } from "@/lib/supabase";
import { getTestScope, withoutTestRows } from "@/lib/test-data";
import { audit } from "@/lib/security-log";

export const dynamic = "force-dynamic";

/**
 * Rapor merkezi — dağınık rapor girişlerinin tek kapısı.
 *
 * Kurallar:
 *  • Yalnız GERÇEK veriyle dolu raporlar kart alır. Kapalı/boş modüller
 *    (yakıt fişi, masraf, sefer, bölge, bakım, ceza) burada YOKTUR — "0" yazan
 *    bir kart, olmayan bir yeteneği varmış gibi gösterir.
 *  • Her kart veri hacmini yazar; şoför/araç sayıları sunucuda sayılır, böylece
 *    yönetici raporu açmadan dolu mu boş mu bilir.
 *  • Eski erişimler kırılmadı: buradaki kartlar mevcut sayfalara götürür,
 *    araç detayındaki rota/metrik girişleri yerinde durur.
 */
/**
 * Kategori etiketi. Eskiden 15px yarı-kalın bir başlıktı ve kartların içindeki
 * rapor adıyla (aynı 15px, aynı ağırlık) aynı seviyede okunuyordu — bölüm mü
 * kart mı belli olmuyordu. Resend'in bölüm etiketi gibi mikro ve harf aralıklı:
 * kart başlığından KÜÇÜK olduğu için hiyerarşide üstte durur.
 */
function CategoryLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <h2 className="shrink-0 text-[11px] font-medium uppercase tracking-[0.1em] text-text-tertiary">
        {children}
      </h2>
      <hr className="divider-glow flex-1" />
    </div>
  );
}

export default async function ReportsPage() {
  const session = await requireAdmin();

  // Sayfa görüntüleme izi (045). Katman kapalıysa ilk satırda çıkar.
  await audit(session.worker_id ?? null, "page_view", "/admin/raporlar");
  const t = await getTranslations("reports");

  // Kart altyazılarındaki hacimler — head:true ile yalnız sayım döner (satır
  // taşınmaz). Sayım başarısızsa kart yine görünür, yalnız hacim "—" olur.
  const scope = await getTestScope();
  // Bölge Süreleri kartı KOŞULLU: müşteri bölgesi tanımlı değilse kart hiç
  // çıkmaz (yukarıdaki kural — boş bir modül, olmayan bir yeteneği varmış gibi
  // gösterir). Ölçüm `purpose='customer'`e bağlı, `category`ye değil.
  const [events, idle, shifts, vehicles, customerZones, zoneVisits] = await Promise.all([
    supabaseAdmin.from("vehicle_events").select("id", { count: "exact", head: true }),
    supabaseAdmin.from("idle_episodes").select("id", { count: "exact", head: true }),
    withoutTestRows(
      supabaseAdmin.from("time_entries").select("id", { count: "exact", head: true }),
      "worker_id",
      scope.workerIds
    ),
    withoutTestRows(
      supabaseAdmin
        .from("vehicles")
        .select("id", { count: "exact", head: true })
        .or("flespi_device_id.not.is.null,imei.not.is.null"),
      "id",
      scope.vehicleIds
    ),
    supabaseAdmin
      .from("geofences")
      .select("id", { count: "exact", head: true })
      .eq("purpose", "customer"),
    supabaseAdmin.from("zone_visits").select("id", { count: "exact", head: true }),
  ]);
  const n = (c: number | null) => (c === null ? "—" : c.toLocaleString("tr-TR"));

  return (
    <DashboardShell
      user={{
        id: session.worker_id!,
        name: session.name!,
        phone: session.phone ?? "",
        isAdmin: true,
        shadowOf: session.shadow_name ?? null,
      }}
      title={t("title")}
    >
      <div className="mx-auto max-w-6xl space-y-12 px-4 py-6 sm:px-6">
        <PageHeader title={t("title")} description={t("subtitle")} help="page_reports" />

        <section>
          <CategoryLabel>{t("cat_vehicle")}</CategoryLabel>
          {/* Mobilde tek sütun (kartlar dikey), tablette 2, masaüstünde 3. */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <ReportCard
              href="/admin/araclar"
              icon={Route}
              title={t("route_title")}
              description={t("route_desc")}
              contains={[t("route_c1"), t("route_c2"), t("route_c3")]}
              metaValue={n(vehicles.count)}
              metaLabel={t("unit_vehicles")}
              hint={t("route_hint")}
            />
            <ReportCard
              href="/admin/araclar"
              icon={Gauge}
              title={t("distance_title")}
              description={t("distance_desc")}
              contains={[t("distance_c1"), t("distance_c2"), t("distance_c3")]}
              metaValue={n(vehicles.count)}
              metaLabel={t("unit_vehicles")}
              hint={t("distance_hint")}
            />
            <ReportCard
              href="/admin/raporlar/mesafe"
              icon={Milestone}
              title={t("fleet_distance_title")}
              description={t("fleet_distance_desc")}
              contains={[t("fd_c1"), t("fd_c2"), t("fd_c3")]}
              metaValue={n(vehicles.count)}
              metaLabel={t("unit_vehicles")}
            />
            <ReportCard
              href="/admin/raporlar/hiz"
              icon={Gauge}
              title={t("speed_title")}
              description={t("speed_desc")}
              contains={[t("speed_c1"), t("speed_c2"), t("speed_c3")]}
              metaValue={n(events.count)}
              metaLabel={t("unit_events")}
            />
            <ReportCard
              href="/admin/raporlar/yakit"
              icon={Fuel}
              title={t("fuel_title")}
              description={t("fuel_desc")}
              contains={[t("fuel_c1"), t("fuel_c2"), t("fuel_c3")]}
              metaValue={n(vehicles.count)}
              metaLabel={t("unit_vehicles")}
              hint={t("fuel_hint")}
            />
            <ReportCard
              href="/admin/analiz"
              icon={Hourglass}
              title={t("idle_title")}
              description={t("idle_desc")}
              contains={[t("idle_c1"), t("idle_c2"), t("idle_c3")]}
              metaValue={n(idle.count)}
              metaLabel={t("unit_idle")}
            />
            <ReportCard
              href="/admin/alarmlar"
              icon={Siren}
              title={t("events_title")}
              description={t("events_desc")}
              contains={[t("events_c1"), t("events_c2"), t("events_c3")]}
              metaValue={n(events.count)}
              metaLabel={t("unit_events")}
            />
            {(customerZones.count ?? 0) > 0 && (
              <ReportCard
                href="/admin/raporlar/bolge-sureleri"
                icon={MapPinned}
                title={t("zone_title")}
                description={t("zone_desc")}
                contains={[t("zone_c1"), t("zone_c2"), t("zone_c3")]}
                metaValue={n(zoneVisits.count)}
                metaLabel={t("unit_visits")}
                hint={t("zone_hint")}
              />
            )}
          </div>
        </section>

        <section>
          <CategoryLabel>{t("cat_driver")}</CategoryLabel>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <ReportCard
              href="/admin/raporlar/performans"
              icon={TrendingUp}
              title={t("perf_title")}
              description={t("perf_desc")}
              contains={[t("perf_c1"), t("perf_c2"), t("perf_c3")]}
              metaValue={n(shifts.count)}
              metaLabel={t("unit_shifts")}
              hint={t("calc_hint")}
            />
            <ReportCard
              href="/admin"
              icon={Clock3}
              title={t("shift_title")}
              description={t("shift_desc")}
              contains={[t("shift_c1"), t("shift_c2"), t("shift_c3")]}
              metaValue={n(shifts.count)}
              metaLabel={t("unit_shifts")}
              hint={t("shift_hint")}
            />
          </div>
        </section>

        <section>
          <CategoryLabel>{t("cat_analysis")}</CategoryLabel>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <ReportCard
              href="/admin/analiz"
              icon={BarChart3}
              title={t("analysis_title")}
              description={t("analysis_desc")}
              contains={[t("analysis_c1"), t("analysis_c2"), t("analysis_c3")]}
              metaValue={n(events.count)}
              metaLabel={t("unit_events")}
              hint={t("calc_hint")}
            />
          </div>
        </section>
      </div>
    </DashboardShell>
  );
}

import { getTranslations } from "next-intl/server";
import { Clock3, Hourglass, Route, Siren, Gauge, BarChart3 } from "lucide-react";
import { requireAdmin } from "@/lib/session";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { PageHeader } from "@/components/ui-v2";
import { ReportCard } from "@/components/admin/ReportCard";
import { supabaseAdmin } from "@/lib/supabase";

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
export default async function ReportsPage() {
  const session = await requireAdmin();
  const t = await getTranslations("reports");

  // Kart altyazılarındaki hacimler — head:true ile yalnız sayım döner (satır
  // taşınmaz). Sayım başarısızsa kart yine görünür, yalnız hacim "—" olur.
  const [events, idle, shifts, vehicles] = await Promise.all([
    supabaseAdmin.from("vehicle_events").select("id", { count: "exact", head: true }),
    supabaseAdmin.from("idle_episodes").select("id", { count: "exact", head: true }),
    supabaseAdmin.from("time_entries").select("id", { count: "exact", head: true }),
    supabaseAdmin
      .from("vehicles")
      .select("id", { count: "exact", head: true })
      .or("flespi_device_id.not.is.null,imei.not.is.null"),
  ]);
  const n = (c: number | null) => (c === null ? "—" : c.toLocaleString("tr-TR"));

  return (
    <DashboardShell
      user={{
        id: session.worker_id!,
        name: session.name!,
        phone: session.phone ?? "",
        isAdmin: true,
      }}
      title={t("title")}
    >
      <div className="mx-auto max-w-6xl space-y-8 px-4 py-6 sm:px-6">
        <PageHeader title={t("title")} description={t("subtitle")} />

        <section>
          <h2 className="mb-3 text-[15px] font-semibold">{t("cat_vehicle")}</h2>
          {/* Mobilde tek sütun (kartlar dikey), tablette 2, masaüstünde 3. */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <ReportCard
              href="/admin/araclar"
              icon={Route}
              title={t("route_title")}
              description={t("route_desc")}
              contains={[t("route_c1"), t("route_c2"), t("route_c3")]}
              meta={t("route_meta", { n: n(vehicles.count) })}
            />
            <ReportCard
              href="/admin/araclar"
              icon={Gauge}
              title={t("distance_title")}
              description={t("distance_desc")}
              contains={[t("distance_c1"), t("distance_c2"), t("distance_c3")]}
              meta={t("distance_meta", { n: n(vehicles.count) })}
            />
            <ReportCard
              href="/admin/analiz"
              icon={Hourglass}
              title={t("idle_title")}
              description={t("idle_desc")}
              contains={[t("idle_c1"), t("idle_c2"), t("idle_c3")]}
              meta={t("idle_meta", { n: n(idle.count) })}
            />
            <ReportCard
              href="/admin/alarmlar"
              icon={Siren}
              title={t("events_title")}
              description={t("events_desc")}
              contains={[t("events_c1"), t("events_c2"), t("events_c3")]}
              meta={t("events_meta", { n: n(events.count) })}
            />
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-[15px] font-semibold">{t("cat_driver")}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <ReportCard
              href="/admin"
              icon={Clock3}
              title={t("shift_title")}
              description={t("shift_desc")}
              contains={[t("shift_c1"), t("shift_c2"), t("shift_c3")]}
              meta={t("shift_meta", { n: n(shifts.count) })}
            />
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-[15px] font-semibold">{t("cat_analysis")}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <ReportCard
              href="/admin/analiz"
              icon={BarChart3}
              title={t("analysis_title")}
              description={t("analysis_desc")}
              contains={[t("analysis_c1"), t("analysis_c2"), t("analysis_c3")]}
              meta={t("analysis_meta", { n: n(events.count) })}
            />
          </div>
        </section>
      </div>
    </DashboardShell>
  );
}

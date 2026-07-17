import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Route as RouteIcon } from "lucide-react";
import { requireAdmin } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/UserAvatar";
import { WorkerDetailClient } from "./WorkerDetailClient";
import {
  formatDate,
  startOfMonthVienna,
  startOfTodayVienna,
  workedMs,
  kmDiff,
} from "@/lib/format";
import { licenseState, LICENSE_BADGE } from "@/lib/worker-ui";
import type { WorkerPublic, TimeEntry, DriverLocation } from "@/lib/types";
import { WORKER_PUBLIC_COLUMNS } from "@/lib/types";
import { getLocale, getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export default async function WorkerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireAdmin();
  const { id } = await params;
  const t = await getTranslations("workers");
  const tc = await getTranslations("common");
  const tRoute = await getTranslations("route");
  const ta = await getTranslations("admin");
  const locale = await getLocale();

  const { data: worker } = await supabaseAdmin
    .from("workers")
    .select(WORKER_PUBLIC_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (!worker) notFound();
  const w = worker as WorkerPublic;

  const monthStart = startOfMonthVienna();
  const todayStart = startOfTodayVienna();
  const [monthEntriesResult, allEntriesResult, todayLocsResult] = await Promise.all([
    supabaseAdmin
      .from("time_entries")
      .select("*")
      .eq("worker_id", id)
      .gte("started_at", monthStart.toISOString()),
    supabaseAdmin
      .from("time_entries")
      .select("*")
      .eq("worker_id", id)
      .order("started_at", { ascending: false })
      .limit(200),
    supabaseAdmin
      .from("driver_locations")
      .select("*")
      .eq("worker_id", id)
      .gte("recorded_at", todayStart.toISOString())
      .order("recorded_at", { ascending: true }),
  ]);

  const monthEntries = (monthEntriesResult.data ?? []) as TimeEntry[];
  const allEntries = (allEntriesResult.data ?? []) as TimeEntry[];
  const todayLocations = (todayLocsResult.data ?? []) as DriverLocation[];
  const routePoints = todayLocations.map((l) => ({
    lat: l.latitude,
    lng: l.longitude,
    recorded_at: l.recorded_at,
  }));

  let monthMs = 0;
  let monthKm = 0;
  let monthCargo = 0;
  for (const e of monthEntries) {
    monthMs += workedMs(e);
    const km = kmDiff(e);
    if (km !== null) monthKm += km;
    monthCargo += e.cargo_count ?? 0;
  }

  return (
    <DashboardShell
      user={{
        id: session.worker_id!,
        name: session.name!,
        phone: session.phone ?? "",
        isAdmin: true,
      }}
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6 space-y-6">
        <div className="flex items-center gap-3">
          <Link href="/admin/workers">
            <Button variant="ghost" size="sm" className="gap-1.5">
              <ArrowLeft className="size-4" />
              {t("title")}
            </Button>
          </Link>
          <Link href={`/admin/rota?worker=${w.id}`} className="ml-auto">
            <Button variant="outline" size="sm" className="gap-1.5">
              <RouteIcon className="size-4" />
              {tRoute("title")}
            </Button>
          </Link>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between flex-wrap gap-3">
              <div className="flex items-center gap-4">
                <UserAvatar name={w.name} size="lg" />
                <div>
                  <CardTitle className="text-2xl">{w.name}</CardTitle>
                  <div className="mt-2 flex flex-wrap gap-3 text-sm text-muted-foreground">
                    <span className="nums">{w.phone}</span>
                    <span>•</span>
                    <span className="nums">{w.plate ?? "—"}</span>
                    <span>•</span>
                    <span>{w.is_admin ? tc("admin") : tc("worker")}</span>
                  </div>
                </div>
              </div>
              {w.is_active ? (
                <Badge variant="default">{tc("active")}</Badge>
              ) : (
                <Badge variant="outline">{tc("passive")}</Badge>
              )}
            </div>
          </CardHeader>
        </Card>

        {/* Personel dosyası (migration 025) — kâğıt formdaki bilgiler artık
            sistemde. Boş alan "girilmedi" (—): formlar eksik gelebiliyor. */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("profileTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {(
              [
                {
                  title: ta("secPersonal"),
                  fields: [
                    {
                      label: ta("birthDate"),
                      value: w.birth_date ? formatDate(w.birth_date, locale) : null,
                    },
                    { label: ta("ssn"), value: w.social_security_no, nums: true },
                    { label: ta("email"), value: w.email },
                    { label: ta("address"), value: w.address },
                  ],
                },
                {
                  title: ta("secEmployment"),
                  fields: [
                    {
                      label: ta("employmentStart"),
                      value: w.employment_start
                        ? formatDate(w.employment_start, locale)
                        : null,
                    },
                    {
                      label: ta("employmentType"),
                      value: w.employment_type
                        ? ta(`employment_${w.employment_type}`)
                        : null,
                    },
                  ],
                },
                {
                  title: ta("secLicense"),
                  fields: [
                    { label: ta("licenseNo"), value: w.license_no, nums: true },
                    {
                      label: ta("licenseExpiry"),
                      value: w.license_expiry
                        ? formatDate(w.license_expiry, locale)
                        : null,
                      badge: licenseState(w.license_expiry),
                    },
                  ],
                },
                {
                  title: ta("secEmergency"),
                  fields: [
                    { label: ta("emergencyName"), value: w.emergency_contact_name },
                    {
                      label: ta("emergencyRelation"),
                      value: w.emergency_contact_relation,
                    },
                    {
                      label: ta("emergencyPhone"),
                      value: w.emergency_contact_phone,
                      nums: true,
                    },
                  ],
                },
              ] as {
                title: string;
                fields: {
                  label: string;
                  value: string | null;
                  nums?: boolean;
                  badge?: ReturnType<typeof licenseState>;
                }[];
              }[]
            ).map((sec) => (
              <div key={sec.title}>
                <p className="mb-2 text-[12px] sm:text-[11px] font-medium uppercase tracking-[0.04em] text-text-tertiary">
                  {sec.title}
                </p>
                <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                  {sec.fields.map((f) => (
                    <div key={f.label} className="flex items-baseline justify-between gap-3 sm:justify-start">
                      <dt className="w-40 shrink-0 text-sm text-muted-foreground">
                        {f.label}
                      </dt>
                      <dd
                        className={`text-sm ${f.nums ? "nums " : ""}${f.value ? "" : "text-text-tertiary"}`}
                      >
                        {f.value ?? "—"}
                        {f.badge && (
                          <span
                            className={`ml-2 rounded-full px-2 py-0.5 text-[12px] sm:text-[11px] font-semibold ${LICENSE_BADGE[f.badge.state]}`}
                          >
                            {f.badge.state === "expired"
                              ? t("licenseExpired")
                              : t("licenseExpiring", { days: f.badge.days })}
                          </span>
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </CardContent>
        </Card>

        <WorkerDetailClient
          worker={w}
          entries={allEntries}
          routePoints={routePoints}
          monthSummary={{
            shifts: monthEntries.length,
            ms: monthMs,
            km: monthKm,
            cargo: monthCargo,
          }}
        />
      </div>
    </DashboardShell>
  );
}

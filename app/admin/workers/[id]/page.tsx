import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAdmin } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";
import { AppShell } from "@/components/AppShell";
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
import { startOfMonthVienna, workedMs, kmDiff } from "@/lib/format";
import type { Worker, TimeEntry } from "@/lib/types";
import { getTranslations } from "next-intl/server";

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

  const { data: worker } = await supabaseAdmin
    .from("workers")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!worker) notFound();
  const w = worker as Worker;

  const monthStart = startOfMonthVienna();
  const [monthEntriesResult, allEntriesResult] = await Promise.all([
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
  ]);

  const monthEntries = (monthEntriesResult.data ?? []) as TimeEntry[];
  const allEntries = (allEntriesResult.data ?? []) as TimeEntry[];

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
    <AppShell
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

        <WorkerDetailClient
          worker={w}
          entries={allEntries}
          monthSummary={{
            shifts: monthEntries.length,
            ms: monthMs,
            km: monthKm,
            cargo: monthCargo,
          }}
        />
      </div>
    </AppShell>
  );
}

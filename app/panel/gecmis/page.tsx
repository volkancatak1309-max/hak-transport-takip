import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { requireWorker } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { HistoryClient } from "./HistoryClient";
import type { TimeEntry } from "@/lib/types";
import { markKmMeasured } from "@/lib/km-quality";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 25;

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; from?: string; to?: string }>;
}) {
  const session = await requireWorker();
  const sp = await searchParams;
  const t = await getTranslations("history");
  const tp = await getTranslations("panel");

  const page = Math.max(1, Number(sp.page ?? "1"));
  const offset = (page - 1) * PAGE_SIZE;

  let q = supabaseAdmin
    .from("time_entries")
    .select("*", { count: "exact" })
    .eq("worker_id", session.worker_id!);

  if (sp.from) q = q.gte("started_at", new Date(sp.from).toISOString());
  if (sp.to) {
    const to = new Date(sp.to);
    to.setHours(23, 59, 59, 999);
    q = q.lte("started_at", to.toISOString());
  }

  const { data, count } = await q
    .order("started_at", { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  // Cihazı sessiz vardiyada km bir ölçüm değil → kmDiff null döner → "—".
  const entries = await markKmMeasured((data ?? []) as TimeEntry[]);
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  return (
    <DashboardShell
      user={{
        id: session.worker_id!,
        name: session.name!,
        phone: session.phone ?? "",
        isAdmin: false,
      }}
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6 space-y-4">
        {/* Geri bağlantısı telefonda 28px idi — şoför ekranında dokunma hedefi
            44px (aşağı inmez). Link'in kendisi hedeftir; iç içe Button
            sarmalayıcısı kaldırıldı, yoksa hedef yine butonun boyu olurdu. */}
        <div className="flex items-center gap-2">
          <Link
            href="/panel"
            className="btn-outline-ring inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface-panel hover:text-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden />
            {tp("myPanel")}
          </Link>
          <h1 className="text-xl font-semibold">{t("title")}</h1>
        </div>

        <HistoryClient
          entries={entries}
          page={page}
          totalPages={totalPages}
          from={sp.from ?? ""}
          to={sp.to ?? ""}
        />
      </div>
    </DashboardShell>
  );
}

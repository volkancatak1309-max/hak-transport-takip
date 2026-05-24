import { requireWorker } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";
import { logoutAction } from "../actions/auth";
import { PanelClient } from "./PanelClient";
import type { TimeEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PanelPage() {
  const session = await requireWorker();

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

  return (
    <main className="min-h-screen p-4 max-w-3xl mx-auto">
      <header className="flex items-center justify-between mb-6 pt-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900">{session.name}</h1>
          <p className="text-sm text-slate-600">
            Plaka: <span className="font-mono">{session.plate ?? "—"}</span>
          </p>
        </div>
        <form action={logoutAction}>
          <button type="submit" className="btn-secondary btn-sm">
            Çıkış
          </button>
        </form>
      </header>

      <PanelClient
        active={active}
        past={past}
        defaultPlate={session.plate ?? ""}
      />
    </main>
  );
}

import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabase";
import { logoutAction } from "../../actions/auth";
import { WorkersClient } from "./WorkersClient";
import type { Worker } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function WorkersPage() {
  const session = await requireAdmin();

  const { data: workers } = await supabaseAdmin
    .from("workers")
    .select("*")
    .order("name");

  return (
    <main className="min-h-screen p-4 max-w-5xl mx-auto">
      <header className="flex items-center justify-between mb-6 pt-2 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">Çalışan Yönetimi</h1>
          <p className="text-sm text-slate-600">{session.name}</p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin" className="btn-secondary btn-sm">
            ← Panel
          </Link>
          <form action={logoutAction}>
            <button type="submit" className="btn-secondary btn-sm">
              Çıkış
            </button>
          </form>
        </div>
      </header>

      <WorkersClient workers={(workers ?? []) as Worker[]} />
    </main>
  );
}

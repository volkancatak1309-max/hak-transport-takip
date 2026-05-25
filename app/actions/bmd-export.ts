"use server";

import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/session";
import { workedMs, formatDate, formatTime } from "@/lib/format";
import type { ExportResult } from "./datev-export";

type Row = {
  worker_id: string;
  started_at: string;
  ended_at: string | null;
  break_minutes: number | null;
  plate: string | null;
};

function csvField(v: string): string {
  return `"${v.replace(/"/g, '""')}"`;
}

function monthTag(startIso: string): string {
  const d = new Date(startIso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * BMD (Austria) payroll export — simpler semicolon CSV with UTF-8 BOM.
 * Columns: PersNr;Datum;Beginn;Ende;Pause;Stunden;Bemerkung
 */
export async function generateBMD(
  startIso: string,
  endIso: string
): Promise<ExportResult> {
  await requireAdmin();

  const { data, error } = await supabaseAdmin
    .from("time_entries")
    .select("worker_id, started_at, ended_at, break_minutes, plate")
    .gte("started_at", startIso)
    .lte("started_at", endIso)
    .not("ended_at", "is", null)
    .order("started_at", { ascending: true });

  if (error) return { ok: false, error: error.message };
  const rows = (data ?? []) as Row[];
  if (rows.length === 0) return { ok: false, error: "no_data" };

  const workerIds = [...new Set(rows.map((r) => r.worker_id))];
  const { data: workers } = await supabaseAdmin
    .from("workers")
    .select("id, name")
    .in("id", workerIds);
  const nameById = new Map((workers ?? []).map((w) => [w.id, w.name as string]));

  const header = 'PersNr;Datum;Beginn;Ende;Pause;"Stunden";Bemerkung';

  const lines = rows.map((r) => {
    const persNr = r.worker_id.slice(0, 8);
    const datum = formatDate(r.started_at, "de");
    const beginn = formatTime(r.started_at, "de");
    const ende = formatTime(r.ended_at, "de");
    const pause = String(r.break_minutes ?? 0);
    // Austrian (German) locale: comma decimal separator. The value must stay
    // quoted so the semicolon parser doesn't read the comma as a delimiter.
    const stunden = (
      workedMs({
        started_at: r.started_at,
        ended_at: r.ended_at,
        break_minutes: r.break_minutes ?? 0,
      }) / 3_600_000
    )
      .toFixed(2)
      .replace(".", ",");
    const name = nameById.get(r.worker_id) ?? "—";
    const bemerkung = `${name}${r.plate ? " - " + r.plate : ""}`;
    // Quote every field — comma decimals + Bemerkung can both contain separators.
    return [
      csvField(persNr),
      csvField(datum),
      csvField(beginn),
      csvField(ende),
      csvField(pause),
      csvField(stunden),
      csvField(bemerkung),
    ].join(";");
  });

  const csv = "﻿" + [header, ...lines].join("\r\n");
  return { ok: true, csv, filename: `HAK_BMD_${monthTag(startIso)}.csv` };
}

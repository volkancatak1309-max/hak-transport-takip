"use server";

import { supabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/session";
import { workedMs, formatDate, formatTime } from "@/lib/format";

export type ExportResult =
  | { ok: true; csv: string; filename: string }
  | { ok: false; error: string };

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

function hoursDecimal(ms: number): string {
  return (ms / 3_600_000).toFixed(2);
}

function monthTag(startIso: string): string {
  const d = new Date(startIso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Simplified DATEV-style payroll export (CSV, semicolon, UTF-8 BOM).
 * Real DATEV ASCII is far more complex; this covers the time-tracking fields
 * a Steuerberater needs to import driver hours.
 */
export async function generateDATEV(
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

  const header =
    '"EXTF";"700";"21";"Buchungsstapel";"7";"Stamm-Nr.";"Aufzeichnungsdatum";"Beginn";"Ende";"Pause (Min)";"Stunden gesamt";"Kostenstelle";"Bemerkung"';

  const lines = rows.map((r) => {
    const persNr = r.worker_id.slice(0, 8);
    const datum = formatDate(r.started_at, "de");
    const beginn = formatTime(r.started_at, "de");
    const ende = formatTime(r.ended_at, "de");
    const pause = String(r.break_minutes ?? 0);
    const stunden = hoursDecimal(
      workedMs({
        started_at: r.started_at,
        ended_at: r.ended_at,
        break_minutes: r.break_minutes ?? 0,
      })
    );
    const name = nameById.get(r.worker_id) ?? "—";
    const bemerkung = `${name}${r.plate ? " - " + r.plate : ""}`;
    return [
      '""',
      '""',
      '""',
      '""',
      '""',
      csvField(persNr),
      csvField(datum),
      csvField(beginn),
      csvField(ende),
      csvField(pause),
      csvField(stunden),
      csvField("FAHRER"),
      csvField(bemerkung),
    ].join(";");
  });

  const csv = "﻿" + [header, ...lines].join("\r\n");
  return { ok: true, csv, filename: `HAK_DATEV_${monthTag(startIso)}.csv` };
}
